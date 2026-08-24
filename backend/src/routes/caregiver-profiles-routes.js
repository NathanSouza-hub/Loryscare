const { Router } = require("express");

function createCaregiverProfilesRouter(controller) {
  const router = Router();
  router.get("/", controller.getAll);
  router.post("/", controller.create);
  router.put("/:id", controller.update);
  router.delete("/:id", controller.remove);
  router.post("/:id/set-pin", controller.setPin);
  router.post("/:id/verify-pin", controller.verifyPin);
  return router;
}

module.exports = createCaregiverProfilesRouter;
