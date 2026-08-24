const RoutinesRepository = (() => {
  const API_URL = `${API_BASE_URL}/api/routines`;
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
  async function getAll(patientId) { return (await request(`${API_URL}?patientId=${encodeURIComponent(patientId)}`)).data; }
  async function create(data) { return request(API_URL, { method: "POST", body: JSON.stringify(data) }); }
  async function update(id, data) { return request(`${API_URL}/${id}`, { method: "PUT", body: JSON.stringify(data) }); }
  async function remove(id) { return request(`${API_URL}/${id}`, { method: "DELETE" }); }
  async function getDaily(date, patientId) { return (await request(`${API_URL}/daily?date=${encodeURIComponent(date)}&patientId=${encodeURIComponent(patientId)}`)).data; }
  async function setCompletion(id, data) { return request(`${API_URL}/${id}/completion`, { method: "PATCH", body: JSON.stringify(data) }); }
  return Object.freeze({ create, getAll, getDaily, remove, setCompletion, update });
})();
