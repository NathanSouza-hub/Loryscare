const pool = require("../config/database");

const RETURNING_FIELDS = `
  id,
  measured_at AS "measuredAt",
  shift,
  systolic_pressure AS "systolicPressure",
  diastolic_pressure AS "diastolicPressure",
  heart_rate AS "heartRate",
  oxygen_saturation AS "oxygenSaturation",
  temperature::FLOAT AS temperature,
  blood_glucose AS "bloodGlucose",
  notes,
  author_profile_id AS "authorProfileId",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

async function getAll(patientId, userId) {
  const result = await pool.query(`
    SELECT v.id, v.measured_at AS "measuredAt", v.shift,
      v.systolic_pressure AS "systolicPressure", v.diastolic_pressure AS "diastolicPressure",
      v.heart_rate AS "heartRate", v.oxygen_saturation AS "oxygenSaturation",
      v.temperature::FLOAT AS temperature, v.blood_glucose AS "bloodGlucose", v.notes,
      v.author_profile_id AS "authorProfileId", cp.name AS "authorProfileName",
      v.created_at AS "createdAt", v.updated_at AS "updatedAt"
    FROM vital_signs v
    LEFT JOIN caregiver_profiles cp ON cp.id = v.author_profile_id
    WHERE v.patient_id = $1 AND v.patient_id IN (SELECT id FROM patients WHERE user_id = $2)
    ORDER BY v.measured_at DESC
  `, [patientId, userId]);

  return result.rows;
}

async function patientBelongsToUser(patientId, userId) {
  const result = await pool.query("SELECT 1 FROM patients WHERE id = $1 AND user_id = $2", [patientId, userId]);
  return result.rowCount > 0;
}

async function findById(id, userId) {
  const result = await pool.query(
    `SELECT id, author_profile_id AS "authorProfileId"
     FROM vital_signs
     WHERE id = $1 AND patient_id IN (SELECT id FROM patients WHERE user_id = $2)`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}

async function create(vitalSigns) {
  const query = `
    INSERT INTO vital_signs (
      measured_at,
      shift,
      systolic_pressure,
      diastolic_pressure,
      heart_rate,
      oxygen_saturation,
      temperature,
      blood_glucose,
      notes,
      patient_id,
      author_profile_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING ${RETURNING_FIELDS}
  `;
  const values = [
    vitalSigns.measuredAt,
    vitalSigns.shift,
    vitalSigns.systolicPressure,
    vitalSigns.diastolicPressure,
    vitalSigns.heartRate,
    vitalSigns.oxygenSaturation,
    vitalSigns.temperature,
    vitalSigns.bloodGlucose,
    vitalSigns.notes,
    vitalSigns.patientId,
    vitalSigns.authorProfileId,
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

async function update(id, vitalSigns, userId) {
  const query = `
    UPDATE vital_signs
    SET
      measured_at = $1,
      shift = $2,
      systolic_pressure = $3,
      diastolic_pressure = $4,
      heart_rate = $5,
      oxygen_saturation = $6,
      temperature = $7,
      blood_glucose = $8,
      notes = $9,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $10 AND patient_id IN (SELECT id FROM patients WHERE user_id = $11)
    RETURNING ${RETURNING_FIELDS}
  `;
  const values = [
    vitalSigns.measuredAt,
    vitalSigns.shift,
    vitalSigns.systolicPressure,
    vitalSigns.diastolicPressure,
    vitalSigns.heartRate,
    vitalSigns.oxygenSaturation,
    vitalSigns.temperature,
    vitalSigns.bloodGlucose,
    vitalSigns.notes,
    id,
    userId,
  ];
  const result = await pool.query(query, values);

  return result.rows[0] ?? null;
}

async function remove(id, userId) {
  const result = await pool.query(
    "DELETE FROM vital_signs WHERE id = $1 AND patient_id IN (SELECT id FROM patients WHERE user_id = $2) RETURNING id",
    [id, userId],
  );

  return result.rowCount > 0;
}

module.exports = Object.freeze({ create, findById, getAll, patientBelongsToUser, remove, update });
