const { Router } = require("express");

function createWorkShiftsRouter(controller) {
  const router = Router();
  router.get("/current", controller.getCurrent);
  router.post("/", controller.start);
  return router;
}

module.exports = createWorkShiftsRouter;
