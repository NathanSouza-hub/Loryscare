const EventNotFoundError = require("../errors/event-not-found-error");
const EventValidationError = require("../errors/event-validation-error");

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validateId(value, field = "id") {
  if (!/^\d+$/.test(String(value ?? "")) || value === "0") {
    throw new EventValidationError({ [field]: "Identificador inválido" });
  }
}

function validateEvent(input, editing = false) {
  const details = {};
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const category = typeof input.category === "string" ? input.category.trim() : "";
  const eventTime = typeof input.eventTime === "string" ? input.eventTime.trim() : "";
  const notes = typeof input.notes === "string" ? input.notes.trim() : "";
  const eventDate = typeof input.eventDate === "string" ? input.eventDate : "";
  const patientId = input.patientId;

  if (!title || title.length > 120) details.title = "Informe um título com até 120 caracteres";
  if (category.length > 40) details.category = "Use no máximo 40 caracteres";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(eventTime)) details.eventTime = "Informe um horário válido";
  if (notes.length > 500) details.notes = "Use no máximo 500 caracteres";
  if (!isDate(eventDate)) details.eventDate = "Informe uma data válida";
  if (!editing && !/^\d+$/.test(String(patientId ?? ""))) details.patientId = "Selecione um paciente";
  if (Object.keys(details).length) throw new EventValidationError(details);

  const important = input.important !== false;

  return { title, category: category || null, eventDate, eventTime, notes: notes || null, patientId, important };
}

function recurringDates(start, end, weekdays) {
  const dates = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor <= last) {
    if (weekdays.has(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function createEventsService(repository) {
  async function getAll(patientId, userId, range) {
    validateId(patientId, "patientId");
    return repository.getAll(patientId, userId, range);
  }
  async function create(input, userId, profileId) {
    const source = input ?? {};
    const event = { ...validateEvent(source), authorProfileId: profileId ?? null };
    if (!(await repository.patientBelongsToUser(event.patientId, userId))) {
      throw new EventValidationError({ patientId: "Paciente não encontrado" });
    }
    if (!source.repeatWeekly) return { id: await repository.create(event) };

    const repeatUntil = typeof source.repeatUntil === "string" ? source.repeatUntil : "";
    const weekdays = new Set(Array.isArray(source.repeatWeekdays) ? source.repeatWeekdays.map(Number) : []);
    const maxDate = new Date(`${event.eventDate}T00:00:00Z`);
    maxDate.setUTCFullYear(maxDate.getUTCFullYear() + 1);
    if (!isDate(repeatUntil) || repeatUntil < event.eventDate || new Date(`${repeatUntil}T00:00:00Z`) > maxDate) {
      throw new EventValidationError({ repeatUntil: "Informe uma data final entre a data inicial e um ano" });
    }
    if (!weekdays.size || [...weekdays].some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new EventValidationError({ repeatWeekdays: "Selecione pelo menos um dia da semana" });
    }
    const dates = recurringDates(event.eventDate, repeatUntil, weekdays);
    if (!dates.length) throw new EventValidationError({ repeatWeekdays: "Nenhuma ocorrência encontrada no período" });
    const ids = await repository.createMany(dates.map((eventDate) => ({ ...event, eventDate })));
    return { ids, count: ids.length };
  }
  async function update(id, input, userId) {
    validateId(id);
    if (!(await repository.update(id, validateEvent(input ?? {}, true), userId))) throw new EventNotFoundError();
  }
  async function remove(id, userId) {
    validateId(id);
    if (!(await repository.remove(id, userId))) throw new EventNotFoundError();
  }
  async function getDaily(date, patientId, userId) {
    if (!isDate(date)) throw new EventValidationError({ date: "Informe uma data válida" });
    validateId(patientId, "patientId");
    return repository.getDaily(date, patientId, userId);
  }
  async function getUpcoming(patientId, userId, days) {
    validateId(patientId, "patientId");
    const parsedDays = Number(days);
    if (!Number.isInteger(parsedDays) || parsedDays < 0 || parsedDays > 365) {
      throw new EventValidationError({ days: "Informe um número de dias válido" });
    }
    return repository.getUpcoming(patientId, userId, parsedDays);
  }
  async function setStatus(id, input, userId, profileId) {
    validateId(id);
    const status = input.status;
    if (!new Set(["completed", "skipped"]).has(status)) throw new EventValidationError({ status: "Status inválido" });
    const result = await repository.setStatus(id, status, userId, profileId ?? null);
    if (!result) throw new EventNotFoundError();
    return result;
  }
  function yesterday() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  async function getMissed(patientId, userId) {
    validateId(patientId, "patientId");
    return repository.getMissed(yesterday(), patientId, userId);
  }
  return Object.freeze({ create, getAll, getDaily, getMissed, getUpcoming, remove, setStatus, update });
}

module.exports = createEventsService;
