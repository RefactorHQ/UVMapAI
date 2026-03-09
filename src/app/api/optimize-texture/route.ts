import { NextRequest, NextResponse } from 'next/server';
import { postAssetServiceFormData } from '@/lib/optimization/httpAssetService';

export const runtime = 'nodejs';
export const maxDuration = 300;

const readProxyError = async (response: Response) => {
  const payload = await response.json().catch(() => ({}));
  return typeof payload?.error === 'string' ? payload.error : 'Texture optimization failed.';
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const image = formData.get('image');
    const source = formData.get('source');
    const options = formData.get('options');

    if (!(image instanceof File)) {
      return NextResponse.json({ error: 'image is required.' }, { status: 400 });
    }

    if (typeof source !== 'string' || typeof options !== 'string') {
      return NextResponse.json({ error: 'source and options are required.' }, { status: 400 });
    }

    try {
      JSON.parse(source);
      JSON.parse(options);
    } catch {
      return NextResponse.json({ error: 'source and options must be valid JSON.' }, { status: 400 });
    }

    const response = await postAssetServiceFormData('/optimize-texture', formData);
    if (!response.ok) {
      return NextResponse.json({ error: await readProxyError(response) }, { status: response.status });
    }

    const payload = await response.json();
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Texture optimization failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
