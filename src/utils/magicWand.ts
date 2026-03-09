export interface MagicWandPoint {
  id: string;
  x: number;
  y: number;
  label: 0 | 1;
}

export interface MagicWandRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MagicWandClickPosition {
  x: number;
  y: number;
  label: 0 | 1;
}

interface ApplyMagicWandClickParams {
  imageRect: MagicWandRect | null;
  selectionRect: MagicWandRect | null;
  samInteractionRegion: MagicWandRect | null;
  samPoints: MagicWandPoint[];
  pos: MagicWandClickPosition;
  createPointId?: () => string;
}

type MagicWandClickError = 'invalid-area' | 'outside-selection';

export interface ApplyMagicWandClickResult {
  error?: MagicWandClickError;
  updatedPoints: MagicWandPoint[];
  nextInteractionRegion: MagicWandRect | null;
  shouldClearMask: boolean;
}

export const getFullImageRect = (
  imageObj: { width: number; height: number } | null
): MagicWandRect | null => {
  if (!imageObj) return null;

  return {
    x: 0,
    y: 0,
    width: imageObj.width,
    height: imageObj.height,
  };
};

export const applyMagicWandClick = ({
  imageRect,
  selectionRect,
  samInteractionRegion,
  samPoints,
  pos,
  createPointId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
}: ApplyMagicWandClickParams): ApplyMagicWandClickResult => {
  const explicitRegion = samInteractionRegion || selectionRect;
  const activeRegion = explicitRegion || imageRect;

  if (!activeRegion || activeRegion.width < 10 || activeRegion.height < 10) {
    return {
      error: 'invalid-area',
      updatedPoints: samPoints,
      nextInteractionRegion: samInteractionRegion,
      shouldClearMask: false,
    };
  }

  const cropX = activeRegion.width < 0 ? activeRegion.x + activeRegion.width : activeRegion.x;
  const cropY = activeRegion.height < 0 ? activeRegion.y + activeRegion.height : activeRegion.y;
  const cropW = Math.abs(activeRegion.width);
  const cropH = Math.abs(activeRegion.height);

  const isOutsideActiveRegion =
    pos.x < cropX || pos.x > cropX + cropW || pos.y < cropY || pos.y > cropY + cropH;

  let normalizedPos = pos;
  if (isOutsideActiveRegion) {
    if (explicitRegion) {
      return {
        error: 'outside-selection',
        updatedPoints: samPoints,
        nextInteractionRegion: samInteractionRegion,
        shouldClearMask: false,
      };
    }

    normalizedPos = {
      ...pos,
      x: Math.max(cropX, Math.min(pos.x, cropX + cropW)),
      y: Math.max(cropY, Math.min(pos.y, cropY + cropH)),
    };
  }

  const HIT_RADIUS_PX = 14;
  const existingPoint = samPoints.find(
    (point) => Math.hypot(point.x - normalizedPos.x, point.y - normalizedPos.y) <= HIT_RADIUS_PX
  );

  const updatedPoints = existingPoint
    ? samPoints.filter((point) => point.id !== existingPoint.id)
    : [
        ...samPoints,
        {
          id: createPointId(),
          x: normalizedPos.x,
          y: normalizedPos.y,
          label: normalizedPos.label,
        },
      ];

  return {
    updatedPoints,
    nextInteractionRegion: samInteractionRegion || activeRegion,
    shouldClearMask: updatedPoints.length === 0,
  };
};
