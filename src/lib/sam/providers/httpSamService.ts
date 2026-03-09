import type { SamSegmentRequest, SamSegmentResponse } from "../types";

const DEFAULT_TIMEOUT_MS = 120_000;

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "");

type SamServiceHttpResponse = {
  maskBase64List?: unknown;
  error?: unknown;
  detail?: unknown;
};

export async function segmentWithHttpSamService(
  request: SamSegmentRequest
): Promise<SamSegmentResponse> {
  const samBaseUrl = process.env.SAM3_BASE_URL;
  if (!samBaseUrl) {
    throw new Error("SAM3_BASE_URL is not configured.");
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${normalizeBaseUrl(samBaseUrl)}/segment`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        imageBase64: request.imageBase64,
        prompt: request.prompt ?? null,
        maxMasks: request.maxMasks,
        points: request.points.map((point) => ({
          x: point.x,
          y: point.y,
          label: point.label,
          object_id: point.objectId,
        })),
      }),
      signal: abortController.signal,
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as SamServiceHttpResponse;
    if (!response.ok) {
      const message =
        typeof payload.error === "string"
          ? payload.error
          : typeof payload.detail === "string"
            ? payload.detail
          : "SAM service request failed.";
      throw new Error(message);
    }

    const maskBase64List = Array.isArray(payload.maskBase64List)
      ? payload.maskBase64List.filter(
          (mask): mask is string => typeof mask === "string" && mask.length > 0
        )
      : [];

    if (maskBase64List.length === 0) {
      throw new Error("SAM3 did not return any masks.");
    }

    return { maskBase64List };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("SAM service request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
