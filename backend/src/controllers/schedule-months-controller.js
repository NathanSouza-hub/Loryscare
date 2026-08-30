const ScheduleMonthValidationError = require("../errors/schedule-month-validation-error");
const ScheduleMonthNotFoundError = require("../errors/schedule-month-not-found-error");

function handle(error, response, next) {
  if (error instanceof ScheduleMonthValidationError) response.status(400).json({ error: error.message, details: error.details });
  else if (error instanceof ScheduleMonthNotFoundError) response.status(404).json({ error: error.message });
  else next(error);
}

function createScheduleMonthsController(service, changeBus) {
  const action = (callback) => async (request, response, next) => {
    try { await callback(request, response); } catch (error) { handle(error, response, next); }
  };
  return Object.freeze({
    getByYearMonth: action(async (request, response) => {
      const data = await service.getByYearMonth(request.query.year, request.query.month, request.userId);
      response.json({ data });
    }),
    create: action(async (request, response) => {
      const data = await service.create(request.body, request.userId);
      changeBus.publish(request.userId, { resource: "schedule-months", action: "created" });
      response.status(201).json({ data });
    }),
    remove: action(async (request, response) => {
      await service.remove(request.params.id, request.userId);
      changeBus.publish(request.userId, { resource: "schedule-months", action: "removed" });
      response.status(204).send();
    }),
  });
}

module.exports = createScheduleMonthsController;
