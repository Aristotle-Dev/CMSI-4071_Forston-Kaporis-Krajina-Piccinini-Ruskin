/**
 * Express handlers for the Brightspace OAuth integration.
 *
 * Four endpoints:
 *
 *   POST /brightspace/connect     — Start the OAuth flow (returns authorize URL)
 *   GET  /brightspace/callback    — Brightspace redirects here after user consent
 *   POST /brightspace/disconnect  — Revoke tokens + delete all Brightspace data
 *   GET  /brightspace/status      — Check if user has an active connection
 *
 * Flow overview:
 *
 *   ┌──────────┐     POST /connect      ┌─────────────────┐
 *   │  Gather  │ ──────────────────────► │  Backend (here) │
 *   │ Frontend │ ◄────────────────────── │  generates PKCE  │
 *   └──────────┘   { authorizeUrl }      │  stores verifier │
 *        │                               └─────────────────┘
 *        │  User opens authorizeUrl
 *        ▼
 *   ┌──────────────┐   code + state    ┌─────────────────┐
 *   │  Brightspace │ ────────────────► │  GET /callback  │
 *   │  (LMU)       │                   │  exchanges code  │
 *   └──────────────┘                   │  encrypts tokens │
 *                                      │  stores in DB    │
 *                                      └─────────────────┘
 */

const {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} = require("../helpers/crypto");

const {
  savePendingAuth,
  consumePendingAuth,
  saveTokens,
  getRefreshToken,
  isConnected,
  clearBrightspaceData,
} = require("../helpers/brightspaceTokens");

const {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  revokeToken,
} = require("../helpers/brightspaceClient");

const {logApiAccess} = require("../helpers/auditLog");

const {getAssignmentsCollection} = require("../helpers/assignments");

// ---------------------------------------------------------------------------
// POST /brightspace/connect
// ---------------------------------------------------------------------------

/**
 * Initiates the Brightspace OAuth flow.
 *
 * The frontend calls this endpoint (with the user's Firebase Auth token).
 * We generate PKCE values, store them in Firestore for the callback, and
 * return the Brightspace authorization URL for the frontend to open.
 *
 * Why doesn't the backend redirect directly?
 *   Because the frontend might be a mobile app or SPA that needs to open
 *   the URL in a system browser or in-app browser.  Returning the URL
 *   gives the frontend control over how to present it.
 *
 * @param {import("express").Request} req Express request.
 * @param {import("express").Response} res Express response.
 * @return {Promise<import("express").Response>}
 */
async function connectHandler(req, res) {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({error: "Unauthorized"});
    }

    // Check if already connected
    const alreadyConnected = await isConnected(uid);
    if (alreadyConnected) {
      return res.status(409).json({
        error: "Brightspace is already connected. Disconnect first to reconnect.",
      });
    }

    // 1. Generate PKCE pair
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // 2. Generate anti-CSRF state
    const state = generateState();

    // 3. Persist verifier + state so the callback can retrieve them
    await savePendingAuth(uid, codeVerifier, state);

    // 4. Build the URL and return it to the frontend
    const authorizeUrl = buildAuthorizeUrl(state, codeChallenge);

    await logApiAccess({
      uid,
      endpoint: "/d2l/api/oauth2/authorize",
      method: "GET",
      statusCode: 200,
      latencyMs: null,
      error: null,
    });

    return res.status(200).json({authorizeUrl});
  } catch (error) {
    console.error("❌ Error starting Brightspace OAuth:", error);
    return res.status(500).json({error: "Failed to start Brightspace connection"});
  }
}

// ---------------------------------------------------------------------------
// GET /brightspace/callback
// ---------------------------------------------------------------------------

/**
 * Handles the OAuth callback from Brightspace.
 *
 * After the user grants consent, Brightspace redirects their browser to
 * this endpoint with `?code=...&state=...`.  We:
 *
 *   1. Verify the state matches what we stored (anti-CSRF).
 *   2. Retrieve the PKCE verifier from Firestore (and delete it).
 *   3. Exchange the authorization code + verifier for tokens.
 *   4. Encrypt and store the refresh token.
 *   5. Redirect the user back to the Gather app.
 *
 * Note: This endpoint is NOT behind the `authenticate` middleware because
 * it's called by a browser redirect from Brightspace, not by the frontend
 * with a Bearer token.  Instead, the user identity comes from the state
 * parameter, which maps back to a specific user's pending auth.
 *
 * SECURITY: The state parameter is a cryptographically random value that
 * was generated server-side and stored per-user.  An attacker cannot forge
 * it, so this is safe.
 *
 * @param {import("express").Request} req Express request.
 * @param {import("express").Response} res Express response.
 * @return {Promise<import("express").Response>}
 */
async function callbackHandler(req, res) {
  try {
    const {code, state, error: oauthError} = req.query;

    // Handle user denial or Brightspace errors
    if (oauthError) {
      console.error("Brightspace OAuth error:", oauthError);
      // TODO: Replace with your app's frontend URL
      return res.redirect(`${getAppUrl()}/brightspace/error?reason=${oauthError}`);
    }

    if (!code || !state) {
      return res.status(400).json({error: "Missing code or state parameter"});
    }

    // We need to find which user this state belongs to.
    // Since the callback doesn't have a Bearer token, we look up the
    // pending auth by state across all users.
    const pendingResult = await findPendingAuthByState(state);

    if (!pendingResult) {
      return res.status(400).json({
        error: "Invalid or expired state parameter. Please try connecting again.",
      });
    }

    const {uid, codeVerifier} = pendingResult;

    // Exchange the code for tokens
    const startTime = Date.now();
    const tokens = await exchangeCodeForTokens(code, codeVerifier);
    const latencyMs = Date.now() - startTime;

    await logApiAccess({
      uid,
      endpoint: "/d2l/api/oauth2/token",
      method: "POST",
      statusCode: 200,
      latencyMs,
    });

    // Encrypt and store the refresh token
    await saveTokens(uid, tokens.refreshToken);

    // Redirect back to the app with a success indicator
    // TODO: Replace with your app's frontend URL
    return res.redirect(`${getAppUrl()}/brightspace/success`);
  } catch (error) {
    console.error("❌ Error in Brightspace callback:", error);

    await logApiAccess({
      uid: "unknown",
      endpoint: "/d2l/api/oauth2/token",
      method: "POST",
      statusCode: 500,
      error: error.message,
    });

    // TODO: Replace with your app's frontend URL
    return res.redirect(`${getAppUrl()}/brightspace/error?reason=token_exchange_failed`);
  }
}

// ---------------------------------------------------------------------------
// POST /brightspace/disconnect
// ---------------------------------------------------------------------------

/**
 * Disconnects Brightspace and deletes all associated data.
 *
 * Per ITS requirements #2 and #4:
 *   - Revoke the tokens at Brightspace so they can't be used again.
 *   - Delete all stored tokens from our database.
 *   - Delete all Brightspace-sourced assignments.
 *
 * The user can also revoke from Brightspace's side (My Settings >
 * Account Settings > Application Settings > Remove App), but this
 * endpoint handles it from within Gather.
 *
 * @param {import("express").Request} req Express request.
 * @param {import("express").Response} res Express response.
 * @return {Promise<import("express").Response>}
 */
async function disconnectHandler(req, res) {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({error: "Unauthorized"});
    }

    // 1. Retrieve the refresh token so we can revoke it at Brightspace
    const refreshToken = await getRefreshToken(uid);
    if (refreshToken) {
      try {
        await revokeToken(refreshToken);
      } catch (revokeError) {
        // Log but don't fail — we still want to clean up locally
        console.error("⚠️ Token revocation failed:", revokeError);
      }
    }

    // 2. Delete all Brightspace auth data from Firestore
    await clearBrightspaceData(uid);

    // 3. Delete all Brightspace-sourced assignments for this user
    await deleteBrightspaceAssignments(uid);

    await logApiAccess({
      uid,
      endpoint: "disconnect",
      method: "POST",
      statusCode: 200,
    });

    return res.status(200).json({
      message: "Brightspace disconnected. All associated data has been deleted.",
    });
  } catch (error) {
    console.error("❌ Error disconnecting Brightspace:", error);
    return res.status(500).json({error: "Failed to disconnect Brightspace"});
  }
}

// ---------------------------------------------------------------------------
// GET /brightspace/status
// ---------------------------------------------------------------------------

/**
 * Returns whether the user currently has Brightspace connected.
 *
 * The frontend can call this to decide whether to show a "Connect" or
 * "Disconnect" button.
 *
 * @param {import("express").Request} req Express request.
 * @param {import("express").Response} res Express response.
 * @return {Promise<import("express").Response>}
 */
async function statusHandler(req, res) {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({error: "Unauthorized"});
    }

    const connected = await isConnected(uid);
    return res.status(200).json({connected});
  } catch (error) {
    console.error("❌ Error checking Brightspace status:", error);
    return res.status(500).json({error: "Failed to check Brightspace status"});
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Finds a pending auth record by its state parameter.
 *
 * Since the callback doesn't carry a Firebase Auth token, we need to
 * look up which user initiated this flow by searching for the matching
 * state value.
 *
 * This queries across all users' pending auth documents.  The state is
 * cryptographically random (128-bit), so collisions are not a concern.
 *
 * @param {string} state The state parameter from the callback.
 * @return {Promise<{uid: string, codeVerifier: string} | null>}
 */
async function findPendingAuthByState(state) {
  const {db} = require("../config.js");

  // Query all users' pending auth docs for the matching state.
  // collectionGroup queries across all subcollections named "brightspaceAuth".
  const snapshot = await db.collectionGroup("brightspaceAuth")
      .where("state", "==", state)
      .limit(1)
      .get();

  if (snapshot.empty) {
    return null;
  }

  const doc = snapshot.docs[0];
  const data = doc.data();

  // Extract the uid from the document path: users/{uid}/brightspaceAuth/pending
  const uid = doc.ref.parent.parent.id;

  // Delete the pending doc (single-use)
  await doc.ref.delete();

  return {
    uid,
    codeVerifier: data.codeVerifier,
  };
}

/**
 * Deletes all assignments sourced from Brightspace for a user.
 *
 * Looks for assignments where source === "brightspace" and deletes them
 * in a batch.
 *
 * @param {string} uid Firebase user ID.
 * @return {Promise<number>} Number of assignments deleted.
 */
async function deleteBrightspaceAssignments(uid) {
  const {db} = require("../config.js");
  const assignmentsRef = getAssignmentsCollection(uid);

  const snapshot = await assignmentsRef
      .where("source", "==", "brightspace")
      .get();

  if (snapshot.empty) {
    return 0;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();

  return snapshot.size;
}

/**
 * Returns the frontend app URL for redirects after OAuth callback.
 *
 * @return {string} App URL.
 */
function getAppUrl() {
  // TODO: Set this to your actual frontend URL
  return process.env.APP_URL || "http://localhost:3000";
}

module.exports = {
  connectHandler,
  callbackHandler,
  disconnectHandler,
  statusHandler,
};
