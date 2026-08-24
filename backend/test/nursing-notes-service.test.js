const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const NursingNoteNotFoundError = require("../src/errors/nursing-note-not-found-error");
const NursingNoteValidationError = require("../src/errors/nursing-note-validation-error");
const NursingNoteOwnershipError = require("../src/errors/nursing-note-ownership-error");
const NursingNoteShiftConflictError = require("../src/errors/nursing-note-shift-conflict-error");
const createNursingNotesService = require("../src/services/nursing-notes-service");

function validNote(overrides = {}) {
  return {
    noteDate: "2026-08-20", noteTime: "08:00", shift: "Manhã",
    authorName: "Maria Souza", noteText: "Paciente dormiu bem, sem queixas.", patientId: "1",
    ...overrides,
  };
}

describe("nursing notes service", () => {
  it("normaliza e cadastra uma anotação de enfermagem", async () => {
    let received;
    const service = createNursingNotesService({
      patientBelongsToUser: async () => true,
      async create(data) { received = data; return "4"; },
    });
    assert.deepEqual(await service.create(validNote(), "9"), { id: "4" });
    assert.equal(received.isHighlighted, false);
  });

  it("marca a anotação como grifada quando solicitado", async () => {
    let received;
    const service = createNursingNotesService({
      patientBelongsToUser: async () => true,
      async create(data) { received = data; return "4"; },
    });
    await service.create(validNote({ isHighlighted: true }), "9");
    assert.equal(received.isHighlighted, true);
  });

  it("rejeita cadastro para paciente de outro usuário", async () => {
    const service = createNursingNotesService({
      patientBelongsToUser: async () => false,
      create: async () => assert.fail(),
    });
    await assert.rejects(service.create(validNote(), "9"), NursingNoteValidationError);
  });

  it("rejeita turno inválido", async () => {
    const service = createNursingNotesService({ create: async () => assert.fail() });
    await assert.rejects(service.create(validNote({ shift: "Vespertino" })), NursingNoteValidationError);
  });

  it("rejeita texto vazio", async () => {
    const service = createNursingNotesService({ create: async () => assert.fail() });
    await assert.rejects(service.create(validNote({ noteText: "" })), NursingNoteValidationError);
  });

  it("grava o profileId de quem fez a anotacao", async () => {
    let received;
    const service = createNursingNotesService({
      patientBelongsToUser: async () => true,
      async create(data) { received = data; return "7"; },
    });
    await service.create(validNote(), "9", "4");
    assert.equal(received.authorProfileId, "4");
  });

  it("informa quando a anotação não existe ao atualizar", async () => {
    const service = createNursingNotesService({
      findById: async () => ({ id: "9", authorProfileId: null }),
      update: async () => false,
    });
    await assert.rejects(service.update("9", validNote(), "1"), NursingNoteNotFoundError);
  });

  it("informa quando a anotação não existe ao remover", async () => {
    const service = createNursingNotesService({ remove: async () => false });
    await assert.rejects(service.remove("9"), NursingNoteNotFoundError);
  });

  it("lista anotações filtrando por data e turno válidos", async () => {
    const items = [{ id: "1" }];
    let receivedFilters;
    const service = createNursingNotesService({
      async getAll(patientId, userId, filters) { receivedFilters = filters; return items; },
    });
    assert.equal(await service.getAll("1", "9", { date: "2026-08-20", shift: "Manhã" }), items);
    assert.deepEqual(receivedFilters, { date: "2026-08-20", shift: "Manhã" });
  });

  it("rejeita filtro de turno inválido", async () => {
    const service = createNursingNotesService({ getAll: async () => assert.fail() });
    await assert.rejects(service.getAll("1", "9", { shift: "Inválido" }), NursingNoteValidationError);
  });

  it("permite que o autor original edite sua própria anotação", async () => {
    let updatedId;
    const service = createNursingNotesService({
      findById: async () => ({ id: "5", authorProfileId: "4" }),
      async update(id) { updatedId = id; return true; },
    });
    await service.update("5", {
      noteDate: "2026-08-20", noteTime: "22:00", shift: "Noite", noteText: "Texto",
    }, "9", "4");
    assert.equal(updatedId, "5");
  });

  it("rejeita edição de outro perfil com NursingNoteOwnershipError", async () => {
    const service = createNursingNotesService({
      findById: async () => ({ id: "5", authorProfileId: "4" }),
      update: async () => assert.fail("não deveria editar"),
    });
    await assert.rejects(
      service.update("5", {
        noteDate: "2026-08-20", noteTime: "22:00", shift: "Noite", noteText: "Texto",
      }, "9", "7"),
      NursingNoteOwnershipError,
    );
  });

  it("anotação sem author_profile_id (legado) pode ser editada por qualquer perfil", async () => {
    let updatedId;
    const service = createNursingNotesService({
      findById: async () => ({ id: "5", authorProfileId: null }),
      async update(id) { updatedId = id; return true; },
    });
    await service.update("5", {
      noteDate: "2026-08-20", noteTime: "22:00", shift: "Noite", noteText: "Texto",
    }, "9", "7");
    assert.equal(updatedId, "5");
  });

  it("informa quando a anotação não existe", async () => {
    const service = createNursingNotesService({ findById: async () => null });
    await assert.rejects(
      service.update("99", {
        noteDate: "2026-08-20", noteTime: "22:00", shift: "Noite", noteText: "Texto",
      }, "9", "4"),
      NursingNoteNotFoundError,
    );
  });

  it("permite cadastro quando nenhum plantão cobre o horário", async () => {
    let received;
    const service = createNursingNotesService(
      { patientBelongsToUser: async () => true, async create(data) { received = data; return "4"; } },
      { findCovering: async () => null },
    );
    await service.create(validNote(), "9", "4");
    assert.equal(received.authorProfileId, "4");
  });

  it("permite cadastro quando o plantão que cobre o horário é do próprio perfil", async () => {
    const service = createNursingNotesService(
      { patientBelongsToUser: async () => true, create: async () => "4" },
      { findCovering: async () => ({ profileId: "4", profileName: "Eric", startedTime: "07:00", endTime: "19:00" }) },
    );
    await service.create(validNote(), "9", "4");
  });

  it("rejeita cadastro quando o horário pertence ao plantão de outro cuidador", async () => {
    const service = createNursingNotesService(
      { patientBelongsToUser: async () => true, create: async () => assert.fail() },
      { findCovering: async () => ({ profileId: "7", profileName: "Eric", startedTime: "07:00", endTime: "19:00" }) },
    );
    await assert.rejects(service.create(validNote(), "9", "4"), NursingNoteShiftConflictError);
  });

  it("não checa plantão quando não há perfil selecionado", async () => {
    let checked = false;
    const service = createNursingNotesService(
      { patientBelongsToUser: async () => true, create: async () => "4" },
      { findCovering: async () => { checked = true; return { profileId: "7", profileName: "Eric", startedTime: "07:00", endTime: "19:00" }; } },
    );
    await service.create(validNote(), "9", null);
    assert.equal(checked, false);
  });

  it("rejeita edição quando a nova data/hora cai no plantão de outro cuidador", async () => {
    const service = createNursingNotesService(
      { findById: async () => ({ id: "5", authorProfileId: "4" }), update: async () => assert.fail() },
      { findCovering: async () => ({ profileId: "7", profileName: "Eric", startedTime: "07:00", endTime: "19:00" }) },
    );
    await assert.rejects(
      service.update("5", {
        noteDate: "2026-08-20", noteTime: "08:00", shift: "Manhã", noteText: "Texto",
      }, "9", "4"),
      NursingNoteShiftConflictError,
    );
  });
});
