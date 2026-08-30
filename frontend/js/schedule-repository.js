const ScheduleRepository = (() => {
  const MONTHS_URL = `${API_BASE_URL}/api/schedule-months`;
  const SHIFTS_URL = `${API_BASE_URL}/api/schedule-shifts`;

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

  async function getMonth(year, month) {
    return (await request(`${MONTHS_URL}?year=${year}&month=${month}`)).data;
  }
  async function generateMonth(data) {
    return (await request(MONTHS_URL, { method: "POST", body: JSON.stringify(data) })).data;
  }
  async function deleteMonth(id) {
    await request(`${MONTHS_URL}/${id}`, { method: "DELETE" });
  }
  async function listShifts(year, month) {
    return (await request(`${SHIFTS_URL}?year=${year}&month=${month}`)).data;
  }
  async function getCurrentShift(profileId) {
    return (await request(`${SHIFTS_URL}/current?profileId=${profileId}`)).data;
  }
  async function updateShift(id, data) {
    await request(`${SHIFTS_URL}/${id}`, { method: "PATCH", body: JSON.stringify(data) });
  }
  async function deleteShift(id) {
    await request(`${SHIFTS_URL}/${id}`, { method: "DELETE" });
  }
  async function swapShifts(shiftIdA, shiftIdB) {
    await request(`${SHIFTS_URL}/swap`, { method: "POST", body: JSON.stringify({ shiftIdA, shiftIdB }) });
  }

  return Object.freeze({
    deleteMonth, deleteShift, generateMonth, getCurrentShift, getMonth, listShifts, swapShifts, updateShift,
  });
})();
