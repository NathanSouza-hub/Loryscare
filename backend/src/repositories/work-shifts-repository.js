const pool = require("../config/database");

const SHIFT_FIELDS = `
  id,
  profile_id AS "profileId",
  to_char(started_at, 'HH24:MI') AS "startedTime",
  to_char(expected_end_at, 'HH24:MI') AS "expectedEndTime",
  duration_hours AS "durationHours"
`;

async function createExclusive(shift) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [shift.userId]);
    const current = await client.query(
      `SELECT ws.profile_id AS "profileId", cp.name AS "profileName",
         to_char(ws.started_at, 'HH24:MI') AS "startedTime",
         to_char(ws.expected_end_at, 'HH24:MI') AS "expectedEndTime",
         ws.duration_hours AS "durationHours"
       FROM work_shifts ws
       JOIN caregiver_profiles cp ON cp.id = ws.profile_id
       WHERE ws.user_id = $1 AND ws.ended_at IS NULL
         AND ws.started_at <= $2::timestamp AND ws.expected_end_at > $2::timestamp
       ORDER BY ws.started_at DESC
       LIMIT 1`,
      [shift.userId, shift.now],
    );
    if (current.rows[0]) {
      await client.query("COMMIT");
      return { created: false, shift: current.rows[0] };
    }
    const result = await client.query(
      `INSERT INTO work_shifts (user_id, profile_id, started_at, duration_hours, expected_end_at, schedule_shift_id, scheduled_start_at, scheduled_end_at)
       VALUES ($1, $2, $3::timestamp, $4::smallint, $3::timestamp + ($4::text || ' hours')::interval, $5, $6::timestamp, $7::timestamp)
       RETURNING ${SHIFT_FIELDS}`,
      [
        shift.userId, shift.profileId, shift.startedAt, shift.durationHours,
        shift.scheduleShiftId ?? null, shift.scheduledStartAt ?? null, shift.scheduledEndAt ?? null,
      ],
    );
    await client.query("COMMIT");
    return { created: true, shift: result.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function existsForScheduleShift(scheduleShiftId) {
  const result = await pool.query("SELECT 1 FROM work_shifts WHERE schedule_shift_id = $1", [scheduleShiftId]);
  return result.rowCount > 0;
}

async function findCurrent(userId, now) {
  const result = await pool.query(
    `SELECT ws.profile_id AS "profileId", cp.name AS "profileName",
       to_char(ws.started_at, 'HH24:MI') AS "startedTime",
       to_char(ws.expected_end_at, 'HH24:MI') AS "expectedEndTime"
     FROM work_shifts ws
     JOIN caregiver_profiles cp ON cp.id = ws.profile_id
     WHERE ws.user_id = $1 AND ws.ended_at IS NULL AND ws.expected_end_at > $2::timestamp
     ORDER BY ws.started_at DESC
     LIMIT 1`,
    [userId, now],
  );
  return result.rows[0] ?? null;
}

async function findCovering(userId, at) {
  const result = await pool.query(
    `SELECT ws.profile_id AS "profileId", cp.name AS "profileName",
       to_char(ws.started_at, 'HH24:MI') AS "startedTime",
       to_char(COALESCE(ws.ended_at, ws.expected_end_at), 'HH24:MI') AS "endTime"
     FROM work_shifts ws
     JOIN caregiver_profiles cp ON cp.id = ws.profile_id
     WHERE ws.user_id = $1 AND ws.started_at <= $2::timestamp AND $2::timestamp < COALESCE(ws.ended_at, ws.expected_end_at)
     ORDER BY ws.started_at DESC
     LIMIT 1`,
    [userId, at],
  );
  return result.rows[0] ?? null;
}

module.exports = Object.freeze({ createExclusive, existsForScheduleShift, findCovering, findCurrent });
