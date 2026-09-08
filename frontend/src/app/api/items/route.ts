import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../_shared/proxy';

export async function GET(request: NextRequest) {
  const { search } = new URL(request.url);
  return proxyBackendRequest(request, `/items${search}`, {
    method: 'GET',
    includeIfNoneMatch: true,
    preserveEtag: true,
    allow304: true,
    preserveHeaders: ['x-request-id'],
  });
}

export async function POST(request: NextRequest) {
  return proxyBackendRequest(request, '/items', {
    method: 'POST',
    includeIfMatch: true,
    forceJsonContentType: true,
  });
}
