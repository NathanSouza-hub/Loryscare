class ScheduleShiftNotFoundError extends Error {
  constructor() {
    super("Plantão programado não encontrado");
    this.name = "ScheduleShiftNotFoundError";
  }
}

module.exports = ScheduleShiftNotFoundError;
