const pool = require("../config/database");

async function getAll(patientId, userId, { start, end } = {}) {
  const result = await pool.query(`
    SELECT e.id, e.title, e.category, to_char(e.event_date, 'YYYY-MM-DD') AS "eventDate",
      to_char(e.event_time, 'HH24:MI') AS "eventTime", e.notes, e.status, e.important,
      e.completed_at AS "completedAt",
      e.author_profile_id AS "authorProfileId", author.name AS "authorProfileName",
      e.completed_by_profile_id AS "completedByProfileId", completer.name AS "completedByProfileName"
    FROM events e
    LEFT JOIN caregiver_profiles author ON author.id = e.author_profile_id
    LEFT JOIN caregiver_profiles completer ON completer.id = e.completed_by_profile_id
    WHERE e.patient_id = $1 AND e.patient_id IN (SELECT id FROM patients WHERE user_id = $2)
      AND ($3::date IS NULL OR e.event_date >= $3)
      AND ($4::date IS NULL OR e.event_date <= $4)
    ORDER BY e.event_date, e.event_time, e.title`,
    [patientId, userId, start || null, end || null]);
  return result.rows;
}

async function patientBelongsToUser(patientId, userId) {
  const result = await pool.query("SELECT 1 FROM patients WHERE id = $1 AND user_id = $2", [patientId, userId]);
  return result.rowCount > 0;
}

async function create(event) {
  const result = await pool.query(
    `INSERT INTO events (title, category, event_date, event_time, notes, patient_id, author_profile_id, important)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [event.title, event.category, event.eventDate, event.eventTime, event.notes, event.patientId, event.authorProfileId, event.important],
  );
  return result.rows[0].id;
}

async function createMany(events) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = [];
    for (const event of events) {
      const result = await client.query(
        `INSERT INTO events (title, category, event_date, event_time, notes, patient_id, author_profile_id, important)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [event.title, event.category, event.eventDate, event.eventTime, event.notes, event.patientId, event.authorProfileId, event.important],
      );
      ids.push(result.rows[0].id);
    }
    await client.query("COMMIT");
    return ids;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function update(id, event, userId) {
  const result = await pool.query(
    `UPDATE events SET title = $1, category = $2, event_date = $3, event_time = $4, notes = $5,
      important = $6, updated_at = CURRENT_TIMESTAMP
     WHERE id = $7 AND patient_id IN (SELECT id FROM patients WHERE user_id = $8) RETURNING id`,
    [event.title, event.category, event.eventDate, event.eventTime, event.notes, event.important, id, userId],
  );
  return result.rowCount > 0;
}

async function remove(id, userId) {
  const result = await pool.query(
    "DELETE FROM events WHERE id = $1 AND patient_id IN (SELECT id FROM patients WHERE user_id = $2) RETURNING id",
    [id, userId],
  );
  return result.rowCount > 0;
}

async function getDaily(date, patientId, userId) {
  const result = await pool.query(
    `SELECT e.id, e.title, e.category, to_char(e.event_time, 'HH24:MI') AS time, e.notes, e.status,
       e.completed_by_profile_id AS "completedByProfileId", cp.name AS "completedByProfileName"
     FROM events e
     LEFT JOIN caregiver_profiles cp ON cp.id = e.completed_by_profile_id
     WHERE e.event_date = $1 AND e.patient_id = $2
       AND e.patient_id IN (SELECT id FROM patients WHERE user_id = $3)
     ORDER BY e.event_time, e.title`,
    [date, patientId, userId],
  );
  return result.rows;
}

async function getUpcoming(patientId, userId, days) {
  const result = await pool.query(
    `SELECT id, title, category, to_char(event_date, 'YYYY-MM-DD') AS "eventDate",
      to_char(event_time, 'HH24:MI') AS "eventTime"
     FROM events
     WHERE status = 'pending' AND important = true AND patient_id = $1
       AND patient_id IN (SELECT id FROM patients WHERE user_id = $2)
       AND event_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $3::integer
     ORDER BY event_date, event_time`,
    [patientId, userId, days],
  );
  return result.rows;
}

async function setStatus(id, status, userId, profileId) {
  const result = await pool.query(
    `UPDATE events SET status = $1, completed_at = $2, completed_by_profile_id = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $4 AND patient_id IN (SELECT id FROM patients WHERE user_id = $5)
     RETURNING id, status, completed_at AS "completedAt", completed_by_profile_id AS "completedByProfileId"`,
    [status, status === "completed" ? new Date() : null, profileId, id, userId],
  );
  return result.rows[0];
}

module.exports = Object.freeze({
  create, createMany, getAll, getDaily, getUpcoming, patientBelongsToUser, remove, setStatus, update,
});
