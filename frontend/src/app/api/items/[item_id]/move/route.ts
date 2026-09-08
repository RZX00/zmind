import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../../../_shared/proxy';

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ item_id: string }> },
) {
  const { item_id } = await ctx.params;
  return proxyBackendRequest(request, `/items/${item_id}/move`, {
    method: 'POST',
    includeIfMatch: true,
    forceJsonContentType: true,
  });
}
