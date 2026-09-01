const ScheduleMonthValidationError = require("../errors/schedule-month-validation-error");
const ScheduleMonthNotFoundError = require("../errors/schedule-month-not-found-error");

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function minutesOf(value) {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(dateStr, amount) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + amount));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

function buildSlots({ year, month, durationHours, firstStartTime, secondStartTime, caregiverIds }) {
  const totalDays = daysInMonth(year, month);
  const slots = [];
  let caregiverIndex = 0;
  const nextCaregiver = () => {
    const profileId = caregiverIds[caregiverIndex % caregiverIds.length];
    caregiverIndex += 1;
    return profileId;
  };
  for (let day = 1; day <= totalDays; day += 1) {
    const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
    const nextDate = addDays(dateStr, 1);
    if (durationHours === 24) {
      slots.push({
        scheduledStartAt: `${dateStr} ${firstStartTime}:00`,
        scheduledEndAt: `${nextDate} ${firstStartTime}:00`,
        profileId: nextCaregiver(),
      });
    } else {
      slots.push({
        scheduledStartAt: `${dateStr} ${firstStartTime}:00`,
        scheduledEndAt: `${dateStr} ${secondStartTime}:00`,
        profileId: nextCaregiver(),
      });
      slots.push({
        scheduledStartAt: `${dateStr} ${secondStartTime}:00`,
        scheduledEndAt: `${nextDate} ${firstStartTime}:00`,
        profileId: nextCaregiver(),
      });
    }
  }
  return slots;
}

function validateInput(input) {
  const details = {};
  const year = Number(input.year);
  const month = Number(input.month);
  const durationHours = Number(input.durationHours);
  const firstStartTime = typeof input.firstStartTime === "string" ? input.firstStartTime.trim() : "";
  const secondStartTime = typeof input.secondStartTime === "string" ? input.secondStartTime.trim() : "";
  const caregiverIds = Array.isArray(input.caregiverIds) ? input.caregiverIds.map(String) : [];

  if (!Number.isInteger(year) || year < 2020 || year > 2100) details.year = "Informe um ano válido";
  if (!Number.isInteger(month) || month < 1 || month > 12) details.month = "Informe um mês válido";
  if (durationHours !== 12 && durationHours !== 24) details.durationHours = "Escolha 12h ou 24h";
  if (!isTime(firstStartTime)) details.firstStartTime = "Informe um horário válido";
  if (durationHours === 12 && !isTime(secondStartTime)) details.secondStartTime = "Informe um horário válido";
  if (
    durationHours === 12 && isTime(firstStartTime) && isTime(secondStartTime)
    && ((minutesOf(secondStartTime) - minutesOf(firstStartTime) + 1440) % 1440) !== 720
  ) {
    details.secondStartTime = "Em plantões de 12h os dois períodos devem começar com 12 horas de diferença";
  }
  if (!caregiverIds.length) details.caregiverIds = "Selecione ao menos um cuidador";
  if (new Set(caregiverIds).size !== caregiverIds.length) {
    details.caregiverIds = "Cada cuidador só pode aparecer uma vez na ordem";
  }
  if (Object.keys(details).length) throw new ScheduleMonthValidationError(details);

  return {
    year, month, durationHours, firstStartTime,
    secondStartTime: durationHours === 12 ? secondStartTime : null,
    caregiverIds,
  };
}

function createScheduleMonthsService(repository, caregiverProfilesRepository) {
  async function create(input, userId) {
    const data = validateInput(input ?? {});
    for (const profileId of data.caregiverIds) {
      if (!(await caregiverProfilesRepository.belongsToUser(profileId, userId))) {
        throw new ScheduleMonthValidationError({ caregiverIds: "Cuidador inválido" });
      }
    }
    if (await repository.findByYearMonth(userId, data.year, data.month)) {
      throw new ScheduleMonthValidationError({
        month: "Já existe uma escala para este mês. Exclua-a antes de gerar novamente.",
      });
    }
    const slots = buildSlots(data);
    const id = await repository.create({ userId, ...data, slots });
    return { id, ...data };
  }

  async function getByYearMonth(year, month, userId) {
    const scheduleMonth = await repository.findByYearMonth(userId, Number(year), Number(month));
    if (!scheduleMonth) return null;
    const caregivers = await repository.getCaregivers(scheduleMonth.id);
    return { ...scheduleMonth, caregivers };
  }

  async function remove(id, userId) {
    if (!(await repository.belongsToUser(id, userId))) throw new ScheduleMonthNotFoundError();
    if (await repository.hasStartedShift(id)) {
      throw new ScheduleMonthValidationError({
        month: "Este mês já tem plantões iniciados; não é possível excluir a escala.",
      });
    }
    await repository.remove(id, userId);
  }

  return Object.freeze({ create, getByYearMonth, remove });
}

module.exports = createScheduleMonthsService;
