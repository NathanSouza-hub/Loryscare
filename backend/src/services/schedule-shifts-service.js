const ScheduleShiftValidationError = require("../errors/schedule-shift-validation-error");
const ScheduleShiftNotFoundError = require("../errors/schedule-shift-not-found-error");

function isTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateId(value, field = "id") {
  if (!/^\d+$/.test(String(value ?? "")) || value === "0") {
    throw new ScheduleShiftValidationError({ [field]: "Identificador inválido" });
  }
}

function computeStatus(shift, now) {
  const started = Boolean(shift.workShiftId);
  const windowEnded = new Date(shift.scheduledEndAt) <= now;
  if (started && shift.workShiftEndedAt) return "Concluído";
  if (started && windowEnded) return "Concluído";
  if (started) return "Em andamento";
  if (windowEnded) return "Não realizado";
  return "Programado";
}

function createScheduleShiftsService(repository, caregiverProfilesRepository) {
  async function listByMonth(year, month, userId) {
    const rows = await repository.listByMonth(userId, Number(year), Number(month));
    const now = new Date();
    return rows.map((row) => ({ ...row, status: computeStatus(row, now) }));
  }

  async function findCurrentForProfile(profileId, userId) {
    validateId(profileId, "profileId");
    if (!(await caregiverProfilesRepository.belongsToUser(profileId, userId))) {
      throw new ScheduleShiftValidationError({ profileId: "Cuidador inválido" });
    }
    const now = new Date();
    const pad2 = (value) => String(value).padStart(2, "0");
    const nowText = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    const shift = await repository.findCurrentForProfile(userId, profileId, nowText);
    if (!shift) return null;
    return { ...shift, status: computeStatus(shift, now), alreadyStarted: Boolean(shift.workShiftId) };
  }

  async function update(id, input, userId, profileId) {
    validateId(id);
    const details = {};
    const scheduledDate = typeof input.scheduledDate === "string" ? input.scheduledDate : "";
    const scheduledEndDate = typeof input.scheduledEndDate === "string" && input.scheduledEndDate
      ? input.scheduledEndDate : scheduledDate;
    const scheduledStartTime = typeof input.scheduledStartTime === "string" ? input.scheduledStartTime.trim() : "";
    const scheduledEndTime = typeof input.scheduledEndTime === "string" ? input.scheduledEndTime.trim() : "";
    const newProfileId = input.profileId;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) details.scheduledDate = "Informe uma data válida";
    if (!isTime(scheduledStartTime)) details.scheduledStartTime = "Informe um horário válido";
    if (!isTime(scheduledEndTime)) details.scheduledEndTime = "Informe um horário válido";
    if (!/^\d+$/.test(String(newProfileId ?? ""))) details.profileId = "Selecione um cuidador";
    if (Object.keys(details).length) throw new ScheduleShiftValidationError(details);

    const scheduledStartAt = `${scheduledDate} ${scheduledStartTime}:00`;
    const scheduledEndAt = `${scheduledEndDate} ${scheduledEndTime}:00`;
    if (scheduledEndAt <= scheduledStartAt) {
      throw new ScheduleShiftValidationError({ scheduledEndTime: "O término deve ser depois do início" });
    }
    if (!(await caregiverProfilesRepository.belongsToUser(newProfileId, userId))) {
      throw new ScheduleShiftValidationError({ profileId: "Cuidador inválido" });
    }

    const existing = await repository.findById(id, userId);
    if (!existing) throw new ScheduleShiftNotFoundError();

    const previousProfileId = existing.profileId;
    if (!(await repository.update(id, { profileId: newProfileId, scheduledStartAt, scheduledEndAt }, userId))) {
      throw new ScheduleShiftNotFoundError();
    }
    if (String(previousProfileId) !== String(newProfileId)) {
      await repository.recordSwap({
        scheduleShiftId: id, previousProfileId, newProfileId, changedByProfileId: profileId ?? null,
      });
    }
  }

  async function remove(id, userId) {
    validateId(id);
    if (!(await repository.remove(id, userId))) throw new ScheduleShiftNotFoundError();
  }

  async function swap(shiftIdA, shiftIdB, userId, profileId) {
    validateId(shiftIdA, "shiftIdA");
    validateId(shiftIdB, "shiftIdB");
    if (String(shiftIdA) === String(shiftIdB)) {
      throw new ScheduleShiftValidationError({ shiftIdB: "Escolha dois plantões diferentes" });
    }
    if ((await repository.hasWorkShift(shiftIdA)) || (await repository.hasWorkShift(shiftIdB))) {
      throw new ScheduleShiftValidationError({ shiftIdA: "Não é possível trocar um plantão que já foi iniciado" });
    }
    const result = await repository.swapProfiles(shiftIdA, shiftIdB, userId);
    if (!result) throw new ScheduleShiftNotFoundError();
    await repository.recordSwap({
      scheduleShiftId: result.shiftA.id,
      previousProfileId: result.shiftA.previousProfileId,
      newProfileId: result.shiftA.newProfileId,
      changedByProfileId: profileId ?? null,
    });
    await repository.recordSwap({
      scheduleShiftId: result.shiftB.id,
      previousProfileId: result.shiftB.previousProfileId,
      newProfileId: result.shiftB.newProfileId,
      changedByProfileId: profileId ?? null,
    });
  }

  return Object.freeze({ findCurrentForProfile, listByMonth, remove, swap, update });
}

module.exports = createScheduleShiftsService;
