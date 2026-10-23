const PaymentReportValidationError = require("../errors/payment-report-validation-error");
const PaymentReportNotFoundError = require("../errors/payment-report-not-found-error");

const CYCLE_DAYS = [5, 20];
const MAX_PERIOD_DAYS = 62;
const MAX_AMOUNT_CENTS = 100000000;
const MAX_DESCRIPTION_LENGTH = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

function isId(value) {
  return /^\d{1,18}$/.test(String(value ?? ""));
}

function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function addOneDay(isoDate) {
  return new Date(parseDate(isoDate).getTime() + DAY_MS).toISOString().slice(0, 10);
}

function isValidTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function parseAmount(rawValue, field = "amount") {
  const text = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
  const value = Number(text.replace(",", "."));
  const cents = Math.round(value * 100);
  if (text === "" || !Number.isFinite(value) || cents < 0 || cents > MAX_AMOUNT_CENTS) {
    throw new PaymentReportValidationError({ [field]: "Informe um valor válido" });
  }
  return cents;
}

function parseDescription(rawValue, required) {
  const text = typeof rawValue === "string" ? rawValue.trim() : "";
  if (required && !text) throw new PaymentReportValidationError({ description: "Informe uma descrição" });
  if (text.length > MAX_DESCRIPTION_LENGTH) {
    throw new PaymentReportValidationError({ description: `A descrição deve ter até ${MAX_DESCRIPTION_LENGTH} caracteres` });
  }
  return text || null;
}

function validatePeriod(input) {
  const cycleDay = Number(input.cycleDay);
  if (!CYCLE_DAYS.includes(cycleDay)) {
    throw new PaymentReportValidationError({ cycleDay: "Escolha o pagamento do dia 05 ou do dia 20" });
  }
  const start = parseDate(input.startDate);
  const end = parseDate(input.endDate);
  if (!start || !end) throw new PaymentReportValidationError({ startDate: "Informe datas válidas" });
  if (end < start) throw new PaymentReportValidationError({ endDate: "A data final deve ser igual ou posterior à inicial" });
  if ((end - start) / DAY_MS + 1 > MAX_PERIOD_DAYS) {
    throw new PaymentReportValidationError({ endDate: `O período pode ter no máximo ${MAX_PERIOD_DAYS} dias` });
  }
  return { cycleDay, startDate: input.startDate, endDate: input.endDate };
}

// Valor proporcional às horas, como em Pagamentos: um plantão dividido (12h numa escala de 24h) vale metade.
function shiftAmountCents({ rateCents, durationMinutes, monthDurationHours }) {
  if (rateCents === null || rateCents === undefined) return null;
  return Math.round((rateCents * durationMinutes) / (monthDurationHours * 60));
}

function itemsFromShifts(shifts) {
  return shifts.map((shift) => ({
    kind: "shift",
    profileId: String(shift.profileId),
    scheduleShiftId: String(shift.scheduleShiftId),
    startedAt: shift.startedAt,
    endedAt: shift.endedAt,
    amountCents: shiftAmountCents(shift),
    description: null,
  }));
}

function createPaymentReportsService(repository, caregiverProfilesRepository) {
  async function findOwnedReport(id, userId) {
    if (!isId(id)) throw new PaymentReportNotFoundError();
    const report = await repository.findById(id, userId);
    if (!report) throw new PaymentReportNotFoundError();
    return report;
  }

  async function assertProfileBelongsToUser(profileId, userId) {
    if (!isId(profileId) || !(await caregiverProfilesRepository.belongsToUser(profileId, userId))) {
      throw new PaymentReportValidationError({ profileId: "Cuidador inválido" });
    }
  }

  async function list(userId) {
    return repository.list(userId);
  }

  async function create(input, userId, profileId) {
    const period = validatePeriod(input ?? {});
    const shifts = await repository.listShiftsForPeriod(userId, period.startDate, period.endDate);
    const id = await repository.create({
      userId, ...period, createdByProfileId: profileId ?? null, items: itemsFromShifts(shifts),
    });
    return { id, ...period };
  }

  async function get(id, userId) {
    const report = await findOwnedReport(id, userId);
    const [items, overlappingReports] = await Promise.all([
      repository.listItems(report.id),
      repository.findOverlapping(userId, report.id, report.startDate, report.endDate),
    ]);
    const totalCents = items.reduce((sum, item) => sum + (item.amountCents ?? 0), 0);
    const missingAmountCount = items.filter((item) => item.kind === "shift" && item.amountCents === null).length;
    return { ...report, items, totalCents, warnings: { missingAmountCount, overlappingReports } };
  }

  async function recalculate(id, userId) {
    const report = await findOwnedReport(id, userId);
    const shifts = await repository.listShiftsForPeriod(userId, report.startDate, report.endDate);
    await repository.replaceShiftItems(report.id, itemsFromShifts(shifts));
  }

  async function remove(id, userId) {
    if (!(await repository.remove(id, userId))) throw new PaymentReportNotFoundError();
  }

  function buildManualShift(input) {
    const startDate = parseDate(input.date) ? input.date : null;
    if (!startDate) throw new PaymentReportValidationError({ date: "Informe uma data válida" });
    if (!isValidTime(input.startTime) || !isValidTime(input.endTime)) {
      throw new PaymentReportValidationError({ startTime: "Informe horários válidos" });
    }
    // Término igual ou antes do início significa que o plantão termina no dia seguinte (noturno ou 24h).
    const endDate = input.endTime <= input.startTime ? addOneDay(startDate) : startDate;
    return {
      kind: "shift",
      scheduleShiftId: null,
      startedAt: `${startDate} ${input.startTime}:00`,
      endedAt: `${endDate} ${input.endTime}:00`,
      amountCents: parseAmount(input.amount),
      description: parseDescription(input.description, false),
    };
  }

  function buildAdjustment(input) {
    if (!["discount", "bonus"].includes(input.direction)) {
      throw new PaymentReportValidationError({ direction: "Escolha desconto ou acréscimo" });
    }
    const cents = parseAmount(input.amount);
    return {
      kind: "adjustment",
      scheduleShiftId: null,
      startedAt: null,
      endedAt: null,
      amountCents: input.direction === "discount" ? -cents : cents,
      description: parseDescription(input.description, true),
    };
  }

  async function addItem(reportId, input, userId) {
    const data = input ?? {};
    let item;
    if (data.kind === "shift") item = buildManualShift(data);
    else if (data.kind === "adjustment") item = buildAdjustment(data);
    else throw new PaymentReportValidationError({ kind: "Tipo de lançamento inválido" });
    await assertProfileBelongsToUser(data.profileId, userId);
    const report = await findOwnedReport(reportId, userId);
    const id = await repository.insertItem(report.id, { ...item, profileId: String(data.profileId) });
    return { id };
  }

  async function updateItem(reportId, itemId, input, userId) {
    const report = await findOwnedReport(reportId, userId);
    const item = isId(itemId) ? await repository.findItem(report.id, itemId) : null;
    if (!item) throw new PaymentReportNotFoundError();
    const cents = parseAmount(input?.amount);
    const isDiscount = item.kind === "adjustment" && item.amountCents < 0;
    await repository.updateItem(report.id, itemId, {
      amountCents: isDiscount ? -cents : cents,
      description: parseDescription(input?.description, item.kind === "adjustment"),
    });
  }

  async function removeItem(reportId, itemId, userId) {
    const report = await findOwnedReport(reportId, userId);
    if (!isId(itemId) || !(await repository.deleteItem(report.id, itemId))) throw new PaymentReportNotFoundError();
  }

  return Object.freeze({ addItem, create, get, list, recalculate, remove, removeItem, updateItem });
}

module.exports = createPaymentReportsService;
