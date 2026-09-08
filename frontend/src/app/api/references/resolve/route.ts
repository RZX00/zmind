import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../../_shared/proxy';

export async function POST(request: NextRequest) {
  return proxyBackendRequest(request, '/references/resolve', {
    method: 'POST',
    forceJsonContentType: true,
  });
}
