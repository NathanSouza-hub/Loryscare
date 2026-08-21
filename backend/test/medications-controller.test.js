const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const MedicationAdministrationConflictError = require("../src/errors/medication-administration-conflict-error");
const createMedicationsController = require("../src/controllers/medications-controller");

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

describe("medications controller", () => {
  it("retorna 409 quando outro autor já registrou a dose", async () => {
    const conflictError = new MedicationAdministrationConflictError({
      authorProfileName: "Nathan",
      administeredAt: new Date("2026-08-18T08:03:00Z"),
    });
    const controller = createMedicationsController({
      setAdministration: async () => {
        throw conflictError;
      },
    }, { publish: () => {} });
    const response = createResponse();

    await controller.setAdministration(
      { params: { id: "3", scheduleId: "5" }, body: { date: "2026-08-18", status: "taken" } },
      response,
      assert.fail,
    );

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.body, {
      error: conflictError.message,
      authorProfileName: "Nathan",
      administeredAt: conflictError.administeredAt,
    });
  });
});
