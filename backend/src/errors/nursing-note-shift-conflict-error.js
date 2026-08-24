class NursingNoteShiftConflictError extends Error {
  constructor(message = "Este horário pertence ao plantão de outro cuidador") {
    super(message);
    this.name = "NursingNoteShiftConflictError";
  }
}

module.exports = NursingNoteShiftConflictError;
