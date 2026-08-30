const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const WorkShiftValidationError = require("../src/errors/work-shift-validation-error");
const createWorkShiftsService = require("../src/services/work-shifts-service");

function pastInput(overrides = {}) {
  const past = new Date(Date.now() - 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    startedDate: `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}`,
    startedTime: `${pad(past.getHours())}:${pad(past.getMinutes())}`,
    durationHours: "12",
    ...overrides,
  };
}

describe("work shifts service", () => {
  it("rejeita iniciar plantão sem perfil selecionado", async () => {
    const service = createWorkShiftsService({ createExclusive: async () => assert.fail() });
    await assert.rejects(service.start(pastInput(), "9", null), WorkShiftValidationError);
  });

  it("rejeita data inválida", async () => {
    const service = createWorkShiftsService({ createExclusive: async () => assert.fail() });
    await assert.rejects(
      service.start(pastInput({ startedDate: "31-13-2026" }), "9", "4"),
      WorkShiftValidationError,
    );
  });

  it("rejeita duração diferente de 12 ou 24", async () => {
    const service = createWorkShiftsService({ createExclusive: async () => assert.fail() });
    await assert.rejects(service.start(pastInput({ durationHours: "8" }), "9", "4"), WorkShiftValidationError);
  });

  it("rejeita início no futuro", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    const service = createWorkShiftsService({ createExclusive: async () => assert.fail() });
    await assert.rejects(
      service.start({
        startedDate: `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}`,
        startedTime: `${pad(future.getHours())}:${pad(future.getMinutes())}`,
        durationHours: "12",
      }, "9", "4"),
      WorkShiftValidationError,
    );
  });

  it("cria o plantão e calcula o período a partir da hora de início", async () => {
    let received;
    const service = createWorkShiftsService({
      async createExclusive(data) {
        received = data;
        return { created: true, shift: { id: "1", profileId: "4", startedTime: "08:00", expectedEndTime: "20:00", durationHours: 12 } };
      },
    });
    const result = await service.start(pastInput({ startedTime: "08:00", startedDate: "2026-08-20" }), "9", "4");
    assert.equal(received.userId, "9");
    assert.equal(received.profileId, "4");
    assert.equal(received.startedAt, "2026-08-20 08:00:00");
    assert.equal(received.durationHours, 12);
    assert.equal(result.period, "Manhã");
  });

  it("mantém o plantão quando o mesmo cuidador tenta iniciar novamente", async () => {
    const service = createWorkShiftsService({
      createExclusive: async () => ({
        created: false,
        shift: { profileId: "4", profileName: "Maurício", startedTime: "08:00", expectedEndTime: "20:00" },
      }),
    });
    const result = await service.start(pastInput(), "9", "4");
    assert.equal(result.alreadyActive, true);
    assert.equal(result.profileName, "Maurício");
  });

  it("impede outro cuidador de iniciar durante um plantão ativo", async () => {
    const service = createWorkShiftsService({
      createExclusive: async () => ({
        created: false,
        shift: { profileId: "3", profileName: "Maurício", startedTime: "08:00", expectedEndTime: "20:00" },
      }),
    });
    await assert.rejects(service.start(pastInput(), "9", "4"), WorkShiftValidationError);
  });

  it("retorna null quando não há plantão ativo", async () => {
    const service = createWorkShiftsService({ findCurrent: async () => null });
    assert.equal(await service.getCurrent("9"), null);
  });

  it("retorna o plantão ativo com o período calculado", async () => {
    const service = createWorkShiftsService({
      findCurrent: async () => ({ profileId: "4", profileName: "Eric", startedTime: "19:00", expectedEndTime: "07:00" }),
    });
    const result = await service.getCurrent("9");
    assert.equal(result.profileName, "Eric");
    assert.equal(result.period, "Noite");
  });

  it("inicia a partir de um plantão programado usando o cuidador atual da escala", async () => {
    let received;
    const service = createWorkShiftsService(
      {
        createExclusive: async (data) => { received = data; return { created: true, shift: { id: "1", profileId: "4", startedTime: "06:07", expectedEndTime: "18:07", durationHours: 12 } }; },
        existsForScheduleShift: async () => false,
      },
      {
        findById: async () => ({
          id: "20", profileId: "4",
          scheduledDate: "2026-08-27", scheduledEndDate: "2026-08-27",
          scheduledStartTime: "06:00", scheduledEndTime: "18:00",
          scheduledStartAt: new Date("2026-08-27T06:00:00"), scheduledEndAt: new Date("2026-08-27T18:00:00"),
        }),
      },
    );
    const result = await service.start({ scheduleShiftId: "20" }, "9", null);
    assert.equal(received.profileId, "4");
    assert.equal(received.durationHours, 12);
    assert.equal(received.scheduleShiftId, "20");
    assert.equal(received.scheduledStartAt, "2026-08-27 06:00:00");
    assert.equal(received.scheduledEndAt, "2026-08-27 18:00:00");
    assert.equal(result.period, "Manhã");
  });

  it("rejeita iniciar duas vezes o mesmo plantão programado", async () => {
    const service = createWorkShiftsService(
      { createExclusive: async () => assert.fail(), existsForScheduleShift: async () => true },
      { findById: async () => ({ id: "20", profileId: "4" }) },
    );
    await assert.rejects(service.start({ scheduleShiftId: "20" }, "9", null), WorkShiftValidationError);
  });

  it("rejeita iniciar um plantão programado que não existe ou não pertence à conta", async () => {
    const service = createWorkShiftsService(
      { createExclusive: async () => assert.fail() },
      { findById: async () => null },
    );
    await assert.rejects(service.start({ scheduleShiftId: "999" }, "9", null), WorkShiftValidationError);
  });

  it("continua funcionando sem scheduleShiftId, exatamente como antes", async () => {
    let received;
    const service = createWorkShiftsService({
      async createExclusive(data) {
        received = data;
        return { created: true, shift: { id: "1", profileId: "4", startedTime: "08:00", expectedEndTime: "20:00", durationHours: 12 } };
      },
    });
    await service.start(pastInput({ startedTime: "08:00", startedDate: "2026-08-20" }), "9", "4");
    assert.equal(received.scheduleShiftId, undefined);
  });
});
