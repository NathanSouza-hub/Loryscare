const WorkShiftsRepository = (() => {
  const API_URL = "http://localhost:3000/api/work-shifts";
  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...AuthContext.authHeader(), ...options.headers },
    });
    if (response.status === 401) { AuthContext.logout(); throw new Error("Sessão expirada"); }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.details ? Object.values(body.details)[0] : body.error || "Falha ao acessar a API");
    }
    if (response.status === 204) return null;
    return response.json();
  }
  async function getCurrent(timeoutMs = 1000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return (await request(`${API_URL}/current`, { signal: controller.signal })).data;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  async function start(data) { return (await request(API_URL, { method: "POST", body: JSON.stringify(data) })).data; }
  return Object.freeze({ getCurrent, start });
})();
