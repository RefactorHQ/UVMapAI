import { NextRequest, NextResponse } from 'next/server';
import { postAssetServiceFormData } from '@/lib/optimization/httpAssetService';

export const runtime = 'nodejs';
export const maxDuration = 300;

const readProxyError = async (response: Response) => {
  const payload = await response.json().catch(() => ({}));
  return typeof payload?.error === 'string' ? payload.error : 'Model optimization failed.';
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const model = formData.get('model');
    const options = formData.get('options');

    if (!(model instanceof File)) {
      return NextResponse.json({ error: 'model is required.' }, { status: 400 });
    }

    if (typeof options !== 'string') {
      return NextResponse.json({ error: 'options are required.' }, { status: 400 });
    }

    try {
      JSON.parse(options);
    } catch {
      return NextResponse.json({ error: 'options must be valid JSON.' }, { status: 400 });
    }

    const response = await postAssetServiceFormData('/optimize-model', formData);
    if (!response.ok) {
      return NextResponse.json({ error: await readProxyError(response) }, { status: response.status });
    }

    const arrayBuffer = await response.arrayBuffer();
    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'content-type': response.headers.get('content-type') || 'application/octet-stream',
        'content-disposition': response.headers.get('content-disposition') || 'attachment; filename="optimized.glb"'
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Model optimization failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
