const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const bcrypt = require("bcryptjs");
const CaregiverProfileNotFoundError = require("../src/errors/caregiver-profile-not-found-error");
const CaregiverProfileValidationError = require("../src/errors/caregiver-profile-validation-error");
const createCaregiverProfilesService = require("../src/services/caregiver-profiles-service");

function validProfile(overrides = {}) {
  return { name: "Maria", avatarColor: "#176B87", pin: "1234", ...overrides };
}

describe("caregiver profiles service", () => {
  it("normaliza e cadastra um cuidador com PIN hasheado", async () => {
    let received;
    const service = createCaregiverProfilesService({
      async create(data) { received = data; return { id: "1", ...data }; },
    });
    const result = await service.create(validProfile(), "9");
    assert.equal(received.name, "Maria");
    assert.equal(received.userId, "9");
    assert.notEqual(received.pinHash, "1234");
    assert.equal(await bcrypt.compare("1234", received.pinHash), true);
    assert.equal(result.id, "1");
  });

  it("cadastra um cuidador sem PIN, para ser definido no primeiro acesso", async () => {
    let received;
    const service = createCaregiverProfilesService({
      async create(data) { received = data; return { id: "1", ...data }; },
    });
    await service.create(validProfile({ pin: "" }), "9");
    assert.equal(received.pinHash, null);
  });

  it("rejeita PIN com formato invalido no cadastro", async () => {
    const service = createCaregiverProfilesService({ create: async () => assert.fail() });
    await assert.rejects(
      service.create(validProfile({ pin: "12a4" }), "9"),
      CaregiverProfileValidationError,
    );
    await assert.rejects(
      service.create(validProfile({ pin: "123" }), "9"),
      CaregiverProfileValidationError,
    );
  });

  it("rejeita nome vazio", async () => {
    const service = createCaregiverProfilesService({ create: async () => assert.fail() });
    await assert.rejects(
      service.create(validProfile({ name: "" }), "9"),
      CaregiverProfileValidationError,
    );
  });

  it("rejeita nome maior que 80 caracteres", async () => {
    const service = createCaregiverProfilesService({ create: async () => assert.fail() });
    await assert.rejects(
      service.create(validProfile({ name: "a".repeat(81) }), "9"),
      CaregiverProfileValidationError,
    );
  });

  it("rejeita cor de avatar vazia", async () => {
    const service = createCaregiverProfilesService({ create: async () => assert.fail() });
    await assert.rejects(
      service.create(validProfile({ avatarColor: "" }), "9"),
      CaregiverProfileValidationError,
    );
  });

  it("lista os cuidadores da conta", async () => {
    const profiles = [{ id: "1", name: "Maria" }];
    const service = createCaregiverProfilesService({ getAll: async () => profiles });
    assert.equal(await service.getAll("9"), profiles);
  });

  it("atualiza um cuidador existente sem alterar o PIN quando nao informado", async () => {
    let receivedId;
    let receivedProfile;
    const service = createCaregiverProfilesService({
      async update(id, profile) { receivedId = id; receivedProfile = profile; return { id, name: "Maria" }; },
    });
    await service.update("3", validProfile({ pin: undefined }), "9");
    assert.equal(receivedId, "3");
    assert.equal(receivedProfile.pinHash, null);
  });

  it("atualiza o PIN quando informado na edicao", async () => {
    let receivedProfile;
    const service = createCaregiverProfilesService({
      async update(id, profile) { receivedProfile = profile; return { id, name: "Maria" }; },
    });
    await service.update("3", validProfile({ pin: "4321" }), "9");
    assert.equal(await bcrypt.compare("4321", receivedProfile.pinHash), true);
  });

  it("rejeita PIN com formato invalido na edicao", async () => {
    const service = createCaregiverProfilesService({ update: async () => assert.fail() });
    await assert.rejects(
      service.update("3", validProfile({ pin: "12" }), "9"),
      CaregiverProfileValidationError,
    );
  });

  it("informa quando o cuidador nao existe ao atualizar", async () => {
    const service = createCaregiverProfilesService({ update: async () => null });
    await assert.rejects(service.update("99", validProfile(), "9"), CaregiverProfileNotFoundError);
  });

  it("informa quando o cuidador nao existe ao remover", async () => {
    const service = createCaregiverProfilesService({ remove: async () => false });
    await assert.rejects(service.remove("99", "9"), CaregiverProfileNotFoundError);
  });

  describe("verifyPin", () => {
    it("aceita o PIN correto", async () => {
      const pinHash = await bcrypt.hash("1234", 10);
      const service = createCaregiverProfilesService({
        getPinHash: async () => ({ pinHash }),
      });
      await assert.doesNotReject(service.verifyPin("3", "1234", "9"));
    });

    it("rejeita PIN incorreto", async () => {
      const pinHash = await bcrypt.hash("1234", 10);
      const service = createCaregiverProfilesService({
        getPinHash: async () => ({ pinHash }),
      });
      await assert.rejects(service.verifyPin("3", "0000", "9"), CaregiverProfileValidationError);
    });

    it("informa quando o cuidador nao existe", async () => {
      const service = createCaregiverProfilesService({ getPinHash: async () => null });
      await assert.rejects(service.verifyPin("99", "1234", "9"), CaregiverProfileNotFoundError);
    });

    it("rejeita formato de PIN invalido", async () => {
      const service = createCaregiverProfilesService({ getPinHash: async () => assert.fail() });
      await assert.rejects(service.verifyPin("3", "12a4", "9"), CaregiverProfileValidationError);
    });
  });

  describe("setPin", () => {
    it("define o PIN quando o cuidador ainda nao tem um", async () => {
      let receivedHash;
      const service = createCaregiverProfilesService({
        getPinStatus: async () => ({ hasPin: false }),
        async setPin(id, pinHash) { receivedHash = pinHash; return { id, name: "Maria" }; },
      });
      await service.setPin("3", "1234", "9");
      assert.equal(await bcrypt.compare("1234", receivedHash), true);
    });

    it("rejeita definir PIN quando o cuidador ja tem um", async () => {
      const service = createCaregiverProfilesService({
        getPinStatus: async () => ({ hasPin: true }),
        setPin: async () => assert.fail(),
      });
      await assert.rejects(service.setPin("3", "1234", "9"), CaregiverProfileValidationError);
    });

    it("informa quando o cuidador nao existe", async () => {
      const service = createCaregiverProfilesService({ getPinStatus: async () => null });
      await assert.rejects(service.setPin("99", "1234", "9"), CaregiverProfileNotFoundError);
    });

    it("rejeita formato de PIN invalido", async () => {
      const service = createCaregiverProfilesService({ getPinStatus: async () => assert.fail() });
      await assert.rejects(service.setPin("3", "12a4", "9"), CaregiverProfileValidationError);
    });
  });
});
