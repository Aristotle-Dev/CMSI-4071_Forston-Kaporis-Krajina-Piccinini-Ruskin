/**
 * Brightspace (Valence) data API — fetches a user's courses and the
 * assignments in them.
 *
 * Only two OAuth scopes are needed:
 *
 *   enrollment:own_enrollment:read
 *     GET /d2l/api/lp/(ver)/enrollments/myenrollments/
 *     → the courses the user is enrolled in.
 *
 *   calendar:my_events:read
 *     GET /d2l/api/le/(ver)/(orgUnitId)/calendar/events/myEvents/
 *     → calendar events in one course. Events linked to an assignment
 *       (dropbox), quiz, discussion, etc. carry an AssociatedEntity, and
 *       the "DueDate" event is the one we treat as the item's due date.
 *
 * Why the calendar instead of the dropbox/quizzing APIs? Those need
 * extra scopes (dropbox:folders:read, quizzing:quizzes:read, ...). The
 * calendar already shows every dated item, so one read-only scope
 * covers all of them.
 *
 * Typical usage (one access token per sync; see getAccessToken below):
 *
 *   const token = await getAccessToken(uid);
 *   const courses = await fetchMyCourses(uid, token);
 *   const items = await fetchAssignmentsForCourses(uid, token, courses);
 */

const {getConfig, refreshAccessToken} = require("./brightspaceClient");
const {getRefreshToken, rotateRefreshToken} = require("./brightspaceTokens");
const {brightspaceFetch} = require("./auditLog");

// API versions. lmutest and lmu.brightspace.com both report lp 1.64 / le 1.100
// (GET /d2l/api/versions/). Minimums: myenrollments needs lp 1.49+, myEvents
// needs le 1.82+, and the EventType field on events needs le 1.94+.
const LP_VERSION = process.env.BRIGHTSPACE_LP_VERSION || "1.64";
const LE_VERSION = process.env.BRIGHTSPACE_LE_VERSION || "1.100";

// D2L's built-in org unit type ID for "Course Offering".
const COURSE_OFFERING_TYPE_ID = 3;

// Calendar enums (see Valence docs: ASSOCIATION_T / EVENTTYPE_T).
const ASSOCIATION_ASSOCIATED_ONLY = 2;
const EVENT_TYPE_DUE_DATE = 6;

// Calendar associated-entity types → Gather assignment "type".
const ENTITY_TYPE_MAP = {
  "D2L.LE.Dropbox.Dropbox": "assignment",
  "D2L.LE.Quizzing.Quiz": "quiz",
  "D2L.LE.Discussions.DiscussionTopic": "discussion",
  "D2L.LE.Discussions.DiscussionForum": "discussion",
  "D2L.LE.Survey.Survey": "survey",
};

// Safety cap so a bad `Next`/bookmark can't loop forever.
const MAX_PAGES = 50;

/**
 * Error thrown for non-2xx Brightspace responses. `status` lets callers
 * react (e.g. 401/403 → ask the user to reconnect).
 */
class BrightspaceApiError extends Error {
  constructor(message, status, endpoint) {
    super(message);
    this.name = "BrightspaceApiError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Gets a fresh access token for a user, using their stored refresh token.
 *
 * Brightspace refresh tokens are single-use: every refresh returns a new
 * refresh token, which we must save, and the old one stops working.
 * So call this ONCE per sync and pass the access token (valid for about
 * an hour) to every fetch. Don't call it in parallel for the same user.
 *
 * @param {string} uid Firebase user ID.
 * @return {Promise<string>} Access token.
 * @throws {BrightspaceApiError} 401 if the user hasn't connected Brightspace
 *   or the refresh token was revoked.
 */
async function getAccessToken(uid) {
  const refreshToken = await getRefreshToken(uid);
  if (!refreshToken) {
    throw new BrightspaceApiError("Brightspace is not connected", 401, "oauth2/token");
  }

  // The token call is audit-logged inside refreshAccessToken.
  let tokens;
  try {
    tokens = await refreshAccessToken(refreshToken, uid);
  } catch (err) {
    throw new BrightspaceApiError(
        "Brightspace session expired or was revoked; please reconnect", 401, "oauth2/token");
  }

  if (tokens.refreshToken) {
    await rotateRefreshToken(uid, tokens.refreshToken);
  }
  return tokens.accessToken;
}

// ---------------------------------------------------------------------------
// Low-level GET
// ---------------------------------------------------------------------------

/**
 * Authenticated GET against the Brightspace API. Every attempt, including
 * 429 retries and network errors, is audit-logged by brightspaceFetch.
 * Retries once on 429 (rate limited), waiting as long as Retry-After says.
 *
 * @param {string} uid Firebase user ID (for audit logging).
 * @param {string} accessToken OAuth access token.
 * @param {string} pathOrUrl API path ("/d2l/api/...") or absolute URL
 *   (e.g. an ObjectListPage `Next` link).
 * @param {Object} [query] Query parameters; null/undefined values are skipped.
 * @param {string} [action] Label recorded in the audit log / usage counters.
 * @return {Promise<any>} Parsed JSON body.
 */
async function brightspaceGet(uid, accessToken, pathOrUrl, query = {}, action = "api_get") {
  const {baseUrl} = getConfig();
  const url = new URL(pathOrUrl, baseUrl);

  // Only send the token to our own Brightspace host.
  if (url.origin !== new URL(baseUrl).origin) {
    throw new BrightspaceApiError(`Refusing to call non-Brightspace URL: ${url.origin}`, 400, url.pathname);
  }

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await brightspaceFetch(url, {
      headers: {Authorization: `Bearer ${accessToken}`, Accept: "application/json"},
    }, {uid, action});

    if (response.status === 429 && attempt === 0) {
      const waitSec = Math.min(Number(response.headers.get("Retry-After")) || 2, 30);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      continue;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new BrightspaceApiError(
          `Brightspace GET ${url.pathname} failed (${response.status}): ${body.slice(0, 200)}`,
          response.status, url.pathname);
    }

    return response.json();
  }

  throw new BrightspaceApiError("Brightspace rate limit persisted after retry", 429, url.pathname);
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

/**
 * Fetches every course offering the user is enrolled in.
 * Uses paging (PagedResultSet + bookmark).
 *
 * @param {string} uid Firebase user ID.
 * @param {string} accessToken OAuth access token.
 * @param {Object} [opts]
 * @param {boolean} [opts.activeOnly=false] Only return courses whose
 *   org unit is active. Closed or inactive courses are included by default
 *   and flagged with isActive/canAccess, so you can see what Brightspace returns.
 * @return {Promise<Array<{
 *   orgUnitId: number, name: string, code: string|null, homeUrl: string|null,
 *   isActive: boolean, canAccess: boolean, startDate: string|null,
 *   endDate: string|null, role: string|null
 * }>>}
 */
async function fetchMyCourses(uid, accessToken, {activeOnly = false} = {}) {
  const path = `/d2l/api/lp/${LP_VERSION}/enrollments/myenrollments/`;
  const courses = [];
  let bookmark;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await brightspaceGet(uid, accessToken, path, {
      orgUnitTypeId: COURSE_OFFERING_TYPE_ID,
      isActive: activeOnly ? true : undefined,
      bookmark,
    }, "list_courses");

    for (const item of result.Items || []) {
      courses.push({
        orgUnitId: item.OrgUnit.Id,
        name: item.OrgUnit.Name,
        code: item.OrgUnit.Code || null,
        homeUrl: item.OrgUnit.HomeUrl || null,
        isActive: !!item.Access?.IsActive,
        canAccess: !!item.Access?.CanAccess,
        startDate: item.Access?.StartDate || null,
        endDate: item.Access?.EndDate || null,
        role: item.Access?.ClasslistRoleName || null,
      });
    }

    if (!result.PagingInfo?.HasMoreItems) break;
    bookmark = result.PagingInfo.Bookmark;
  }

  return courses;
}

// ---------------------------------------------------------------------------
// Assignments (via calendar)
// ---------------------------------------------------------------------------

/**
 * Default date window for calendar queries: 30 days ago → 180 days ahead.
 * myEvents requires both startDateTime and endDateTime.
 *
 * @return {{startDateTime: string, endDateTime: string}}
 */
function defaultWindow() {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  return {
    startDateTime: new Date(now - 30 * day).toISOString(),
    endDateTime: new Date(now + 180 * day).toISOString(),
  };
}

/**
 * Fetches due-dated items (assignments, quizzes, discussions, ...) for
 * one course, from the user's calendar for that course.
 *
 * @param {string} uid Firebase user ID.
 * @param {string} accessToken OAuth access token.
 * @param {number|string} orgUnitId Course org unit ID (from fetchMyCourses).
 * @param {Object} [opts]
 * @param {string} [opts.startDateTime] ISO UTC start of window.
 * @param {string} [opts.endDateTime] ISO UTC end of window.
 * @param {string[]} [opts.types] Gather types to keep, e.g. ["assignment"].
 *   Defaults to every type in ENTITY_TYPE_MAP.
 * @return {Promise<Array<Object>>} Normalized items, ready for createAssignment().
 */
async function fetchCourseAssignments(uid, accessToken, orgUnitId, opts = {}) {
  const win = defaultWindow();
  const startDateTime = opts.startDateTime || win.startDateTime;
  const endDateTime = opts.endDateTime || win.endDateTime;
  const allowedTypes = opts.types ? new Set(opts.types) : null;

  let next = `/d2l/api/le/${LE_VERSION}/${orgUnitId}/calendar/events/myEvents/`;
  let query = {
    association: ASSOCIATION_ASSOCIATED_ONLY,
    eventType: EVENT_TYPE_DUE_DATE,
    startDateTime,
    endDateTime,
  };

  const byEntity = new Map();
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const result = await brightspaceGet(uid, accessToken, next, query, "list_calendar_events");
    // `Next` is a complete URL that already includes its query parameters.
    next = result.Next || null;
    query = {};

    for (const event of result.Objects || []) {
      const item = normalizeEvent(event);
      if (!item) continue;
      if (allowedTypes && !allowedTypes.has(item.type)) continue;
      // One item per entity (defensive: avoid duplicate events for the same folder).
      byEntity.set(item.id, item);
    }
  }

  return [...byEntity.values()];
}

/**
 * Fetches assignments for many courses. Courses are fetched in small
 * batches to avoid hitting Brightspace rate limits. A course that fails
 * doesn't stop the rest; its error is returned in `errors`.
 *
 * @param {string} uid Firebase user ID.
 * @param {string} accessToken OAuth access token.
 * @param {Array<{orgUnitId: number}>} courses From fetchMyCourses.
 * @param {Object} [opts] Same options as fetchCourseAssignments.
 * @return {Promise<{assignments: Array<Object>, errors: Array<{orgUnitId: number, status: number, message: string}>}>}
 */
async function fetchAssignmentsForCourses(uid, accessToken, courses, opts = {}) {
  const CONCURRENCY = 3;
  const assignments = [];
  const errors = [];

  for (let i = 0; i < courses.length; i += CONCURRENCY) {
    const batch = courses.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
        batch.map((c) => fetchCourseAssignments(uid, accessToken, c.orgUnitId, opts)),
    );
    results.forEach((r, idx) => {
      if (r.status === "fulfilled") {
        assignments.push(...r.value);
      } else {
        errors.push({
          orgUnitId: batch[idx].orgUnitId,
          status: r.reason?.status || 500,
          message: r.reason?.message || String(r.reason),
        });
      }
    });
  }

  assignments.sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  return {assignments, errors};
}

/**
 * Converts a Calendar.EventDataInfo into Gather's assignment shape.
 * Returns null for events we don't track (no entity, unknown type, no date).
 *
 * @param {Object} event EventDataInfo from Brightspace.
 * @return {Object|null}
 */
function normalizeEvent(event) {
  if (!event.IsAssociatedWithEntity || !event.AssociatedEntity) return null;
  // Should already be filtered server-side; check in case the param is ignored.
  if (event.EventType != null && event.EventType !== EVENT_TYPE_DUE_DATE) return null;

  const entityType = event.AssociatedEntity.AssociatedEntityType;
  const type = ENTITY_TYPE_MAP[entityType];
  if (!type) return null;

  // Due-date events are usually timed (EndDateTime/StartDateTime).
  // All-day events use StartDay/EndDay instead.
  const dueAt = event.EndDateTime || event.StartDateTime || event.EndDay || event.StartDay || null;
  if (!dueAt) return null;

  return {
    // Stable ID: makes re-syncs idempotent when used as the Firestore doc ID.
    id: `bs_${event.OrgUnitId}_${type}_${event.AssociatedEntity.AssociatedEntityId}`,
    title: event.Title,
    courseId: String(event.OrgUnitId),
    courseName: event.OrgUnitName || null,
    dueAt,
    type,
    source: "brightspace",
    sourceUrl: event.AssociatedEntity.Link || event.CalendarEventViewUrl || null,
    brightspace: {
      orgUnitId: event.OrgUnitId,
      entityType,
      entityId: event.AssociatedEntity.AssociatedEntityId,
      calendarEventId: event.CalendarEventId,
    },
  };
}

module.exports = {
  BrightspaceApiError,
  getAccessToken,
  brightspaceGet,
  fetchMyCourses,
  fetchCourseAssignments,
  fetchAssignmentsForCourses,
  normalizeEvent,
};
