const pool = require("../config/database");

async function getAll(patientId, userId) {
  const result = await pool.query(`
    SELECT id, title, category, to_char(scheduled_time, 'HH24:MI') AS time,
      notes, to_char(start_date, 'YYYY-MM-DD') AS "startDate",
      is_active AS "isActive", is_fixed AS "isFixed"
    FROM routines
    WHERE patient_id = $1 AND patient_id IN (SELECT id FROM patients WHERE user_id = $2)
    ORDER BY is_active DESC, scheduled_time, title`,
    [patientId, userId]);
  return result.rows;
}

async function patientBelongsToUser(patientId, userId) {
  const result = await pool.query("SELECT 1 FROM patients WHERE id = $1 AND user_id = $2", [patientId, userId]);
  return result.rowCount > 0;
}

async function create(routine) {
  const result = await pool.query(
    `INSERT INTO routines (title, category, scheduled_time, notes, start_date, patient_id, is_fixed)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [routine.title, routine.category, routine.time, routine.notes, routine.startDate, routine.patientId, routine.isFixed],
  );
  return result.rows[0].id;
}

async function update(id, routine, userId) {
  const result = await pool.query(
    `UPDATE routines SET title = $1, category = $2, scheduled_time = $3, notes = $4,
      start_date = $5, is_active = $6, is_fixed = $7, updated_at = CURRENT_TIMESTAMP
     WHERE id = $8 AND patient_id IN (SELECT id FROM patients WHERE user_id = $9) RETURNING id`,
    [routine.title, routine.category, routine.time, routine.notes, routine.startDate, routine.isActive, routine.isFixed, id, userId],
  );
  return result.rowCount > 0;
}

async function remove(id, userId) {
  const result = await pool.query(
    "DELETE FROM routines WHERE id = $1 AND patient_id IN (SELECT id FROM patients WHERE user_id = $2) RETURNING id",
    [id, userId],
  );
  return result.rowCount > 0;
}

async function getDaily(date, patientId, userId) {
  const result = await pool.query(
    `SELECT r.id, r.title, r.category, to_char(r.scheduled_time, 'HH24:MI') AS time,
      r.notes, r.is_fixed AS "isFixed", COALESCE(c.status, 'pending') AS status, c.completed_at AS "completedAt",
      c.author_profile_id AS "authorProfileId", cp.name AS "authorProfileName"
     FROM routines r
     LEFT JOIN routine_completions c ON c.routine_id = r.id AND c.scheduled_date = $1
     LEFT JOIN caregiver_profiles cp ON cp.id = c.author_profile_id
     WHERE r.is_active = TRUE AND r.start_date <= $1
       AND r.patient_id = $2
       AND r.patient_id IN (SELECT id FROM patients WHERE user_id = $3)
     ORDER BY r.scheduled_time, r.title`,
    [date, patientId, userId],
  );
  return result.rows;
}

async function existsOnDate(id, date, userId) {
  const result = await pool.query(
    `SELECT 1 FROM routines WHERE id = $1 AND is_active = TRUE AND start_date <= $2
       AND patient_id IN (SELECT id FROM patients WHERE user_id = $3)`,
    [id, date, userId],
  );
  return result.rowCount > 0;
}

async function findCompletion(routineId, date) {
  const result = await pool.query(
    `SELECT c.id, c.status, c.completed_at AS "completedAt",
            c.author_profile_id AS "authorProfileId", cp.name AS "authorProfileName"
     FROM routine_completions c
     LEFT JOIN caregiver_profiles cp ON cp.id = c.author_profile_id
     WHERE c.routine_id = $1 AND c.scheduled_date = $2`,
    [routineId, date],
  );
  return result.rows[0] ?? null;
}

async function insertCompletion(data) {
  const result = await pool.query(
    `INSERT INTO routine_completions (routine_id, scheduled_date, status, completed_at, author_profile_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (routine_id, scheduled_date) DO NOTHING
     RETURNING id, status, completed_at AS "completedAt", author_profile_id AS "authorProfileId"`,
    [data.routineId, data.date, data.status, data.completedAt, data.authorProfileId],
  );
  return result.rows[0] ?? null;
}

async function updateCompletion(id, data) {
  const result = await pool.query(
    `UPDATE routine_completions
     SET status = $1, completed_at = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING id, status, completed_at AS "completedAt", author_profile_id AS "authorProfileId"`,
    [data.status, data.completedAt, id],
  );
  return result.rows[0];
}

async function getMissed(date, patientId, userId) {
  const result = await pool.query(
    `SELECT r.id, r.title, to_char(r.scheduled_time, 'HH24:MI') AS time,
       cp.name AS "onDutyProfileName"
     FROM routines r
     LEFT JOIN routine_completions c ON c.routine_id = r.id AND c.scheduled_date = $1
     LEFT JOIN schedule_shifts ss ON ss.user_id = $3
       AND ss.scheduled_start_at <= ($1::text || ' ' || to_char(r.scheduled_time, 'HH24:MI'))::timestamp
       AND ss.scheduled_end_at > ($1::text || ' ' || to_char(r.scheduled_time, 'HH24:MI'))::timestamp
     LEFT JOIN caregiver_profiles cp ON cp.id = ss.profile_id
     WHERE r.is_active = TRUE AND r.start_date <= $1
       AND r.patient_id = $2
       AND r.patient_id IN (SELECT id FROM patients WHERE user_id = $3)
       AND COALESCE(c.status, 'pending') = 'pending'
     ORDER BY r.scheduled_time, r.title`,
    [date, patientId, userId],
  );
  return result.rows;
}

module.exports = Object.freeze({
  create, existsOnDate, findCompletion, getAll, getDaily, getMissed, insertCompletion,
  patientBelongsToUser, remove, update, updateCompletion,
});
