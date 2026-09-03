class ScheduleMonthValidationError extends Error {
  constructor(details) {
    super("Dados da escala inválidos");
    this.name = "ScheduleMonthValidationError";
    this.details = details;
  }
}

module.exports = ScheduleMonthValidationError;
