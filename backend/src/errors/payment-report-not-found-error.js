class PaymentReportNotFoundError extends Error {
  constructor() {
    super("Relatório não encontrado");
    this.name = "PaymentReportNotFoundError";
  }
}

module.exports = PaymentReportNotFoundError;
