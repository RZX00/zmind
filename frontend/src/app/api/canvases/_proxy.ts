import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '../_shared/proxy';

type CanvasProxyOptions = {
  method?: string;
  includeIfMatch?: boolean;
  includeIfNoneMatch?: boolean;
  forceJsonContentType?: boolean;
  forwardCookie?: boolean;
  allow304?: boolean;
  allow204?: boolean;
  preserveEtag?: boolean;
  preserveSnapshotSource?: boolean;
};

export async function proxyCanvasRequest(
  request: NextRequest,
  path: string,
  options: CanvasProxyOptions = {},
) {
  return proxyBackendRequest(request, path, {
    method: options.method,
    includeIfMatch: options.includeIfMatch,
    includeIfNoneMatch: options.includeIfNoneMatch,
    forceJsonContentType: options.forceJsonContentType,
    forwardCookie: options.forwardCookie,
    allow304: options.allow304,
    allow204: options.allow204,
    preserveEtag: options.preserveEtag,
    preserveHeaders: options.preserveSnapshotSource
      ? ['x-snapshot-source', 'x-request-id']
      : ['x-request-id'],
  });
}
