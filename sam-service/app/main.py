import base64
import io
import os
from functools import lru_cache
from typing import Any

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel, Field, field_validator
from transformers import Sam3Model, Sam3Processor


DEFAULT_MODEL_ID = "facebook/sam3"
DEFAULT_MASK_THRESHOLD = 0.5
DEFAULT_SCORE_THRESHOLD = 0.5
DEFAULT_MAX_MASKS = 6


class PointPrompt(BaseModel):
    x: float
    y: float
    label: int
    object_id: int | None = None

    @field_validator("label")
    @classmethod
    def validate_label(cls, value: int) -> int:
        if value not in (0, 1):
            raise ValueError("Point prompt labels must be 0 or 1.")
        return value


class SegmentRequest(BaseModel):
    imageBase64: str
    prompt: str | None = None
    points: list[PointPrompt] = Field(default_factory=list)
    maxMasks: int = DEFAULT_MAX_MASKS

    @field_validator("maxMasks")
    @classmethod
    def validate_max_masks(cls, value: int) -> int:
        return max(1, min(value, 12))


class SegmentResponse(BaseModel):
    maskBase64List: list[str]


def get_device() -> str:
    configured = os.getenv("SAM3_DEVICE")
    if configured:
        return configured
    return "cuda" if torch.cuda.is_available() else "cpu"


def decode_base64_image(image_base64: str) -> Image.Image:
    raw_base64 = image_base64.split(",", 1)[1] if "," in image_base64 else image_base64
    image_bytes = base64.b64decode(raw_base64)
    return Image.open(io.BytesIO(image_bytes)).convert("RGB")


def encode_mask(mask: np.ndarray) -> str | None:
    binary_mask = (mask > 0.5).astype(np.uint8) * 255
    if binary_mask.max(initial=0) == 0:
        return None

    image = Image.fromarray(binary_mask, mode="L")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode('ascii')}"


def flatten_masks(mask_data: Any) -> list[np.ndarray]:
    if isinstance(mask_data, torch.Tensor):
        mask_data = mask_data.detach().cpu().numpy()

    if isinstance(mask_data, list):
        masks: list[np.ndarray] = []
        for item in mask_data:
            masks.extend(flatten_masks(item))
        return masks

    array = np.asarray(mask_data)
    if array.ndim == 2:
        return [array]
    if array.ndim == 3:
        return [array[index] for index in range(array.shape[0])]
    if array.ndim == 4:
        return [
            array[first_index, second_index]
            for first_index in range(array.shape[0])
            for second_index in range(array.shape[1])
        ]
    return []


def build_point_inputs(points: list[PointPrompt]) -> tuple[list[list[list[list[float]]]], list[list[list[int]]]] | tuple[None, None]:
    if not points:
        return None, None

    grouped_points: dict[int, list[PointPrompt]] = {}
    for index, point in enumerate(points):
        group_id = point.object_id if point.object_id is not None else 0
        if point.object_id is None and len(points) > 1:
            group_id = 0
        grouped_points.setdefault(group_id, []).append(point)

    ordered_groups = [grouped_points[key] for key in sorted(grouped_points.keys())]
    input_points = [[
        [[float(point.x), float(point.y)] for point in group]
        for group in ordered_groups
    ]]
    input_labels = [[
        [int(point.label) for point in group]
        for group in ordered_groups
    ]]
    return input_points, input_labels


class Sam3Engine:
    def __init__(self) -> None:
        self.model_id = os.getenv("SAM3_MODEL_ID", DEFAULT_MODEL_ID)
        self.device = get_device()
        token = os.getenv("HF_TOKEN") or None
        dtype = torch.bfloat16 if self.device.startswith("cuda") else torch.float32

        self.model = Sam3Model.from_pretrained(
            self.model_id,
            token=token,
            torch_dtype=dtype,
        ).to(self.device)
        self.model.eval()
        self.processor = Sam3Processor.from_pretrained(self.model_id, token=token)

    def segment(self, request: SegmentRequest) -> list[str]:
        image = decode_base64_image(request.imageBase64)
        input_points, input_labels = build_point_inputs(request.points)

        processor_kwargs: dict[str, Any] = {
            "images": image,
            "return_tensors": "pt",
        }
        if request.prompt:
            processor_kwargs["text"] = request.prompt.strip()
        if input_points is not None and input_labels is not None:
            processor_kwargs["input_points"] = input_points
            processor_kwargs["input_labels"] = input_labels

        inputs = self.processor(**processor_kwargs).to(self.device)
        multimask_output = bool(request.points) and len(request.points) < 2

        with torch.inference_mode():
            outputs = self.model(**inputs, multimask_output=multimask_output)

        if request.points:
            raw_masks = self.processor.post_process_masks(
                outputs.pred_masks.detach().cpu(),
                inputs["original_sizes"],
            )[0]
        else:
            result = self.processor.post_process_instance_segmentation(
                outputs,
                threshold=DEFAULT_SCORE_THRESHOLD,
                mask_threshold=DEFAULT_MASK_THRESHOLD,
                target_sizes=inputs.get("original_sizes").tolist(),
            )[0]
            raw_masks = result.get("masks", [])

        encoded_masks: list[str] = []
        for mask in flatten_masks(raw_masks):
            encoded_mask = encode_mask(mask)
            if encoded_mask:
                encoded_masks.append(encoded_mask)
            if len(encoded_masks) >= request.maxMasks:
                break

        return encoded_masks


@lru_cache(maxsize=1)
def get_engine() -> Sam3Engine:
    return Sam3Engine()


app = FastAPI(title="Texture Enhancer SAM3 Service", version="0.1.0")


@app.get("/healthz")
def healthcheck() -> dict[str, str]:
    return {
        "status": "ok",
        "model": os.getenv("SAM3_MODEL_ID", DEFAULT_MODEL_ID),
        "device": get_device(),
    }


@app.post("/segment", response_model=SegmentResponse)
def segment(request: SegmentRequest) -> SegmentResponse:
    if not request.imageBase64:
        raise HTTPException(status_code=400, detail="imageBase64 is required.")
    if not request.prompt and not request.points:
        raise HTTPException(status_code=400, detail="At least one point or a text prompt is required.")

    try:
        masks = get_engine().segment(request)
    except HTTPException:
        raise
    except Exception as error:  # pragma: no cover - runtime model issues are environment-dependent
        raise HTTPException(status_code=500, detail=str(error)) from error

    if not masks:
        raise HTTPException(
            status_code=422,
            detail="SAM3 could not find anything to segment from the supplied prompts.",
        )

    return SegmentResponse(maskBase64List=masks)
