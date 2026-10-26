const AuthContext = (() => {
  const STORAGE_KEY = "loreroutine:token";
  const USER_STORAGE_KEY = "loreroutine:userName";
  const AVATAR_STORAGE_KEY = "loreroutine:avatar";

  function getToken() {
    return localStorage.getItem(STORAGE_KEY) || null;
  }

  function getUserName() {
    return localStorage.getItem(USER_STORAGE_KEY) || "";
  }

  function setUserName(userName) {
    if (userName) localStorage.setItem(USER_STORAGE_KEY, userName);
  }

  function getAvatar() {
    return localStorage.getItem(AVATAR_STORAGE_KEY) || "";
  }

  function setAvatar(avatarData) {
    if (avatarData) localStorage.setItem(AVATAR_STORAGE_KEY, avatarData);
    else localStorage.removeItem(AVATAR_STORAGE_KEY);
  }

  function getTokenPayload() {
    const token = getToken();
    if (!token) return null;
    try {
      const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(base64));
    } catch {
      return null;
    }
  }

  // Espelha a regra do backend: logo após entrar com Google, dá para trocar a senha sem a atual.
  const GOOGLE_PASSWORD_CHANGE_WINDOW_SECONDS = 15 * 60;
  function canChangePasswordWithoutCurrent() {
    const payload = getTokenPayload();
    if (payload?.authMethod !== "google" || !payload.iat) return false;
    return Date.now() / 1000 - payload.iat <= GOOGLE_PASSWORD_CHANGE_WINDOW_SECONDS;
  }

  function setSession(token, userName) {
    localStorage.setItem(STORAGE_KEY, token);
    if (userName) localStorage.setItem(USER_STORAGE_KEY, userName);
  }

  function authHeader() {
    const token = getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const profileId = localStorage.getItem("loreroutine:profileId");
    if (profileId) headers["X-Profile-Id"] = profileId;
    return headers;
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(AVATAR_STORAGE_KEY);
    localStorage.removeItem("loreroutine:patientId");
    localStorage.removeItem("loreroutine:profileId");
    localStorage.removeItem("loreroutine:profileName");
    localStorage.removeItem("loreroutine:profileColor");
    location.href = "login.html";
  }

  if (!getToken()) {
    location.href = "login.html";
  }

  document.addEventListener("DOMContentLoaded", () => {
    const userLabel = document.querySelector("#sidebar-user");
    if (userLabel) userLabel.textContent = getUserName();
  });

  return Object.freeze({
    authHeader, canChangePasswordWithoutCurrent, getAvatar, getToken, getUserName, logout, setAvatar, setSession,
    setUserName,
  });
})();
