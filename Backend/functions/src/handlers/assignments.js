const {db, FieldValue} = require("../config.js");
const {
  createAssignment,
  getAssignments,
  updateAssignment,
  deleteAssignment,
} = require("../helpers/assignments");

// CREATE assignment
//
// Upload an assignment of shape:
//
// title
// courseId
// dueAt (nullable)
// type
// source
// sourceUrl
// status
// confidence
//
/**
 * Express handler to create a new assignment.
 *
 * @param {import("express").Request} req Express request object.
 * @param {import("express").Response} res Express response object.
 * @return {Promise<import("express").Response>}
 */
async function createAssignmentHandler(req, res) {
  try {
    const assignment = req.body;
    const uid = req.user?.uid;

    if (!uid) {
      return res.status(401).json({error: "Unauthorized: Missing user authentication"});
    }

    if (!assignment || typeof assignment !== "object") {
      return res.status(400).json({error: "Invalid request payload"});
    }

    if (!assignment.title || typeof assignment.title !== "string" || !assignment.title.trim()) {
      return res.status(400).json({error: "Missing required field: title"});
    }

    const createdAssignment = await createAssignment(uid, assignment);

    return res.status(201).json({
      message: "Assignment created successfully",
      id: createdAssignment.id,
      assignment: createdAssignment,
    });
  } catch (error) {
    console.error("❌ Error creating assignment:", error);
    return res.status(500).json({error: "Failed to create assignment"});
  }
}

/**
 * Express handler to read all assignments for the authenticated user.
 *
 * @param {import("express").Request} req Express request object.
 * @param {import("express").Response} res Express response object.
 * @return {Promise<import("express").Response>}
 */
async function readAssignmentHandler(req, res) {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({error: "Unauthorized: Missing user authentication"});
    }

    const assignments = await getAssignments(uid);
    return res.status(200).json({assignments});
  } catch (error) {
    console.error("❌ Error fetching assignments:", error);
    return res.status(500).json({error: "Failed to fetch assignments"});
  }
}

/**
 * Express handler to update an assignment for the authenticated user.
 *
 * @param {import("express").Request} req Express request object.
 * @param {import("express").Response} res Express response object.
 * @return {Promise<import("express").Response>}
 */
async function patchAssignmentHandler(req, res) {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({error: "Unauthorized: Missing user authentication"});
    }

    const assignmentId = req.body?.id;
    if (!assignmentId) {
      return res.status(400).json({error: "Missing required assignment identifier (id)"});
    }

    const updates = {...req.body};
    delete updates.id;
    delete updates.userId;

    await updateAssignment(uid, assignmentId, updates);
    return res.status(200).json({message: "Assignment updated successfully"});
  } catch (error) {
    console.error("❌ Error updating assignment:", error);
    return res.status(500).json({error: "Failed to update assignment"});
  }
}

/**
 * Express handler to delete an assignment for the authenticated user.
 *
 * @param {import("express").Request} req Express request object.
 * @param {import("express").Response} res Express response object.
 * @return {Promise<import("express").Response>}
 */
async function deleteAssignmentHandler(req, res) {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({error: "Unauthorized: Missing user authentication"});
    }

    const assignmentId = req.body?.id || req.query?.id;
    if (!assignmentId) {
      return res.status(400).json({error: "Missing required assignment identifier (id)"});
    }

    await deleteAssignment(uid, assignmentId);
    return res.status(200).json({message: "Assignment deleted successfully"});
  } catch (error) {
    console.error("❌ Error deleting assignment:", error);
    return res.status(500).json({error: "Deletion failed"});
  }
}

module.exports = {
  createAssignmentHandler,
  readAssignmentHandler,
  patchAssignmentHandler,
  deleteAssignmentHandler,
};
