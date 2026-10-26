const AuthValidationError = require("../errors/auth-validation-error");
const AuthenticationError = require("../errors/auth-authentication-error");

function handle(error, response, next) {
  if (error instanceof AuthValidationError) response.status(400).json({ error: error.message, details: error.details });
  else if (error instanceof AuthenticationError) response.status(401).json({ error: error.message });
  else next(error);
}

function createAuthController(service) {
  const action = (callback) => async (request, response, next) => {
    try { await callback(request, response); } catch (error) { handle(error, response, next); }
  };
  return Object.freeze({
    signUp: action(async (request, response) => response.status(201).json({ data: await service.signUp(request.body) })),
    logIn: action(async (request, response) => response.json({ data: await service.logIn(request.body) })),
    signInWithGoogle: action(async (request, response) => response.json({ data: await service.signInWithGoogle(request.body) })),
    getGoogleConfig: action(async (request, response) => response.json({ data: { clientId: process.env.GOOGLE_CLIENT_ID || null } })),
    requestPasswordReset: action(async (request, response) => { await service.requestPasswordReset(request.body); response.status(204).send(); }),
    resetPassword: action(async (request, response) => { await service.resetPassword(request.body); response.status(204).send(); }),
    getProfile: action(async (request, response) => response.json({ data: await service.getProfile(request.userId) })),
    updateProfile: action(async (request, response) => response.json({ data: await service.updateProfile(request.userId, request.body) })),
    changePassword: action(async (request, response) => { await service.changePassword(request.userId, request.body, request.authSession); response.status(204).send(); }),
    updateAvatar: action(async (request, response) => response.json({ data: await service.updateAvatar(request.userId, request.body.avatarData) })),
  });
}

module.exports = createAuthController;
