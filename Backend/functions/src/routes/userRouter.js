const express = require("express");
const {authenticate} = require("../middleware/auth");
const {
  syncUserProfileHandler,
  getUserProfileHandler,
  updateBrightspaceUrlHandler,
} = require("../handlers/users");

const router = express.Router();

router.post("/login", authenticate, syncUserProfileHandler);
router.get("/profile", authenticate, getUserProfileHandler);
router.post("/profile", authenticate, syncUserProfileHandler);
router.post("/brightspace-url", authenticate, updateBrightspaceUrlHandler);

module.exports = router;
