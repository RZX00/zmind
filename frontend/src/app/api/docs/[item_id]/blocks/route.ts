import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../../../_shared/proxy';

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ item_id: string }> },
) {
  const { item_id } = await ctx.params;
  return proxyBackendRequest(request, `/docs/${item_id}/blocks`, {
    method: 'GET',
  });
}
