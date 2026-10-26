const pool = require("../config/database");

async function create({ userId, tokenHash, expiresAt }) {
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
}

async function findValid(tokenHash) {
  const result = await pool.query(
    `SELECT id, user_id AS "userId" FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
    [tokenHash],
  );
  return result.rows[0] ?? null;
}

async function invalidateForUser(userId) {
  await pool.query(
    `UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
}

module.exports = Object.freeze({ create, findValid, invalidateForUser });
