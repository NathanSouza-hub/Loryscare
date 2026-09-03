const ScheduleShiftValidationError = require("../errors/schedule-shift-validation-error");
const ScheduleShiftNotFoundError = require("../errors/schedule-shift-not-found-error");

function handle(error, response, next) {
  if (error instanceof ScheduleShiftValidationError) response.status(400).json({ error: error.message, details: error.details });
  else if (error instanceof ScheduleShiftNotFoundError) response.status(404).json({ error: error.message });
  else next(error);
}

function createScheduleShiftsController(service, changeBus) {
  const action = (callback) => async (request, response, next) => {
    try { await callback(request, response); } catch (error) { handle(error, response, next); }
  };
  return Object.freeze({
    listByMonth: action(async (request, response) => {
      response.json({ data: await service.listByMonth(request.query.year, request.query.month, request.userId) });
    }),
    getCurrent: action(async (request, response) => {
      response.json({ data: await service.findCurrentForProfile(request.query.profileId, request.userId) });
    }),
    update: action(async (request, response) => {
      await service.update(request.params.id, request.body, request.userId, request.profileId);
      changeBus.publish(request.userId, { resource: "schedule-shifts", action: "updated" });
      response.status(204).send();
    }),
    remove: action(async (request, response) => {
      await service.remove(request.params.id, request.userId);
      changeBus.publish(request.userId, { resource: "schedule-shifts", action: "removed" });
      response.status(204).send();
    }),
    swap: action(async (request, response) => {
      await service.swap(request.body.shiftIdA, request.body.shiftIdB, request.userId, request.profileId);
      changeBus.publish(request.userId, { resource: "schedule-shifts", action: "swapped" });
      response.status(204).send();
    }),
  });
}

module.exports = createScheduleShiftsController;
