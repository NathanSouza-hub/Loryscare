const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const ScheduleShiftValidationError = require("../src/errors/schedule-shift-validation-error");
const ScheduleShiftNotFoundError = require("../src/errors/schedule-shift-not-found-error");
const createScheduleShiftsService = require("../src/services/schedule-shifts-service");

function fakeCaregiverProfiles(validIds = ["1", "2", "3"]) {
  return { belongsToUser: async (id) => validIds.includes(String(id)) };
}

function row(overrides = {}) {
  return {
    id: "1",
    scheduledStartAt: new Date(Date.now() - 60 * 60 * 1000),
    scheduledEndAt: new Date(Date.now() + 60 * 60 * 1000),
    scheduledDate: "2026-08-27",
    scheduledEndDate: "2026-08-27",
    scheduledStartTime: "06:00",
    scheduledEndTime: "18:00",
    originalProfileId: "1",
    profileId: "1",
    profileName: "Maurício",
    workShiftId: null,
    workShiftEndedAt: null,
    ...overrides,
  };
}

describe("schedule shifts service", () => {
  it("marca como Programado quando não iniciado e dentro da janela", async () => {
    const repository = { listByMonth: async () => [row()] };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    const [result] = await service.listByMonth(2026, 8, "9");
    assert.equal(result.status, "Programado");
  });

  it("marca como Não realizado quando não iniciado e a janela já passou", async () => {
    const repository = {
      listByMonth: async () => [row({
        scheduledStartAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        scheduledEndAt: new Date(Date.now() - 60 * 60 * 1000),
      })],
    };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    const [result] = await service.listByMonth(2026, 8, "9");
    assert.equal(result.status, "Não realizado");
  });

  it("marca como Em andamento quando iniciado e ainda dentro da janela prevista", async () => {
    const repository = { listByMonth: async () => [row({ workShiftId: "50" })] };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    const [result] = await service.listByMonth(2026, 8, "9");
    assert.equal(result.status, "Em andamento");
  });

  it("marca como Concluído quando o plantão real já foi encerrado", async () => {
    const repository = {
      listByMonth: async () => [row({ workShiftId: "50", workShiftEndedAt: new Date() })],
    };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    const [result] = await service.listByMonth(2026, 8, "9");
    assert.equal(result.status, "Concluído");
  });

  it("marca como Concluído quando iniciado, sem encerramento, mas a janela prevista já passou", async () => {
    const repository = {
      listByMonth: async () => [row({
        scheduledStartAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        scheduledEndAt: new Date(Date.now() - 60 * 60 * 1000),
        workShiftId: "50",
        workShiftEndedAt: null,
      })],
    };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    const [result] = await service.listByMonth(2026, 8, "9");
    assert.equal(result.status, "Concluído");
  });

  it("rejeita buscar o plantão atual com profileId inválido", async () => {
    const service = createScheduleShiftsService({}, fakeCaregiverProfiles());
    await assert.rejects(service.findCurrentForProfile("abc", "9"), ScheduleShiftValidationError);
  });

  it("rejeita buscar o plantão atual de um cuidador de outra conta", async () => {
    const service = createScheduleShiftsService({}, fakeCaregiverProfiles([]));
    await assert.rejects(service.findCurrentForProfile("1", "9"), ScheduleShiftValidationError);
  });

  it("retorna null quando não há plantão cobrindo agora", async () => {
    const repository = { findCurrentForProfile: async () => null };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    assert.equal(await service.findCurrentForProfile("1", "9"), null);
  });

  it("retorna alreadyStarted true quando já existe work_shift vinculado", async () => {
    const repository = { findCurrentForProfile: async () => row({ workShiftId: "50" }) };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    const result = await service.findCurrentForProfile("1", "9");
    assert.equal(result.alreadyStarted, true);
    assert.equal(result.status, "Em andamento");
  });

  it("rejeita editar com término antes ou igual ao início", async () => {
    const service = createScheduleShiftsService({}, fakeCaregiverProfiles());
    await assert.rejects(
      service.update("1", {
        profileId: "1", scheduledDate: "2026-08-27", scheduledStartTime: "18:00",
        scheduledEndDate: "2026-08-27", scheduledEndTime: "18:00",
      }, "9", "1"),
      ScheduleShiftValidationError,
    );
  });

  it("rejeita editar para um cuidador que não pertence à conta", async () => {
    const service = createScheduleShiftsService({}, fakeCaregiverProfiles(["1"]));
    await assert.rejects(
      service.update("1", {
        profileId: "99", scheduledDate: "2026-08-27", scheduledStartTime: "06:00", scheduledEndTime: "18:00",
      }, "9", "1"),
      ScheduleShiftValidationError,
    );
  });

  it("grava histórico de troca quando o cuidador responsável muda", async () => {
    let recorded;
    const repository = {
      findById: async () => row({ profileId: "1" }),
      update: async () => true,
      recordSwap: async (entry) => { recorded = entry; },
    };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    await service.update("1", {
      profileId: "2", scheduledDate: "2026-08-27", scheduledStartTime: "06:00", scheduledEndTime: "18:00",
    }, "9", "3");
    assert.deepEqual(recorded, {
      scheduleShiftId: "1", previousProfileId: "1", newProfileId: "2", changedByProfileId: "3",
    });
  });

  it("não grava histórico quando o cuidador não muda, só o horário", async () => {
    let recordCalled = false;
    const repository = {
      findById: async () => row({ profileId: "1" }),
      update: async () => true,
      recordSwap: async () => { recordCalled = true; },
    };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    await service.update("1", {
      profileId: "1", scheduledDate: "2026-08-27", scheduledStartTime: "07:00", scheduledEndTime: "19:00",
    }, "9", "3");
    assert.equal(recordCalled, false);
  });

  it("lança não encontrado ao editar um plantão inexistente", async () => {
    const repository = { findById: async () => null };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    await assert.rejects(
      service.update("1", {
        profileId: "1", scheduledDate: "2026-08-27", scheduledStartTime: "06:00", scheduledEndTime: "18:00",
      }, "9", "3"),
      ScheduleShiftNotFoundError,
    );
  });

  it("lança não encontrado ao excluir um plantão inexistente", async () => {
    const repository = { remove: async () => false };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    await assert.rejects(service.remove("1", "9"), ScheduleShiftNotFoundError);
  });

  it("rejeita trocar um plantão consigo mesmo", async () => {
    const service = createScheduleShiftsService({}, fakeCaregiverProfiles());
    await assert.rejects(service.swap("1", "1", "9", "3"), ScheduleShiftValidationError);
  });

  it("bloqueia troca quando um dos dois já foi iniciado", async () => {
    const repository = { hasWorkShift: async (id) => id === "2" };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    await assert.rejects(service.swap("1", "2", "9", "3"), ScheduleShiftValidationError);
  });

  it("troca os dois plantões e grava as duas entradas de histórico", async () => {
    const recorded = [];
    const repository = {
      hasWorkShift: async () => false,
      swapProfiles: async (idA, idB) => ({
        shiftA: { id: idA, previousProfileId: "1", newProfileId: "2" },
        shiftB: { id: idB, previousProfileId: "2", newProfileId: "1" },
      }),
      recordSwap: async (entry) => recorded.push(entry),
    };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    await service.swap("1", "2", "9", "3");
    assert.equal(recorded.length, 2);
    assert.deepEqual(recorded[0], { scheduleShiftId: "1", previousProfileId: "1", newProfileId: "2", changedByProfileId: "3" });
    assert.deepEqual(recorded[1], { scheduleShiftId: "2", previousProfileId: "2", newProfileId: "1", changedByProfileId: "3" });
  });

  it("lança não encontrado quando a troca não pertence à conta", async () => {
    const repository = { hasWorkShift: async () => false, swapProfiles: async () => null };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    await assert.rejects(service.swap("1", "2", "9", "3"), ScheduleShiftNotFoundError);
  });
});
