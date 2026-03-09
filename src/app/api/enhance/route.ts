import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';

type GeminiInlineData = {
    mimeType?: string;
    mime_type?: string;
    data?: string;
};

type GeminiCandidate = {
    content?: {
        parts?: Array<{
            inlineData?: GeminiInlineData;
            inline_data?: GeminiInlineData;
        }>;
    };
    finishReason?: string;
    finish_reason?: string;
};

type GeminiResponse = {
    candidates?: GeminiCandidate[];
    promptFeedback?: unknown;
    prompt_feedback?: unknown;
};

const createAiClient = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not configured.');
    }
    return new GoogleGenAI({ apiKey });
};

export async function POST(req: NextRequest) {
    try {
        const { prompt, imageBase64 } = await req.json();

        if (!prompt || !imageBase64) {
            return NextResponse.json({ error: 'Missing prompt or imageBase64' }, { status: 400 });
        }

        // Remove data:image/png;base64, prefix if present
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const ai = createAiClient();

        const generate = async (promptText: string) => {
            return ai.models.generateContent({
                model: 'gemini-3.1-flash-image-preview',
                contents: [
                    { text: promptText },
                    {
                        inlineData: {
                            mimeType: 'image/png',
                            data: base64Data,
                        },
                    },
                ],
                config: {
                    responseModalities: ['IMAGE'],
                }
            });
        };

        const extractImage = (response: GeminiResponse): string | null => {
            for (const candidate of response.candidates || []) {
                const parts = candidate?.content?.parts || [];
                for (const part of parts) {
                    const inline = part?.inlineData || part?.inline_data;
                    const mimeType = inline?.mimeType || inline?.mime_type;
                    const data = inline?.data;
                    if (data && mimeType) {
                        return `data:${mimeType};base64,${data}`;
                    }
                }
            }
            return null;
        };

        const getFinishReasons = (response: GeminiResponse): string[] => {
            return (response.candidates || [])
                .map((candidate) => candidate?.finishReason || candidate?.finish_reason)
                .filter((reason): reason is string => Boolean(reason));
        };

        let response = await generate(prompt) as GeminiResponse;
        let newImageData = extractImage(response);

        // Automatic fallback when Gemini blocks near-identical outputs.
        if (!newImageData) {
            const finishReasons = getFinishReasons(response);
            if (finishReasons.includes('IMAGE_RECITATION')) {
                const antiRecitationPrompt = `${prompt}

Important anti-recitation constraint:
- Create a fresh variant, not a near-duplicate copy of the input pixels.
- Keep material/style consistent, but introduce subtle non-identical texture variation in the edited region.`;
                response = await generate(antiRecitationPrompt);
                newImageData = extractImage(response);
            }
        }

        if (!newImageData) {
            const finishReasons = getFinishReasons(response);
            const promptFeedback = response.promptFeedback || response.prompt_feedback;
            console.error('Gemini raw response (no image):', JSON.stringify({
                finishReasons,
                promptFeedback,
                candidates: (response.candidates || []).length
            }, null, 2));
            throw new Error("No image was returned by Gemini. Try simplifying the prompt or reducing selected area.");
        }

        return NextResponse.json({ imageBase64: newImageData });

    } catch (error: unknown) {
        console.error('Enhancement Error:', error);
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
