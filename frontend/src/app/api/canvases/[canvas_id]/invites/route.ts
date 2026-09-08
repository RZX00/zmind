import { NextRequest } from 'next/server';
import { proxyCanvasRequest } from '../../_proxy';

export async function GET(request: NextRequest, ctx: { params: Promise<{ canvas_id: string }> }) {
  const { canvas_id } = await ctx.params;
  return proxyCanvasRequest(request, `/canvases/${canvas_id}/invites`);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ canvas_id: string }> }) {
  const { canvas_id } = await ctx.params;
  return proxyCanvasRequest(request, `/canvases/${canvas_id}/invites`, {
    forceJsonContentType: true,
  });
}
