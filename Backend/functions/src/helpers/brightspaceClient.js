/**
 * Brightspace OAuth client — handles communication with Brightspace's
 * OAuth 2.0 endpoints.
 *
 * This module wraps the HTTP calls to Brightspace for:
 *   1. Building the authorization URL (what the user's browser navigates to).
 *   2. Exchanging an authorization code for tokens.
 *   3. Refreshing an expired access token.
 *   4. Revoking tokens on disconnect.
 *
 * All Brightspace-specific URLs and credentials are loaded from
 * environment variables so nothing sensitive lives in source code.
 *
 * Environment variables required (set via Firebase Functions config):
 *   BRIGHTSPACE_CLIENT_ID       — OAuth app client ID (from ITS)
 *   BRIGHTSPACE_CLIENT_SECRET   — OAuth app client secret (from ITS)
 *   BRIGHTSPACE_BASE_URL        — e.g. "https://lmu.brightspace.com"
 *   BRIGHTSPACE_REDIRECT_URI    — e.g. "https://<project>.cloudfunctions.net/api/brightspace/callback"
 *   BRIGHTSPACE_SCOPES          — space-separated scopes (e.g. "core:*:read")
 */

/**
 * Returns Brightspace OAuth configuration from environment variables.
 * Centralised here so every function reads from one place.
 *
 * @return {Object} Configuration object.
 * @throws {Error} If any required variable is missing.
 */
function getConfig() {
  const required = {
    clientId: process.env.BRIGHTSPACE_CLIENT_ID,
    clientSecret: process.env.BRIGHTSPACE_CLIENT_SECRET,
    baseUrl: process.env.BRIGHTSPACE_BASE_URL,
    redirectUri: process.env.BRIGHTSPACE_REDIRECT_URI,
    scopes: process.env.BRIGHTSPACE_SCOPES || "",
  };

  for (const [key, value] of Object.entries(required)) {
    if (!value && key !== "scopes") {
      throw new Error(`Missing required environment variable for Brightspace OAuth: ${key}`);
    }
  }

  return {
    ...required,
    authorizeUrl: `${required.baseUrl}/d2l/api/oauth2/authorize`,
    tokenUrl: `${required.baseUrl}/d2l/api/oauth2/token`,
    revokeUrl: `${required.baseUrl}/d2l/api/oauth2/revoke`,
  };
}

/**
 * Builds the full authorization URL that the user's browser should
 * navigate to in order to grant Gather read access.
 *
 * Includes:
 *   - response_type=code  (Authorization Code flow, not implicit)
 *   - client_id
 *   - redirect_uri        (exact match, HTTPS only)
 *   - state               (anti-CSRF, verified on callback)
 *   - scope               (minimum necessary read scopes)
 *   - code_challenge       (PKCE S256)
 *   - code_challenge_method=S256
 *
 * @param {string} state Anti-CSRF state parameter.
 * @param {string} codeChallenge PKCE code challenge (S256).
 * @return {string} The full URL to redirect the user to.
 */
function buildAuthorizeUrl(state, codeChallenge) {
  const config = getConfig();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state: state,
    scope: config.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `${config.authorizeUrl}?${params.toString()}`;
}

/**
 * Exchanges an authorization code for access + refresh tokens.
 *
 * This is the second leg of the Authorization Code + PKCE flow.
 * We send:
 *   - The authorization code (received from Brightspace callback)
 *   - The original PKCE code verifier (proves we started the flow)
 *   - Client credentials (server-side only — never exposed to frontend)
 *
 * @param {string} code Authorization code from the callback query string.
 * @param {string} codeVerifier The original PKCE verifier for this flow.
 * @return {Promise<{accessToken: string, refreshToken: string, expiresIn: number}>}
 * @throws {Error} If the token exchange fails.
 */
async function exchangeCodeForTokens(code, codeVerifier) {
  const config = getConfig();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Client credentials sent via HTTP Basic Auth (RFC 6749 §2.3.1)
      "Authorization": "Basic " + Buffer.from(
          `${config.clientId}:${config.clientSecret}`,
      ).toString("base64"),
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Uses a refresh token to obtain a new access token.
 *
 * If the server issues a new refresh token in the response (rotation),
 * both tokens are returned so the caller can store the new refresh token.
 *
 * @param {string} refreshToken Current refresh token (decrypted).
 * @return {Promise<{accessToken: string, refreshToken: string | null, expiresIn: number}>}
 * @throws {Error} If the refresh fails (token may have been revoked).
 */
async function refreshAccessToken(refreshToken) {
  const config = getConfig();

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + Buffer.from(
          `${config.clientId}:${config.clientSecret}`,
      ).toString("base64"),
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    // If the server rotated the refresh token, use the new one.
    // Otherwise return null to signal "keep using the existing one."
    refreshToken: data.refresh_token || null,
    expiresIn: data.expires_in,
  };
}

/**
 * Revokes a token at Brightspace's revocation endpoint.
 *
 * Called when a user disconnects Brightspace from within Gather.
 * Per ITS requirement #2, revocation should "take effect immediately."
 *
 * @param {string} token The refresh token to revoke.
 * @return {Promise<void>}
 */
async function revokeToken(token) {
  const config = getConfig();

  const body = new URLSearchParams({
    token: token,
    token_type_hint: "refresh_token",
  });

  const response = await fetch(config.revokeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + Buffer.from(
          `${config.clientId}:${config.clientSecret}`,
      ).toString("base64"),
    },
    body: body.toString(),
  });

  // RFC 7009: revocation endpoint returns 200 even if the token was
  // already invalid.  We only throw on unexpected errors.
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Token revocation returned ${response.status}: ${errorBody}`);
  }
}

module.exports = {
  getConfig,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  revokeToken,
};
