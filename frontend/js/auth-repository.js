const AuthRepository = (() => {
  const API_URL = `${API_BASE_URL}/api/auth`;

  const hasAuthContext = typeof AuthContext !== "undefined";
  const PUBLIC_PATHS = ["login", "signup", "google", "password/forgot", "password/reset"];

  async function request(path, options = {}) {
    const response = await fetch(`${API_URL}/${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(hasAuthContext ? AuthContext.authHeader() : {}), ...options.headers },
    });
    if (response.status === 401 && hasAuthContext && !PUBLIC_PATHS.includes(path)) {
      AuthContext.logout();
      throw new Error("Sessão expirada");
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.details ? Object.values(body.details)[0] : body.error || "Falha ao acessar a API");
    }
    return body.data;
  }

  async function signUp(data) { return request("signup", { method: "POST", body: JSON.stringify(data) }); }
  async function logIn(data) { return request("login", { method: "POST", body: JSON.stringify(data) }); }
  async function signInWithGoogle(credential) { return request("google", { method: "POST", body: JSON.stringify({ credential }) }); }
  async function getGoogleConfig() { return request("google/config"); }
  async function requestPasswordReset(email) { return request("password/forgot", { method: "POST", body: JSON.stringify({ email }) }); }
  async function resetPassword(data) { return request("password/reset", { method: "POST", body: JSON.stringify(data) }); }
  async function getProfile() { return request("profile"); }
  async function updateProfile(data) { return request("profile", { method: "PUT", body: JSON.stringify(data) }); }
  async function changePassword(data) { return request("profile/password", { method: "PUT", body: JSON.stringify(data) }); }
  async function updateAvatar(avatarData) { return request("profile/avatar", { method: "PUT", body: JSON.stringify({ avatarData }) }); }

  return Object.freeze({
    changePassword, getGoogleConfig, getProfile, logIn, requestPasswordReset, resetPassword, signInWithGoogle,
    signUp, updateAvatar, updateProfile,
  });
})();
