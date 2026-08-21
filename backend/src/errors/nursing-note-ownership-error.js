class NursingNoteOwnershipError extends Error {
  constructor(message = "Só quem registrou esta anotação pode editá-la") {
    super(message);
    this.name = "NursingNoteOwnershipError";
  }
}

module.exports = NursingNoteOwnershipError;
