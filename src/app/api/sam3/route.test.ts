// @vitest-environment node

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { segmentWithSam } = vi.hoisted(() => ({
  segmentWithSam: vi.fn(),
}));

vi.mock('@/lib/sam/client', () => ({
  segmentWithSam,
}));

import { POST } from './route';

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/sam3', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
    },
  });

describe('POST /api/sam3', () => {
  beforeEach(() => {
    segmentWithSam.mockReset();
    delete process.env.SAM3_BASE_URL;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns 400 when neither segmentation points nor a text prompt are provided', async () => {
    const response = await POST(
      makeRequest({
        imageBase64: 'data:image/png;base64,abc',
        points: [],
        prompt: '   ',
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Missing required parameters',
    });
  });

  it('normalizes points, uploads the image once, and returns all downloaded masks', async () => {
    segmentWithSam.mockResolvedValue({
      maskBase64List: ['data:image/png;base64,AQID', 'data:image/png;base64,BAUG'],
    });

    const response = await POST(
      makeRequest({
        imageBase64: 'data:image/png;base64,aGVsbG8=',
        prompt: '  isolate the damaged region  ',
        points: [
          { x: '10.8', y: -2, label: '0', object_id: '7' },
          { x: 25.2, y: 11.9, label: 1 },
          { x: 'bad', y: 50, label: 1 },
        ],
      })
    );

    expect(segmentWithSam).toHaveBeenCalledWith({
      imageBase64: 'data:image/png;base64,aGVsbG8=',
      prompt: 'isolate the damaged region',
      points: [
        { x: 11, y: 0, label: 0, objectId: 7 },
        { x: 25, y: 12, label: 1 },
      ],
      maxMasks: 5,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      maskBase64: 'data:image/png;base64,AQID',
      maskBase64List: ['data:image/png;base64,AQID', 'data:image/png;base64,BAUG'],
    });
  });
});
