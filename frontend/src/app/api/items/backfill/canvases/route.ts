import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../../../_shared/proxy';

export async function POST(request: NextRequest) {
  return proxyBackendRequest(request, '/items/backfill/canvases', {
    method: 'POST',
    includeIfMatch: true,
  });
}
