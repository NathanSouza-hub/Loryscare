const { Router } = require("express");

function createEventsRouter(controller) {
  const router = Router();
  router.get("/daily", controller.getDaily);
  router.get("/missed", controller.getMissed);
  router.get("/upcoming", controller.getUpcoming);
  router.get("/", controller.getAll);
  router.post("/", controller.create);
  router.put("/:id", controller.update);
  router.delete("/:id", controller.remove);
  router.patch("/:id/status", controller.setStatus);
  return router;
}

module.exports = createEventsRouter;
