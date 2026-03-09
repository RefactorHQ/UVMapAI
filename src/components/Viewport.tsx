'use client';

import React, { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Group, Circle, Text } from 'react-konva';
import Konva from 'konva';
import { Tool } from './Toolbar';

export interface OverlayNode {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    imageObj: HTMLImageElement;
}

export interface SamPoint {
    id: string;
    x: number;
    y: number;
    label: 0 | 1;
}

interface ViewportProps {
    currentTool: Tool;
    imageObj: HTMLImageElement | null;
    overlays: OverlayNode[];
    onSelectionComplete: (rect: { x: number, y: number, width: number, height: number }) => void;
    onSelectionViewportRectChange?: (rect: { x: number, y: number, width: number, height: number } | null) => void;
    onSamClick?: (pos: { x: number, y: number, label: 0 | 1 }) => void;
    samPoints?: SamPoint[];
    samMaskBase64?: string | null;
    samCropRegion?: { x: number, y: number, width: number, height: number } | null;
    viewportSize: { width: number, height: number };
    externalSelectionRect?: { x: number, y: number, width: number, height: number } | null;
}

export interface ViewportRef {
    extractSelection: (rect: { x: number; y: number; width: number; height: number }) => string | null;
}

const Viewport = forwardRef<ViewportRef, ViewportProps>(({
    currentTool,
    imageObj,
    overlays,
    onSelectionComplete,
    onSelectionViewportRectChange,
    onSamClick,
    samPoints = [],
    samMaskBase64,
    samCropRegion,
    viewportSize,
    externalSelectionRect
}, ref) => {
    const stageRef = useRef<Konva.Stage>(null);
    const [scale, setScale] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isTemporaryPanning, setIsTemporaryPanning] = useState(false);

    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressActivatedRef = useRef(false);
    const pendingTouchSamPosRef = useRef<{ x: number; y: number } | null>(null);

    // Helper to get coordinates relative to the untransformed image pixels
    const getRelativePointerPosition = () => {
        if (!stageRef.current) return null;
        const stage = stageRef.current;
        const transform = stage.getAbsoluteTransform().copy().invert();
        const pos = stage.getPointerPosition();
        if (!pos) return null;
        return transform.point(pos);
    };

    // Selection state
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionRect, setSelectionRect] = useState<{ x: number, y: number, width: number, height: number } | null>(null);

    const activeImageRef = useRef<HTMLImageElement | null>(null);
    const [samMaskImage, setSamMaskImage] = useState<HTMLImageElement | null>(null);
    const pointRefs = useRef<Record<string, Konva.Group | null>>({});
    const pointPhaseRef = useRef<Record<string, 'enter' | 'idle' | 'leave'>>({});
    const pointTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
    const [animatedSamPoints, setAnimatedSamPoints] = useState<Array<SamPoint & { phase: 'enter' | 'idle' | 'leave' }>>([]);

    // Animate point additions/removals smoothly.
    useEffect(() => {
        setAnimatedSamPoints((previousPoints) => {
            const incomingMap = new Map(samPoints.map((point) => [point.id, point]));
            const nextPoints: Array<SamPoint & { phase: 'enter' | 'idle' | 'leave' }> = [];

            previousPoints.forEach((point) => {
                const incoming = incomingMap.get(point.id);
                if (incoming) {
                    nextPoints.push({ ...incoming, phase: point.phase === 'enter' ? 'enter' : 'idle' });
                    incomingMap.delete(point.id);
                } else if (point.phase !== 'leave') {
                    nextPoints.push({ ...point, phase: 'leave' });
                } else {
                    nextPoints.push(point);
                }
            });

            incomingMap.forEach((point) => {
                nextPoints.push({ ...point, phase: 'enter' });
            });

            return nextPoints;
        });
    }, [samPoints]);

    useEffect(() => {
        animatedSamPoints.forEach((point) => {
            const node = pointRefs.current[point.id];
            if (!node) return;

            const lastPhase = pointPhaseRef.current[point.id];
            if (lastPhase === point.phase) return;
            pointPhaseRef.current[point.id] = point.phase;

            if (pointTimerRef.current[point.id]) {
                clearTimeout(pointTimerRef.current[point.id]);
            }

            if (point.phase === 'enter') {
                node.opacity(0);
                node.scale({ x: 0.35, y: 0.35 });
                node.to({
                    opacity: 1,
                    scaleX: 1,
                    scaleY: 1,
                    duration: 0.2,
                    easing: Konva.Easings.EaseOut
                });

                pointTimerRef.current[point.id] = setTimeout(() => {
                    setAnimatedSamPoints((currentPoints) =>
                        currentPoints.map((currentPoint) =>
                            currentPoint.id === point.id && currentPoint.phase === 'enter'
                                ? { ...currentPoint, phase: 'idle' }
                                : currentPoint
                        )
                    );
                }, 220);
                return;
            }

            if (point.phase === 'leave') {
                node.to({
                    opacity: 0,
                    scaleX: 0.35,
                    scaleY: 0.35,
                    duration: 0.16,
                    easing: Konva.Easings.EaseIn,
                    onFinish: () => {
                        setAnimatedSamPoints((currentPoints) => currentPoints.filter((currentPoint) => currentPoint.id !== point.id));
                        delete pointRefs.current[point.id];
                        delete pointPhaseRef.current[point.id];
                        if (pointTimerRef.current[point.id]) {
                            clearTimeout(pointTimerRef.current[point.id]);
                            delete pointTimerRef.current[point.id];
                        }
                    }
                });
                return;
            }

            node.opacity(1);
            node.scale({ x: 1, y: 1 });
        });
    }, [animatedSamPoints]);

    useEffect(() => {
        const timers = pointTimerRef.current;
        return () => {
            Object.values(timers).forEach((timer) => clearTimeout(timer));
        };
    }, []);

    // Convert sam mask string to Image object
    useEffect(() => {
        if (!samMaskBase64) {
            setSamMaskImage(null);
            return;
        }
        const img = new window.Image();
        img.src = samMaskBase64;
        img.onload = () => {
            setSamMaskImage(img);
        };
    }, [samMaskBase64]);

    // Center/focus image on first load
    useEffect(() => {
        if (imageObj && stageRef.current && viewportSize.width > 0) {
            // Only re-center the camera if the actual image object changed
            // We don't want to aggressively snap back when the window resizes
            if (activeImageRef.current !== imageObj) {
                activeImageRef.current = imageObj;

                if (externalSelectionRect) {
                    // Focus nicely on the selection box 
                    const padding = 100;
                    const availableW = Math.max(100, viewportSize.width - padding);
                    const availableH = Math.max(100, viewportSize.height - padding);

                    const scaleX = availableW / externalSelectionRect.width;
                    const scaleY = availableH / externalSelectionRect.height;
                    const newScale = Math.max(0.1, Math.min(scaleX, scaleY, 5)); // Cap maximum zoom so it doesn't get pixelated

                    setScale(newScale);

                    const cx = externalSelectionRect.x + externalSelectionRect.width / 2;
                    const cy = externalSelectionRect.y + externalSelectionRect.height / 2;

                    setPosition({
                        x: viewportSize.width / 2 - cx * newScale,
                        y: viewportSize.height / 2 - cy * newScale
                    });

                    setSelectionRect(externalSelectionRect);
                } else {
                    const scaleX = viewportSize.width / imageObj.width;
                    const scaleY = viewportSize.height / imageObj.height;

                    // Fit to screen with some padding
                    const initialScale = Math.max(0.1, Math.min(scaleX, scaleY) * 0.9);
                    setScale(initialScale);

                    setPosition({
                        x: (viewportSize.width - imageObj.width * initialScale) / 2,
                        y: (viewportSize.height - imageObj.height * initialScale) / 2
                    });
                    setSelectionRect(null);
                }
            }
        }
    }, [imageObj, viewportSize, externalSelectionRect]);

    // Sync external programmatic selections (like from 3D UV clicks)
    useEffect(() => {
        if (externalSelectionRect !== undefined) {
            setSelectionRect(externalSelectionRect);
        }
    }, [externalSelectionRect]);

    // Report current selection rectangle in viewport pixels for anchored UI (prompt panel).
    useEffect(() => {
        if (!onSelectionViewportRectChange || !selectionRect) {
            onSelectionViewportRectChange?.(null);
            return;
        }
        const normalizedRect = {
            x: selectionRect.width < 0 ? selectionRect.x + selectionRect.width : selectionRect.x,
            y: selectionRect.height < 0 ? selectionRect.y + selectionRect.height : selectionRect.y,
            width: Math.abs(selectionRect.width),
            height: Math.abs(selectionRect.height)
        };
        onSelectionViewportRectChange({
            x: normalizedRect.x * scale + position.x,
            y: normalizedRect.y * scale + position.y,
            width: normalizedRect.width * scale,
            height: normalizedRect.height * scale
        });
    }, [onSelectionViewportRectChange, selectionRect, scale, position]);

    const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
        e.evt.preventDefault();
        if (!stageRef.current) return;

        const scaleBy = 1.1;
        const stage = stageRef.current;
        const oldScale = stage.scaleX();

        const pointer = stage.getPointerPosition();
        if (!pointer) return;

        const mousePointTo = {
            x: (pointer.x - stage.x()) / oldScale,
            y: (pointer.y - stage.y()) / oldScale,
        };

        const direction = e.evt.deltaY > 0 ? -1 : 1;
        let newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
        newScale = Math.max(0.1, Math.min(newScale, 10));

        setScale(newScale);
        setPosition({
            x: pointer.x - mousePointTo.x * newScale,
            y: pointer.y - mousePointTo.y * newScale,
        });
    };

    const startTemporaryPan = (targetStage: Konva.Stage) => {
        if (isTemporaryPanning) return;
        setIsTemporaryPanning(true);
        targetStage.draggable(true);
        targetStage.startDrag();
    };

    const stopTemporaryPan = () => {
        if (!stageRef.current || !isTemporaryPanning) return;
        setPosition({ x: stageRef.current.x(), y: stageRef.current.y() });
        stageRef.current.draggable(false);
        setIsTemporaryPanning(false);
    };

    const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
        if (!stageRef.current) return;
        if ('button' in e.evt && e.evt.button === 1) {
            e.evt.preventDefault();
            startTemporaryPan(stageRef.current);
            return;
        }
        if (
            e.target.getStage() !== stageRef.current
            && e.target.name() !== 'base-image'
            && e.target.name() !== 'sam-mask'
            && e.target.name() !== 'sam-point'
        ) return;

        if (currentTool === 'sam-select') {
            e.evt.preventDefault();
            const pos = getRelativePointerPosition();
            if (pos && onSamClick) {
                if (imageObj && pos.x >= 0 && pos.x <= imageObj.width && pos.y >= 0 && pos.y <= imageObj.height) {
                    const isTouchEvent = e.evt.type === 'touchstart';
                    if (!isTouchEvent) {
                        const label: 0 | 1 = 'button' in e.evt && e.evt.button === 2 ? 0 : 1;
                        onSamClick({ x: pos.x, y: pos.y, label });
                    } else {
                        pendingTouchSamPosRef.current = { x: pos.x, y: pos.y };
                        longPressActivatedRef.current = false;
                        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                        longPressTimerRef.current = setTimeout(() => {
                            const savedPos = pendingTouchSamPosRef.current;
                            if (savedPos && onSamClick) {
                                longPressActivatedRef.current = true;
                                onSamClick({ x: savedPos.x, y: savedPos.y, label: 0 });
                                try { navigator.vibrate?.(60); } catch { /* ignore */ }
                            }
                        }, 600);
                    }
                }
            }
            return;
        }

        if (currentTool !== 'select') return;

        setIsSelecting(true);
        const pos = getRelativePointerPosition();
        if (!pos) return;

        setSelectionRect({
            x: pos.x,
            y: pos.y,
            width: 0,
            height: 0
        });
    };

    const handleMouseMove = () => {
        if (!isSelecting || !selectionRect || !stageRef.current) return;

        const pos = getRelativePointerPosition();
        if (!pos) return;

        setSelectionRect({
            x: selectionRect.x,
            y: selectionRect.y,
            width: pos.x - selectionRect.x,
            height: pos.y - selectionRect.y
        });
    };

    const handleMouseUp = () => {
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
        if (isTemporaryPanning) {
            stopTemporaryPan();
            return;
        }
        if (!isSelecting || !selectionRect) return;
        setIsSelecting(false);

        const normalizedRect = {
            x: selectionRect.width < 0 ? selectionRect.x + selectionRect.width : selectionRect.x,
            y: selectionRect.height < 0 ? selectionRect.y + selectionRect.height : selectionRect.y,
            width: Math.abs(selectionRect.width),
            height: Math.abs(selectionRect.height)
        };

        setSelectionRect(normalizedRect);

        if (normalizedRect.width > 20 && normalizedRect.height > 20) {
            onSelectionComplete(normalizedRect);
        } else {
            setSelectionRect(null); // Clear accidental tiny clicks
        }
    };

    useImperativeHandle(ref, () => ({
        extractSelection: (rect: { x: number; y: number; width: number; height: number }) => {
            if (!imageObj) return null;

            const normalizedRect = {
                x: rect.width < 0 ? rect.x + rect.width : rect.x,
                y: rect.height < 0 ? rect.y + rect.height : rect.y,
                width: Math.abs(rect.width),
                height: Math.abs(rect.height)
            };

            const cropX = Math.max(0, Math.floor(normalizedRect.x));
            const cropY = Math.max(0, Math.floor(normalizedRect.y));
            const cropWidth = Math.max(1, Math.min(imageObj.width - cropX, Math.ceil(normalizedRect.width)));
            const cropHeight = Math.max(1, Math.min(imageObj.height - cropY, Math.ceil(normalizedRect.height)));

            const canvas = document.createElement('canvas');
            canvas.width = cropWidth;
            canvas.height = cropHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            // Export from source pixels only so viewport UI overlays never leak into the request.
            ctx.drawImage(
                imageObj,
                cropX,
                cropY,
                cropWidth,
                cropHeight,
                0,
                0,
                cropWidth,
                cropHeight
            );

            overlays.forEach((overlay) => {
                const overlayLeft = overlay.x;
                const overlayTop = overlay.y;
                const overlayRight = overlay.x + overlay.width;
                const overlayBottom = overlay.y + overlay.height;

                if (
                    overlayRight <= cropX ||
                    overlayBottom <= cropY ||
                    overlayLeft >= cropX + cropWidth ||
                    overlayTop >= cropY + cropHeight
                ) {
                    return;
                }

                const sourceX = Math.max(0, cropX - overlayLeft);
                const sourceY = Math.max(0, cropY - overlayTop);
                const sourceWidth = Math.min(overlay.width - sourceX, cropX + cropWidth - Math.max(cropX, overlayLeft));
                const sourceHeight = Math.min(overlay.height - sourceY, cropY + cropHeight - Math.max(cropY, overlayTop));
                const destX = Math.max(0, overlayLeft - cropX);
                const destY = Math.max(0, overlayTop - cropY);

                if (sourceWidth <= 0 || sourceHeight <= 0) {
                    return;
                }

                ctx.drawImage(
                    overlay.imageObj,
                    sourceX,
                    sourceY,
                    sourceWidth,
                    sourceHeight,
                    destX,
                    destY,
                    sourceWidth,
                    sourceHeight
                );
            });

            return canvas.toDataURL('image/png');
        }
    }), [imageObj, overlays]);

    return (
        <Stage
            width={viewportSize.width}
            height={viewportSize.height}
            onWheel={handleWheel}
            draggable={isTemporaryPanning}
            scaleX={scale}
            scaleY={scale}
            x={position.x}
            y={position.y}
            onDragEnd={(e) => {
                setPosition({ x: e.target.x(), y: e.target.y() });
                if (isTemporaryPanning) {
                    e.target.draggable(false);
                    setIsTemporaryPanning(false);
                }
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onTouchStart={(e) => {
                if (!stageRef.current) return;
                if (e.evt.touches.length >= 2) {
                    e.evt.preventDefault();
                    startTemporaryPan(stageRef.current);
                }
            }}
            onTouchEnd={(e) => {
                if (longPressTimerRef.current) {
                    clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                }
                if (
                    currentTool === 'sam-select' &&
                    pendingTouchSamPosRef.current &&
                    !longPressActivatedRef.current &&
                    e.evt.changedTouches.length === 1
                ) {
                    const pos = pendingTouchSamPosRef.current;
                    onSamClick?.({ x: pos.x, y: pos.y, label: 1 });
                }
                pendingTouchSamPosRef.current = null;
                longPressActivatedRef.current = false;
                if (isTemporaryPanning) {
                    stopTemporaryPan();
                }
            }}
            onTouchMove={() => {
                if (longPressTimerRef.current) {
                    clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                    pendingTouchSamPosRef.current = null;
                }
            }}
            onContextMenu={(e) => {
                e.evt.preventDefault();
            }}
            ref={stageRef}
            style={{ cursor: isTemporaryPanning ? 'grab' : (currentTool === 'sam-select' && onSamClick) ? 'crosshair' : currentTool === 'select' ? 'crosshair' : 'default' }}
        >
            <Layer>
                {imageObj && (
                    <KonvaImage
                        name="base-image"
                        image={imageObj}
                        x={0}
                        y={0}
                    />
                )}

                {samMaskImage && (
                    <KonvaImage
                        name="sam-mask"
                        image={samMaskImage}
                        x={samCropRegion?.x ?? 0}
                        y={samCropRegion?.y ?? 0}
                        width={samCropRegion?.width ?? samMaskImage.width}
                        height={samCropRegion?.height ?? samMaskImage.height}
                        opacity={0.5}
                        filters={[Konva.Filters.RGB]}
                        red={255}
                        green={138}
                        blue={61}
                    />
                )}

                {overlays && overlays.map((overlay) => (
                    <KonvaImage
                        key={overlay.id}
                        image={overlay.imageObj}
                        x={overlay.x}
                        y={overlay.y}
                        width={overlay.width}
                        height={overlay.height}
                    />
                ))}

                {selectionRect && (
                    <Group>
                        <Rect
                            x={selectionRect.width < 0 ? selectionRect.x + selectionRect.width : selectionRect.x}
                            y={selectionRect.height < 0 ? selectionRect.y + selectionRect.height : selectionRect.y}
                            width={Math.abs(selectionRect.width)}
                            height={Math.abs(selectionRect.height)}
                            stroke="rgba(255,255,255,0.95)"
                            strokeWidth={4 / scale}
                            shadowColor="rgba(0, 0, 0, 0.45)"
                            shadowBlur={10 / scale}
                            listening={false}
                        />
                        <Rect
                            x={selectionRect.width < 0 ? selectionRect.x + selectionRect.width : selectionRect.x}
                            y={selectionRect.height < 0 ? selectionRect.y + selectionRect.height : selectionRect.y}
                            width={Math.abs(selectionRect.width)}
                            height={Math.abs(selectionRect.height)}
                            stroke={samMaskBase64 ? "#FF8A3D" : "#4A8CFF"}
                            strokeWidth={2.5 / scale}
                            dash={[8 / scale, 6 / scale]}
                            fill={samMaskBase64 ? "rgba(255, 138, 61, 0.18)" : "rgba(74, 140, 255, 0.16)"}
                            listening={false}
                        />
                    </Group>
                )}

                {animatedSamPoints.map((point, index) => (
                    <Group
                        key={point.id}
                        name="sam-point"
                        x={point.x}
                        y={point.y}
                        ref={(node) => {
                            pointRefs.current[point.id] = node;
                        }}
                    >
                        <Circle
                            name="sam-point"
                            radius={10 / scale}
                            fill={point.label === 0 ? 'rgba(255, 107, 107, 0.24)' : 'rgba(74, 140, 255, 0.24)'}
                            stroke={point.label === 0 ? '#FF6B6B' : '#4A8CFF'}
                            strokeWidth={2 / scale}
                            shadowColor="rgba(0, 0, 0, 0.35)"
                            shadowBlur={8 / scale}
                            shadowOffsetY={1 / scale}
                        />
                        <Circle
                            name="sam-point"
                            radius={4 / scale}
                            fill={point.label === 0 ? '#FF6B6B' : '#4A8CFF'}
                        />
                        <Text
                            name="sam-point"
                            text={point.label === 0 ? '−' : `${index + 1}`}
                            fontSize={9 / scale}
                            fill="#FFFFFF"
                            align="center"
                            verticalAlign="middle"
                            width={16 / scale}
                            height={16 / scale}
                            x={-8 / scale}
                            y={-22 / scale}
                            listening={false}
                        />
                    </Group>
                ))}
            </Layer>
        </Stage>
    );
});

Viewport.displayName = 'Viewport';
export default Viewport;
