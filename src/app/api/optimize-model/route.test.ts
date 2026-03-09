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
  new NextRequest('http://localhost/api/optimize-model', {
    method: 'POST',
    body: formData
  });

describe('POST /api/optimize-model', () => {
  beforeEach(() => {
    postAssetServiceFormData.mockReset();
  });

  it('returns 400 when the model is missing', async () => {
    const formData = new FormData();
    formData.set('options', JSON.stringify({ outputFormat: 'glb' }));

    const response = await POST(makeRequest(formData));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'model is required.' });
  });

  it('streams the optimized artifact back to the client', async () => {
    const formData = new FormData();
    formData.set('model', new File(['glb'], 'scene.glb', { type: 'model/gltf-binary' }));
    formData.set('options', JSON.stringify({ outputFormat: 'glb' }));

    postAssetServiceFormData.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          'content-type': 'model/gltf-binary',
          'content-disposition': 'attachment; filename="scene.glb"'
        }
      })
    );

    const response = await POST(makeRequest(formData));

    expect(postAssetServiceFormData).toHaveBeenCalledWith('/optimize-model', expect.any(FormData));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('model/gltf-binary');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="scene.glb"');
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2, 3]);
  });
});
