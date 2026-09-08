import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../../_shared/proxy';

export async function PUT(request: NextRequest, ctx: { params: Promise<{ folder_id: string }> }) {
  const { folder_id } = await ctx.params;
  return proxyBackendRequest(request, `/folders/${folder_id}`, {
    includeIfMatch: true,
  });
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ folder_id: string }> }) {
  const { folder_id } = await ctx.params;
  const search = new URL(request.url).search;
  return proxyBackendRequest(request, `/folders/${folder_id}${search}`, {
    includeIfMatch: true,
  });
}
