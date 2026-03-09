// @vitest-environment node

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { postAssetServiceFormData } = vi.hoisted(() => ({
  postAssetServiceFormData: vi.fn()
}));

vi.mock('@/lib/optimization/httpAssetService', () => ({
  postAssetServiceFormData
}));

import { POST } from './route';

const makeRequest = (formData: FormData) =>
  new NextRequest('http://localhost/api/optimize-texture', {
    method: 'POST',
    body: formData
  });

describe('POST /api/optimize-texture', () => {
  beforeEach(() => {
    postAssetServiceFormData.mockReset();
  });

  it('returns 400 when the image is missing', async () => {
    const formData = new FormData();
    formData.set('source', JSON.stringify({ width: 256, height: 256 }));
    formData.set('options', JSON.stringify({ format: 'webp' }));

    const response = await POST(makeRequest(formData));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'image is required.' });
  });

  it('proxies the request to the asset service and returns the JSON payload', async () => {
    const formData = new FormData();
    formData.set('image', new File(['hello'], 'texture.png', { type: 'image/png' }));
    formData.set('source', JSON.stringify({ slot: 'baseColor', width: 256, height: 256 }));
    formData.set('options', JSON.stringify({ format: 'webp', quality: 80, resizePercent: 100 }));

    postAssetServiceFormData.mockResolvedValue(
      new Response(JSON.stringify({ previewDataUrl: 'data:image/png;base64,AQID' }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      })
    );

    const response = await POST(makeRequest(formData));

    expect(postAssetServiceFormData).toHaveBeenCalledWith('/optimize-texture', expect.any(FormData));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ previewDataUrl: 'data:image/png;base64,AQID' });
  });
});
