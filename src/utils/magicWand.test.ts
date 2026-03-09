import {
  applyMagicWandClick,
  getFullImageRect,
  type MagicWandPoint,
} from './magicWand';

describe('magicWand helpers', () => {
  it('clamps clicks to the image bounds when no explicit selection exists', () => {
    const result = applyMagicWandClick({
      imageRect: getFullImageRect({ width: 100, height: 80 }),
      selectionRect: null,
      samInteractionRegion: null,
      samPoints: [],
      pos: { x: 140, y: -12, label: 1 },
      createPointId: () => 'point-1',
    });

    expect(result.error).toBeUndefined();
    expect(result.updatedPoints).toEqual([
      { id: 'point-1', x: 100, y: 0, label: 1 },
    ]);
    expect(result.nextInteractionRegion).toEqual({ x: 0, y: 0, width: 100, height: 80 });
    expect(result.shouldClearMask).toBe(false);
  });

  it('rejects clicks outside an explicit selection region', () => {
    const existingPoints: MagicWandPoint[] = [{ id: 'keep', x: 25, y: 25, label: 1 }];
    const result = applyMagicWandClick({
      imageRect: getFullImageRect({ width: 100, height: 80 }),
      selectionRect: { x: 10, y: 10, width: 30, height: 30 },
      samInteractionRegion: null,
      samPoints: existingPoints,
      pos: { x: 60, y: 60, label: 1 },
    });

    expect(result.error).toBe('outside-selection');
    expect(result.updatedPoints).toEqual(existingPoints);
    expect(result.shouldClearMask).toBe(false);
  });

  it('toggles an existing point off when clicking within the hit radius', () => {
    const result = applyMagicWandClick({
      imageRect: getFullImageRect({ width: 100, height: 80 }),
      selectionRect: null,
      samInteractionRegion: { x: 0, y: 0, width: 100, height: 80 },
      samPoints: [{ id: 'point-1', x: 40, y: 40, label: 1 }],
      pos: { x: 48, y: 44, label: 1 },
    });

    expect(result.updatedPoints).toEqual([]);
    expect(result.shouldClearMask).toBe(true);
    expect(result.nextInteractionRegion).toEqual({ x: 0, y: 0, width: 100, height: 80 });
  });
});
