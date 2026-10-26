const pool = require("../config/database");

const REPORT_FIELDS = `
  pr.id,
  pr.cycle_day AS "cycleDay",
  to_char(pr.start_date, 'YYYY-MM-DD') AS "startDate",
  to_char(pr.end_date, 'YYYY-MM-DD') AS "endDate",
  pr.created_at AS "createdAt",
  pr.updated_at AS "updatedAt"
`;

const ITEM_FIELDS = `
  pri.id,
  pri.kind,
  pri.profile_id AS "profileId",
  cp.name AS "profileName",
  pri.schedule_shift_id AS "scheduleShiftId",
  to_char(pri.started_at, 'YYYY-MM-DD') AS "startDate",
  to_char(pri.started_at, 'HH24:MI') AS "startTime",
  to_char(pri.ended_at, 'YYYY-MM-DD') AS "endDate",
  to_char(pri.ended_at, 'HH24:MI') AS "endTime",
  (EXTRACT(EPOCH FROM pri.ended_at - pri.started_at) / 60)::int AS "durationMinutes",
  pri.amount_cents AS "amountCents",
  pri.description
`;

// Um plantão pertence ao período em que COMEÇA: quem atravessa a meia-noite ou o limite
// entre dois períodos entra em um só relatório.
async function listShiftsForPeriod(userId, startDate, endDate) {
  const result = await pool.query(
    `SELECT ss.id AS "scheduleShiftId",
            ss.profile_id AS "profileId",
            to_char(ss.scheduled_start_at, 'YYYY-MM-DD HH24:MI:SS') AS "startedAt",
            to_char(ss.scheduled_end_at, 'YYYY-MM-DD HH24:MI:SS') AS "endedAt",
            (EXTRACT(EPOCH FROM ss.scheduled_end_at - ss.scheduled_start_at) / 60)::int AS "durationMinutes",
            sm.duration_hours AS "monthDurationHours",
            sm.shift_rate_cents AS "rateCents"
     FROM schedule_shifts ss
     JOIN schedule_months sm ON sm.id = ss.schedule_month_id
     WHERE ss.user_id = $1
       AND ss.scheduled_start_at >= $2::date
       AND ss.scheduled_start_at < $3::date + 1
     ORDER BY ss.scheduled_start_at, ss.id`,
    [userId, startDate, endDate],
  );
  return result.rows;
}

async function list(userId) {
  const result = await pool.query(
    `SELECT ${REPORT_FIELDS},
            COALESCE(SUM(pri.amount_cents), 0)::float AS "totalCents",
            COUNT(pri.id) FILTER (WHERE pri.kind = 'shift' AND pri.amount_cents IS NULL)::int AS "missingAmountCount"
     FROM payment_reports pr
     LEFT JOIN payment_report_items pri ON pri.report_id = pr.id
     WHERE pr.user_id = $1
     GROUP BY pr.id
     ORDER BY pr.start_date DESC, pr.id DESC`,
    [userId],
  );
  return result.rows;
}

async function findById(id, userId) {
  const result = await pool.query(
    `SELECT ${REPORT_FIELDS} FROM payment_reports pr WHERE pr.id = $1 AND pr.user_id = $2`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}

async function findOverlapping(userId, id, startDate, endDate) {
  const result = await pool.query(
    `SELECT ${REPORT_FIELDS} FROM payment_reports pr
     WHERE pr.user_id = $1 AND pr.id <> $2 AND pr.start_date <= $4::date AND pr.end_date >= $3::date
     ORDER BY pr.start_date`,
    [userId, id, startDate, endDate],
  );
  return result.rows;
}

async function listItems(reportId) {
  const result = await pool.query(
    `SELECT ${ITEM_FIELDS}
     FROM payment_report_items pri
     JOIN caregiver_profiles cp ON cp.id = pri.profile_id
     WHERE pri.report_id = $1
     ORDER BY cp.name, pri.profile_id, pri.kind DESC, pri.started_at NULLS LAST, pri.id`,
    [reportId],
  );
  return result.rows;
}

async function findItem(reportId, itemId) {
  const result = await pool.query(
    `SELECT ${ITEM_FIELDS}
     FROM payment_report_items pri
     JOIN caregiver_profiles cp ON cp.id = pri.profile_id
     WHERE pri.report_id = $1 AND pri.id = $2`,
    [reportId, itemId],
  );
  return result.rows[0] ?? null;
}

async function insertItemWith(client, reportId, item) {
  const result = await client.query(
    `INSERT INTO payment_report_items
       (report_id, profile_id, kind, schedule_shift_id, started_at, ended_at, amount_cents, description)
     VALUES ($1, $2, $3, $4, $5::timestamp, $6::timestamp, $7, $8) RETURNING id`,
    [reportId, item.profileId, item.kind, item.scheduleShiftId, item.startedAt, item.endedAt, item.amountCents, item.description],
  );
  return result.rows[0].id;
}

async function touch(client, reportId) {
  await client.query("UPDATE payment_reports SET updated_at = CURRENT_TIMESTAMP WHERE id = $1", [reportId]);
}

async function inTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function create({ userId, cycleDay, startDate, endDate, createdByProfileId, items }) {
  return inTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO payment_reports (user_id, cycle_day, start_date, end_date, created_by_profile_id)
       VALUES ($1, $2, $3::date, $4::date, $5) RETURNING id`,
      [userId, cycleDay, startDate, endDate, createdByProfileId],
    );
    const reportId = result.rows[0].id;
    for (const item of items) await insertItemWith(client, reportId, item);
    return reportId;
  });
}

async function replaceShiftItems(reportId, items) {
  await inTransaction(async (client) => {
    await client.query("DELETE FROM payment_report_items WHERE report_id = $1 AND kind = 'shift'", [reportId]);
    for (const item of items) await insertItemWith(client, reportId, item);
    await touch(client, reportId);
  });
}

async function insertItem(reportId, item) {
  return inTransaction(async (client) => {
    const id = await insertItemWith(client, reportId, item);
    await touch(client, reportId);
    return id;
  });
}

async function updateItem(reportId, itemId, { amountCents, description }) {
  await inTransaction(async (client) => {
    await client.query(
      "UPDATE payment_report_items SET amount_cents = $3, description = $4 WHERE report_id = $1 AND id = $2",
      [reportId, itemId, amountCents, description],
    );
    await touch(client, reportId);
  });
}

async function deleteItem(reportId, itemId) {
  return inTransaction(async (client) => {
    const result = await client.query(
      "DELETE FROM payment_report_items WHERE report_id = $1 AND id = $2",
      [reportId, itemId],
    );
    if (result.rowCount > 0) await touch(client, reportId);
    return result.rowCount > 0;
  });
}

async function remove(id, userId) {
  const result = await pool.query("DELETE FROM payment_reports WHERE id = $1 AND user_id = $2", [id, userId]);
  return result.rowCount > 0;
}

module.exports = Object.freeze({
  create, deleteItem, findById, findItem, findOverlapping, insertItem, list, listItems, listShiftsForPeriod, remove,
  replaceShiftItems, updateItem,
});
