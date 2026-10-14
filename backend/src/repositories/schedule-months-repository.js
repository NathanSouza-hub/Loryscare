const pool = require("../config/database");

const MONTH_FIELDS = `
  id,
  year,
  month,
  duration_hours AS "durationHours",
  to_char(first_start_time, 'HH24:MI') AS "firstStartTime",
  to_char(second_start_time, 'HH24:MI') AS "secondStartTime"
`;

async function findByYearMonth(userId, year, month) {
  const result = await pool.query(
    `SELECT ${MONTH_FIELDS} FROM schedule_months WHERE user_id = $1 AND year = $2 AND month = $3`,
    [userId, year, month],
  );
  return result.rows[0] ?? null;
}

async function getCaregivers(scheduleMonthId) {
  const result = await pool.query(
    `SELECT smc.profile_id AS "profileId", smc.position, cp.name
     FROM schedule_month_caregivers smc
     JOIN caregiver_profiles cp ON cp.id = smc.profile_id
     WHERE smc.schedule_month_id = $1 ORDER BY smc.position`,
    [scheduleMonthId],
  );
  return result.rows;
}

async function getRatedProfileIds(scheduleMonthId) {
  const result = await pool.query(
    "SELECT profile_id::text AS \"profileId\" FROM schedule_month_rates WHERE schedule_month_id = $1",
    [scheduleMonthId],
  );
  return result.rows.map((row) => row.profileId);
}

async function insertRates(client, scheduleMonthId, rates) {
  for (const { profileId, rateCents } of rates) {
    await client.query(
      `INSERT INTO schedule_month_rates (schedule_month_id, profile_id, rate_cents) VALUES ($1, $2, $3)
       ON CONFLICT (schedule_month_id, profile_id)
       DO UPDATE SET rate_cents = EXCLUDED.rate_cents, updated_at = CURRENT_TIMESTAMP`,
      [scheduleMonthId, profileId, rateCents],
    );
  }
}

async function upsertRates(scheduleMonthId, rates) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await insertRates(client, scheduleMonthId, rates);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getEarningsData(scheduleMonthId, profileId) {
  const result = await pool.query(
    `SELECT sm.duration_hours AS "durationHours",
            smr.rate_cents AS "rateCents",
            COALESCE((
              SELECT SUM(EXTRACT(EPOCH FROM ss.scheduled_end_at - ss.scheduled_start_at) / 60)
              FROM schedule_shifts ss
              WHERE ss.schedule_month_id = sm.id AND ss.profile_id = $2
            ), 0)::float AS "totalMinutes"
     FROM schedule_months sm
     LEFT JOIN schedule_month_rates smr ON smr.schedule_month_id = sm.id AND smr.profile_id = $2
     WHERE sm.id = $1`,
    [scheduleMonthId, profileId],
  );
  return result.rows[0];
}

async function create({ userId, year, month, durationHours, firstStartTime, secondStartTime, caregiverIds, slots, rates = [] }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const monthResult = await client.query(
      `INSERT INTO schedule_months (user_id, year, month, duration_hours, first_start_time, second_start_time)
       VALUES ($1, $2, $3, $4, $5::time, $6::time) RETURNING id`,
      [userId, year, month, durationHours, firstStartTime, secondStartTime],
    );
    const scheduleMonthId = monthResult.rows[0].id;
    for (let index = 0; index < caregiverIds.length; index += 1) {
      await client.query(
        `INSERT INTO schedule_month_caregivers (schedule_month_id, profile_id, position) VALUES ($1, $2, $3)`,
        [scheduleMonthId, caregiverIds[index], index + 1],
      );
    }
    for (const slot of slots) {
      await client.query(
        `INSERT INTO schedule_shifts (schedule_month_id, user_id, scheduled_start_at, scheduled_end_at, original_profile_id, profile_id)
         VALUES ($1, $2, $3::timestamp, $4::timestamp, $5, $5)`,
        [scheduleMonthId, userId, slot.scheduledStartAt, slot.scheduledEndAt, slot.profileId],
      );
    }
    await insertRates(client, scheduleMonthId, rates);
    await client.query("COMMIT");
    return scheduleMonthId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function hasStartedShift(scheduleMonthId) {
  const result = await pool.query(
    `SELECT 1 FROM schedule_shifts ss
     JOIN work_shifts ws ON ws.schedule_shift_id = ss.id
     WHERE ss.schedule_month_id = $1 LIMIT 1`,
    [scheduleMonthId],
  );
  return result.rowCount > 0;
}

async function belongsToUser(id, userId) {
  const result = await pool.query("SELECT 1 FROM schedule_months WHERE id = $1 AND user_id = $2", [id, userId]);
  return result.rowCount > 0;
}

async function remove(id, userId) {
  const result = await pool.query(
    "DELETE FROM schedule_months WHERE id = $1 AND user_id = $2 RETURNING id",
    [id, userId],
  );
  return result.rowCount > 0;
}

module.exports = Object.freeze({
  belongsToUser, create, findByYearMonth, getCaregivers, getEarningsData, getRatedProfileIds, hasStartedShift, remove,
  upsertRates,
});
