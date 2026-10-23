/**
 * Brightspace token storage — Firestore operations for OAuth tokens.
 *
 * This module handles three things:
 *   1. Storing the PKCE state during the OAuth flow (temporary).
 *   2. Storing encrypted refresh tokens after successful auth.
 *   3. Clearing everything when a user disconnects.
 *
 * Data layout in Firestore:
 *
 *   users/{uid}
 *     ├── brightspaceAuth            (document — long-lived token data)
 *     │     ├── encryptedRefreshToken   "iv:tag:ciphertext"
 *     │     ├── connectedAt             Timestamp
 *     │     └── updatedAt               Timestamp
 *     │
 *     └── brightspacePending          (document — temporary PKCE state)
 *           ├── codeVerifier            plaintext verifier (server-side only)
 *           ├── state                   random anti-CSRF token
 *           └── createdAt               Timestamp (for TTL cleanup)
 *
 * Why a separate "pending" doc?
 *   Cloud Functions are stateless — we can't hold the PKCE verifier in
 *   memory between the /start and /callback requests.  Storing it in
 *   Firestore (scoped to the user's UID) lets us retrieve it when the
 *   callback arrives.  It's deleted immediately after use.
 */

const {db, FieldValue} = require("../config.js");
const {encrypt, decrypt} = require("./crypto");

// ---------------------------------------------------------------------------
// Pending OAuth state (short-lived, used during the auth flow)
// ---------------------------------------------------------------------------

/**
 * Saves the PKCE verifier and state token so the callback handler can
 * retrieve them later.
 *
 * @param {string} uid Firebase user ID.
 * @param {string} codeVerifier PKCE code verifier (plaintext).
 * @param {string} state Random state parameter.
 * @return {Promise<void>}
 */
async function savePendingAuth(uid, codeVerifier, state) {
  const ref = db.collection("users").doc(uid).collection("brightspaceAuth").doc("pending");
  await ref.set({
    codeVerifier,
    state,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Retrieves and deletes the pending auth data in one step.
 *
 * "Retrieve-then-delete" ensures a verifier can never be reused
 * (one-time use, as required by PKCE).
 *
 * @param {string} uid Firebase user ID.
 * @return {Promise<{codeVerifier: string, state: string} | null>}
 */
async function consumePendingAuth(uid) {
  const ref = db.collection("users").doc(uid).collection("brightspaceAuth").doc("pending");
  const doc = await ref.get();

  if (!doc.exists) {
    return null;
  }

  const data = doc.data();
  // Delete immediately — single-use
  await ref.delete();
  return data;
}

// ---------------------------------------------------------------------------
// Long-lived token storage (encrypted refresh token)
// ---------------------------------------------------------------------------

/**
 * Stores an encrypted refresh token after a successful token exchange.
 *
 * The access token is NOT stored — it's short-lived and used immediately
 * for the current request, then discarded.  On the next request, we
 * decrypt the refresh token and use it to get a fresh access token.
 *
 * @param {string} uid Firebase user ID.
 * @param {string} refreshToken Plaintext refresh token from Brightspace.
 * @return {Promise<void>}
 */
async function saveTokens(uid, refreshToken) {
  const ref = db.collection("users").doc(uid).collection("brightspaceAuth").doc("tokens");
  await ref.set({
    encryptedRefreshToken: encrypt(refreshToken),
    connectedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Updates the stored refresh token (called after token rotation).
 *
 * When we use a refresh token to get a new access token, the OAuth
 * server may issue a new refresh token at the same time.  We MUST
 * store the new one and discard the old one — this is "rotation on use."
 *
 * @param {string} uid Firebase user ID.
 * @param {string} newRefreshToken The rotated refresh token.
 * @return {Promise<void>}
 */
async function rotateRefreshToken(uid, newRefreshToken) {
  const ref = db.collection("users").doc(uid).collection("brightspaceAuth").doc("tokens");
  await ref.update({
    encryptedRefreshToken: encrypt(newRefreshToken),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Retrieves and decrypts the stored refresh token.
 *
 * @param {string} uid Firebase user ID.
 * @return {Promise<string | null>} Plaintext refresh token, or null if
 *   the user hasn't connected Brightspace.
 */
async function getRefreshToken(uid) {
  const ref = db.collection("users").doc(uid).collection("brightspaceAuth").doc("tokens");
  const doc = await ref.get();

  if (!doc.exists || !doc.data().encryptedRefreshToken) {
    return null;
  }

  return decrypt(doc.data().encryptedRefreshToken);
}

/**
 * Checks whether a user has an active Brightspace connection.
 *
 * @param {string} uid Firebase user ID.
 * @return {Promise<boolean>}
 */
async function isConnected(uid) {
  const ref = db.collection("users").doc(uid).collection("brightspaceAuth").doc("tokens");
  const doc = await ref.get();
  return doc.exists && !!doc.data().encryptedRefreshToken;
}

// ---------------------------------------------------------------------------
// Disconnection — full cleanup
// ---------------------------------------------------------------------------

/**
 * Removes all Brightspace auth data for a user.
 *
 * Called when:
 *   - The user clicks "Disconnect Brightspace" in the app (point 2/4).
 *   - The user deletes their Gather account entirely.
 *   - ITS revokes the app's access (point 7).
 *
 * This deletes:
 *   - Encrypted tokens
 *   - Any pending auth state
 *
 * Note: Caller should also delete Brightspace-sourced assignments
 * from the user's assignments subcollection.
 *
 * @param {string} uid Firebase user ID.
 * @return {Promise<void>}
 */
async function clearBrightspaceData(uid) {
  const authCollection = db.collection("users").doc(uid).collection("brightspaceAuth");

  // Delete both docs in the subcollection
  const snapshot = await authCollection.listDocuments();
  const batch = db.batch();
  for (const docRef of snapshot) {
    batch.delete(docRef);
  }
  await batch.commit();
}

module.exports = {
  savePendingAuth,
  consumePendingAuth,
  saveTokens,
  rotateRefreshToken,
  getRefreshToken,
  isConnected,
  clearBrightspaceData,
};
