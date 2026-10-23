const { Router } = require("express");

function createPaymentReportsRouter(controller) {
  const router = Router();
  router.get("/", controller.list);
  router.post("/", controller.create);
  router.get("/:id", controller.get);
  router.post("/:id/recalculate", controller.recalculate);
  router.delete("/:id", controller.remove);
  router.post("/:id/items", controller.addItem);
  router.patch("/:id/items/:itemId", controller.updateItem);
  router.delete("/:id/items/:itemId", controller.removeItem);
  return router;
}

module.exports = createPaymentReportsRouter;
