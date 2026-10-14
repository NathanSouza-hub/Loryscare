const { Router } = require("express");

function createScheduleMonthsRouter(controller) {
  const router = Router();
  router.get("/", controller.getByYearMonth);
  router.post("/", controller.create);
  router.get("/:id/earnings", controller.getEarnings);
  router.put("/:id/rates", controller.setRates);
  router.delete("/:id", controller.remove);
  return router;
}

module.exports = createScheduleMonthsRouter;
