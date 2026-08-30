const path = require("path");
const cors = require("cors");
const express = require("express");
const pool = require("./config/database");
const createVitalsController = require("./controllers/vitals-controller");
const vitalsRepository = require("./repositories/vitals-repository");
const createVitalsRouter = require("./routes/vitals-routes");
const createVitalsService = require("./services/vitals-service");
const createMedicationsController = require("./controllers/medications-controller");
const medicationsRepository = require("./repositories/medications-repository");
const createMedicationsRouter = require("./routes/medications-routes");
const createMedicationsService = require("./services/medications-service");
const createRoutinesController = require("./controllers/routines-controller");
const routinesRepository = require("./repositories/routines-repository");
const createRoutinesRouter = require("./routes/routines-routes");
const createRoutinesService = require("./services/routines-service");
const createEventsController = require("./controllers/events-controller");
const eventsRepository = require("./repositories/events-repository");
const createEventsRouter = require("./routes/events-routes");
const createEventsService = require("./services/events-service");
const createNursingNotesController = require("./controllers/nursing-notes-controller");
const nursingNotesRepository = require("./repositories/nursing-notes-repository");
const createNursingNotesRouter = require("./routes/nursing-notes-routes");
const createNursingNotesService = require("./services/nursing-notes-service");
const createPatientsController = require("./controllers/patients-controller");
const patientsRepository = require("./repositories/patients-repository");
const createPatientsRouter = require("./routes/patients-routes");
const createPatientsService = require("./services/patients-service");
const createAuthController = require("./controllers/auth-controller");
const usersRepository = require("./repositories/users-repository");
const createAuthRouter = require("./routes/auth-routes");
const createAuthService = require("./services/auth-service");
const createCaregiverProfilesController = require("./controllers/caregiver-profiles-controller");
const caregiverProfilesRepository = require("./repositories/caregiver-profiles-repository");
const createCaregiverProfilesRouter = require("./routes/caregiver-profiles-routes");
const createCaregiverProfilesService = require("./services/caregiver-profiles-service");
const createWorkShiftsController = require("./controllers/work-shifts-controller");
const workShiftsRepository = require("./repositories/work-shifts-repository");
const createWorkShiftsRouter = require("./routes/work-shifts-routes");
const createWorkShiftsService = require("./services/work-shifts-service");
const createScheduleMonthsController = require("./controllers/schedule-months-controller");
const scheduleMonthsRepository = require("./repositories/schedule-months-repository");
const createScheduleMonthsRouter = require("./routes/schedule-months-routes");
const createScheduleMonthsService = require("./services/schedule-months-service");
const createScheduleShiftsController = require("./controllers/schedule-shifts-controller");
const scheduleShiftsRepository = require("./repositories/schedule-shifts-repository");
const createScheduleShiftsRouter = require("./routes/schedule-shifts-routes");
const createScheduleShiftsService = require("./services/schedule-shifts-service");
const createRequireAuth = require("./middleware/require-auth");
const createAttachProfile = require("./middleware/attach-profile");
const createChangeBus = require("./realtime/change-bus");

const app = express();
const changeBus = createChangeBus();

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "../../frontend")));

const authService = createAuthService(usersRepository);
const authController = createAuthController(authService);
const requireAuth = createRequireAuth(authService);
const attachProfile = createAttachProfile(caregiverProfilesRepository);
app.use("/api/auth", createAuthRouter(authController, requireAuth));

const vitalsService = createVitalsService(vitalsRepository);
const vitalsController = createVitalsController(vitalsService, changeBus);

app.use("/api/vitals", requireAuth, attachProfile, createVitalsRouter(vitalsController));

const medicationsService = createMedicationsService(medicationsRepository);
const medicationsController = createMedicationsController(medicationsService, changeBus);
app.use("/api/medications", requireAuth, attachProfile, createMedicationsRouter(medicationsController));

const routinesService = createRoutinesService(routinesRepository);
const routinesController = createRoutinesController(routinesService, changeBus);
app.use("/api/routines", requireAuth, attachProfile, createRoutinesRouter(routinesController));

const patientsService = createPatientsService(patientsRepository);
const patientsController = createPatientsController(patientsService);
app.use("/api/patients", requireAuth, createPatientsRouter(patientsController));

const eventsService = createEventsService(eventsRepository);
const eventsController = createEventsController(eventsService, changeBus);
app.use("/api/events", requireAuth, attachProfile, createEventsRouter(eventsController));

const nursingNotesService = createNursingNotesService(nursingNotesRepository, workShiftsRepository);
const nursingNotesController = createNursingNotesController(nursingNotesService, changeBus);
app.use("/api/nursing-notes", requireAuth, attachProfile, createNursingNotesRouter(nursingNotesController));

const caregiverProfilesService = createCaregiverProfilesService(caregiverProfilesRepository);
const caregiverProfilesController = createCaregiverProfilesController(caregiverProfilesService, changeBus);
app.use("/api/caregiver-profiles", requireAuth, createCaregiverProfilesRouter(caregiverProfilesController));

const workShiftsService = createWorkShiftsService(workShiftsRepository, scheduleShiftsRepository);
const workShiftsController = createWorkShiftsController(workShiftsService);
app.use("/api/work-shifts", requireAuth, attachProfile, createWorkShiftsRouter(workShiftsController));

const scheduleMonthsService = createScheduleMonthsService(scheduleMonthsRepository, caregiverProfilesRepository);
const scheduleMonthsController = createScheduleMonthsController(scheduleMonthsService, changeBus);
app.use("/api/schedule-months", requireAuth, createScheduleMonthsRouter(scheduleMonthsController));

const scheduleShiftsService = createScheduleShiftsService(scheduleShiftsRepository, caregiverProfilesRepository);
const scheduleShiftsController = createScheduleShiftsController(scheduleShiftsService, changeBus);
app.use("/api/schedule-shifts", requireAuth, attachProfile, createScheduleShiftsRouter(scheduleShiftsController));

app.get("/api/stream", (request, response) => {
  let userId;
  try {
    ({ userId } = authService.verifyToken(request.query.token));
  } catch (error) {
    response.status(401).end();
    return;
  }

  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  response.flushHeaders();
  response.write("retry: 3000\n\n");

  changeBus.subscribe(userId, response);
  request.on("close", () => changeBus.unsubscribe(userId, response));
});

app.get("/health", (request, response) => {
  response.status(200).json({
    status: "ok",
    service: "Lory's Care API",
  });
});

app.get("/health/database", async (request, response) => {
  try {
    const result = await pool.query(
      "SELECT CURRENT_DATABASE() AS database, CURRENT_TIMESTAMP AS checked_at",
    );

    response.status(200).json({
      status: "ok",
      database: result.rows[0].database,
      checkedAt: result.rows[0].checked_at,
    });
  } catch (error) {
    console.error("Falha ao verificar o banco de dados:", error.message);
    response.status(503).json({
      status: "error",
      message: "Banco de dados indisponível",
    });
  }
});

app.use((error, request, response, next) => {
  console.error("Erro inesperado na API:", error.message);
  response.status(500).json({
    error: "Erro interno do servidor",
  });
});

module.exports = app;
module.exports.changeBus = changeBus;
