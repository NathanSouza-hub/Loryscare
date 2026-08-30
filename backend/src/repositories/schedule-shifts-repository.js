const pool = require("../config/database");

const SHIFT_FIELDS = `
  ss.id,
  ss.schedule_month_id AS "scheduleMonthId",
  to_char(ss.scheduled_start_at, 'YYYY-MM-DD') AS "scheduledDate",
  to_char(ss.scheduled_end_at, 'YYYY-MM-DD') AS "scheduledEndDate",
  to_char(ss.scheduled_start_at, 'HH24:MI') AS "scheduledStartTime",
  to_char(ss.scheduled_end_at, 'HH24:MI') AS "scheduledEndTime",
  ss.scheduled_start_at AS "scheduledStartAt",
  ss.scheduled_end_at AS "scheduledEndAt",
  ss.original_profile_id AS "originalProfileId",
  ss.profile_id AS "profileId",
  cp.name AS "profileName",
  ws.id AS "workShiftId",
  ws.ended_at AS "workShiftEndedAt"
`;

async function listByMonth(userId, year, month) {
  const result = await pool.query(
    `SELECT ${SHIFT_FIELDS}
     FROM schedule_shifts ss
     JOIN schedule_months sm ON sm.id = ss.schedule_month_id
     JOIN caregiver_profiles cp ON cp.id = ss.profile_id
     LEFT JOIN work_shifts ws ON ws.schedule_shift_id = ss.id
     WHERE ss.user_id = $1 AND sm.year = $2 AND sm.month = $3
     ORDER BY ss.scheduled_start_at`,
    [userId, year, month],
  );
  return result.rows;
}

async function findById(id, userId) {
  const result = await pool.query(
    `SELECT ${SHIFT_FIELDS}
     FROM schedule_shifts ss
     JOIN caregiver_profiles cp ON cp.id = ss.profile_id
     LEFT JOIN work_shifts ws ON ws.schedule_shift_id = ss.id
     WHERE ss.id = $1 AND ss.user_id = $2`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}

async function findCurrentForProfile(userId, profileId, now) {
  const result = await pool.query(
    `SELECT ${SHIFT_FIELDS}
     FROM schedule_shifts ss
     JOIN caregiver_profiles cp ON cp.id = ss.profile_id
     LEFT JOIN work_shifts ws ON ws.schedule_shift_id = ss.id
     WHERE ss.user_id = $1 AND ss.profile_id = $2
       AND ss.scheduled_start_at <= $3::timestamp AND ss.scheduled_end_at > $3::timestamp
     ORDER BY ss.scheduled_start_at DESC LIMIT 1`,
    [userId, profileId, now],
  );
  return result.rows[0] ?? null;
}

async function update(id, changes, userId) {
  const result = await pool.query(
    `UPDATE schedule_shifts SET profile_id = $1, scheduled_start_at = $2::timestamp, scheduled_end_at = $3::timestamp,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $4 AND user_id = $5 RETURNING id`,
    [changes.profileId, changes.scheduledStartAt, changes.scheduledEndAt, id, userId],
  );
  return result.rowCount > 0;
}

async function remove(id, userId) {
  const result = await pool.query(
    "DELETE FROM schedule_shifts WHERE id = $1 AND user_id = $2 RETURNING id",
    [id, userId],
  );
  return result.rowCount > 0;
}

async function swapProfiles(idA, idB, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query(
      `SELECT id, profile_id AS "profileId" FROM schedule_shifts WHERE id IN ($1, $2) AND user_id = $3 FOR UPDATE`,
      [idA, idB, userId],
    );
    if (rows.rowCount !== 2) {
      await client.query("ROLLBACK");
      return null;
    }
    const shiftA = rows.rows.find((row) => String(row.id) === String(idA));
    const shiftB = rows.rows.find((row) => String(row.id) === String(idB));
    await client.query(
      "UPDATE schedule_shifts SET profile_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [shiftB.profileId, shiftA.id],
    );
    await client.query(
      "UPDATE schedule_shifts SET profile_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [shiftA.profileId, shiftB.id],
    );
    await client.query("COMMIT");
    return {
      shiftA: { id: shiftA.id, previousProfileId: shiftA.profileId, newProfileId: shiftB.profileId },
      shiftB: { id: shiftB.id, previousProfileId: shiftB.profileId, newProfileId: shiftA.profileId },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function hasWorkShift(id) {
  const result = await pool.query("SELECT 1 FROM work_shifts WHERE schedule_shift_id = $1", [id]);
  return result.rowCount > 0;
}

async function recordSwap({ scheduleShiftId, previousProfileId, newProfileId, changedByProfileId }) {
  await pool.query(
    `INSERT INTO schedule_shift_swaps (schedule_shift_id, previous_profile_id, new_profile_id, changed_by_profile_id)
     VALUES ($1, $2, $3, $4)`,
    [scheduleShiftId, previousProfileId, newProfileId, changedByProfileId],
  );
}

module.exports = Object.freeze({
  findById, findCurrentForProfile, hasWorkShift, listByMonth, recordSwap, remove, swapProfiles, update,
});
