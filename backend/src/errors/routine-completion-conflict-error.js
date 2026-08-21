class RoutineCompletionConflictError extends Error {
  constructor({ authorProfileName, completedAt } = {}) {
    super(
      authorProfileName
        ? `Esta atividade já foi registrada por ${authorProfileName}`
        : "Esta atividade já foi registrada por outro cuidador",
    );
    this.name = "RoutineCompletionConflictError";
    this.authorProfileName = authorProfileName ?? null;
    this.completedAt = completedAt ?? null;
  }
}

module.exports = RoutineCompletionConflictError;
