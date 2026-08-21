const pool = require("../config/database");

const RETURNING_FIELDS = `
  id,
  to_char(note_date, 'YYYY-MM-DD') AS "noteDate",
  to_char(note_time, 'HH24:MI') AS "noteTime",
  shift,
  author_name AS "authorName",
  author_profile_id AS "authorProfileId",
  note_text AS "noteText",
  is_highlighted AS "isHighlighted",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

async function getAll(patientId, userId, { date, shift } = {}) {
  const result = await pool.query(`
    SELECT n.id, to_char(n.note_date, 'YYYY-MM-DD') AS "noteDate",
      to_char(n.note_time, 'HH24:MI') AS "noteTime", n.shift,
      n.author_name AS "authorName", n.author_profile_id AS "authorProfileId",
      cp.name AS "authorProfileName", n.note_text AS "noteText",
      n.is_highlighted AS "isHighlighted", n.created_at AS "createdAt", n.updated_at AS "updatedAt"
    FROM nursing_notes n
    LEFT JOIN caregiver_profiles cp ON cp.id = n.author_profile_id
    WHERE n.patient_id = $1 AND n.patient_id IN (SELECT id FROM patients WHERE user_id = $2)
      AND ($3::date IS NULL OR n.note_date = $3)
      AND ($4::varchar IS NULL OR n.shift = $4)
    ORDER BY n.note_date DESC, n.note_time DESC`,
    [patientId, userId, date, shift]);
  return result.rows;
}

async function patientBelongsToUser(patientId, userId) {
  const result = await pool.query("SELECT 1 FROM patients WHERE id = $1 AND user_id = $2", [patientId, userId]);
  return result.rowCount > 0;
}

async function create(note) {
  const result = await pool.query(
    `INSERT INTO nursing_notes (note_date, note_time, shift, author_name, author_profile_id, note_text, is_highlighted, patient_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [note.noteDate, note.noteTime, note.shift, note.authorName, note.authorProfileId, note.noteText, note.isHighlighted, note.patientId],
  );
  return result.rows[0].id;
}

async function update(id, note, userId) {
  const result = await pool.query(
    `UPDATE nursing_notes SET note_date = $1, note_time = $2, shift = $3,
      note_text = $4, is_highlighted = $5, updated_at = CURRENT_TIMESTAMP
     WHERE id = $6 AND patient_id IN (SELECT id FROM patients WHERE user_id = $7) RETURNING id`,
    [note.noteDate, note.noteTime, note.shift, note.noteText, note.isHighlighted, id, userId],
  );
  return result.rowCount > 0;
}

async function findById(id, userId) {
  const result = await pool.query(
    `SELECT id, author_profile_id AS "authorProfileId"
     FROM nursing_notes
     WHERE id = $1 AND patient_id IN (SELECT id FROM patients WHERE user_id = $2)`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}

async function remove(id, userId) {
  const result = await pool.query(
    "DELETE FROM nursing_notes WHERE id = $1 AND patient_id IN (SELECT id FROM patients WHERE user_id = $2) RETURNING id",
    [id, userId],
  );
  return result.rowCount > 0;
}

module.exports = Object.freeze({ create, findById, getAll, patientBelongsToUser, remove, update });
