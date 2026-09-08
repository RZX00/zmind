import { NextRequest } from 'next/server';
import { proxyCanvasRequest } from '../../_proxy';

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ canvas_id: string }> }) {
  const { canvas_id } = await ctx.params;
  return proxyCanvasRequest(request, `/canvases/${canvas_id}/purge`, {
    method: 'DELETE',
    forwardCookie: false,
  });
}
