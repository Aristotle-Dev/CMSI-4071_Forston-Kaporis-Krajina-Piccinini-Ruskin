/**
 * Router for Brightspace OAuth endpoints.
 *
 * Route map:
 *
 *   POST /brightspace/connect       [authenticated]  Start OAuth flow
 *   GET  /brightspace/callback      [public]         OAuth redirect target
 *   POST /brightspace/disconnect    [authenticated]  Revoke + delete data
 *   GET  /brightspace/status        [authenticated]  Check connection state
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
} = require("../handlers/brightspace");

const router = express.Router();

// Start OAuth flow — requires Firebase Auth
router.post("/connect", authenticate, connectHandler);

// OAuth callback — public (called by Brightspace redirect)
router.get("/callback", callbackHandler);

// Disconnect — requires Firebase Auth
router.post("/disconnect", authenticate, disconnectHandler);

// Connection status — requires Firebase Auth
router.get("/status", authenticate, statusHandler);

module.exports = router;
