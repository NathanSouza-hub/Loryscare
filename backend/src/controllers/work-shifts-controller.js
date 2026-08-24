const WorkShiftValidationError = require("../errors/work-shift-validation-error");

function handle(error, response, next) {
  if (error instanceof WorkShiftValidationError) response.status(400).json({ error: error.message, details: error.details });
  else next(error);
}

function createWorkShiftsController(service) {
  const action = (callback) => async (request, response, next) => {
    try { await callback(request, response); } catch (error) { handle(error, response, next); }
  };
  return Object.freeze({
    start: action(async (request, response) => {
      const data = await service.start(request.body, request.userId, request.profileId);
      response.status(201).json({ data });
    }),
    getCurrent: action(async (request, response) => {
      response.json({ data: await service.getCurrent(request.userId) });
    }),
  });
}

module.exports = createWorkShiftsController;
