import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../_shared/proxy';

export async function GET(request: NextRequest) {
  return proxyBackendRequest(request, '/workspace', {
    method: 'GET',
    includeIfNoneMatch: true,
    preserveEtag: true,
    preserveHeaders: ['x-request-id'],
    allow304: true,
  });
}
