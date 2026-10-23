/**
 * Cryptographic utilities for the Brightspace OAuth integration.
 *
 * Two responsibilities:
 *   1. PKCE (Proof Key for Code Exchange) — generates the verifier/challenge
 *      pair that proves the token-exchange request came from the same party
 *      that started the authorization flow.
 *   2. Symmetric encryption — AES-256-GCM encrypt/decrypt for storing
 *      refresh tokens at rest in Firestore.
 */

const crypto = require("crypto");

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically random code verifier for PKCE.
 *
 * The OAuth 2.0 spec (RFC 7636) requires the verifier to be a 43–128
 * character string using the unreserved URI characters [A-Z, a-z, 0-9,
 * "-", ".", "_", "~"].  We use 32 random bytes → 43 base64url characters.
 *
 * @return {string} A base64url-encoded random string (43 characters).
 */
function generateCodeVerifier() {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Derives the code challenge from a code verifier using SHA-256.
 *
 * Brightspace (and most OAuth providers) support the "S256" method:
 *   challenge = BASE64URL( SHA256( verifier ) )
 *
 * The challenge is sent in the authorize request; the original verifier
 * is sent later in the token-exchange request.  The server hashes the
 * verifier and compares it to the stored challenge — proving possession
 * without ever transmitting the verifier over the front-channel.
 *
 * @param {string} verifier The code verifier string.
 * @return {string} The S256 code challenge (base64url-encoded).
 */
function generateCodeChallenge(verifier) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// ---------------------------------------------------------------------------
// AES-256-GCM encryption for token storage
// ---------------------------------------------------------------------------
//
// Why encrypt refresh tokens?
//   Even though Firestore has access controls, defense-in-depth says we
//   should encrypt sensitive values at the application layer too.  If
//   Firestore data were ever exported or leaked, the tokens would still
//   be useless without the encryption key.
//
// Key management:
//   The 256-bit key is loaded from an environment variable / Firebase
//   Functions config (TOKEN_ENCRYPTION_KEY).  In production this should
//   be set via `firebase functions:secrets:set TOKEN_ENCRYPTION_KEY` or
//   Google Secret Manager.  For local development, set it in .env or
//   .runtimeconfig.json.
//
//   To generate a suitable key:
//     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// ---------------------------------------------------------------------------

/**
 * Returns the 256-bit encryption key from the environment.
 *
 * @return {Buffer} 32-byte key buffer.
 * @throws {Error} If the key is missing or invalid.
 */
function getEncryptionKey() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
        "TOKEN_ENCRYPTION_KEY must be a 64-character hex string (256 bits). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypts a plaintext string with AES-256-GCM.
 *
 * Returns a single colon-delimited string: `iv:authTag:ciphertext`
 * (all hex-encoded) so it can be stored as one Firestore field.
 *
 * GCM mode provides both confidentiality AND integrity — if anyone
 * tampers with the ciphertext, decryption will fail.
 *
 * @param {string} plaintext The value to encrypt (e.g. a refresh token).
 * @return {string} The encrypted payload as "iv:tag:ciphertext".
 */
function encrypt(plaintext) {
  const key = getEncryptionKey();

  // 96-bit (12-byte) IV is the recommended size for GCM.
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  // The auth tag is a 128-bit MAC that guarantees integrity.
  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a payload previously produced by encrypt().
 *
 * @param {string} payload The "iv:tag:ciphertext" string from Firestore.
 * @return {string} The original plaintext.
 * @throws {Error} If the payload is malformed or tampered with.
 */
function decrypt(payload) {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, ciphertext] = payload.split(":");

  if (!ivHex || !authTagHex || !ciphertext) {
    throw new Error("Malformed encrypted payload");
  }

  const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ---------------------------------------------------------------------------
// Secure random state parameter
// ---------------------------------------------------------------------------

/**
 * Generates a random state parameter for the OAuth authorize request.
 *
 * The state parameter prevents CSRF attacks — when the callback arrives,
 * we verify the state matches what we stored for this user.
 *
 * @return {string} A 32-character hex string.
 */
function generateState() {
  return crypto.randomBytes(16).toString("hex");
}

module.exports = {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  encrypt,
  decrypt,
};
