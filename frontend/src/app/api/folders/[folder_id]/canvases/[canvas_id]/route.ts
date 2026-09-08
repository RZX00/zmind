import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../../../../_shared/proxy';

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ folder_id: string; canvas_id: string }> },
) {
  const { folder_id, canvas_id } = await ctx.params;
  return proxyBackendRequest(request, `/folders/${folder_id}/canvases/${canvas_id}`, {
    includeIfMatch: true,
  });
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ folder_id: string; canvas_id: string }> },
) {
  const { folder_id, canvas_id } = await ctx.params;
  return proxyBackendRequest(request, `/folders/${folder_id}/canvases/${canvas_id}`, {
    includeIfMatch: true,
  });
}
