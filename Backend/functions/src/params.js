/**
 * Secrets stored in Google Cloud Secret Manager (project gather-0).
 *
 * Each secret must be listed in the `secrets` option of the function that
 * uses it (see index.js); Firebase then mounts it at runtime and `.value()`
 * returns it. Calling `.value()` at module load time (outside a request)
 * does not work — only call it inside handlers/helpers.
 *
 * Manage with the Firebase CLI:
 *   firebase functions:secrets:set BRIGHTSPACE_CLIENT_ID
 *   firebase functions:secrets:set BRIGHTSPACE_SECRET
 *   firebase functions:secrets:set TOKEN_ENCRYPTION_KEY
 *
 * For the local emulator, put values in functions/.secret.local
 * (gitignored) as KEY=value lines.
 */

const {defineSecret} = require("firebase-functions/params");

// OAuth app credentials issued by LMU ITS for the Brightspace integration.
const brightspaceClientId = defineSecret("BRIGHTSPACE_CLIENT_ID");
const brightspaceClientSecret = defineSecret("BRIGHTSPACE_SECRET");

// 64-char hex (256-bit) AES key used to encrypt refresh tokens at rest.
// Changing it makes every stored refresh token undecryptable (users would
// have to reconnect).
const tokenEncryptionKey = defineSecret("TOKEN_ENCRYPTION_KEY");

// Every secret the `api` function needs.
const apiSecrets = [brightspaceClientId, brightspaceClientSecret, tokenEncryptionKey];

module.exports = {
  brightspaceClientId,
  brightspaceClientSecret,
  tokenEncryptionKey,
  apiSecrets,
};
