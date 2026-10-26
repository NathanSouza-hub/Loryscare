const AuthenticationError = require("../errors/auth-authentication-error");

function createRequireAuth(authService) {
  return function requireAuth(request, response, next) {
    try {
      const header = request.headers.authorization ?? "";
      const [scheme, token] = header.split(" ");
      if (scheme !== "Bearer" || !token) throw new AuthenticationError("Faça login para continuar");
      const { userId, authMethod, issuedAt } = authService.verifyToken(token);
      request.userId = userId;
      request.authSession = { authMethod, issuedAt };
      next();
    } catch (error) {
      if (error instanceof AuthenticationError) response.status(401).json({ error: error.message });
      else next(error);
    }
  };
}

module.exports = createRequireAuth;
