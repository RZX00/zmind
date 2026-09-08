import { NextRequest } from 'next/server';
import { proxyCanvasRequest } from '../_proxy';

export async function GET(request: NextRequest) {
  const { search } = new URL(request.url);
  return proxyCanvasRequest(request, `/canvases/meta${search}`, {
    includeIfNoneMatch: true,
    preserveEtag: true,
    allow304: true,
  });
}
