import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../_shared/proxy';

export async function GET(request: NextRequest) {
  const { search } = new URL(request.url);
  return proxyBackendRequest(request, `/folders${search}`);
}

export async function POST(request: NextRequest) {
  return proxyBackendRequest(request, '/folders', {
    includeIfMatch: true,
  });
}
