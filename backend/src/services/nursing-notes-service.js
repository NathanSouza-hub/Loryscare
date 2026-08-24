const NursingNoteNotFoundError = require("../errors/nursing-note-not-found-error");
const NursingNoteValidationError = require("../errors/nursing-note-validation-error");
const NursingNoteOwnershipError = require("../errors/nursing-note-ownership-error");
const NursingNoteShiftConflictError = require("../errors/nursing-note-shift-conflict-error");

const VALID_SHIFTS = new Set(["Manhã", "Tarde", "Noite", "Madrugada"]);

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validateId(value, field = "id") {
  if (!/^\d+$/.test(String(value ?? "")) || value === "0") {
    throw new NursingNoteValidationError({ [field]: "Identificador inválido" });
  }
}

function validateNote(input, editing = false) {
  const details = {};
  const noteDate = typeof input.noteDate === "string" ? input.noteDate : "";
  const noteTime = typeof input.noteTime === "string" ? input.noteTime.trim() : "";
  const shift = typeof input.shift === "string" ? input.shift.trim() : "";
  const noteText = typeof input.noteText === "string" ? input.noteText.trim() : "";
  const patientId = input.patientId;

  if (!isDate(noteDate)) details.noteDate = "Informe uma data válida";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(noteTime)) details.noteTime = "Informe um horário válido";
  if (!VALID_SHIFTS.has(shift)) details.shift = "Informe um turno válido";
  if (!noteText || noteText.length > 2000) details.noteText = "Informe o texto da evolução com até 2000 caracteres";
  if (!editing && !/^\d+$/.test(String(patientId ?? ""))) details.patientId = "Selecione um paciente";
  if (Object.keys(details).length) throw new NursingNoteValidationError(details);

  return { noteDate, noteTime, shift, noteText, patientId, isHighlighted: Boolean(input.isHighlighted) };
}

function createNursingNotesService(repository, workShiftsRepository) {
  async function checkShift(note, userId, profileId) {
    if (!profileId || !workShiftsRepository) return;
    const eventAt = `${note.noteDate} ${note.noteTime}:00`;
    const covering = await workShiftsRepository.findCovering(userId, eventAt);
    if (covering && String(covering.profileId) !== String(profileId)) {
      throw new NursingNoteShiftConflictError(
        `Este horário pertence ao plantão de ${covering.profileName} (${covering.startedTime}–${covering.endTime})`,
      );
    }
  }
  async function create(input, userId, profileId) {
    const note = { ...validateNote(input ?? {}), authorName: null, authorProfileId: profileId ?? null };
    if (!(await repository.patientBelongsToUser(note.patientId, userId))) {
      throw new NursingNoteValidationError({ patientId: "Paciente não encontrado" });
    }
    await checkShift(note, userId, profileId);
    return { id: await repository.create(note) };
  }
  async function getAll(patientId, userId, { date, shift } = {}) {
    validateId(patientId, "patientId");
    if (date && !isDate(date)) throw new NursingNoteValidationError({ date: "Informe uma data válida" });
    if (shift && !VALID_SHIFTS.has(shift)) throw new NursingNoteValidationError({ shift: "Informe um turno válido" });
    return repository.getAll(patientId, userId, { date: date || null, shift: shift || null });
  }
  async function update(id, input, userId, profileId) {
    validateId(id);
    const existing = await repository.findById(id, userId);
    if (!existing) throw new NursingNoteNotFoundError();
    if (existing.authorProfileId != null && String(existing.authorProfileId) !== String(profileId ?? "")) {
      throw new NursingNoteOwnershipError();
    }
    const note = validateNote(input ?? {}, true);
    await checkShift(note, userId, profileId);
    if (!(await repository.update(id, note, userId))) throw new NursingNoteNotFoundError();
  }
  async function remove(id, userId) {
    validateId(id);
    if (!(await repository.remove(id, userId))) throw new NursingNoteNotFoundError();
  }
  return Object.freeze({ create, getAll, remove, update });
}

module.exports = createNursingNotesService;
