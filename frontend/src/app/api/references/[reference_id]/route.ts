import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../../_shared/proxy';

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ reference_id: string }> },
) {
  const { reference_id } = await ctx.params;
  return proxyBackendRequest(request, `/references/${reference_id}`, {
    method: 'DELETE',
    includeIfMatch: true,
  });
}
