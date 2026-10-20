const admin = require("firebase-admin");
const {db, FieldValue} = require("../config.js");

/**
 * Returns the Firestore collection reference for a user's assignments.
 *
 * @param {string} uid Firebase user ID.
 * @return {FirebaseFirestore.CollectionReference} Assignments collection.
 */
function getAssignmentsCollection(uid) {
  return db.collection("users").doc(uid).collection("assignments");
}

/**
 * Creates a new assignment document in Firestore.
 *
 * @param {string} uid Firebase user ID.
 * @param {Object} data Assignment payload.
 * @param {string} data.title Title of the assignment.
 * @param {string} [data.courseId] Identifier of the course.
 * @param {string|Date|number} [data.dueAt] Due date / timestamp.
 * @param {string} [data.type] Assignment type (e.g. "homework", "exam").
 * @param {string} [data.source] Source (e.g. "manual", "brightspace", "pdf").
 * @param {string} [data.sourceUrl] Optional URL reference.
 * @param {string} [data.status] Status (e.g. "pending", "completed").
 * @param {number} [data.confidence] AI confidence score if applicable.
 * @param {string} [data.id] Optional explicit document ID.
 * @return {Promise<Object>} The persisted assignment with its generated ID.
 */
async function createAssignment(uid, data) {
  let dueAt = null;
  if (data.dueAt) {
    const parsedDate = new Date(data.dueAt);
    if (!isNaN(parsedDate.getTime())) {
      dueAt = admin.firestore.Timestamp.fromDate(parsedDate);
    }
  }

  const assignmentDoc = {
    title: data.title.trim(),
    courseId: data.courseId ? String(data.courseId).trim() : null,
    dueAt: dueAt,
    type: data.type ? String(data.type).trim() : "assignment",
    source: data.source ? String(data.source).trim() : "manual",
    sourceUrl: data.sourceUrl ? String(data.sourceUrl).trim() : null,
    status: data.status ? String(data.status).trim() : "pending",
    confidence: typeof data.confidence === "number" ? data.confidence : null,
    userId: uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const collectionRef = getAssignmentsCollection(uid);
  const docRef = data.id ?
    collectionRef.doc(String(data.id)) :
    collectionRef.doc();

  await docRef.set(assignmentDoc);

  return {
    id: docRef.id,
    ...assignmentDoc,
    dueAt: data.dueAt || null,
  };
}

/**
 * Fetches all assignments for a user.
 *
 * @param {string} uid Firebase user ID.
 * @return {Promise<Array<Object>>} List of user assignments.
 */
async function getAssignments(uid) {
  const snapshot = await getAssignmentsCollection(uid).get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

/**
 * Updates an existing assignment for a user.
 *
 * @param {string} uid Firebase user ID.
 * @param {string} assignmentId Assignment document ID.
 * @param {Object} updates Fields to update.
 * @return {Promise<void>}
 */
async function updateAssignment(uid, assignmentId, updates) {
  const docRef = getAssignmentsCollection(uid).doc(assignmentId);
  await docRef.update({
    ...updates,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Deletes an assignment for a user.
 *
 * @param {string} uid Firebase user ID.
 * @param {string} assignmentId Assignment document ID.
 * @return {Promise<void>}
 */
async function deleteAssignment(uid, assignmentId) {
  const docRef = getAssignmentsCollection(uid).doc(assignmentId);
  await docRef.delete();
}

module.exports = {
  getAssignmentsCollection,
  createAssignment,
  getAssignments,
  updateAssignment,
  deleteAssignment,
};
