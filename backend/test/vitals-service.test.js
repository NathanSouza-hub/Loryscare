const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const ValidationError = require("../src/errors/validation-error");
const NotFoundError = require("../src/errors/not-found-error");
const VitalSignOwnershipError = require("../src/errors/vital-sign-ownership-error");
const createVitalsService = require("../src/services/vitals-service");

function validInput(overrides = {}) {
  return {
    date: "2026-08-18",
    time: "17:07",
    shift: "Tarde",
    bloodPressure: "120/80",
    heartRate: "72",
    oxygenSaturation: "98",
    temperature: "36.5",
    bloodGlucose: "95",
    notes: "Após o repouso",
    patientId: "1",
    ...overrides,
  };
}

describe("vitals service", () => {
  it("inclui o profileId de quem fez a medicao", async () => {
    let received;
    const service = createVitalsService({
      patientBelongsToUser: async () => true,
      async create(data) { received = data; return { id: "1", ...data }; },
    });
    await service.create(validInput(), "9", "3");
    assert.equal(received.authorProfileId, "3");
  });

  it("aceita profileId nulo", async () => {
    let received;
    const service = createVitalsService({
      patientBelongsToUser: async () => true,
      async create(data) { received = data; return { id: "1", ...data }; },
    });
    await service.create(validInput(), "9", null);
    assert.equal(received.authorProfileId, null);
  });

  it("valida, transforma e envia os dados ao repositório", async () => {
    let receivedData;
    const repository = {
      patientBelongsToUser: async () => true,
      async create(data) {
        receivedData = data;
        return { id: "1", ...data };
      },
    };
    const service = createVitalsService(repository);

    const result = await service.create(validInput());

    assert.deepEqual(receivedData, {
      measuredAt: "2026-08-18T17:07:00",
      shift: "Tarde",
      systolicPressure: 120,
      diastolicPressure: 80,
      heartRate: 72,
      oxygenSaturation: 98,
      temperature: 36.5,
      bloodGlucose: 95,
      notes: "Após o repouso",
      patientId: "1",
      authorProfileId: null,
    });
    assert.equal(result.id, "1");
  });

  it("converte glicemia e observações vazias para null", async () => {
    let receivedData;
    const service = createVitalsService({
      patientBelongsToUser: async () => true,
      async create(data) {
        receivedData = data;
        return data;
      },
    });

    await service.create(validInput({ bloodGlucose: "", notes: "  " }));

    assert.equal(receivedData.bloodGlucose, null);
    assert.equal(receivedData.notes, null);
  });

  it("aceita um registro sem nenhuma medição", async () => {
    let receivedData;
    const service = createVitalsService({
      patientBelongsToUser: async () => true,
      async create(data) {
        receivedData = data;
        return data;
      },
    });

    await service.create(
      validInput({
        bloodPressure: "",
        heartRate: "",
        oxygenSaturation: "",
        temperature: "",
        bloodGlucose: "",
      }),
    );

    assert.equal(receivedData.systolicPressure, null);
    assert.equal(receivedData.diastolicPressure, null);
    assert.equal(receivedData.heartRate, null);
    assert.equal(receivedData.oxygenSaturation, null);
    assert.equal(receivedData.temperature, null);
    assert.equal(receivedData.bloodGlucose, null);
  });

  it("rejeita campos obrigatórios e formatos inválidos", async () => {
    const service = createVitalsService({ create: async () => assert.fail() });

    await assert.rejects(
      service.create(
        validInput({
          date: "2026-02-30",
          time: "25:00",
          shift: "",
          bloodPressure: "120-80",
          heartRate: "0",
          oxygenSaturation: "101",
          temperature: "29",
        }),
      ),
      (error) => {
        assert.ok(error instanceof ValidationError);
        assert.deepEqual(Object.keys(error.details).sort(), [
          "bloodPressure",
          "date",
          "heartRate",
          "oxygenSaturation",
          "shift",
          "temperature",
          "time",
        ]);
        return true;
      },
    );
  });

  it("rejeita cadastro para paciente de outro usuário", async () => {
    const service = createVitalsService({
      patientBelongsToUser: async () => false,
      create: async () => assert.fail(),
    });
    await assert.rejects(service.create(validInput()), ValidationError);
  });

  it("lista os registros fornecidos pelo repositório", async () => {
    const records = [{ id: "2" }, { id: "1" }];
    const service = createVitalsService({ getAll: async () => records });

    assert.equal(await service.getAll("1"), records);
  });

  it("atualiza um registro válido", async () => {
    let receivedId;
    const service = createVitalsService({
      findById: async () => ({ id: "12", authorProfileId: "3" }),
      async update(id, data) {
        receivedId = id;
        return { id, ...data };
      },
    });

    const result = await service.update("12", validInput(), "9", "3");

    assert.equal(receivedId, "12");
    assert.equal(result.systolicPressure, 120);
  });

  it("retorna erro quando o registro atualizado não existe", async () => {
    const service = createVitalsService({
      findById: async () => null,
      update: async () => null
    });

    await assert.rejects(service.update("999", validInput(), "9", "3"), NotFoundError);
  });

  it("permite que o autor original edite seu próprio registro", async () => {
    let updatedId;
    const service = createVitalsService({
      findById: async () => ({ id: "5", authorProfileId: "4" }),
      async update(id) { updatedId = id; return { id }; },
    });
    await service.update("5", {
      date: "2026-08-20", time: "08:00", shift: "Manhã", bloodPressure: "120/80",
    }, "9", "4");
    assert.equal(updatedId, "5");
  });

  it("rejeita edição de outro perfil com VitalSignOwnershipError", async () => {
    const service = createVitalsService({
      findById: async () => ({ id: "5", authorProfileId: "4" }),
      update: async () => assert.fail("não deveria editar"),
    });
    await assert.rejects(
      service.update("5", {
        date: "2026-08-20", time: "08:00", shift: "Manhã", bloodPressure: "120/80",
      }, "9", "7"),
      VitalSignOwnershipError,
    );
  });

  it("registro sem author_profile_id (legado) pode ser editado por qualquer perfil", async () => {
    let updatedId;
    const service = createVitalsService({
      findById: async () => ({ id: "5", authorProfileId: null }),
      async update(id) { updatedId = id; return { id }; },
    });
    await service.update("5", {
      date: "2026-08-20", time: "08:00", shift: "Manhã", bloodPressure: "120/80",
    }, "9", "7");
    assert.equal(updatedId, "5");
  });

  it("informa quando o registro não existe", async () => {
    const service = createVitalsService({ findById: async () => null });
    await assert.rejects(
      service.update("99", {
        date: "2026-08-20", time: "08:00", shift: "Manhã", bloodPressure: "120/80",
      }, "9", "4"),
      NotFoundError,
    );
  });

  it("remove um registro existente", async () => {
    let receivedId;
    const service = createVitalsService({
      async remove(id) {
        receivedId = id;
        return true;
      },
    });

    await service.remove("12");

    assert.equal(receivedId, "12");
  });

  it("rejeita identificador inválido sem consultar o repositório", async () => {
    const service = createVitalsService({ remove: async () => assert.fail() });

    await assert.rejects(service.remove("abc"), ValidationError);
  });

  it("retorna erro quando o registro removido não existe", async () => {
    const service = createVitalsService({ remove: async () => false });

    await assert.rejects(service.remove("999"), NotFoundError);
  });
});
