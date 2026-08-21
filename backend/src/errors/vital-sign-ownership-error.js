class VitalSignOwnershipError extends Error {
  constructor(message = "Só quem registrou este sinal vital pode editá-lo") {
    super(message);
    this.name = "VitalSignOwnershipError";
  }
}

module.exports = VitalSignOwnershipError;
