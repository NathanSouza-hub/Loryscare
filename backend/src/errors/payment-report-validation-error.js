class PaymentReportValidationError extends Error {
  constructor(details) {
    super("Dados do relatório inválidos");
    this.name = "PaymentReportValidationError";
    this.details = details;
  }
}

module.exports = PaymentReportValidationError;
