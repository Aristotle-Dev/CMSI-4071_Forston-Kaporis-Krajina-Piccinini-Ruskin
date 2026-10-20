const express = require("express");
const {authenticate} = require("../middleware/auth");
const {
  deleteAssignmentHandler,
  patchAssignmentHandler,
  createAssignmentHandler,
  readAssignmentHandler,
} = require("../handlers/assignments");

const router = express.Router();

router.post("/delete", authenticate, deleteAssignmentHandler);
router.post("/patch", authenticate, patchAssignmentHandler);
router.post("/create", authenticate, createAssignmentHandler);
router.post("/read", authenticate, readAssignmentHandler);

module.exports = router;
