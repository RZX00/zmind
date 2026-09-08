import { requiredEnv } from '@/lib/env-utils';

const rawUrl = requiredEnv('NEXT_PUBLIC_CANVAS_REALTIME_URL');

export const CANVAS_REALTIME_URL = rawUrl.replace(/\/$/, "");

export const CANVAS_REALTIME_ENABLED =
  (process.env.NEXT_PUBLIC_CANVAS_REALTIME_ENABLED ?? "true").toLowerCase() !== "false";

export const CANVAS_REALTIME_INCREMENTAL_SYNC =
  (process.env.NEXT_PUBLIC_CANVAS_REALTIME_INCREMENTAL_SYNC ?? "true").toLowerCase() !== "false";

export const buildRealtimeWsUrl = () => {
  if (!CANVAS_REALTIME_URL) {
    return "";
  }
  if (CANVAS_REALTIME_URL.startsWith("ws://") || CANVAS_REALTIME_URL.startsWith("wss://")) {
    return CANVAS_REALTIME_URL;
  }
  if (CANVAS_REALTIME_URL.startsWith("http://")) {
    return CANVAS_REALTIME_URL.replace(/^http:\/\//, "ws://");
  }
  if (CANVAS_REALTIME_URL.startsWith("https://")) {
    return CANVAS_REALTIME_URL.replace(/^https:\/\//, "wss://");
  }
  return `ws://${CANVAS_REALTIME_URL}`;
};
