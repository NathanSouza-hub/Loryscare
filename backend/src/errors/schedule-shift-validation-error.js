class ScheduleShiftValidationError extends Error {
  constructor(details) {
    super("Dados do plantão inválidos");
    this.name = "ScheduleShiftValidationError";
    this.details = details;
  }
}

module.exports = ScheduleShiftValidationError;
