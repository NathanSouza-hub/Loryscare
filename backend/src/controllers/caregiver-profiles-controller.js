const CaregiverProfileNotFoundError = require("../errors/caregiver-profile-not-found-error");
const CaregiverProfileValidationError = require("../errors/caregiver-profile-validation-error");

function handle(error, response, next) {
  if (error instanceof CaregiverProfileValidationError) response.status(400).json({ error: error.message, details: error.details });
  else if (error instanceof CaregiverProfileNotFoundError) response.status(404).json({ error: error.message });
  else next(error);
}

function createCaregiverProfilesController(service, changeBus) {
  const action = (callback) => async (request, response, next) => {
    try { await callback(request, response); } catch (error) { handle(error, response, next); }
  };
  return Object.freeze({
    getAll: action(async (request, response) => response.json({ data: await service.getAll(request.userId) })),
    create: action(async (request, response) => {
      const data = await service.create(request.body, request.userId);
      changeBus.publish(request.userId, { resource: "caregiver-profiles", action: "created" });
      response.status(201).json({ data });
    }),
    update: action(async (request, response) => {
      const data = await service.update(request.params.id, request.body, request.userId);
      changeBus.publish(request.userId, { resource: "caregiver-profiles", action: "updated" });
      response.json({ data });
    }),
    remove: action(async (request, response) => {
      await service.remove(request.params.id, request.userId);
      changeBus.publish(request.userId, { resource: "caregiver-profiles", action: "removed" });
      response.status(204).send();
    }),
    setPin: action(async (request, response) => {
      const data = await service.setPin(request.params.id, request.body.pin, request.userId);
      response.status(200).json({ data });
    }),
    verifyPin: action(async (request, response) => {
      await service.verifyPin(request.params.id, request.body.pin, request.userId);
      response.status(200).json({ data: true });
    }),
  });
}

module.exports = createCaregiverProfilesController;
