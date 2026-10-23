/**
 * Audit logging for Brightspace API access.
 *
 * ITS requirement #2 asks for "basic audit logging of API access on
 * your app's side, so unusual activity can be identified."
 *
 * Every time our backend calls the Brightspace API on behalf of a user,
 * we log:
 *   - who (Firebase UID — never the student's name/email)
 *   - what (which Brightspace API endpoint)
 *   - when (server timestamp)
 *   - result (HTTP status code)
 *   - how long it took (latency in ms)
 *
 * Logs are stored in Firestore under a top-level `auditLogs` collection
 * so they're easy to query, export, or show to ITS during review.
 *
 * Retention: These logs can be periodically cleaned up.  A Firestore
 * TTL policy can auto-delete documents older than N days.
 */

const {db, FieldValue} = require("../config.js");

/**
 * Writes an audit log entry for a Brightspace API call.
 *
 * @param {Object} entry Log entry data.
 * @param {string} entry.uid Firebase user ID of the student.
 * @param {string} entry.endpoint Brightspace API endpoint called
 *   (e.g. "/d2l/api/le/1.0/enrollments/myenrollments/").
 * @param {string} entry.method HTTP method (GET, POST, etc.).
 * @param {number} entry.statusCode Response status from Brightspace.
 * @param {number} [entry.latencyMs] Round-trip time in milliseconds.
 * @param {string} [entry.error] Error message if the call failed.
 * @return {Promise<void>}
 */
async function logApiAccess({uid, endpoint, method, statusCode, latencyMs = null, error = null}) {
  try {
    await db.collection("auditLogs").add({
      uid,
      service: "brightspace",
      endpoint,
      method: method.toUpperCase(),
      statusCode,
      latencyMs,
      error: error || null,
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch (logError) {
    // Audit logging should never crash the main request.
    // Fall back to console so it still appears in Cloud Functions logs.
    console.error("⚠️ Failed to write audit log:", logError);
    console.log("Audit entry:", {uid, endpoint, method, statusCode, latencyMs, error});
  }
}

module.exports = {logApiAccess};
