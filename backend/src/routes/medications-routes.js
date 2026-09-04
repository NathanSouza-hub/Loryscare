const { Router } = require("express");

function createMedicationsRouter(controller) {
  const router = Router();
  router.get("/daily", controller.getDaily);
  router.get("/missed", controller.getMissed);
  router.get("/", controller.getAll);
  router.post("/", controller.create);
  router.put("/:id", controller.update);
  router.delete("/:id", controller.remove);
  router.patch("/:id/schedules/:scheduleId/administration", controller.setAdministration);
  return router;
}

module.exports = createMedicationsRouter;
