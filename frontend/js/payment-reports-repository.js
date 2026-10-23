const PaymentReportsRepository = (() => {
  const REPORTS_URL = `${API_BASE_URL}/api/payment-reports`;

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

  async function list() {
    return (await request(REPORTS_URL)).data;
  }
  async function create(data) {
    return (await request(REPORTS_URL, { method: "POST", body: JSON.stringify(data) })).data;
  }
  async function get(id) {
    return (await request(`${REPORTS_URL}/${id}`)).data;
  }
  async function remove(id) {
    await request(`${REPORTS_URL}/${id}`, { method: "DELETE" });
  }
  async function recalculate(id) {
    await request(`${REPORTS_URL}/${id}/recalculate`, { method: "POST" });
  }
  async function addItem(id, data) {
    return (await request(`${REPORTS_URL}/${id}/items`, { method: "POST", body: JSON.stringify(data) })).data;
  }
  async function updateItem(id, itemId, data) {
    await request(`${REPORTS_URL}/${id}/items/${itemId}`, { method: "PATCH", body: JSON.stringify(data) });
  }
  async function removeItem(id, itemId) {
    await request(`${REPORTS_URL}/${id}/items/${itemId}`, { method: "DELETE" });
  }

  return Object.freeze({ addItem, create, get, list, recalculate, remove, removeItem, updateItem });
})();
