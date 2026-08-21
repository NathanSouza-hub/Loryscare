const RoutineNotFoundError = require("../errors/routine-not-found-error");
const RoutineValidationError = require("../errors/routine-validation-error");
const RoutineCompletionConflictError = require("../errors/routine-completion-conflict-error");

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validateId(value, field = "id") {
  if (!/^\d+$/.test(String(value ?? "")) || value === "0") {
    throw new RoutineValidationError({ [field]: "Identificador inválido" });
  }
}

function validateRoutine(input, editing = false) {
  const details = {};
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const category = typeof input.category === "string" ? input.category.trim() : "";
  const time = typeof input.time === "string" ? input.time.trim() : "";
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  const startDate = typeof input.startDate === "string" ? input.startDate : "";
  const patientId = input.patientId;

  if (!title || title.length > 120) details.title = "Informe uma atividade com até 120 caracteres";
  if (!category || category.length > 40) details.category = "Informe uma categoria válida";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) details.time = "Informe um horário válido";
  if (notes.length > 500) details.notes = "Use no máximo 500 caracteres";
  if (!isDate(startDate)) details.startDate = "Informe uma data inicial válida";
  if (!editing && !/^\d+$/.test(String(patientId ?? ""))) details.patientId = "Selecione um paciente";
  if (Object.keys(details).length) throw new RoutineValidationError(details);

  return {
    title, category, time, notes: notes || null, startDate, patientId,
    isActive: editing ? input.isActive !== false : true,
    isFixed: Boolean(input.isFixed),
  };
}

function createRoutinesService(repository) {
  async function getAll(patientId, userId) {
    validateId(patientId, "patientId");
    return repository.getAll(patientId, userId);
  }
  async function create(input, userId) {
    const routine = validateRoutine(input ?? {});
    if (!(await repository.patientBelongsToUser(routine.patientId, userId))) {
      throw new RoutineValidationError({ patientId: "Paciente não encontrado" });
    }
    return { id: await repository.create(routine) };
  }
  async function update(id, input, userId) {
    validateId(id);
    if (!(await repository.update(id, validateRoutine(input ?? {}, true), userId))) throw new RoutineNotFoundError();
  }
  async function remove(id, userId) {
    validateId(id);
    if (!(await repository.remove(id, userId))) throw new RoutineNotFoundError();
  }
  async function getDaily(date, patientId, userId) {
    if (!isDate(date)) throw new RoutineValidationError({ date: "Informe uma data válida" });
    validateId(patientId, "patientId");
    return repository.getDaily(date, patientId, userId);
  }
  async function setCompletion(id, input, userId, profileId) {
    validateId(id);
    const details = {};
    const date = typeof input.date === "string" ? input.date : "";
    const status = input.status;
    if (!isDate(date)) details.date = "Informe uma data válida";
    if (!new Set(["completed", "skipped"]).has(status)) details.status = "Status inválido";
    if (Object.keys(details).length) throw new RoutineValidationError(details);
    if (!(await repository.existsOnDate(id, date, userId))) throw new RoutineNotFoundError("Atividade não encontrada nesta data");

    const completedAt = status === "completed" ? new Date() : null;
    const authorProfileId = profileId ?? null;

    function applyEdit(record) {
      if (record.authorProfileId != null && String(record.authorProfileId) !== String(authorProfileId)) {
        throw new RoutineCompletionConflictError({
          authorProfileName: record.authorProfileName,
          completedAt: record.completedAt,
        });
      }
      return repository.updateCompletion(record.id, { status, completedAt: record.completedAt ?? completedAt });
    }

    const existing = await repository.findCompletion(id, date);
    if (!existing) {
      const inserted = await repository.insertCompletion({ routineId: id, date, status, completedAt, authorProfileId });
      if (inserted) return inserted;
      const refetched = await repository.findCompletion(id, date);
      if (!refetched) {
        throw new RoutineCompletionConflictError({ authorProfileName: null, completedAt: null });
      }
      return applyEdit(refetched);
    }
    return applyEdit(existing);
  }
  return Object.freeze({ create, getAll, getDaily, remove, setCompletion, update });
}

module.exports = createRoutinesService;
