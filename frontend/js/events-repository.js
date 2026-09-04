const EventsRepository = (() => {
  const API_URL = `${API_BASE_URL}/api/events`;
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
  async function getAll(patientId, start, end) {
    const params = new URLSearchParams({ patientId });
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    return (await request(`${API_URL}?${params.toString()}`)).data;
  }
  async function getDaily(date, patientId) { return (await request(`${API_URL}/daily?date=${encodeURIComponent(date)}&patientId=${encodeURIComponent(patientId)}`)).data; }
  async function getUpcoming(patientId, days = 3) { return (await request(`${API_URL}/upcoming?patientId=${encodeURIComponent(patientId)}&days=${days}`)).data; }
  async function create(data) { return request(API_URL, { method: "POST", body: JSON.stringify(data) }); }
  async function update(id, data) { return request(`${API_URL}/${id}`, { method: "PUT", body: JSON.stringify(data) }); }
  async function remove(id) { return request(`${API_URL}/${id}`, { method: "DELETE" }); }
  async function setStatus(id, status) { return request(`${API_URL}/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); }
  async function getMissed(patientId) { return (await request(`${API_URL}/missed?patientId=${encodeURIComponent(patientId)}`)).data; }
  return Object.freeze({ create, getAll, getDaily, getMissed, getUpcoming, remove, setStatus, update });
})();
