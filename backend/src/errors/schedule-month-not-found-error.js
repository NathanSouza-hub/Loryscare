class ScheduleMonthNotFoundError extends Error {
  constructor() {
    super("Escala do mês não encontrada");
    this.name = "ScheduleMonthNotFoundError";
  }
}

module.exports = ScheduleMonthNotFoundError;
