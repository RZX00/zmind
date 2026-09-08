import { NextRequest } from 'next/server';
import { proxyCanvasRequest } from './_proxy';

export async function GET(request: NextRequest) {
  const { search } = new URL(request.url);
  return proxyCanvasRequest(request, `/canvases${search}`);
}

export async function POST(request: NextRequest) {
  return proxyCanvasRequest(request, '/canvases');
}
