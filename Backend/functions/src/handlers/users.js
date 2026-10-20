const {
  syncUserProfile,
  getUserProfile,
  updateBrightspaceUrl,
} = require("../helpers/users");

/**
 * Express handler to create or retrieve user profile when a user logs in.
 *
 * @param {import("express").Request} req Express request object.
 * @param {import("express").Response} res Express response object.
 * @return {Promise<import("express").Response>}
 */
async function syncUserProfileHandler(req, res) {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({error: "Unauthorized: Missing user authentication"});
    }

    const displayName = req.body?.displayName || req.user?.name || null;
    const email = req.body?.email || req.user?.email || null;

    const result = await syncUserProfile({uid, displayName, email});

    return res.status(result.isNew ? 201 : 200).json({
      message: result.isNew ? "User profile created" : "User profile retrieved",
      user: result.profile,
    });
  } catch (error) {
    console.error("❌ Error syncing user profile:", error);
    return res.status(500).json({error: "Failed to sync user profile"});
  }
}

/**
 * Express handler to get user profile.
 *
 * @param {import("express").Request} req Express request object.
 * @param {import("express").Response} res Express response object.
 * @return {Promise<import("express").Response>}
 */
async function getUserProfileHandler(req, res) {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({error: "Unauthorized: Missing user authentication"});
    }

    const profile = await getUserProfile(uid);
    if (!profile) {
      return res.status(404).json({error: "User profile not found"});
    }

    return res.status(200).json({user: profile});
  } catch (error) {
    console.error("❌ Error getting user profile:", error);
    return res.status(500).json({error: "Failed to fetch user profile"});
  }
}

/**
 * Express handler to update the user's Brightspace ICS feed URL.
 *
 * @param {import("express").Request} req Express request object.
 * @param {import("express").Response} res Express response object.
 * @return {Promise<import("express").Response>}
 */
async function updateBrightspaceUrlHandler(req, res) {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({error: "Unauthorized: Missing user authentication"});
    }

    const {brightspaceIcsUrl} = req.body || {};
    if (!brightspaceIcsUrl || typeof brightspaceIcsUrl !== "string") {
      return res.status(400).json({error: "Missing required brightspaceIcsUrl"});
    }

    await updateBrightspaceUrl(uid, brightspaceIcsUrl);

    return res.status(200).json({
      message: "Brightspace calendar URL updated successfully",
      brightspaceIcsUrl,
    });
  } catch (error) {
    console.error("❌ Error updating Brightspace ICS URL:", error);
    return res.status(500).json({error: "Failed to update Brightspace calendar URL"});
  }
}

module.exports = {
  syncUserProfileHandler,
  getUserProfileHandler,
  updateBrightspaceUrlHandler,
};
