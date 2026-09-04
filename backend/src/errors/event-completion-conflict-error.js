class EventCompletionConflictError extends Error {
  constructor({ authorProfileName, completedAt } = {}) {
    super(
      authorProfileName
        ? `Este evento já foi registrado por ${authorProfileName}`
        : "Este evento já foi registrado por outro cuidador",
    );
    this.name = "EventCompletionConflictError";
    this.authorProfileName = authorProfileName ?? null;
    this.completedAt = completedAt ?? null;
  }
}

module.exports = EventCompletionConflictError;
