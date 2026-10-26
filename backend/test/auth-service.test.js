const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { before, describe, it } = require("node:test");
const AuthValidationError = require("../src/errors/auth-validation-error");
const AuthenticationError = require("../src/errors/auth-authentication-error");
const createAuthService = require("../src/services/auth-service");

before(() => {
  process.env.JWT_SECRET = "test-secret";
});

function createFakeRepository() {
  const users = [];
  let nextId = 1;
  return {
    async findByEmail(email) {
      return users.find((user) => user.email.toLowerCase() === email.toLowerCase()) ?? null;
    },
    async create(user) {
      const created = { id: String(nextId++), phone: null, avatarData: null, ...user };
      users.push(created);
      return { id: created.id, name: created.name, email: created.email, phone: created.phone, avatarData: created.avatarData };
    },
    async getById(id) {
      const user = users.find((entry) => entry.id === String(id));
      if (!user) return null;
      return { id: user.id, name: user.name, email: user.email, phone: user.phone, avatarData: user.avatarData };
    },
    async getPasswordHash(id) {
      const user = users.find((entry) => entry.id === String(id));
      return user ? { passwordHash: user.passwordHash } : null;
    },
    async updateProfile(id, profile) {
      const user = users.find((entry) => entry.id === String(id));
      Object.assign(user, profile);
      return { id: user.id, name: user.name, email: user.email, phone: user.phone, avatarData: user.avatarData };
    },
    async updatePassword(id, passwordHash) {
      const user = users.find((entry) => entry.id === String(id));
      user.passwordHash = passwordHash;
    },
    async updateAvatar(id, avatarData) {
      const user = users.find((entry) => entry.id === String(id));
      user.avatarData = avatarData;
      return { id: user.id, name: user.name, email: user.email, phone: user.phone, avatarData: user.avatarData };
    },
  };
}

function createFakeResetTokens() {
  const tokens = [];
  let nextId = 1;
  return {
    tokens,
    async create({ userId, tokenHash, expiresAt }) {
      tokens.push({ id: String(nextId++), userId: String(userId), tokenHash, expiresAt, usedAt: null });
    },
    async findValid(tokenHash) {
      const token = tokens.find((entry) => entry.tokenHash === tokenHash && !entry.usedAt && entry.expiresAt > new Date());
      return token ? { id: token.id, userId: token.userId } : null;
    },
    async invalidateForUser(userId) {
      tokens.filter((entry) => entry.userId === String(userId)).forEach((entry) => { entry.usedAt = new Date(); });
    },
  };
}

function createFakeMailer() {
  const sent = [];
  return { sent, async sendPasswordReset(message) { sent.push(message); } };
}

function googleVerifierReturning(payload) {
  return async () => payload;
}

describe("auth service", () => {
  it("cadastra um usuário e emite um token", async () => {
    const service = createAuthService(createFakeRepository());
    const result = await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    assert.equal(result.user.name, "Ana");
    assert.equal(result.user.email, "ana@example.com");
    assert.equal(typeof result.token, "string");
    assert.equal(service.verifyToken(result.token).userId, result.user.id);
  });

  it("rejeita senha curta", async () => {
    const service = createAuthService(createFakeRepository());
    await assert.rejects(
      service.signUp({ name: "Ana", email: "ana@example.com", password: "123" }),
      AuthValidationError,
    );
  });

  it("rejeita e-mail já cadastrado", async () => {
    const repository = createFakeRepository();
    const service = createAuthService(repository);
    await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    await assert.rejects(
      service.signUp({ name: "Outra", email: "ana@example.com", password: "outrasenha" }),
      AuthValidationError,
    );
  });

  it("faz login com credenciais válidas", async () => {
    const repository = createFakeRepository();
    const service = createAuthService(repository);
    await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    const result = await service.logIn({ email: "ana@example.com", password: "senha1234" });
    assert.equal(result.user.email, "ana@example.com");
    assert.equal(typeof result.token, "string");
  });

  it("rejeita login com senha incorreta", async () => {
    const repository = createFakeRepository();
    const service = createAuthService(repository);
    await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    await assert.rejects(
      service.logIn({ email: "ana@example.com", password: "errada123" }),
      AuthenticationError,
    );
  });

  it("rejeita login com e-mail inexistente", async () => {
    const service = createAuthService(createFakeRepository());
    await assert.rejects(
      service.logIn({ email: "ninguem@example.com", password: "senha1234" }),
      AuthenticationError,
    );
  });

  it("rejeita token inválido", async () => {
    const service = createAuthService(createFakeRepository());
    assert.throws(() => service.verifyToken("token-invalido"), AuthenticationError);
  });

  it("atualiza nome, e-mail e telefone do perfil", async () => {
    const repository = createFakeRepository();
    const service = createAuthService(repository);
    const { user } = await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    const updated = await service.updateProfile(user.id, { name: "Ana Souza", email: "ana@example.com", phone: "11999998888" });
    assert.equal(updated.name, "Ana Souza");
    assert.equal(updated.phone, "11999998888");
  });

  it("mantém campos não enviados ao atualizar apenas o telefone", async () => {
    const repository = createFakeRepository();
    const service = createAuthService(repository);
    const { user } = await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    const updated = await service.updateProfile(user.id, { phone: "11999998888" });
    assert.equal(updated.name, "Ana");
    assert.equal(updated.email, "ana@example.com");
    assert.equal(updated.phone, "11999998888");
  });

  it("rejeita e-mail de perfil já usado por outro usuário", async () => {
    const repository = createFakeRepository();
    const service = createAuthService(repository);
    await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    const { user } = await service.signUp({ name: "Bia", email: "bia@example.com", password: "senha1234" });
    await assert.rejects(service.updateProfile(user.id, { email: "ana@example.com" }), AuthValidationError);
  });

  it("troca a senha quando a senha atual está correta", async () => {
    const repository = createFakeRepository();
    const service = createAuthService(repository);
    const { user } = await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    await service.changePassword(user.id, { currentPassword: "senha1234", newPassword: "novasenha123" });
    const stored = await repository.getPasswordHash(user.id);
    assert.ok(await bcrypt.compare("novasenha123", stored.passwordHash));
  });

  it("rejeita troca de senha com senha atual incorreta", async () => {
    const repository = createFakeRepository();
    const service = createAuthService(repository);
    const { user } = await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    await assert.rejects(
      service.changePassword(user.id, { currentPassword: "errada123", newPassword: "novasenha123" }),
      AuthenticationError,
    );
  });

  it("atualiza a foto de perfil com uma imagem válida", async () => {
    const repository = createFakeRepository();
    const service = createAuthService(repository);
    const { user } = await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    const avatarData = "data:image/png;base64,aGVsbG8=";
    const updated = await service.updateAvatar(user.id, avatarData);
    assert.equal(updated.avatarData, avatarData);
  });

  it("remove a foto de perfil quando enviado null", async () => {
    const repository = createFakeRepository();
    const service = createAuthService(repository);
    const { user } = await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    await service.updateAvatar(user.id, "data:image/png;base64,aGVsbG8=");
    const updated = await service.updateAvatar(user.id, null);
    assert.equal(updated.avatarData, null);
  });

  it("rejeita foto de perfil em formato inválido", async () => {
    const repository = createFakeRepository();
    const service = createAuthService(repository);
    const { user } = await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    await assert.rejects(service.updateAvatar(user.id, "nao-e-uma-imagem"), AuthValidationError);
  });
  it("entra com Google numa conta existente pelo e-mail verificado", async () => {
    const repository = createFakeRepository();
    const verifyGoogleIdToken = googleVerifierReturning({ email: "Ana@Example.com", email_verified: true, sub: "g-1" });
    const service = createAuthService(repository, { verifyGoogleIdToken });
    const { user } = await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    const result = await service.signInWithGoogle({ credential: "id-token" });
    assert.equal(result.user.id, user.id);
    assert.equal(result.user.passwordHash, undefined);
    assert.equal(service.verifyToken(result.token).userId, user.id);
    assert.equal(service.verifyToken(result.token).authMethod, "google");
  });

  it("rejeita login com Google quando não há conta com o e-mail", async () => {
    const verifyGoogleIdToken = googleVerifierReturning({ email: "nova@example.com", email_verified: true, sub: "g-2" });
    const service = createAuthService(createFakeRepository(), { verifyGoogleIdToken });
    await assert.rejects(service.signInWithGoogle({ credential: "id-token" }), /Nenhuma conta encontrada/);
  });

  it("rejeita login com Google quando o e-mail não é verificado", async () => {
    const repository = createFakeRepository();
    const verifyGoogleIdToken = googleVerifierReturning({ email: "ana@example.com", email_verified: false, sub: "g-1" });
    const service = createAuthService(repository, { verifyGoogleIdToken });
    await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    await assert.rejects(service.signInWithGoogle({ credential: "id-token" }), AuthenticationError);
  });

  it("rejeita login com Google quando o token do Google é inválido", async () => {
    const verifyGoogleIdToken = async () => { throw new Error("Wrong recipient"); };
    const service = createAuthService(createFakeRepository(), { verifyGoogleIdToken });
    await assert.rejects(service.signInWithGoogle({ credential: "id-token" }), AuthenticationError);
  });

  it("rejeita login com Google sem credencial", async () => {
    const service = createAuthService(createFakeRepository(), { verifyGoogleIdToken: googleVerifierReturning({}) });
    await assert.rejects(service.signInWithGoogle({}), AuthenticationError);
  });

  it("login por senha emite token com método password", async () => {
    const service = createAuthService(createFakeRepository());
    await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    const result = await service.logIn({ email: "ana@example.com", password: "senha1234" });
    assert.equal(service.verifyToken(result.token).authMethod, "password");
  });

  it("permite definir nova senha sem a atual logo após entrar com Google", async () => {
    const repository = createFakeRepository();
    const verifyGoogleIdToken = googleVerifierReturning({ email: "ana@example.com", email_verified: true, sub: "g-1" });
    const service = createAuthService(repository, { verifyGoogleIdToken });
    const { user } = await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    const { token } = await service.signInWithGoogle({ credential: "id-token" });
    await service.changePassword(user.id, { newPassword: "novasenha123" }, service.verifyToken(token));
    const stored = await repository.getPasswordHash(user.id);
    assert.ok(await bcrypt.compare("novasenha123", stored.passwordHash));
  });

  it("exige a senha atual quando o login com Google tem mais de 15 minutos", async () => {
    const repository = createFakeRepository();
    const service = createAuthService(repository);
    const { user } = await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    const issuedAt = Math.floor(Date.now() / 1000) - 16 * 60;
    const oldToken = jwt.sign({ userId: user.id, authMethod: "google", iat: issuedAt }, "test-secret");
    await assert.rejects(
      service.changePassword(user.id, { newPassword: "novasenha123" }, service.verifyToken(oldToken)),
      AuthValidationError,
    );
  });

  it("exige a senha atual numa sessão aberta por senha", async () => {
    const repository = createFakeRepository();
    const service = createAuthService(repository);
    const { user, token } = await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    await assert.rejects(
      service.changePassword(user.id, { newPassword: "novasenha123" }, service.verifyToken(token)),
      AuthValidationError,
    );
  });

  it("envia link de redefinição de senha para e-mail cadastrado", async () => {
    const resetTokens = createFakeResetTokens();
    const mailer = createFakeMailer();
    const service = createAuthService(createFakeRepository(), { resetTokens, mailer, appUrl: "http://app.test" });
    await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    await service.requestPasswordReset({ email: "ANA@example.com" });
    assert.equal(mailer.sent.length, 1);
    assert.equal(mailer.sent[0].to, "ana@example.com");
    const link = new URL(mailer.sent[0].resetUrl);
    assert.equal(link.origin + link.pathname, "http://app.test/redefinir-senha.html");
    const rawToken = link.searchParams.get("token");
    assert.equal(resetTokens.tokens[0].tokenHash, crypto.createHash("sha256").update(rawToken).digest("hex"));
    assert.notEqual(resetTokens.tokens[0].tokenHash, rawToken);
  });

  it("não revela se o e-mail de redefinição existe", async () => {
    const mailer = createFakeMailer();
    const service = createAuthService(createFakeRepository(), { resetTokens: createFakeResetTokens(), mailer });
    await service.requestPasswordReset({ email: "ninguem@example.com" });
    assert.equal(mailer.sent.length, 0);
  });

  it("não falha a solicitação quando o envio do e-mail falha", async () => {
    const mailer = { async sendPasswordReset() { throw new Error("SMTP fora do ar"); } };
    const service = createAuthService(createFakeRepository(), { resetTokens: createFakeResetTokens(), mailer, logger: { error() {} } });
    await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    await service.requestPasswordReset({ email: "ana@example.com" });
  });

  it("redefine a senha com um link válido e o invalida depois do uso", async () => {
    const repository = createFakeRepository();
    const resetTokens = createFakeResetTokens();
    const mailer = createFakeMailer();
    const service = createAuthService(repository, { resetTokens, mailer });
    const { user } = await service.signUp({ name: "Ana", email: "ana@example.com", password: "senha1234" });
    await service.requestPasswordReset({ email: "ana@example.com" });
    const token = new URL(mailer.sent[0].resetUrl).searchParams.get("token");

    await service.resetPassword({ token, newPassword: "novasenha123" });
    const stored = await repository.getPasswordHash(user.id);
    assert.ok(await bcrypt.compare("novasenha123", stored.passwordHash));

    await assert.rejects(service.resetPassword({ token, newPassword: "outrasenha123" }), AuthValidationError);
  });

  it("rejeita redefinição com link inválido ou expirado", async () => {
    const resetTokens = createFakeResetTokens();
    const service = createAuthService(createFakeRepository(), { resetTokens, mailer: createFakeMailer() });
    await resetTokens.create({ userId: "1", tokenHash: crypto.createHash("sha256").update("velho").digest("hex"), expiresAt: new Date(Date.now() - 1000) });
    await assert.rejects(service.resetPassword({ token: "velho", newPassword: "novasenha123" }), AuthValidationError);
    await assert.rejects(service.resetPassword({ token: "inexistente", newPassword: "novasenha123" }), AuthValidationError);
  });

  it("rejeita redefinição com senha curta", async () => {
    const service = createAuthService(createFakeRepository(), { resetTokens: createFakeResetTokens(), mailer: createFakeMailer() });
    await assert.rejects(service.resetPassword({ token: "qualquer", newPassword: "123" }), AuthValidationError);
  });
});
