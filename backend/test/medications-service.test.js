const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const MedicationNotFoundError = require("../src/errors/medication-not-found-error");
const MedicationValidationError = require("../src/errors/medication-validation-error");
const MedicationAdministrationConflictError = require("../src/errors/medication-administration-conflict-error");
const createMedicationsService = require("../src/services/medications-service");

function validMedication(overrides = {}) {
  return {
    name: "Losartana",
    dosage: "50 mg",
    instructions: "Após a refeição",
    startDate: "2026-08-18",
    endDate: "",
    times: ["20:00", "08:00", "08:00"],
    patientId: "1",
    ...overrides,
  };
}

describe("medications service", () => {
  it("normaliza e cadastra um tratamento recorrente", async () => {
    let received;
    const service = createMedicationsService({
      patientBelongsToUser: async () => true,
      async create(data) { received = data; return "7"; },
    });

    const result = await service.create(validMedication(), "9");

    assert.deepEqual(received.times, ["08:00", "20:00"]);
    assert.equal(received.endDate, null);
    assert.equal(received.isActive, true);
    assert.equal(received.isFixed, false);
    assert.deepEqual(result, { id: "7" });
  });

  it("marca o tratamento como fixo quando solicitado", async () => {
    let received;
    const service = createMedicationsService({
      patientBelongsToUser: async () => true,
      async create(data) { received = data; return "4"; },
    });
    await service.create(validMedication({ isFixed: true }), "9");
    assert.equal(received.isFixed, true);
  });

  it("rejeita cadastro para paciente de outro usuário", async () => {
    const service = createMedicationsService({
      patientBelongsToUser: async () => false,
      create: async () => assert.fail(),
    });
    await assert.rejects(service.create(validMedication(), "9"), MedicationValidationError);
  });

  it("rejeita tratamento sem horário", async () => {
    const service = createMedicationsService({ create: async () => assert.fail() });
    await assert.rejects(service.create(validMedication({ times: [] })), MedicationValidationError);
  });

  it("rejeita data final anterior à inicial", async () => {
    const service = createMedicationsService({ create: async () => assert.fail() });
    await assert.rejects(
      service.create(validMedication({ endDate: "2026-08-17" })),
      MedicationValidationError,
    );
  });

  it("atualiza um tratamento existente", async () => {
    let receivedId;
    const service = createMedicationsService({
      async update(id) { receivedId = id; return true; },
    });
    await service.update("3", { ...validMedication(), isActive: false });
    assert.equal(receivedId, "3");
  });

  it("informa quando o tratamento não existe", async () => {
    const service = createMedicationsService({ update: async () => false });
    await assert.rejects(service.update("99", validMedication()), MedicationNotFoundError);
  });

  it("lista somente a agenda da data válida", async () => {
    const doses = [{ scheduleId: "2" }];
    const service = createMedicationsService({ getDaily: async () => doses });
    assert.equal(await service.getDaily("2026-08-18", "1"), doses);
    await assert.rejects(service.getDaily("18/08/2026", "1"), MedicationValidationError);
  });

  it("insere a primeira conclusão com o profileId de quem administrou", async () => {
    let inserted;
    const service = createMedicationsService({
      scheduleBelongsToMedication: async () => true,
      findAdministration: async () => null,
      async insertAdministration(data) { inserted = data; return { id: "1", ...data }; },
    });
    await service.setAdministration("3", "5", { date: "2026-08-18", status: "taken" }, "9", "4");
    assert.equal(inserted.authorProfileId, "4");
    assert.equal(inserted.scheduleId, "5");
    assert.ok(inserted.administeredAt instanceof Date);
  });

  it("registra uma dose tomada com observações", async () => {
    let inserted;
    const service = createMedicationsService({
      scheduleBelongsToMedication: async () => true,
      findAdministration: async () => null,
      async insertAdministration(data) { inserted = data; return { id: "1", ...data }; },
    });
    await service.setAdministration("3", "5", {
      date: "2026-08-18", status: "taken", notes: "Sem intercorrências",
    });
    assert.equal(inserted.notes, "Sem intercorrências");
  });

  it("rejeita um horário que não pertence ao medicamento", async () => {
    const service = createMedicationsService({ scheduleBelongsToMedication: async () => false });
    await assert.rejects(
      service.setAdministration("3", "5", { date: "2026-08-18", status: "skipped" }),
      MedicationNotFoundError,
    );
  });

  it("trata uma segunda chamada do MESMO autor como edição, sem trocar o autor", async () => {
    let updatedId;
    let updatedData;
    const service = createMedicationsService({
      scheduleBelongsToMedication: async () => true,
      findAdministration: async () => ({
        id: "8", status: "taken", administeredAt: new Date("2026-08-18T08:03:00Z"),
        notes: null, authorProfileId: "4", authorProfileName: "Nathan",
      }),
      async updateAdministration(id, data) { updatedId = id; updatedData = data; return { id, ...data, authorProfileId: "4" }; },
    });
    const result = await service.setAdministration(
      "3", "5", { date: "2026-08-18", status: "skipped" }, "9", "4",
    );
    assert.equal(updatedId, "8");
    assert.equal(updatedData.status, "skipped");
    assert.equal(result.authorProfileId, "4");
  });

  it("rejeita a conclusão de OUTRO autor com MedicationAdministrationConflictError", async () => {
    const service = createMedicationsService({
      scheduleBelongsToMedication: async () => true,
      findAdministration: async () => ({
        id: "8", status: "taken", administeredAt: new Date("2026-08-18T08:03:00Z"),
        notes: null, authorProfileId: "4", authorProfileName: "Nathan",
      }),
      updateAdministration: async () => assert.fail("não deveria editar"),
    });
    await assert.rejects(
      service.setAdministration("3", "5", { date: "2026-08-18", status: "taken" }, "9", "7"),
      MedicationAdministrationConflictError,
    );
  });

  it("registro sem author_profile_id (legado) pode ser editado por qualquer perfil", async () => {
    let updatedId;
    const service = createMedicationsService({
      scheduleBelongsToMedication: async () => true,
      findAdministration: async () => ({
        id: "8", status: "taken", administeredAt: new Date("2026-08-18T08:03:00Z"),
        notes: null, authorProfileId: null, authorProfileName: null,
      }),
      async updateAdministration(id) { updatedId = id; return { id, authorProfileId: null }; },
    });
    await service.setAdministration("3", "5", { date: "2026-08-18", status: "taken" }, "9", "7");
    assert.equal(updatedId, "8");
  });

  it("condição de corrida: dois cuidadores concluindo juntos — o segundo recebe conflito", async () => {
    let findCalls = 0;
    const service = createMedicationsService({
      scheduleBelongsToMedication: async () => true,
      async findAdministration() {
        findCalls += 1;
        if (findCalls === 1) return null;
        return {
          id: "8", status: "taken", administeredAt: new Date("2026-08-18T08:03:00Z"),
          notes: null, authorProfileId: "4", authorProfileName: "Nathan",
        };
      },
      insertAdministration: async () => null,
      updateAdministration: async () => assert.fail("não deveria editar"),
    });
    await assert.rejects(
      service.setAdministration("3", "5", { date: "2026-08-18", status: "taken" }, "9", "7"),
      MedicationAdministrationConflictError,
    );
  });
});
