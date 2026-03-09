import { NextRequest, NextResponse } from 'next/server';
import { segmentWithSam } from '@/lib/sam/client';
import type { SamPointPrompt } from '@/lib/sam/types';

export const maxDuration = 60;

type IncomingSamPoint = {
    x?: unknown;
    y?: unknown;
    label?: unknown;
    object_id?: unknown;
};

type NormalizedSamPoint = {
    x: number;
    y: number;
    label: 0 | 1;
    object_id?: number;
};

const asObject = (value: unknown): Record<string, unknown> | null => (
    typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
);

export async function POST(req: NextRequest) {
    try {
        const { imageBase64, x, y, points, prompt } = await req.json();
        const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';

        const normalizedPoints: NormalizedSamPoint[] = Array.isArray(points)
            ? points
                .map((point): NormalizedSamPoint => {
                    const candidate = asObject(point) as IncomingSamPoint | null;
                    return {
                        x: Number(candidate?.x),
                        y: Number(candidate?.y),
                        label: candidate?.label === 0 || candidate?.label === '0' ? 0 : 1,
                        object_id: Number.isFinite(Number(candidate?.object_id)) ? Number(candidate?.object_id) : undefined,
                    };
                })
                .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
            : (x !== undefined && y !== undefined)
                ? [{ x: Number(x), y: Number(y), label: 1 as const, object_id: undefined }]
                : [];

        if (!imageBase64 || (normalizedPoints.length === 0 && !trimmedPrompt)) {
            return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
        }

        const pointPrompts: SamPointPrompt[] = normalizedPoints.map((point) => ({
            x: Math.round(Math.max(0, point.x)),
            y: Math.round(Math.max(0, point.y)),
            label: point.label === 0 ? 0 : 1,
            ...(point.object_id !== undefined ? { objectId: point.object_id } : {})
        }));
        const maxMasks = Math.max(3, 3 + pointPrompts.length);
        console.log('[SAM3] Points:', pointPrompts);
        console.log('[SAM3] Prompt:', trimmedPrompt || '(none)');
        console.log('[SAM3] max_masks=', maxMasks);

        const result = await segmentWithSam({
            imageBase64,
            points: pointPrompts,
            prompt: trimmedPrompt || undefined,
            maxMasks,
        });

        console.log('[SAM3] Success, masks:', result.maskBase64List.length);
        return NextResponse.json({
            maskBase64: result.maskBase64List[0],
            maskBase64List: result.maskBase64List
        });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        console.error('[SAM3] Error:', message);
        const errorDetails = asObject(error);
        if (errorDetails?.body) console.error('[SAM3] Body:', JSON.stringify(errorDetails.body, null, 2));
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
