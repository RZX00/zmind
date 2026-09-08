import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '@/app/api/_shared/proxy';

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ job_id: string }> },
) {
  const { job_id } = await ctx.params;
  return proxyBackendRequest(request, `/exports/obsidian/jobs/${job_id}/download`, {
    method: 'GET',
    preserveHeaders: ['content-disposition'],
  });
}
