import { NextRequest } from 'next/server';
import { forwardProxyHeaders } from '../_shared/proxy-headers';

type ForwardProxyHeaderOptions = {
  includeIfMatch?: boolean;
  includeIfNoneMatch?: boolean;
};

export const forwardCanvasProxyHeaders = (
  request: NextRequest,
  headers: Record<string, string>,
  options: ForwardProxyHeaderOptions = {},
) => {
  forwardProxyHeaders(request, headers, options);
};
