import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../../_shared/proxy';

export async function GET(request: NextRequest) {
  return proxyBackendRequest(request, '/references/summary', {
    method: 'GET',
  });
}
