const {db, FieldValue} = require("../config.js");

/**
 * Creates or retrieves a user profile in Firestore.
 * If the profile does not exist, initializes it with:
 * displayName, email, createdAt, and brightspaceIcsUrl (null).
 *
 * @param {Object} user Decoded auth token or user object.
 * @param {string} user.uid User UID.
 * @param {string} [user.displayName] User display name.
 * @param {string} [user.email] User email address.
 * @return {Promise<{isNew: boolean, profile: Object}>} The user profile.
 */
async function syncUserProfile(user) {
  const {uid, displayName = null, email = null} = user;
  const userRef = db.collection("users").doc(uid);
  const doc = await userRef.get();

  if (!doc.exists) {
    const profileData = {
      displayName,
      email,
      createdAt: FieldValue.serverTimestamp(),
      brightspaceIcsUrl: null,
      updatedAt: FieldValue.serverTimestamp(),
    };

    await userRef.set(profileData);

    return {
      isNew: true,
      profile: {
        uid,
        ...profileData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
  }

  return {
    isNew: false,
    profile: {
      uid,
      ...doc.data(),
    },
  };
}

/**
 * Retrieves a user profile by UID.
 *
 * @param {string} uid User UID.
 * @return {Promise<Object|null>} User profile or null if not found.
 */
async function getUserProfile(uid) {
  const doc = await db.collection("users").doc(uid).get();
  if (!doc.exists) {
    return null;
  }
  return {
    uid: doc.id,
    ...doc.data(),
  };
}

/**
 * Updates the Brightspace ICS calendar URL for a user.
 *
 * @param {string} uid User UID.
 * @param {string} url Calendar ICS URL.
 * @return {Promise<void>}
 */
async function updateBrightspaceUrl(uid, url) {
  const userRef = db.collection("users").doc(uid);
  await userRef.set(
      {
        brightspaceIcsUrl: url ? String(url).trim() : null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      {merge: true},
  );
}

module.exports = {
  syncUserProfile,
  getUserProfile,
  updateBrightspaceUrl,
};
