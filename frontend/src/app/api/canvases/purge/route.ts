import { NextRequest } from 'next/server';
import { proxyCanvasRequest } from '../_proxy';

export async function POST(request: NextRequest) {
  return proxyCanvasRequest(request, '/canvases/purge', {
    method: 'POST',
  });
}
