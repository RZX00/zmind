export type ForwardProxyHeaderOptions = {
  includeIfMatch?: boolean;
  includeIfNoneMatch?: boolean;
  extraRequestHeaders?: string[];
};

export type BackendProxyOptions = {
  method?: string;
  includeIfMatch?: boolean;
  includeIfNoneMatch?: boolean;
  forceJsonContentType?: boolean;
  forwardCookie?: boolean;
  allow304?: boolean;
  allow204?: boolean;
  preserveEtag?: boolean;
  preserveHeaders?: string[];
  extraRequestHeaders?: string[];
};
