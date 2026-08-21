const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const ValidationError = require("../src/errors/validation-error");
const VitalSignOwnershipError = require("../src/errors/vital-sign-ownership-error");
const createVitalsController = require("../src/controllers/vitals-controller");

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send() {
      return this;
    },
  };
}

describe("vitals controller", () => {
  it("retorna 201 com o registro criado", async () => {
    const record = { id: "1" };
    const controller = createVitalsController({ create: async () => record }, { publish: () => {} });
    const response = createResponse();

    await controller.create({ body: {} }, response, assert.fail);

    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body, { data: record });
  });

  it("retorna 400 para erro de validação", async () => {
    const validationError = new ValidationError({ date: "Data inválida" });
    const controller = createVitalsController({
      create: async () => {
        throw validationError;
      },
    }, { publish: () => {} });
    const response = createResponse();

    await controller.create({ body: {} }, response, assert.fail);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
      error: validationError.message,
      details: validationError.details,
    });
  });

  it("encaminha erros inesperados ao middleware", async () => {
    const unexpectedError = new Error("Falha no banco");
    const controller = createVitalsController({
      create: async () => {
        throw unexpectedError;
      },
    }, { publish: () => {} });
    const response = createResponse();
    let forwardedError;

    await controller.create({ body: {} }, response, (error) => {
      forwardedError = error;
    });

    assert.equal(forwardedError, unexpectedError);
    assert.equal(response.statusCode, null);
  });

  it("retorna 200 com a lista de registros", async () => {
    const records = [{ id: "1" }];
    const controller = createVitalsController({ getAll: async () => records }, { publish: () => {} });
    const response = createResponse();

    await controller.getAll({ query: { patientId: "1" } }, response, assert.fail);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { data: records });
  });

  it("retorna 400 quando o paciente informado é inválido", async () => {
    const validationError = new ValidationError({ patientId: "Informe um identificador válido" });
    const controller = createVitalsController({
      getAll: async () => {
        throw validationError;
      },
    }, { publish: () => {} });
    const response = createResponse();

    await controller.getAll({ query: {} }, response, assert.fail);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
      error: validationError.message,
      details: validationError.details,
    });
  });

  it("retorna 200 com o registro atualizado", async () => {
    const record = { id: "1", heartRate: 80 };
    const controller = createVitalsController({ update: async () => record }, { publish: () => {} });
    const response = createResponse();

    await controller.update({ params: { id: "1" }, body: {} }, response, assert.fail);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { data: record });
  });

  it("retorna 204 ao remover o registro", async () => {
    const controller = createVitalsController({ remove: async () => undefined }, { publish: () => {} });
    const response = createResponse();

    await controller.remove({ params: { id: "1" } }, response, assert.fail);

    assert.equal(response.statusCode, 204);
    assert.equal(response.body, null);
  });

  it("retorna 403 quando outro perfil tenta editar o registro", async () => {
    const ownershipError = new VitalSignOwnershipError();
    const controller = createVitalsController({
      update: async () => {
        throw ownershipError;
      },
    }, { publish: () => {} });
    const response = createResponse();

    await controller.update({ params: { id: "1" }, body: {} }, response, assert.fail);

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.body, { error: ownershipError.message });
  });

  it("retorna 404 quando o registro não existe", async () => {
    const controller = createVitalsController({
      update: async () => {
        throw new (require("../src/errors/not-found-error"))();
      },
    }, { publish: () => {} });
    const response = createResponse();

    await controller.update({ params: { id: "999" }, body: {} }, response, assert.fail);

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, {
      error: "Registro de sinais vitais não encontrado",
    });
  });
});
