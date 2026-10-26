const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const AuthValidationError = require("../errors/auth-validation-error");
const AuthenticationError = require("../errors/auth-authentication-error");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_EXPIRATION = "7d";
const GOOGLE_PASSWORD_CHANGE_WINDOW_SECONDS = 15 * 60;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const DEFAULT_APP_URL = "http://localhost:3000";

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET não configurado");
  return value;
}

function validateSignUp(input) {
  const details = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (!name || name.length > 120) details.name = "Informe um nome com até 120 caracteres";
  if (!email || email.length > 180 || !EMAIL_PATTERN.test(email)) details.email = "Informe um e-mail válido";
  if (password.length < 8) details.password = "A senha deve ter ao menos 8 caracteres";

  if (Object.keys(details).length) throw new AuthValidationError(details);
  return { name, email, password };
}

function validateLogIn(input) {
  const details = {};
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (!email) details.email = "Informe o e-mail";
  if (!password) details.password = "Informe a senha";

  if (Object.keys(details).length) throw new AuthValidationError(details);
  return { email, password };
}

function validateProfile(input, current) {
  const details = {};
  const name = typeof input.name === "string" ? input.name.trim() : current.name;
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : current.email;
  const phone = typeof input.phone === "string" ? input.phone.trim() : current.phone;

  if (!name || name.length > 120) details.name = "Informe um nome com até 120 caracteres";
  if (!email || email.length > 180 || !EMAIL_PATTERN.test(email)) details.email = "Informe um e-mail válido";
  if (phone && phone.length > 30) details.phone = "Use no máximo 30 caracteres";

  if (Object.keys(details).length) throw new AuthValidationError(details);
  return { name, email, phone: phone || null };
}

function validatePasswordChange(input, { requireCurrentPassword }) {
  const details = {};
  const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";
  const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";

  if (requireCurrentPassword && !currentPassword) details.currentPassword = "Informe a senha atual";
  if (newPassword.length < 8) details.newPassword = "A nova senha deve ter ao menos 8 caracteres";

  if (Object.keys(details).length) throw new AuthValidationError(details);
  return { currentPassword, newPassword };
}

const AVATAR_PATTERN = /^data:image\/(png|jpe?g|webp|gif);base64,/;
const MAX_AVATAR_LENGTH = 2_000_000;

function validateAvatar(avatarData) {
  if (avatarData === null || avatarData === undefined) return null;
  if (typeof avatarData !== "string" || !AVATAR_PATTERN.test(avatarData) || avatarData.length > MAX_AVATAR_LENGTH) {
    throw new AuthValidationError({ avatarData: "Envie uma imagem válida de até 2 MB" });
  }
  return avatarData;
}

function validatePasswordReset(input) {
  const details = {};
  const token = typeof input.token === "string" ? input.token.trim() : "";
  const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";

  if (!token) details.token = "Link de redefinição inválido ou expirado";
  if (newPassword.length < 8) details.newPassword = "A nova senha deve ter ao menos 8 caracteres";

  if (Object.keys(details).length) throw new AuthValidationError(details);
  return { token, newPassword };
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function issueToken(user, authMethod = "password") {
  return jwt.sign({ userId: user.id, authMethod }, secret(), { expiresIn: TOKEN_EXPIRATION });
}

function isRecentGoogleSession(session) {
  if (session?.authMethod !== "google" || !session.issuedAt) return false;
  return Date.now() / 1000 - session.issuedAt <= GOOGLE_PASSWORD_CHANGE_WINDOW_SECONDS;
}

function createAuthService(repository, dependencies = {}) {
  const {
    verifyGoogleIdToken,
    resetTokens,
    mailer,
    appUrl = process.env.APP_URL || DEFAULT_APP_URL,
    logger = console,
  } = dependencies;

  async function signUp(input) {
    const { name, email, password } = validateSignUp(input ?? {});
    if (await repository.findByEmail(email)) {
      throw new AuthValidationError({ email: "Este e-mail já está cadastrado" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await repository.create({ name, email, passwordHash });
    return { token: issueToken(user), user };
  }

  async function logIn(input) {
    const { email, password } = validateLogIn(input ?? {});
    const user = await repository.findByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new AuthenticationError("E-mail ou senha incorretos");
    }
    const { passwordHash, ...publicUser } = user;
    return { token: issueToken(publicUser), user: publicUser };
  }

  async function signInWithGoogle(input) {
    const credential = typeof input?.credential === "string" ? input.credential : "";
    if (!credential) throw new AuthenticationError("Não foi possível entrar com o Google");
    let payload;
    try {
      payload = await verifyGoogleIdToken(credential);
    } catch (error) {
      throw new AuthenticationError("Não foi possível entrar com o Google");
    }
    if (!payload?.email || payload.email_verified !== true) {
      throw new AuthenticationError("O e-mail da sua conta Google não está verificado");
    }
    const user = await repository.findByEmail(payload.email);
    if (!user) {
      throw new AuthenticationError("Nenhuma conta encontrada com este e-mail. Cadastre-se primeiro.");
    }
    const { passwordHash, ...publicUser } = user;
    return { token: issueToken(publicUser, "google"), user: publicUser };
  }

  function verifyToken(token) {
    if (!token) throw new AuthenticationError("Token ausente");
    try {
      const payload = jwt.verify(token, secret());
      return { userId: String(payload.userId), authMethod: payload.authMethod ?? "password", issuedAt: payload.iat };
    } catch (error) {
      throw new AuthenticationError("Token inválido ou expirado");
    }
  }

  async function getProfile(userId) {
    const user = await repository.getById(userId);
    if (!user) throw new AuthenticationError("Usuário não encontrado");
    return user;
  }

  async function updateProfile(userId, input) {
    const current = await repository.getById(userId);
    if (!current) throw new AuthenticationError("Usuário não encontrado");
    const profile = validateProfile(input ?? {}, current);
    const existing = await repository.findByEmail(profile.email);
    if (existing && String(existing.id) !== String(userId)) {
      throw new AuthValidationError({ email: "Este e-mail já está cadastrado" });
    }
    return repository.updateProfile(userId, profile);
  }

  async function changePassword(userId, input, session) {
    const requireCurrentPassword = !isRecentGoogleSession(session);
    const { currentPassword, newPassword } = validatePasswordChange(input ?? {}, { requireCurrentPassword });
    const user = await repository.getPasswordHash(userId);
    if (!user) throw new AuthenticationError("Usuário não encontrado");
    if (requireCurrentPassword && !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new AuthenticationError("Senha atual incorreta");
    }
    await repository.updatePassword(userId, await bcrypt.hash(newPassword, 10));
  }

  async function requestPasswordReset(input) {
    const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!email || !EMAIL_PATTERN.test(email)) throw new AuthValidationError({ email: "Informe um e-mail válido" });
    const user = await repository.findByEmail(email);
    if (!user) return;

    const token = crypto.randomBytes(32).toString("hex");
    await resetTokens.create({
      userId: user.id,
      tokenHash: hashResetToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });
    const resetUrl = new URL("redefinir-senha.html", appUrl.endsWith("/") ? appUrl : `${appUrl}/`);
    resetUrl.searchParams.set("token", token);
    try {
      await mailer.sendPasswordReset({ to: user.email, name: user.name, resetUrl: resetUrl.toString() });
    } catch (error) {
      logger.error("Falha ao enviar e-mail de redefinição de senha:", error);
    }
  }

  async function resetPassword(input) {
    const { token, newPassword } = validatePasswordReset(input ?? {});
    const resetToken = await resetTokens.findValid(hashResetToken(token));
    if (!resetToken) throw new AuthValidationError({ token: "Link de redefinição inválido ou expirado" });
    await repository.updatePassword(resetToken.userId, await bcrypt.hash(newPassword, 10));
    await resetTokens.invalidateForUser(resetToken.userId);
  }

  async function updateAvatar(userId, avatarData) {
    return repository.updateAvatar(userId, validateAvatar(avatarData));
  }

  return Object.freeze({
    changePassword, getProfile, logIn, requestPasswordReset, resetPassword, signInWithGoogle, signUp,
    updateAvatar, updateProfile, verifyToken,
  });
}

module.exports = createAuthService;
