/**
 * Router for Brightspace OAuth endpoints.
 *
 * Route map:
 *
 *   POST /brightspace/connect       [authenticated]  Start OAuth flow
 *   GET  /brightspace/callback      [public]         OAuth redirect target
 *   POST /brightspace/disconnect    [authenticated]  Revoke + delete data
 *   GET  /brightspace/status        [authenticated]  Check connection state
 *   GET  /brightspace/courses       [authenticated]  List enrolled courses
 *   GET  /brightspace/courses/:orgUnitId/assignments  [authenticated]
 *   GET  /brightspace/assignments   [authenticated]  Courses + all due items
 *
 * Note: The callback endpoint is intentionally NOT behind the
 * `authenticate` middleware — it's called by a browser redirect from
 * Brightspace, not by the frontend with a Bearer token.  User identity
 * is verified via the state parameter instead.
 */

const express = require("express");
const {authenticate} = require("../middleware/auth");
const {
  connectHandler,
  callbackHandler,
  disconnectHandler,
  statusHandler,
  coursesHandler,
  courseAssignmentsHandler,
  allAssignmentsHandler,
} = require("../handlers/brightspace");

const {auditContextMiddleware} = require("../helpers/auditLog");

const router = express.Router();

// Tag every Brightspace request with a requestId so each audit record
// (API calls + events) can be traced to the Gather request that caused it.
router.use(auditContextMiddleware);

// Start OAuth flow — requires Firebase Auth
router.post("/connect", authenticate, connectHandler);

// OAuth callback — public (called by Brightspace redirect)
router.get("/callback", callbackHandler);

// Disconnect — requires Firebase Auth
router.post("/disconnect", authenticate, disconnectHandler);

// Connection status — requires Firebase Auth
router.get("/status", authenticate, statusHandler);

// Read-only data fetches — require Firebase Auth
router.get("/courses", authenticate, coursesHandler);
router.get("/courses/:orgUnitId/assignments", authenticate, courseAssignmentsHandler);
router.get("/assignments", authenticate, allAssignmentsHandler);

module.exports = router;
