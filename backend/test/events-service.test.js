const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const EventNotFoundError = require("../src/errors/event-not-found-error");
const EventValidationError = require("../src/errors/event-validation-error");
const createEventsService = require("../src/services/events-service");

function validEvent(overrides = {}) {
  return { title: "Consulta cardiologista", category: "Consulta médica", eventDate: "2026-08-25", eventTime: "09:00", notes: "Levar exames", patientId: "1", ...overrides };
}

describe("events service", () => {
  it("normaliza e cadastra um evento", async () => {
    let received;
    const service = createEventsService({
      patientBelongsToUser: async () => true,
      async create(data) { received = data; return "4"; },
    });
    assert.deepEqual(await service.create(validEvent(), "9"), { id: "4" });
    assert.equal(received.title, "Consulta cardiologista");
    assert.equal(received.category, "Consulta médica");
  });

  it("inclui o profileId de quem criou o evento", async () => {
    let received;
    const service = createEventsService({
      patientBelongsToUser: async () => true,
      async create(data) { received = data; return { id: "1" }; },
    });
    await service.create(validEvent(), "9", "4");
    assert.equal(received.authorProfileId, "4");
  });

  it("cadastra um compromisso recorrente nos dias selecionados", async () => {
    let received;
    const service = createEventsService({
      patientBelongsToUser: async () => true,
      async createMany(items) { received = items; return ["10", "11", "12"]; },
    });
    const result = await service.create(validEvent({
      eventDate: "2026-08-24",
      repeatWeekly: true,
      repeatWeekdays: [1, 3, 5],
      repeatUntil: "2026-08-30",
    }), "9", "4");
    assert.deepEqual(received.map((item) => item.eventDate), ["2026-08-24", "2026-08-26", "2026-08-28"]);
    assert.deepEqual(result, { ids: ["10", "11", "12"], count: 3 });
  });

  it("rejeita recorrência sem dias da semana", async () => {
    const service = createEventsService({ patientBelongsToUser: async () => true });
    await assert.rejects(service.create(validEvent({
      repeatWeekly: true, repeatWeekdays: [], repeatUntil: "2026-09-25",
    }), "9"), EventValidationError);
  });

  it("inclui o profileId de quem marcou o status", async () => {
    let receivedProfileId;
    const service = createEventsService({
      async setStatus(id, status, userId, profileId) { receivedProfileId = profileId; return { id }; },
    });
    await service.setStatus("3", { status: "completed" }, "9", "4");
    assert.equal(receivedProfileId, "4");
  });

  it("rejeita cadastro para paciente de outro usuário", async () => {
    const service = createEventsService({
      patientBelongsToUser: async () => false,
      create: async () => assert.fail(),
    });
    await assert.rejects(service.create(validEvent(), "9"), EventValidationError);
  });

  it("rejeita horário inválido", async () => {
    const service = createEventsService({ create: async () => assert.fail() });
    await assert.rejects(service.create(validEvent({ eventTime: "25:00" })), EventValidationError);
  });

  it("rejeita data inválida", async () => {
    const service = createEventsService({ create: async () => assert.fail() });
    await assert.rejects(service.create(validEvent({ eventDate: "25/08/2026" })), EventValidationError);
  });

  it("informa quando o evento não existe", async () => {
    const service = createEventsService({ update: async () => false });
    await assert.rejects(service.update("9", validEvent()), EventNotFoundError);
  });

  it("lista eventos de uma data válida", async () => {
    const items = [{ id: "1" }];
    const service = createEventsService({ getDaily: async () => items });
    assert.equal(await service.getDaily("2026-08-20", "1"), items);
    await assert.rejects(service.getDaily("20/08/2026", "1"), EventValidationError);
  });

  it("lista eventos próximos dentro do intervalo informado", async () => {
    const items = [{ id: "1" }];
    const service = createEventsService({ getUpcoming: async () => items });
    assert.equal(await service.getUpcoming("1", "9", "3"), items);
    await assert.rejects(service.getUpcoming("1", "9", "-1"), EventValidationError);
  });

  it("registra um evento concluído", async () => {
    const service = createEventsService({
      setStatus: async () => ({ id: "2", status: "completed" }),
    });
    const result = await service.setStatus("1", { status: "completed" }, "9");
    assert.equal(result.status, "completed");
  });

  it("rejeita conclusão de evento inexistente", async () => {
    const service = createEventsService({ setStatus: async () => undefined });
    await assert.rejects(service.setStatus("1", { status: "skipped" }, "9"), EventNotFoundError);
  });
});
