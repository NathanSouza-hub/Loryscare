const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const RoutineNotFoundError = require("../src/errors/routine-not-found-error");
const RoutineValidationError = require("../src/errors/routine-validation-error");
const RoutineCompletionConflictError = require("../src/errors/routine-completion-conflict-error");
const createRoutinesService = require("../src/services/routines-service");

function validRoutine(overrides = {}) {
  return { title: "Caminhada", category: "Atividade física", time: "09:00", notes: "Levar água", startDate: "2026-08-20", patientId: "1", ...overrides };
}

describe("routines service", () => {
  it("normaliza e cadastra uma rotina diária", async () => {
    let received;
    const service = createRoutinesService({
      patientBelongsToUser: async () => true,
      async create(data) { received = data; return "4"; },
    });
    assert.deepEqual(await service.create(validRoutine(), "9"), { id: "4" });
    assert.equal(received.isActive, true);
    assert.equal(received.isFixed, false);
  });

  it("marca a atividade como fixa quando solicitado", async () => {
    let received;
    const service = createRoutinesService({
      patientBelongsToUser: async () => true,
      async create(data) { received = data; return "4"; },
    });
    await service.create(validRoutine({ isFixed: true }), "9");
    assert.equal(received.isFixed, true);
  });

  it("insere a primeira conclusão com o profileId de quem concluiu", async () => {
    let inserted;
    const service = createRoutinesService({
      existsOnDate: async () => true,
      findCompletion: async () => null,
      async insertCompletion(data) { inserted = data; return { id: "1", ...data }; },
    });
    await service.setCompletion("3", { date: "2026-08-18", status: "completed" }, "9", "4");
    assert.equal(inserted.authorProfileId, "4");
    assert.ok(inserted.completedAt instanceof Date);
  });

  it("rejeita cadastro para paciente de outro usuário", async () => {
    const service = createRoutinesService({
      patientBelongsToUser: async () => false,
      create: async () => assert.fail(),
    });
    await assert.rejects(service.create(validRoutine(), "9"), RoutineValidationError);
  });

  it("rejeita horário inválido", async () => {
    const service = createRoutinesService({ create: async () => assert.fail() });
    await assert.rejects(service.create(validRoutine({ time: "25:00" })), RoutineValidationError);
  });

  it("rejeita data inicial inválida", async () => {
    const service = createRoutinesService({ create: async () => assert.fail() });
    await assert.rejects(service.create(validRoutine({ startDate: "20/08/2026" })), RoutineValidationError);
  });

  it("informa quando a rotina não existe", async () => {
    const service = createRoutinesService({ update: async () => false });
    await assert.rejects(service.update("9", validRoutine()), RoutineNotFoundError);
  });

  it("lista atividades de uma data válida", async () => {
    const items = [{ id: "1" }];
    const service = createRoutinesService({ getDaily: async () => items });
    assert.equal(await service.getDaily("2026-08-20", "1"), items);
    await assert.rejects(service.getDaily("20/08/2026", "1"), RoutineValidationError);
  });

  it("registra uma atividade concluída", async () => {
    let inserted;
    const service = createRoutinesService({
      existsOnDate: async () => true,
      findCompletion: async () => null,
      async insertCompletion(data) { inserted = data; return { id: "2", ...data }; },
    });
    await service.setCompletion("1", { date: "2026-08-20", status: "completed" });
    assert.ok(inserted.completedAt instanceof Date);
  });

  it("trata uma segunda chamada do MESMO autor como edição, sem trocar o autor", async () => {
    let updatedId;
    const service = createRoutinesService({
      existsOnDate: async () => true,
      findCompletion: async () => ({
        id: "6", status: "completed", completedAt: new Date("2026-08-20T09:00:00Z"),
        authorProfileId: "4", authorProfileName: "Nathan",
      }),
      async updateCompletion(id, data) { updatedId = id; return { id, ...data, authorProfileId: "4" }; },
    });
    const result = await service.setCompletion(
      "1", { date: "2026-08-20", status: "skipped" }, "9", "4",
    );
    assert.equal(updatedId, "6");
    assert.equal(result.authorProfileId, "4");
  });

  it("preserva o completedAt original quando o MESMO autor edita a atividade", async () => {
    const originalCompletedAt = new Date("2026-08-20T09:00:00Z");
    let updatedData;
    const service = createRoutinesService({
      existsOnDate: async () => true,
      findCompletion: async () => ({
        id: "6", status: "completed", completedAt: originalCompletedAt,
        authorProfileId: "4", authorProfileName: "Nathan",
      }),
      async updateCompletion(id, data) { updatedData = data; return { id, ...data, authorProfileId: "4" }; },
    });
    await service.setCompletion("1", { date: "2026-08-20", status: "completed" }, "9", "4");
    assert.equal(updatedData.completedAt, originalCompletedAt);
  });

  it("preserva o completedAt original quando o MESMO autor muda o status para 'skipped'", async () => {
    const originalCompletedAt = new Date("2026-08-20T09:00:00Z");
    let updatedData;
    const service = createRoutinesService({
      existsOnDate: async () => true,
      findCompletion: async () => ({
        id: "6", status: "completed", completedAt: originalCompletedAt,
        authorProfileId: "4", authorProfileName: "Nathan",
      }),
      async updateCompletion(id, data) { updatedData = data; return { id, ...data, authorProfileId: "4" }; },
    });
    await service.setCompletion("1", { date: "2026-08-20", status: "skipped" }, "9", "4");
    assert.equal(updatedData.status, "skipped");
    assert.equal(updatedData.completedAt, originalCompletedAt);
  });

  it("condição de corrida seguida de reconsulta vazia gera conflito em vez de TypeError", async () => {
    const service = createRoutinesService({
      existsOnDate: async () => true,
      findCompletion: async () => null,
      insertCompletion: async () => null,
    });
    await assert.rejects(
      service.setCompletion("1", { date: "2026-08-20", status: "completed" }, "9", "7"),
      RoutineCompletionConflictError,
    );
  });

  it("rejeita a conclusão de OUTRO autor com RoutineCompletionConflictError", async () => {
    const service = createRoutinesService({
      existsOnDate: async () => true,
      findCompletion: async () => ({
        id: "6", status: "completed", completedAt: new Date("2026-08-20T09:00:00Z"),
        authorProfileId: "4", authorProfileName: "Nathan",
      }),
      updateCompletion: async () => assert.fail("não deveria editar"),
    });
    await assert.rejects(
      service.setCompletion("1", { date: "2026-08-20", status: "completed" }, "9", "7"),
      RoutineCompletionConflictError,
    );
  });

  it("condição de corrida: dois cuidadores concluindo juntos — o segundo recebe conflito", async () => {
    let findCalls = 0;
    const service = createRoutinesService({
      existsOnDate: async () => true,
      async findCompletion() {
        findCalls += 1;
        if (findCalls === 1) return null;
        return {
          id: "6", status: "completed", completedAt: new Date("2026-08-20T09:00:00Z"),
          authorProfileId: "4", authorProfileName: "Nathan",
        };
      },
      insertCompletion: async () => null,
      updateCompletion: async () => assert.fail("não deveria editar"),
    });
    await assert.rejects(
      service.setCompletion("1", { date: "2026-08-20", status: "completed" }, "9", "7"),
      RoutineCompletionConflictError,
    );
  });

  it("rejeita conclusão fora do período da rotina", async () => {
    const service = createRoutinesService({ existsOnDate: async () => false });
    await assert.rejects(service.setCompletion("1", { date: "2026-08-20", status: "skipped" }), RoutineNotFoundError);
  });
});
