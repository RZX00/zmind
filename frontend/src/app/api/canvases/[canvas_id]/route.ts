import { NextRequest } from 'next/server';
import { proxyCanvasRequest } from '../_proxy';

export async function GET(request: NextRequest, ctx: { params: Promise<{ canvas_id: string }> }) {
  const { canvas_id } = await ctx.params;
  return proxyCanvasRequest(request, `/canvases/${canvas_id}`, {
    includeIfMatch: true,
  });
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ canvas_id: string }> }) {
  const { canvas_id } = await ctx.params;
  return proxyCanvasRequest(request, `/canvases/${canvas_id}`, {
    includeIfMatch: true,
  });
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ canvas_id: string }> }) {
  const { canvas_id } = await ctx.params;
  return proxyCanvasRequest(request, `/canvases/${canvas_id}`, {
    includeIfMatch: true,
  });
}
