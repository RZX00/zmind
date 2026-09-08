// CanvasWriteError envelope (WS4) — the ONE typed write-failure shape with a
// machine-actionable self-heal recipe. Mirrors schemas/canvas-schema.json
// #/$defs/CanvasWriteError and backend/core/canvas/errors.py (keep them in sync).
//
// normalizeCanvasError() turns any thrown Error (or an already-built envelope)
// into { code, retryable, message, self_heal?, op_index? }. The classifier is
// message-driven so existing throw sites need no change to gain a typed code.

export const CANVAS_ERROR_CODES = Object.freeze([
  "STALE_RELOAD",
  "ID_REMAPPED",
  "VALIDATION",
  "NODE_NOT_FOUND",
  "CONNECTION_ENDPOINT_MISSING",
  "CONNECTION_ENDPOINT_INVALID",
  "NODE_LOCKED",
  "EMPTY_BATCH",
  "BATCH_TOO_LARGE",
  "TRANSPORT_RETRYABLE",
]);

const RETRYABLE = new Set(["STALE_RELOAD", "TRANSPORT_RETRYABLE"]);

// Default self-heal recipe per code. The agent/client reads {action, params}
// and acts without parsing the human message.
const SELF_HEAL = {
  STALE_RELOAD: { action: "reload_canvas" },
  ID_REMAPPED: { action: "remap_ids" },
  TRANSPORT_RETRYABLE: { action: "retry" },
};

// Map a raw error message to a code. Ordered — most specific first.
const classify = (message) => {
  const m = String(message || "");
  const aboutConnection = /(connection|connect)/i.test(m) && /\b(from|to|fromPoint|toPoint)\b/i.test(m);
  if (aboutConnection) {
    if (/must reference an existing node|references unknown node/i.test(m)) return "CONNECTION_ENDPOINT_MISSING";
    return "CONNECTION_ENDPOINT_INVALID";
  }
  if (/locked/i.test(m)) return "NODE_LOCKED";
  if (/duplicate id|already exists/i.test(m)) return "VALIDATION";
  if (/not found|references unknown node/i.test(m)) return "NODE_NOT_FOUND";
  if (/non-empty|no operations|empty batch/i.test(m)) return "EMPTY_BATCH";
  if (/too many|too large|exceeds the limit/i.test(m)) return "BATCH_TOO_LARGE";
  return "VALIDATION";
};

const isEnvelope = (e) =>
  e && typeof e === "object" && typeof e.code === "string" && CANVAS_ERROR_CODES.includes(e.code) && typeof e.retryable === "boolean";

export const normalizeCanvasError = (err, opts = {}) => {
  if (isEnvelope(err)) return err;
  const message = err && err.message ? String(err.message) : String(err == null ? "unknown error" : err);
  const code = classify(message);
  const envelope = { code, retryable: RETRYABLE.has(code), message };
  if (SELF_HEAL[code]) envelope.self_heal = { ...SELF_HEAL[code] };
  if (Number.isInteger(opts.opIndex)) envelope.op_index = opts.opIndex;
  if (typeof opts.field === "string") envelope.field = opts.field;
  return envelope;
};

// Construct an envelope directly — used by the transport / id-remap / staleness
// layers that produce STALE_RELOAD, ID_REMAPPED, TRANSPORT_RETRYABLE (which the
// message classifier never infers). The default self_heal recipe is attached.
export const makeCanvasError = (code, message, extra = {}) => {
  if (!CANVAS_ERROR_CODES.includes(code)) {
    throw new Error(`unknown canvas error code: ${code}`);
  }
  const envelope = { code, retryable: RETRYABLE.has(code), message: String(message || code) };
  if (SELF_HEAL[code]) envelope.self_heal = { ...SELF_HEAL[code] };
  if (extra.self_heal && typeof extra.self_heal === "object") envelope.self_heal = extra.self_heal;
  if (Number.isInteger(extra.opIndex)) envelope.op_index = extra.opIndex;
  if (typeof extra.field === "string") envelope.field = extra.field;
  return envelope;
};
