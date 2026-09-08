import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../_shared/proxy';

export async function POST(request: NextRequest) {
  return proxyBackendRequest(request, '/docs', {
    method: 'POST',
    includeIfMatch: true,
    forceJsonContentType: true,
  });
}
