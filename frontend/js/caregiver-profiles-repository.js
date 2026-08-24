const CaregiverProfilesRepository = (() => {
  const API_URL = "http://localhost:3000/api/caregiver-profiles";

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

  async function getAll() { return (await request(API_URL)).data; }
  async function create(data) { return (await request(API_URL, { method: "POST", body: JSON.stringify(data) })).data; }
  async function update(id, data) { return (await request(`${API_URL}/${id}`, { method: "PUT", body: JSON.stringify(data) })).data; }
  async function remove(id) { return request(`${API_URL}/${id}`, { method: "DELETE" }); }
  async function setPin(id, pin) { return (await request(`${API_URL}/${id}/set-pin`, { method: "POST", body: JSON.stringify({ pin }) })).data; }
  async function verifyPin(id, pin) { return (await request(`${API_URL}/${id}/verify-pin`, { method: "POST", body: JSON.stringify({ pin }) })).data; }

  return Object.freeze({ create, getAll, remove, setPin, update, verifyPin });
})();
