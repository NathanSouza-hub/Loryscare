const bcrypt = require("bcryptjs");
const CaregiverProfileNotFoundError = require("../errors/caregiver-profile-not-found-error");
const CaregiverProfileValidationError = require("../errors/caregiver-profile-validation-error");

const PIN_PATTERN = /^\d{4}$/;

function validateId(value, field = "id") {
  if (!/^\d+$/.test(String(value ?? "")) || value === "0") {
    throw new CaregiverProfileValidationError({ [field]: "Identificador inválido" });
  }
}

function validatePin(pin) {
  if (!PIN_PATTERN.test(String(pin ?? ""))) {
    throw new CaregiverProfileValidationError({ pin: "Informe um PIN de 4 dígitos" });
  }
}

function validateProfile(input, editing = false) {
  const details = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const avatarColor = typeof input.avatarColor === "string" ? input.avatarColor.trim() : "";
  const pin = typeof input.pin === "string" ? input.pin.trim() : "";

  if (!name || name.length > 80) details.name = "Informe um nome com até 80 caracteres";
  if (!avatarColor) details.avatarColor = "Escolha uma cor de avatar";
  if (pin && !PIN_PATTERN.test(pin)) details.pin = "Informe um PIN de 4 dígitos";
  if (Object.keys(details).length) throw new CaregiverProfileValidationError(details);

  return { name, avatarColor, pin: pin || null, isActive: editing ? input.isActive !== false : true };
}

function createCaregiverProfilesService(repository) {
  async function create(input, userId) {
    const profile = validateProfile(input ?? {});
    const pinHash = profile.pin ? await bcrypt.hash(profile.pin, 10) : null;
    return repository.create({ name: profile.name, avatarColor: profile.avatarColor, pinHash, userId });
  }

  async function getAll(userId) {
    return repository.getAll(userId);
  }

  async function update(id, input, userId) {
    validateId(id);
    const profile = validateProfile(input ?? {}, true);
    const pinHash = profile.pin ? await bcrypt.hash(profile.pin, 10) : null;
    const updated = await repository.update(
      id,
      { name: profile.name, avatarColor: profile.avatarColor, isActive: profile.isActive, pinHash },
      userId,
    );
    if (!updated) throw new CaregiverProfileNotFoundError();
    return updated;
  }

  async function remove(id, userId) {
    validateId(id);
    if (!(await repository.remove(id, userId))) throw new CaregiverProfileNotFoundError();
  }

  async function verifyPin(id, pin, userId) {
    validateId(id);
    validatePin(pin);
    const record = await repository.getPinHash(id, userId);
    if (!record || !record.pinHash) throw new CaregiverProfileNotFoundError();
    if (!(await bcrypt.compare(pin, record.pinHash))) {
      throw new CaregiverProfileValidationError({ pin: "PIN incorreto" });
    }
  }

  async function setPin(id, pin, userId) {
    validateId(id);
    validatePin(pin);
    const status = await repository.getPinStatus(id, userId);
    if (!status) throw new CaregiverProfileNotFoundError();
    if (status.hasPin) throw new CaregiverProfileValidationError({ pin: "Este perfil já possui um PIN" });
    return repository.setPin(id, await bcrypt.hash(pin, 10), userId);
  }

  return Object.freeze({ create, getAll, remove, setPin, update, verifyPin });
}

module.exports = createCaregiverProfilesService;
