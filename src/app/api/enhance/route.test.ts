// @vitest-environment node

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContent } = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent,
    };
  },
}));

import { POST } from './route';

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/enhance', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
    },
  });

describe('POST /api/enhance', () => {
  beforeEach(() => {
    generateContent.mockReset();
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns 400 when prompt or image payload is missing', async () => {
    const response = await POST(makeRequest({ prompt: '', imageBase64: '' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Missing prompt or imageBase64',
    });
  });

  it('strips the data URL prefix before sending the image to Gemini', async () => {
    generateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: 'enhanced-image',
                },
              },
            ],
          },
        },
      ],
    });

    const response = await POST(
      makeRequest({
        prompt: 'Clean the texture seams',
        imageBase64: 'data:image/png;base64,raw-image-data',
      })
    );

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-flash-image-preview',
        contents: [
          { text: 'Clean the texture seams' },
          {
            inlineData: {
              mimeType: 'image/png',
              data: 'raw-image-data',
            },
          },
        ],
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      imageBase64: 'data:image/png;base64,enhanced-image',
    });
  });

  it('retries with an anti-recitation prompt when Gemini blocks a near-duplicate image', async () => {
    generateContent
      .mockResolvedValueOnce({
        candidates: [
          {
            finishReason: 'IMAGE_RECITATION',
            content: { parts: [] },
          },
        ],
      })
      .mockResolvedValueOnce({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: 'fresh-variation',
                  },
                },
              ],
            },
          },
        ],
      });

    const response = await POST(
      makeRequest({
        prompt: 'Enhance only the selected scratches',
        imageBase64: 'base64-source',
      })
    );

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        contents: [
          {
            text: expect.stringContaining('Important anti-recitation constraint:'),
          },
          {
            inlineData: {
              mimeType: 'image/png',
              data: 'base64-source',
            },
          },
        ],
      })
    );
    await expect(response.json()).resolves.toEqual({
      imageBase64: 'data:image/jpeg;base64,fresh-variation',
    });
  });
});
