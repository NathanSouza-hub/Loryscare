class MedicationAdministrationConflictError extends Error {
  constructor({ authorProfileName, administeredAt } = {}) {
    super(
      authorProfileName
        ? `Esta dose já foi registrada por ${authorProfileName}`
        : "Esta dose já foi registrada por outro cuidador",
    );
    this.name = "MedicationAdministrationConflictError";
    this.authorProfileName = authorProfileName ?? null;
    this.administeredAt = administeredAt ?? null;
  }
}

module.exports = MedicationAdministrationConflictError;
