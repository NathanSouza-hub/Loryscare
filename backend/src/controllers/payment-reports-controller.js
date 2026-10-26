const PaymentReportValidationError = require("../errors/payment-report-validation-error");
const PaymentReportNotFoundError = require("../errors/payment-report-not-found-error");

function handle(error, response, next) {
  if (error instanceof PaymentReportValidationError) response.status(400).json({ error: error.message, details: error.details });
  else if (error instanceof PaymentReportNotFoundError) response.status(404).json({ error: error.message });
  else next(error);
}

function createPaymentReportsController(service, changeBus) {
  const action = (callback) => async (request, response, next) => {
    try { await callback(request, response); } catch (error) { handle(error, response, next); }
  };
  const publish = (request, eventAction) => changeBus.publish(request.userId, { resource: "payment-reports", action: eventAction });
  return Object.freeze({
    list: action(async (request, response) => {
      response.json({ data: await service.list(request.userId) });
    }),
    create: action(async (request, response) => {
      const data = await service.create(request.body, request.userId, request.profileId);
      publish(request, "created");
      response.status(201).json({ data });
    }),
    get: action(async (request, response) => {
      response.json({ data: await service.get(request.params.id, request.userId) });
    }),
    recalculate: action(async (request, response) => {
      await service.recalculate(request.params.id, request.userId);
      publish(request, "recalculated");
      response.status(204).send();
    }),
    remove: action(async (request, response) => {
      await service.remove(request.params.id, request.userId);
      publish(request, "removed");
      response.status(204).send();
    }),
    addItem: action(async (request, response) => {
      const data = await service.addItem(request.params.id, request.body, request.userId);
      publish(request, "item-created");
      response.status(201).json({ data });
    }),
    updateItem: action(async (request, response) => {
      await service.updateItem(request.params.id, request.params.itemId, request.body, request.userId);
      publish(request, "item-updated");
      response.status(204).send();
    }),
    removeItem: action(async (request, response) => {
      await service.removeItem(request.params.id, request.params.itemId, request.userId);
      publish(request, "item-removed");
      response.status(204).send();
    }),
  });
}

module.exports = createPaymentReportsController;
