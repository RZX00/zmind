import { NextRequest } from 'next/server';
import { proxyCanvasRequest } from '../../_proxy';

export async function GET(request: NextRequest, ctx: { params: Promise<{ canvas_id: string }> }) {
  const { canvas_id } = await ctx.params;
  const search = new URL(request.url).search;
  return proxyCanvasRequest(request, `/canvases/${canvas_id}/versions${search}`);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ canvas_id: string }> }) {
  const { canvas_id } = await ctx.params;
  return proxyCanvasRequest(request, `/canvases/${canvas_id}/versions`, {
    method: 'POST',
  });
}
