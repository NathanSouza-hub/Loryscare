const ValidationError = require("../errors/validation-error");
const NotFoundError = require("../errors/not-found-error");
const VitalSignOwnershipError = require("../errors/vital-sign-ownership-error");

const VALID_SHIFTS = new Set(["Manhã", "Tarde", "Noite", "Madrugada"]);

function isValidDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseNumber(value, field, details, { integer = false, min, max }) {
  const parsedValue = typeof value === "string" && value.trim() === "" ? NaN : Number(value);

  if (
    !Number.isFinite(parsedValue) ||
    (integer && !Number.isInteger(parsedValue)) ||
    parsedValue < min ||
    parsedValue > max
  ) {
    details[field] = `Deve ser um número entre ${min} e ${max}`;
  }

  return parsedValue;
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function parseOptionalNumber(value, field, details, rules) {
  return hasValue(value) ? parseNumber(value, field, details, rules) : null;
}

function validateAndMap(input, editing = false) {
  const details = {};
  const date = typeof input.date === "string" ? input.date.trim() : "";
  const patientId = input.patientId;
  const time = typeof input.time === "string" ? input.time.trim() : "";
  const shift = typeof input.shift === "string" ? input.shift.trim() : "";
  const bloodPressure =
    typeof input.bloodPressure === "string" ? input.bloodPressure.trim() : "";

  if (!isValidDate(date)) details.date = "Informe uma data válida no formato AAAA-MM-DD";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    details.time = "Informe um horário válido no formato HH:MM";
  }
  if (!VALID_SHIFTS.has(shift)) details.shift = "Informe um turno válido";

  const pressureMatch = /^(\d{2,3})\/(\d{2,3})$/.exec(bloodPressure);
  if (bloodPressure && !pressureMatch) {
    details.bloodPressure = "Informe a pressão no formato 120/80";
  }

  const heartRate = parseOptionalNumber(input.heartRate, "heartRate", details, {
    integer: true,
    min: 1,
    max: 300,
  });
  const oxygenSaturation = parseOptionalNumber(
    input.oxygenSaturation,
    "oxygenSaturation",
    details,
    { integer: true, min: 1, max: 100 },
  );
  const temperature = parseOptionalNumber(input.temperature, "temperature", details, {
    min: 30,
    max: 45,
  });

  let bloodGlucose = null;
  if (hasValue(input.bloodGlucose)) {
    bloodGlucose = parseNumber(input.bloodGlucose, "bloodGlucose", details, {
      integer: true,
      min: 1,
      max: 1000,
    });
  }

  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  if (notes.length > 500) details.notes = "Deve ter no máximo 500 caracteres";
  if (!editing && !/^\d+$/.test(String(patientId ?? ""))) details.patientId = "Selecione um paciente";

  if (Object.keys(details).length > 0) throw new ValidationError(details);

  return {
    measuredAt: `${date}T${time}:00`,
    shift,
    systolicPressure: pressureMatch ? Number(pressureMatch[1]) : null,
    diastolicPressure: pressureMatch ? Number(pressureMatch[2]) : null,
    heartRate,
    oxygenSaturation,
    temperature,
    bloodGlucose,
    notes: notes || null,
    patientId,
  };
}

function createVitalsService(repository) {
  function validateId(id, field = "id") {
    if (!/^\d+$/.test(String(id ?? "")) || id === "0") {
      throw new ValidationError({ [field]: "Informe um identificador válido" });
    }
  }

  async function create(input, userId, profileId) {
    const vitalSigns = { ...validateAndMap(input ?? {}), authorProfileId: profileId ?? null };
    if (!(await repository.patientBelongsToUser(vitalSigns.patientId, userId))) {
      throw new ValidationError({ patientId: "Paciente não encontrado" });
    }
    return repository.create(vitalSigns);
  }

  async function getAll(patientId, userId) {
    validateId(patientId, "patientId");
    return repository.getAll(patientId, userId);
  }

  async function update(id, input, userId, profileId) {
    validateId(id);
    const existing = await repository.findById(id, userId);
    if (!existing) throw new NotFoundError();
    if (existing.authorProfileId != null && String(existing.authorProfileId) !== String(profileId ?? "")) {
      throw new VitalSignOwnershipError();
    }
    const updatedRecord = await repository.update(id, validateAndMap(input ?? {}, true), userId);
    if (!updatedRecord) throw new NotFoundError();
    return updatedRecord;
  }

  async function remove(id, userId) {
    validateId(id);
    const removed = await repository.remove(id, userId);
    if (!removed) throw new NotFoundError();
  }

  return Object.freeze({ create, getAll, remove, update });
}

module.exports = createVitalsService;
