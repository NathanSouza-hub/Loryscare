const NursingNoteNotFoundError = require("../errors/nursing-note-not-found-error");
const NursingNoteValidationError = require("../errors/nursing-note-validation-error");
const NursingNoteOwnershipError = require("../errors/nursing-note-ownership-error");
const NursingNoteShiftConflictError = require("../errors/nursing-note-shift-conflict-error");

function handle(error, response, next) {
  if (error instanceof NursingNoteValidationError) response.status(400).json({ error: error.message, details: error.details });
  else if (error instanceof NursingNoteNotFoundError) response.status(404).json({ error: error.message });
  else if (error instanceof NursingNoteOwnershipError) response.status(403).json({ error: error.message });
  else if (error instanceof NursingNoteShiftConflictError) response.status(403).json({ error: error.message });
  else next(error);
}

function createNursingNotesController(service, changeBus) {
  const action = (callback) => async (request, response, next) => {
    try { await callback(request, response); } catch (error) { handle(error, response, next); }
  };
  return Object.freeze({
    getAll: action(async (request, response) => response.json({
      data: await service.getAll(request.query.patientId, request.userId, {
        date: request.query.date,
        shift: request.query.shift,
      }),
    })),
    create: action(async (request, response) => {
      const data = await service.create(request.body, request.userId, request.profileId);
      changeBus.publish(request.userId, { resource: "nursing-notes", action: "created" });
      response.status(201).json({ data });
    }),
    update: action(async (request, response) => {
      await service.update(request.params.id, request.body, request.userId, request.profileId);
      changeBus.publish(request.userId, { resource: "nursing-notes", action: "updated" });
      response.status(204).send();
    }),
    remove: action(async (request, response) => {
      await service.remove(request.params.id, request.userId);
      changeBus.publish(request.userId, { resource: "nursing-notes", action: "removed" });
      response.status(204).send();
    }),
  });
}

module.exports = createNursingNotesController;
