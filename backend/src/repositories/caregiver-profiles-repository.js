const pool = require("../config/database");

const PUBLIC_FIELDS = `id, name, avatar_color AS "avatarColor", is_active AS "isActive", (pin_hash IS NOT NULL) AS "hasPin"`;

async function getAll(userId) {
  const result = await pool.query(
    `SELECT ${PUBLIC_FIELDS} FROM caregiver_profiles
     WHERE user_id = $1 ORDER BY is_active DESC, name`,
    [userId],
  );
  return result.rows;
}

async function create(profile) {
  const result = await pool.query(
    `INSERT INTO caregiver_profiles (name, avatar_color, user_id, pin_hash)
     VALUES ($1, $2, $3, $4) RETURNING ${PUBLIC_FIELDS}`,
    [profile.name, profile.avatarColor, profile.userId, profile.pinHash],
  );
  return result.rows[0];
}

async function update(id, profile, userId) {
  const result = await pool.query(
    `UPDATE caregiver_profiles SET name = $1, avatar_color = $2, is_active = $3,
       pin_hash = COALESCE($4, pin_hash), updated_at = CURRENT_TIMESTAMP
     WHERE id = $5 AND user_id = $6 RETURNING ${PUBLIC_FIELDS}`,
    [profile.name, profile.avatarColor, profile.isActive, profile.pinHash, id, userId],
  );
  return result.rows[0] ?? null;
}

async function remove(id, userId) {
  const result = await pool.query(
    "DELETE FROM caregiver_profiles WHERE id = $1 AND user_id = $2 RETURNING id",
    [id, userId],
  );
  return result.rowCount > 0;
}

async function belongsToUser(profileId, userId) {
  const result = await pool.query(
    "SELECT 1 FROM caregiver_profiles WHERE id = $1 AND user_id = $2",
    [profileId, userId],
  );
  return result.rowCount > 0;
}

async function getPinHash(id, userId) {
  const result = await pool.query(
    `SELECT pin_hash AS "pinHash" FROM caregiver_profiles WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}

async function getPinStatus(id, userId) {
  const result = await pool.query(
    `SELECT (pin_hash IS NOT NULL) AS "hasPin" FROM caregiver_profiles WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}

async function setPin(id, pinHash, userId) {
  const result = await pool.query(
    `UPDATE caregiver_profiles SET pin_hash = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND user_id = $3 RETURNING ${PUBLIC_FIELDS}`,
    [pinHash, id, userId],
  );
  return result.rows[0] ?? null;
}

module.exports = Object.freeze({
  belongsToUser, create, getAll, getPinHash, getPinStatus, remove, setPin, update,
});
