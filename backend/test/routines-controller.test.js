const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const RoutineCompletionConflictError = require("../src/errors/routine-completion-conflict-error");
const createRoutinesController = require("../src/controllers/routines-controller");

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

describe("routines controller", () => {
  it("retorna 409 quando outro autor já registrou a conclusão", async () => {
    const conflictError = new RoutineCompletionConflictError({
      authorProfileName: "Nathan",
      completedAt: new Date("2026-08-20T09:00:00Z"),
    });
    const controller = createRoutinesController({
      setCompletion: async () => {
        throw conflictError;
      },
    }, { publish: () => {} });
    const response = createResponse();

    await controller.setCompletion(
      { params: { id: "1" }, body: { date: "2026-08-20", status: "completed" } },
      response,
      assert.fail,
    );

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.body, {
      error: conflictError.message,
      authorProfileName: "Nathan",
      completedAt: conflictError.completedAt,
    });
  });
});
