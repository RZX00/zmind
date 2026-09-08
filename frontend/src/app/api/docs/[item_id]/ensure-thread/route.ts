import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../../../_shared/proxy';

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ item_id: string }> },
) {
  const { item_id } = await ctx.params;
  return proxyBackendRequest(request, `/docs/${item_id}/ensure-thread`, {
    method: 'POST',
    forceJsonContentType: true,
  });
}
