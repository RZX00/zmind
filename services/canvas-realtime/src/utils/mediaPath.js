const SUPABASE_BUCKET = "file-uploads";

const decodePath = (value) => {
  if (!value) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizePath = (value) => String(value || "").replace(/^\/+/, "");

const getR2Buckets = () => {
  const buckets = new Set();
  const add = (value) => {
    if (typeof value === "string" && value.trim()) {
      buckets.add(value.trim());
    }
  };
  add(process.env.R2_BUCKET);
  add(process.env.R2_BUCKET_DEV);
  add(process.env.R2_BUCKET_PROD);
  add(process.env.R2_BUCKET_NAME);
  return Array.from(buckets);
};

const isR2Host = (host) =>
  Boolean(host) &&
  (host.endsWith(".r2.cloudflarestorage.com") || host.endsWith(".r2.dev"));

const looksLikeAccountId = (value) => /^[a-f0-9]{16,}$/i.test(value || "");

const extractFromMediaProxy = (pathname) => {
  const marker = "/media/file-uploads/";
  const idx = pathname.indexOf(marker);
  if (idx === -1) return null;
  const candidate = pathname.slice(idx + marker.length);
  if (!candidate) return null;
  return decodePath(candidate.replace(/^\/+/, ""));
};

const extractFromSupabaseStorage = (pathname) => {
  const match = pathname.match(
    /\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/(.+)$/,
  );
  if (!match) return null;
  const bucket = match[1];
  const obj = match[2];
  if (bucket !== SUPABASE_BUCKET) return null;
  return decodePath(obj);
};

const extractFromR2 = (host, pathname) => {
  const cleanPath = normalizePath(pathname);
  if (!cleanPath) return null;
  const buckets = getR2Buckets();
  if (buckets.length) {
    const bucket = buckets.find((b) => cleanPath.startsWith(`${b}/`));
    if (bucket) {
      return decodePath(cleanPath.slice(bucket.length + 1));
    }
    const hostBucket = buckets.find((b) => host && host.startsWith(`${b}.`));
    if (hostBucket) {
      return decodePath(cleanPath);
    }
  }
  if (!isR2Host(host || "")) return null;
  const hostLabel = (host || "").split(".")[0] || "";
  const parts = cleanPath.split("/");
  if (looksLikeAccountId(hostLabel) && parts.length >= 2) {
    return decodePath(parts.slice(1).join("/"));
  }
  return decodePath(cleanPath);
};

export const extractStoragePathFromUrl = (url) => {
  if (typeof url !== "string" || !url.trim()) return null;
  let parsed;
  try {
    parsed = new URL(url, "http://localhost");
  } catch {
    return null;
  }
  const pathname = parsed.pathname || "";
  const host = parsed.hostname || "";
  const fromProxy = extractFromMediaProxy(pathname);
  if (fromProxy) return fromProxy;
  const fromSupabase = extractFromSupabaseStorage(pathname);
  if (fromSupabase) return fromSupabase;
  const fromR2 = extractFromR2(host, pathname);
  if (fromR2) return fromR2;
  return null;
};
