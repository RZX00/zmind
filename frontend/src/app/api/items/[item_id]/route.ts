import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../../_shared/proxy';

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ item_id: string }> },
) {
  const { item_id } = await ctx.params;
  return proxyBackendRequest(request, `/items/${item_id}`, {
    method: 'GET',
    includeIfNoneMatch: true,
    preserveEtag: true,
    allow304: true,
    preserveHeaders: ['x-request-id'],
  });
}

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ item_id: string }> },
) {
  const { item_id } = await ctx.params;
  return proxyBackendRequest(request, `/items/${item_id}`, {
    method: 'PUT',
    includeIfMatch: true,
    forceJsonContentType: true,
  });
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ item_id: string }> },
) {
  const { item_id } = await ctx.params;
  return proxyBackendRequest(request, `/items/${item_id}`, {
    method: 'DELETE',
    includeIfMatch: true,
  });
}
