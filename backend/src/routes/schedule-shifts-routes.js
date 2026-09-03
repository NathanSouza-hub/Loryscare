const { Router } = require("express");

function createScheduleShiftsRouter(controller) {
  const router = Router();
  router.get("/current", controller.getCurrent);
  router.get("/", controller.listByMonth);
  router.post("/swap", controller.swap);
  router.patch("/:id", controller.update);
  router.delete("/:id", controller.remove);
  return router;
}

module.exports = createScheduleShiftsRouter;
