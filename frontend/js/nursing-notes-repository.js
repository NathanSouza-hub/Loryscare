const NursingNotesRepository = (() => {
  const API_URL = `${API_BASE_URL}/api/nursing-notes`;
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
  async function getAll(patientId, filters = {}) {
    const params = new URLSearchParams({ patientId });
    if (filters.date) params.set("date", filters.date);
    if (filters.shift) params.set("shift", filters.shift);
    return (await request(`${API_URL}?${params.toString()}`)).data;
  }
  async function create(data) { return request(API_URL, { method: "POST", body: JSON.stringify(data) }); }
  async function update(id, data) { return request(`${API_URL}/${id}`, { method: "PUT", body: JSON.stringify(data) }); }
  async function remove(id) { return request(`${API_URL}/${id}`, { method: "DELETE" }); }
  return Object.freeze({ create, getAll, remove, update });
})();
