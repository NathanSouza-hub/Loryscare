const WorkShiftValidationError = require("../errors/work-shift-validation-error");

function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function nowTimestamp() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

function periodFromHour(hour) {
  if (hour >= 6 && hour < 12) return "Manhã";
  if (hour >= 12 && hour < 18) return "Tarde";
  if (hour >= 18) return "Noite";
  return "Madrugada";
}

function attachPeriod(shift) {
  if (!shift) return null;
  return { ...shift, period: periodFromHour(Number(shift.startedTime.slice(0, 2))) };
}

function validateInput(input) {
  const details = {};
  const startedDate = typeof input.startedDate === "string" ? input.startedDate : "";
  const startedTime = typeof input.startedTime === "string" ? input.startedTime.trim() : "";
  const durationHours = Number(input.durationHours);

  if (!isDate(startedDate)) details.startedDate = "Informe uma data válida";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startedTime)) details.startedTime = "Informe um horário válido";
  if (durationHours !== 12 && durationHours !== 24) details.durationHours = "Escolha 12h ou 24h";
  if (Object.keys(details).length) throw new WorkShiftValidationError(details);

  const startedAt = `${startedDate} ${startedTime}:00`;
  if (startedAt > nowTimestamp()) {
    throw new WorkShiftValidationError({ startedTime: "O início do plantão não pode ser no futuro" });
  }

  return { startedAt, durationHours };
}

function createWorkShiftsService(repository, scheduleShiftsRepository) {
  async function startFromSchedule(scheduleShiftId, userId) {
    if (!/^\d+$/.test(String(scheduleShiftId ?? ""))) {
      throw new WorkShiftValidationError({ scheduleShiftId: "Identificador inválido" });
    }
    const scheduleShift = await scheduleShiftsRepository.findById(scheduleShiftId, userId);
    if (!scheduleShift) throw new WorkShiftValidationError({ scheduleShiftId: "Plantão programado não encontrado" });
    if (await repository.existsForScheduleShift(scheduleShiftId, userId)) {
      throw new WorkShiftValidationError({ scheduleShiftId: "Este plantão já foi iniciado" });
    }
    const durationHours = Math.round(
      (new Date(scheduleShift.scheduledEndAt) - new Date(scheduleShift.scheduledStartAt)) / 3600000,
    );
    if (durationHours !== 12 && durationHours !== 24) {
      throw new WorkShiftValidationError({
        scheduleShiftId: "A duração deste plantão programado é inválida (12h ou 24h esperado).",
      });
    }
    const scheduledEndAt = `${scheduleShift.scheduledEndDate} ${scheduleShift.scheduledEndTime}:00`;
    const result = await repository.createExclusive({
      userId,
      profileId: scheduleShift.profileId,
      startedAt: nowTimestamp(),
      durationHours,
      now: nowTimestamp(),
      scheduleShiftId,
      scheduledStartAt: `${scheduleShift.scheduledDate} ${scheduleShift.scheduledStartTime}:00`,
      scheduledEndAt,
      expectedEndAt: scheduledEndAt,
    });
    if (!result.created && String(result.shift.profileId) !== String(scheduleShift.profileId)) {
      throw new WorkShiftValidationError({
        scheduleShiftId: `${result.shift.profileName} já está de plantão até ${result.shift.expectedEndTime}`,
      });
    }
    return { ...attachPeriod(result.shift), alreadyActive: !result.created };
  }

  async function start(input, userId, profileId) {
    const body = input ?? {};
    if (body.scheduleShiftId) return startFromSchedule(body.scheduleShiftId, userId);
    if (!profileId) {
      throw new WorkShiftValidationError({ profileId: "Selecione um cuidador para iniciar o plantão" });
    }
    const { startedAt, durationHours } = validateInput(body);
    const result = await repository.createExclusive({
      userId, profileId, startedAt, durationHours, now: nowTimestamp(),
    });
    if (!result.created && String(result.shift.profileId) !== String(profileId)) {
      throw new WorkShiftValidationError({
        profileId: `${result.shift.profileName} já está de plantão até ${result.shift.expectedEndTime}`,
      });
    }
    return { ...attachPeriod(result.shift), alreadyActive: !result.created };
  }

  async function getCurrent(userId) {
    return attachPeriod(await repository.findCurrent(userId, nowTimestamp()));
  }

  return Object.freeze({ getCurrent, start });
}

module.exports = createWorkShiftsService;
