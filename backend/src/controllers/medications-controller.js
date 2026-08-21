const MedicationNotFoundError = require("../errors/medication-not-found-error");
const MedicationValidationError = require("../errors/medication-validation-error");
const MedicationAdministrationConflictError = require("../errors/medication-administration-conflict-error");

function handle(error, response, next) {
  if (error instanceof MedicationValidationError) {
    response.status(400).json({ error: error.message, details: error.details });
  } else if (error instanceof MedicationNotFoundError) {
    response.status(404).json({ error: error.message });
  } else if (error instanceof MedicationAdministrationConflictError) {
    response.status(409).json({
      error: error.message,
      authorProfileName: error.authorProfileName,
      administeredAt: error.administeredAt,
    });
  } else {
    next(error);
  }
}

function createMedicationsController(service, changeBus) {
  const action = (callback) => async (request, response, next) => {
    try { await callback(request, response); } catch (error) { handle(error, response, next); }
  };

  return Object.freeze({
    getAll: action(async (request, response) => response.json({ data: await service.getAll(request.query.patientId, request.userId) })),
    create: action(async (request, response) => {
      const data = await service.create(request.body, request.userId);
      changeBus.publish(request.userId, { resource: "medications", action: "created" });
      response.status(201).json({ data });
    }),
    update: action(async (request, response) => {
      await service.update(request.params.id, request.body, request.userId);
      changeBus.publish(request.userId, { resource: "medications", action: "updated" });
      response.status(204).send();
    }),
    remove: action(async (request, response) => {
      await service.remove(request.params.id, request.userId);
      changeBus.publish(request.userId, { resource: "medications", action: "removed" });
      response.status(204).send();
    }),
    getDaily: action(async (request, response) => response.json({ data: await service.getDaily(request.query.date, request.query.patientId, request.userId) })),
    setAdministration: action(async (request, response) => {
      const data = await service.setAdministration(request.params.id, request.params.scheduleId, request.body, request.userId, request.profileId);
      changeBus.publish(request.userId, { resource: "medications", action: "administration-updated" });
      response.json({ data });
    }),
  });
}

module.exports = createMedicationsController;
