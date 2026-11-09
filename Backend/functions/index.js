/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const express = require("express");
const assignmentRouter = require("./src/routes/assignmentRouter");
const userRouter = require("./src/routes/userRouter");
const brightspaceRouter = require("./src/routes/brightspaceRouter");
const {apiSecrets} = require("./src/params");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({maxInstances: 10});

const app = express();
app.use(express.json());

// Mount routers
app.use("/assignments", assignmentRouter);
app.use("/users", userRouter);
app.use("/brightspace", brightspaceRouter);

// Expose Express API as a Cloud Function. Region is pinned so the public
// URL (and therefore the Brightspace OAuth redirect URI) stays stable:
//   https://us-central1-gather-0.cloudfunctions.net/api/brightspace/callback
// The secrets list mounts Secret Manager values for this function.
exports.api = onRequest({region: "us-central1", secrets: apiSecrets}, app);
