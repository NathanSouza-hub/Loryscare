const ValidationError = require("../errors/validation-error");
const NotFoundError = require("../errors/not-found-error");
const VitalSignOwnershipError = require("../errors/vital-sign-ownership-error");

function handleKnownError(error, response) {
  if (error instanceof ValidationError) {
    response.status(400).json({ error: error.message, details: error.details });
    return true;
  }

  if (error instanceof NotFoundError) {
    response.status(404).json({ error: error.message });
    return true;
  }

  if (error instanceof VitalSignOwnershipError) {
    response.status(403).json({ error: error.message });
    return true;
  }

  return false;
}

function createVitalsController(vitalsService, changeBus) {
  async function create(request, response, next) {
    try {
      const vitalSigns = await vitalsService.create(request.body, request.userId, request.profileId);
      changeBus.publish(request.userId, { resource: "vitals", action: "created" });
      response.status(201).json({ data: vitalSigns });
    } catch (error) {
      if (!handleKnownError(error, response)) next(error);
    }
  }

  async function getAll(request, response, next) {
    try {
      const vitalSigns = await vitalsService.getAll(request.query.patientId, request.userId);
      response.status(200).json({ data: vitalSigns });
    } catch (error) {
      if (!handleKnownError(error, response)) next(error);
    }
  }

  async function update(request, response, next) {
    try {
      const vitalSigns = await vitalsService.update(request.params.id, request.body, request.userId, request.profileId);
      changeBus.publish(request.userId, { resource: "vitals", action: "updated" });
      response.status(200).json({ data: vitalSigns });
    } catch (error) {
      if (!handleKnownError(error, response)) next(error);
    }
  }

  async function remove(request, response, next) {
    try {
      await vitalsService.remove(request.params.id, request.userId);
      changeBus.publish(request.userId, { resource: "vitals", action: "removed" });
      response.status(204).send();
    } catch (error) {
      if (!handleKnownError(error, response)) next(error);
    }
  }

  return Object.freeze({ create, getAll, remove, update });
}

module.exports = createVitalsController;
