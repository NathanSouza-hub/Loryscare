class WorkShiftValidationError extends Error {
  constructor(details) {
    super("Dados do plantão inválidos");
    this.name = "WorkShiftValidationError";
    this.details = details;
  }
}

module.exports = WorkShiftValidationError;
