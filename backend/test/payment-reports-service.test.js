const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const PaymentReportValidationError = require("../src/errors/payment-report-validation-error");
const PaymentReportNotFoundError = require("../src/errors/payment-report-not-found-error");
const createPaymentReportsService = require("../src/services/payment-reports-service");

function fakeCaregiverProfiles(validIds = ["1", "2"]) {
  return { belongsToUser: async (id) => validIds.includes(String(id)) };
}

function shift(overrides = {}) {
  return {
    scheduleShiftId: "100",
    profileId: "1",
    startedAt: "2026-10-16 07:00:00",
    endedAt: "2026-10-16 19:00:00",
    durationMinutes: 720,
    monthDurationHours: 12,
    rateCents: 15000,
    ...overrides,
  };
}

function fakeRepository(overrides = {}) {
  return {
    listShiftsForPeriod: async () => [],
    create: async () => "50",
    findById: async () => ({ id: "50", cycleDay: 5, startDate: "2026-10-16", endDate: "2026-10-31" }),
    listItems: async () => [],
    findOverlapping: async () => [],
    replaceShiftItems: async () => {},
    findItem: async () => null,
    insertItem: async () => "70",
    updateItem: async () => {},
    deleteItem: async () => true,
    remove: async () => true,
    ...overrides,
  };
}

const VALID_INPUT = { cycleDay: 5, startDate: "2026-10-16", endDate: "2026-10-31" };

describe("payment reports service", () => {
  describe("create", () => {
    it("rejeita ciclo diferente de 5 ou 20", async () => {
      const service = createPaymentReportsService(fakeRepository(), fakeCaregiverProfiles());
      await assert.rejects(service.create({ ...VALID_INPUT, cycleDay: 10 }, "9", "1"), PaymentReportValidationError);
    });

    it("rejeita data inválida", async () => {
      const service = createPaymentReportsService(fakeRepository(), fakeCaregiverProfiles());
      await assert.rejects(service.create({ ...VALID_INPUT, startDate: "2026-02-30" }, "9", "1"), PaymentReportValidationError);
    });

    it("rejeita data final antes da inicial", async () => {
      const service = createPaymentReportsService(fakeRepository(), fakeCaregiverProfiles());
      await assert.rejects(
        service.create({ ...VALID_INPUT, startDate: "2026-10-31", endDate: "2026-10-16" }, "9", "1"),
        PaymentReportValidationError,
      );
    });

    it("rejeita período maior que 62 dias", async () => {
      const service = createPaymentReportsService(fakeRepository(), fakeCaregiverProfiles());
      await assert.rejects(
        service.create({ ...VALID_INPUT, startDate: "2026-01-01", endDate: "2026-04-01" }, "9", "1"),
        PaymentReportValidationError,
      );
    });

    it("copia os plantões do período com o valor do mês de cada plantão", async () => {
      let received;
      const repository = fakeRepository({
        listShiftsForPeriod: async () => [
          shift({ scheduleShiftId: "100", rateCents: 15000 }),
          shift({ scheduleShiftId: "200", startedAt: "2026-11-01 07:00:00", endedAt: "2026-11-01 19:00:00", rateCents: 18000 }),
        ],
        create: async (data) => { received = data; return "50"; },
      });
      const service = createPaymentReportsService(repository, fakeCaregiverProfiles());
      const result = await service.create(VALID_INPUT, "9", "1");
      assert.equal(result.id, "50");
      assert.equal(received.userId, "9");
      assert.equal(received.createdByProfileId, "1");
      assert.equal(received.cycleDay, 5);
      assert.deepEqual(received.items.map((item) => item.amountCents), [15000, 18000]);
      assert.equal(received.items[0].kind, "shift");
      assert.equal(received.items[0].scheduleShiftId, "100");
    });

    it("plantão dividido recebe valor proporcional às horas", async () => {
      let received;
      const repository = fakeRepository({
        listShiftsForPeriod: async () => [shift({ durationMinutes: 720, monthDurationHours: 24, rateCents: 30000 })],
        create: async (data) => { received = data; return "50"; },
      });
      const service = createPaymentReportsService(repository, fakeCaregiverProfiles());
      await service.create(VALID_INPUT, "9", "1");
      assert.equal(received.items[0].amountCents, 15000);
    });

    it("mês sem valor definido gera linha sem valor, sem inventar", async () => {
      let received;
      const repository = fakeRepository({
        listShiftsForPeriod: async () => [shift({ rateCents: null })],
        create: async (data) => { received = data; return "50"; },
      });
      const service = createPaymentReportsService(repository, fakeCaregiverProfiles());
      await service.create(VALID_INPUT, "9", "1");
      assert.equal(received.items[0].amountCents, null);
    });

    it("busca os plantões pelo período informado", async () => {
      let args;
      const repository = fakeRepository({ listShiftsForPeriod: async (...received) => { args = received; return []; } });
      const service = createPaymentReportsService(repository, fakeCaregiverProfiles());
      await service.create(VALID_INPUT, "9", "1");
      assert.deepEqual(args, ["9", "2026-10-16", "2026-10-31"]);
    });
  });

  describe("get", () => {
    it("lança não encontrado para relatório de outra conta", async () => {
      const service = createPaymentReportsService(fakeRepository({ findById: async () => null }), fakeCaregiverProfiles());
      await assert.rejects(service.get("50", "9"), PaymentReportNotFoundError);
    });

    it("retorna linhas, total e avisos de valores ausentes e datas repetidas", async () => {
      const repository = fakeRepository({
        listItems: async () => [
          { id: "1", kind: "shift", amountCents: 15000 },
          { id: "2", kind: "shift", amountCents: null },
          { id: "3", kind: "adjustment", amountCents: -5000 },
        ],
        findOverlapping: async () => [{ id: "40", cycleDay: 20, startDate: "2026-10-01", endDate: "2026-10-20" }],
      });
      const service = createPaymentReportsService(repository, fakeCaregiverProfiles());
      const report = await service.get("50", "9");
      assert.equal(report.items.length, 3);
      assert.equal(report.totalCents, 10000);
      assert.equal(report.warnings.missingAmountCount, 1);
      assert.equal(report.warnings.overlappingReports.length, 1);
    });
  });

  describe("recalculate", () => {
    it("substitui as linhas de plantão pelos dados atuais da escala", async () => {
      let replaced;
      const repository = fakeRepository({
        listShiftsForPeriod: async () => [shift({ profileId: "2", rateCents: 20000 })],
        replaceShiftItems: async (reportId, items) => { replaced = { reportId, items }; },
      });
      const service = createPaymentReportsService(repository, fakeCaregiverProfiles());
      await service.recalculate("50", "9");
      assert.equal(replaced.reportId, "50");
      assert.equal(replaced.items.length, 1);
      assert.equal(replaced.items[0].profileId, "2");
      assert.equal(replaced.items[0].amountCents, 20000);
    });

    it("lança não encontrado para relatório de outra conta", async () => {
      const service = createPaymentReportsService(fakeRepository({ findById: async () => null }), fakeCaregiverProfiles());
      await assert.rejects(service.recalculate("50", "9"), PaymentReportNotFoundError);
    });
  });

  describe("addItem", () => {
    it("adiciona plantão manual que atravessa a meia-noite", async () => {
      let inserted;
      const repository = fakeRepository({ insertItem: async (reportId, item) => { inserted = item; return "70"; } });
      const service = createPaymentReportsService(repository, fakeCaregiverProfiles());
      await service.addItem("50", {
        kind: "shift", profileId: "1", date: "2026-10-20", startTime: "19:00", endTime: "07:00", amount: "150,00",
      }, "9");
      assert.equal(inserted.startedAt, "2026-10-20 19:00:00");
      assert.equal(inserted.endedAt, "2026-10-21 07:00:00");
      assert.equal(inserted.amountCents, 15000);
      assert.equal(inserted.scheduleShiftId, null);
    });

    it("plantão manual de 24h termina no dia seguinte", async () => {
      let inserted;
      const repository = fakeRepository({ insertItem: async (reportId, item) => { inserted = item; return "70"; } });
      const service = createPaymentReportsService(repository, fakeCaregiverProfiles());
      await service.addItem("50", {
        kind: "shift", profileId: "1", date: "2026-10-31", startTime: "07:00", endTime: "07:00", amount: "300",
      }, "9");
      assert.equal(inserted.endedAt, "2026-11-01 07:00:00");
    });

    it("desconto é gravado como valor negativo", async () => {
      let inserted;
      const repository = fakeRepository({ insertItem: async (reportId, item) => { inserted = item; return "70"; } });
      const service = createPaymentReportsService(repository, fakeCaregiverProfiles());
      await service.addItem("50", {
        kind: "adjustment", direction: "discount", profileId: "1", amount: "100", description: "Adiantamento",
      }, "9");
      assert.equal(inserted.kind, "adjustment");
      assert.equal(inserted.amountCents, -10000);
      assert.equal(inserted.description, "Adiantamento");
    });

    it("rejeita desconto/acréscimo sem descrição", async () => {
      const service = createPaymentReportsService(fakeRepository(), fakeCaregiverProfiles());
      await assert.rejects(
        service.addItem("50", { kind: "adjustment", direction: "bonus", profileId: "1", amount: "100", description: " " }, "9"),
        PaymentReportValidationError,
      );
    });

    it("rejeita cuidador de outra conta", async () => {
      const service = createPaymentReportsService(fakeRepository(), fakeCaregiverProfiles(["1"]));
      await assert.rejects(
        service.addItem("50", { kind: "adjustment", direction: "bonus", profileId: "99", amount: "10", description: "x" }, "9"),
        PaymentReportValidationError,
      );
    });

    it("rejeita valor inválido", async () => {
      const service = createPaymentReportsService(fakeRepository(), fakeCaregiverProfiles());
      await assert.rejects(
        service.addItem("50", {
          kind: "shift", profileId: "1", date: "2026-10-20", startTime: "07:00", endTime: "19:00", amount: "abc",
        }, "9"),
        PaymentReportValidationError,
      );
    });
  });

  describe("updateItem", () => {
    it("altera valor e descrição de um plantão", async () => {
      let updated;
      const repository = fakeRepository({
        findItem: async () => ({ id: "70", kind: "shift", amountCents: 15000 }),
        updateItem: async (reportId, itemId, data) => { updated = data; },
      });
      const service = createPaymentReportsService(repository, fakeCaregiverProfiles());
      await service.updateItem("50", "70", { amount: "200", description: "Feriado" }, "9");
      assert.deepEqual(updated, { amountCents: 20000, description: "Feriado" });
    });

    it("mantém o sinal negativo de um desconto", async () => {
      let updated;
      const repository = fakeRepository({
        findItem: async () => ({ id: "70", kind: "adjustment", amountCents: -10000 }),
        updateItem: async (reportId, itemId, data) => { updated = data; },
      });
      const service = createPaymentReportsService(repository, fakeCaregiverProfiles());
      await service.updateItem("50", "70", { amount: "150", description: "Adiantamento" }, "9");
      assert.equal(updated.amountCents, -15000);
    });

    it("lança não encontrado para linha inexistente", async () => {
      const service = createPaymentReportsService(fakeRepository(), fakeCaregiverProfiles());
      await assert.rejects(service.updateItem("50", "70", { amount: "10" }, "9"), PaymentReportNotFoundError);
    });
  });

  describe("removeItem", () => {
    it("lança não encontrado quando a linha não existe", async () => {
      const service = createPaymentReportsService(fakeRepository({ deleteItem: async () => false }), fakeCaregiverProfiles());
      await assert.rejects(service.removeItem("50", "70", "9"), PaymentReportNotFoundError);
    });
  });
});
