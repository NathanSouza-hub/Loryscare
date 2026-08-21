const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const NursingNoteOwnershipError = require("../src/errors/nursing-note-ownership-error");
const createNursingNotesController = require("../src/controllers/nursing-notes-controller");

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

describe("nursing notes controller", () => {
  it("retorna 403 quando outro perfil tenta editar a anotação", async () => {
    const ownershipError = new NursingNoteOwnershipError();
    const controller = createNursingNotesController({
      update: async () => {
        throw ownershipError;
      },
    }, { publish: () => {} });
    const response = createResponse();

    await controller.update(
      { params: { id: "1" }, body: {} },
      response,
      assert.fail,
    );

    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.body, { error: ownershipError.message });
  });
});
