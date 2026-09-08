import { NextRequest } from 'next/server';
import { proxyCanvasRequest } from '../../../_proxy';

export async function POST(request: NextRequest, ctx: { params: Promise<{ version_id: string }> }) {
  const { version_id } = await ctx.params;
  return proxyCanvasRequest(request, `/canvases/versions/${version_id}/restore`, {
    method: 'POST',
  });
}
