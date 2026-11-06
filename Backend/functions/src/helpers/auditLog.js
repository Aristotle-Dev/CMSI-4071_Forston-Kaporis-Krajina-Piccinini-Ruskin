/**
 * Audit logging and usage tracking for Brightspace.
 *
 * ITS requirement #2 asks for "basic audit logging of API access on
 * your app's side, so unusual activity can be identified."
 *
 * Two kinds of records go into the top-level `auditLogs` collection:
 *
 *   kind: "api_call" — one per outbound HTTP request to Brightspace,
 *     written by brightspaceFetch(). It wraps every call (OAuth token,
 *     refresh, revoke, and all data API GETs), so a call can't skip logging.
 *     Network failures and 429 retries are logged too.
 *
 *   kind: "event" — user-level actions such as connecting, disconnecting
 *     or a failed OAuth callback, written by logBrightspaceEvent().
 *
 * Every record has:
 *   uid        Firebase UID (never the student's name or email)
 *   requestId  ID of the incoming Gather request that caused it, so you
 *              can group, e.g., all calls made by one sync
 *   trigger    That incoming request, e.g. "GET /brightspace/assignments"
 *   timestamp  Server timestamp
 *
 * Daily aggregates go in `brightspaceUsage/{YYYY-MM-DD}` (UTC), so you can
 * see volume at a glance without scanning the logs:
 *   totalCalls, errorCalls, totalLatencyMs, events,
 *   byStatus.{code}, byEndpoint.{normalized path}, byAction.{name}
 *
 * Tokens, authorization codes, and query strings are never logged.
 * Only the URL path is logged; for data calls it can contain course
 * (org unit) IDs, but nothing personal.
 *
 * Retention: add a Firestore TTL policy on `auditLogs.timestamp` if ITS
 * specifies a retention period.
 */

const crypto = require("crypto");
const {AsyncLocalStorage} = require("async_hooks");
const {db, FieldValue} = require("../config.js");

// ---------------------------------------------------------------------------
// Per-request context
// ---------------------------------------------------------------------------

const requestContext = new AsyncLocalStorage();

/**
 * Express middleware: gives each incoming request a requestId. Every log
 * written while handling the request records that ID and the route that
 * triggered it. The uid is read lazily from req.user, which the
 * `authenticate` middleware sets after this runs.
 */
function auditContextMiddleware(req, res, next) {
  const store = {
    requestId: crypto.randomUUID(),
    trigger: `${req.method} ${req.baseUrl}${req.path}`,
    req,
  };
  res.setHeader("X-Request-Id", store.requestId);
  requestContext.run(store, next);
}

/**
 * Returns {requestId, trigger, uid} for the current request, or nulls if
 * called outside a request (e.g. a scheduled job).
 */
function currentContext() {
  const store = requestContext.getStore();
  return {
    requestId: store?.requestId || null,
    trigger: store?.trigger || null,
    uid: store?.req?.user?.uid || null,
  };
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

/**
 * Writes an audit record for one Brightspace HTTP call and updates the
 * daily usage counters in the same batch.
 *
 * @param {Object} entry
 * @param {string} [entry.uid] Firebase UID; defaults to the request's user.
 * @param {string} entry.endpoint Brightspace URL path (no query string).
 * @param {string} entry.method HTTP method.
 * @param {number|null} entry.statusCode HTTP status, or null on network failure.
 * @param {number} [entry.latencyMs] Round-trip time.
 * @param {string} [entry.action] What the call was for (e.g. "token_refresh").
 * @param {string} [entry.error] Error message (truncated).
 * @return {Promise<void>}
 */
async function logApiAccess({uid, endpoint, method, statusCode, latencyMs = null, action = null, error = null}) {
  const ctx = currentContext();
  const isError = statusCode === null || statusCode >= 400;
  const record = {
    kind: "api_call",
    service: "brightspace",
    uid: uid || ctx.uid || "unknown",
    requestId: ctx.requestId,
    trigger: ctx.trigger,
    action,
    endpoint,
    method: String(method).toUpperCase(),
    statusCode,
    latencyMs,
    error: error ? String(error).slice(0, 500) : null,
    timestamp: FieldValue.serverTimestamp(),
  };

  const counters = {
    totalCalls: FieldValue.increment(1),
    errorCalls: FieldValue.increment(isError ? 1 : 0),
    totalLatencyMs: FieldValue.increment(latencyMs || 0),
    byStatus: {[statusCode === null ? "network_error" : String(statusCode)]: FieldValue.increment(1)},
    byEndpoint: {[counterKey(endpoint)]: FieldValue.increment(1)},
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (action) counters.byAction = {[counterKey(action)]: FieldValue.increment(1)};

  await writeAudit(record, counters);
}

/**
 * Records a user-level Brightspace event (not an HTTP call).
 *
 * @param {Object} entry
 * @param {string} [entry.uid] Firebase UID; defaults to the request's user.
 * @param {string} entry.action e.g. "connect_started", "connect_completed",
 *   "connect_failed", "disconnected".
 * @param {string} [entry.outcome] "success" | "failure".
 * @param {Object} [entry.details] Small, non-sensitive extra info.
 * @return {Promise<void>}
 */
async function logBrightspaceEvent({uid, action, outcome = "success", details = null}) {
  const ctx = currentContext();
  const record = {
    kind: "event",
    service: "brightspace",
    uid: uid || ctx.uid || "unknown",
    requestId: ctx.requestId,
    trigger: ctx.trigger,
    action,
    outcome,
    details,
    timestamp: FieldValue.serverTimestamp(),
  };
  const counters = {
    events: {[counterKey(`${action}:${outcome}`)]: FieldValue.increment(1)},
    updatedAt: FieldValue.serverTimestamp(),
  };
  await writeAudit(record, counters);
}

/**
 * fetch() wrapper used for EVERY outbound request to Brightspace.
 * It logs the result, including network errors, then returns the Response
 * (or rethrows the error) unchanged.
 *
 * @param {string|URL} url Full Brightspace URL.
 * @param {RequestInit} init fetch options.
 * @param {Object} meta
 * @param {string} [meta.uid] Firebase UID.
 * @param {string} meta.action What this call is for.
 * @return {Promise<Response>}
 */
async function brightspaceFetch(url, init, {uid, action}) {
  const endpoint = new URL(url).pathname;
  const method = init?.method || "GET";
  const start = Date.now();

  let response;
  try {
    response = await fetch(url, init);
  } catch (networkError) {
    await logApiAccess({
      uid, endpoint, method, statusCode: null,
      latencyMs: Date.now() - start, action, error: networkError.message,
    });
    throw networkError;
  }

  let error = null;
  if (!response.ok) {
    // Read the error body from a clone so the caller can still read it.
    error = await response.clone().text().catch(() => null);
  }

  await logApiAccess({
    uid, endpoint, method, statusCode: response.status,
    latencyMs: Date.now() - start, action, error,
  });
  return response;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Writes the audit record and the counter update in one batch. Failures
 * here never break the main request; the entry is printed to the Cloud
 * Functions logs instead, so it isn't lost.
 */
async function writeAudit(record, counters) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const batch = db.batch();
    batch.set(db.collection("auditLogs").doc(), record);
    batch.set(db.collection("brightspaceUsage").doc(day), {date: day, ...counters}, {merge: true});
    await batch.commit();
  } catch (logError) {
    console.error("⚠️ Failed to write audit log:", logError);
    console.log("AUDIT_FALLBACK", JSON.stringify({...record, timestamp: new Date().toISOString()}));
  }
}

/**
 * Turns a path or action into a short, stable counter key: numeric IDs
 * become ":id" (so per-course paths roll up together), and "." and "/"
 * become "_" (so the key is a plain Firestore field name).
 * e.g. "/d2l/api/le/1.100/12345/calendar/events/myEvents/"
 *   → "le_:ver_:id_calendar_events_myEvents"
 */
function counterKey(value) {
  return String(value)
      .replace(/^\/d2l\/api\//, "")
      .replace(/\/\d+\.\d+(?=\/)/, "/:ver")
      .replace(/\/\d+(?=\/|$)/g, "/:id")
      .replace(/^\/+|\/+$/g, "")
      .replace(/[./]/g, "_")
      .slice(0, 120) || "root";
}

module.exports = {
  auditContextMiddleware,
  currentContext,
  logApiAccess,
  logBrightspaceEvent,
  brightspaceFetch,
  counterKey,
};
