const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const ScheduleMonthValidationError = require("../src/errors/schedule-month-validation-error");
const ScheduleMonthNotFoundError = require("../src/errors/schedule-month-not-found-error");
const createScheduleMonthsService = require("../src/services/schedule-months-service");

function baseInput(overrides = {}) {
  return {
    year: 2026,
    month: 9,
    durationHours: 24,
    firstStartTime: "07:00",
    caregiverIds: ["1", "2", "3"],
    ...overrides,
  };
}

function fakeCaregiverProfiles(validIds = ["1", "2", "3"]) {
  return { belongsToUser: async (id) => validIds.includes(String(id)) };
}

describe("schedule months service", () => {
  it("rejeita mês inválido", async () => {
    const service = createScheduleMonthsService({}, fakeCaregiverProfiles());
    await assert.rejects(service.create(baseInput({ month: 13 }), "9"), ScheduleMonthValidationError);
  });

  it("rejeita duração diferente de 12 ou 24", async () => {
    const service = createScheduleMonthsService({}, fakeCaregiverProfiles());
    await assert.rejects(service.create(baseInput({ durationHours: 8 }), "9"), ScheduleMonthValidationError);
  });

  it("rejeita 12h sem o segundo horário", async () => {
    const service = createScheduleMonthsService({}, fakeCaregiverProfiles());
    await assert.rejects(
      service.create(baseInput({ durationHours: 12, firstStartTime: "06:00" }), "9"),
      ScheduleMonthValidationError,
    );
  });

  it("rejeita quando os dois períodos não têm 12 horas de diferença", async () => {
    const service = createScheduleMonthsService({}, fakeCaregiverProfiles());
    await assert.rejects(
      service.create(baseInput({ durationHours: 12, firstStartTime: "06:00", secondStartTime: "20:00" }), "9"),
      ScheduleMonthValidationError,
    );
  });

  it("rejeita sem cuidadores selecionados", async () => {
    const service = createScheduleMonthsService({}, fakeCaregiverProfiles());
    await assert.rejects(service.create(baseInput({ caregiverIds: [] }), "9"), ScheduleMonthValidationError);
  });

  it("rejeita cuidador duplicado na ordem", async () => {
    const service = createScheduleMonthsService({}, fakeCaregiverProfiles());
    await assert.rejects(service.create(baseInput({ caregiverIds: ["1", "1"] }), "9"), ScheduleMonthValidationError);
  });

  it("rejeita cuidador que não pertence à conta", async () => {
    const service = createScheduleMonthsService({}, fakeCaregiverProfiles(["1"]));
    await assert.rejects(service.create(baseInput({ caregiverIds: ["1", "99"] }), "9"), ScheduleMonthValidationError);
  });

  it("rejeita gerar quando já existe escala para o mês", async () => {
    const repository = { findByYearMonth: async () => ({ id: "5" }) };
    const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
    await assert.rejects(service.create(baseInput(), "9"), ScheduleMonthValidationError);
  });

  it("gera escala de 24h com revezamento contínuo e cruzando o fim do mês", async () => {
    let received;
    const repository = {
      findByYearMonth: async () => null,
      create: async (data) => { received = data; return "10"; },
    };
    const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
    await service.create(baseInput({ year: 2026, month: 9, caregiverIds: ["1", "2"] }), "9");
    assert.equal(received.slots.length, 30);
    assert.equal(received.slots[0].scheduledStartAt, "2026-09-01 07:00:00");
    assert.equal(received.slots[0].scheduledEndAt, "2026-09-02 07:00:00");
    assert.equal(received.slots[0].profileId, "1");
    assert.equal(received.slots[1].profileId, "2");
    assert.equal(received.slots[2].profileId, "1");
    assert.equal(received.slots[29].scheduledStartAt, "2026-09-30 07:00:00");
    assert.equal(received.slots[29].scheduledEndAt, "2026-10-01 07:00:00");
  });

  it("gera escala de 12h com dois períodos por dia sem reiniciar o revezamento a cada dia", async () => {
    let received;
    const repository = {
      findByYearMonth: async () => null,
      create: async (data) => { received = data; return "11"; },
    };
    const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
    await service.create(baseInput({
      year: 2026, month: 9, durationHours: 12, firstStartTime: "06:00", secondStartTime: "18:00",
      caregiverIds: ["1", "2", "3"],
    }), "9");
    assert.equal(received.slots.length, 60);
    assert.deepEqual(received.slots.slice(0, 4).map((slot) => slot.profileId), ["1", "2", "3", "1"]);
    assert.equal(received.slots[0].scheduledStartAt, "2026-09-01 06:00:00");
    assert.equal(received.slots[0].scheduledEndAt, "2026-09-01 18:00:00");
    assert.equal(received.slots[1].scheduledStartAt, "2026-09-01 18:00:00");
    assert.equal(received.slots[1].scheduledEndAt, "2026-09-02 06:00:00");
  });

  it("retorna null quando não existe escala para o mês", async () => {
    const service = createScheduleMonthsService({ findByYearMonth: async () => null }, fakeCaregiverProfiles());
    assert.equal(await service.getByYearMonth(2026, 9, "9"), null);
  });

  it("retorna a escala com os cuidadores quando existe", async () => {
    const repository = {
      findByYearMonth: async () => ({ id: "10", year: 2026, month: 9 }),
      getCaregivers: async () => [{ profileId: "1", position: 1, name: "Maurício" }],
    };
    const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
    const result = await service.getByYearMonth(2026, 9, "9");
    assert.equal(result.caregivers[0].name, "Maurício");
  });

  it("rejeita excluir escala de outra conta", async () => {
    const repository = { belongsToUser: async () => false };
    const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
    await assert.rejects(service.remove("10", "9"), ScheduleMonthNotFoundError);
  });

  it("bloqueia exclusão quando algum plantão do mês já foi iniciado", async () => {
    const repository = { belongsToUser: async () => true, hasStartedShift: async () => true };
    const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
    await assert.rejects(service.remove("10", "9"), ScheduleMonthValidationError);
  });

  it("exclui a escala quando nenhum plantão foi iniciado", async () => {
    let removed = false;
    const repository = {
      belongsToUser: async () => true,
      hasStartedShift: async () => false,
      remove: async () => { removed = true; return true; },
    };
    const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
    await service.remove("10", "9");
    assert.equal(removed, true);
  });

  describe("valor do plantão (único para todos)", () => {
    it("salva o valor informado ao gerar a escala, em centavos", async () => {
      let received;
      const repository = {
        findByYearMonth: async () => null,
        create: async (data) => { received = data; return "10"; },
      };
      const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
      await service.create(baseInput({ shiftRate: "150,50" }), "9");
      assert.equal(received.shiftRateCents, 15050);
    });

    it("gera a escala sem valor quando nenhum é informado", async () => {
      let received;
      const repository = {
        findByYearMonth: async () => null,
        create: async (data) => { received = data; return "10"; },
      };
      const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
      await service.create(baseInput({ shiftRate: "" }), "9");
      assert.equal(received.shiftRateCents, null);
    });

    it("rejeita valor negativo", async () => {
      const service = createScheduleMonthsService({}, fakeCaregiverProfiles());
      await assert.rejects(service.create(baseInput({ shiftRate: -10 }), "9"), ScheduleMonthValidationError);
    });

    it("rejeita valor que não é número", async () => {
      const repository = { belongsToUser: async () => true };
      const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
      await assert.rejects(service.setShiftRate("10", { shiftRate: "abc" }, "9"), ScheduleMonthValidationError);
    });

    it("rejeita definir valor vazio", async () => {
      const repository = { belongsToUser: async () => true };
      const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
      await assert.rejects(service.setShiftRate("10", { shiftRate: "" }, "9"), ScheduleMonthValidationError);
    });

    it("rejeita definir valor em escala de outra conta", async () => {
      const repository = { belongsToUser: async () => false };
      const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
      await assert.rejects(service.setShiftRate("10", { shiftRate: 100 }, "9"), ScheduleMonthNotFoundError);
    });

    it("grava o valor do plantão do mês", async () => {
      let saved;
      const repository = {
        belongsToUser: async () => true,
        updateShiftRate: async (id, shiftRateCents) => { saved = { id, shiftRateCents }; },
      };
      const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
      await service.setShiftRate("10", { shiftRate: 180 }, "9");
      assert.deepEqual(saved, { id: "10", shiftRateCents: 18000 });
    });
  });

  describe("quanto o perfil vai receber", () => {
    it("exige um perfil selecionado", async () => {
      const service = createScheduleMonthsService({ belongsToUser: async () => true }, fakeCaregiverProfiles());
      await assert.rejects(service.getEarnings("10", "9", null), ScheduleMonthValidationError);
    });

    it("rejeita escala de outra conta", async () => {
      const service = createScheduleMonthsService({ belongsToUser: async () => false }, fakeCaregiverProfiles());
      await assert.rejects(service.getEarnings("10", "9", "1"), ScheduleMonthNotFoundError);
    });

    it("multiplica o valor pelo número de plantões do perfil atual", async () => {
      let asked;
      const repository = {
        belongsToUser: async () => true,
        getEarningsData: async (id, profileId) => {
          asked = { id, profileId };
          return { durationHours: 24, rateCents: 20000, totalMinutes: 15 * 24 * 60 };
        },
      };
      const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
      const result = await service.getEarnings("10", "9", "2");
      assert.deepEqual(asked, { id: "10", profileId: "2" });
      assert.deepEqual(result, { profileId: "2", shiftCount: 15, rateCents: 20000, totalCents: 300000 });
    });

    it("conta plantão dividido (12h numa escala de 24h) como meio plantão", async () => {
      const repository = {
        belongsToUser: async () => true,
        getEarningsData: async () => ({ durationHours: 24, rateCents: 20000, totalMinutes: (2 * 24 + 12) * 60 }),
      };
      const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
      const result = await service.getEarnings("10", "9", "1");
      assert.equal(result.shiftCount, 2.5);
      assert.equal(result.totalCents, 50000);
    });

    it("retorna total nulo quando o valor ainda não foi definido", async () => {
      const repository = {
        belongsToUser: async () => true,
        getEarningsData: async () => ({ durationHours: 12, rateCents: null, totalMinutes: 10 * 12 * 60 }),
      };
      const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
      const result = await service.getEarnings("10", "9", "1");
      assert.deepEqual(result, { profileId: "1", shiftCount: 10, rateCents: null, totalCents: null });
    });
  });
});
