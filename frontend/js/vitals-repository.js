const VitalsRepository = (() => {
  const API_URL = "http://localhost:3000/api/vitals";

  function toLocalRecord(record) {
    const measuredAt = new Date(record.measuredAt);

    return {
      id: String(record.id),
      date: [
        measuredAt.getFullYear(),
        String(measuredAt.getMonth() + 1).padStart(2, "0"),
        String(measuredAt.getDate()).padStart(2, "0"),
      ].join("-"),
      time: [
        String(measuredAt.getHours()).padStart(2, "0"),
        String(measuredAt.getMinutes()).padStart(2, "0"),
      ].join(":"),
      shift: record.shift,
      bloodPressure:
        record.systolicPressure == null
          ? ""
          : `${record.systolicPressure}/${record.diastolicPressure}`,
      heartRate: record.heartRate ?? "",
      oxygenSaturation: record.oxygenSaturation ?? "",
      temperature: record.temperature ?? "",
      bloodGlucose: record.bloodGlucose ?? "",
      notes: record.notes ?? "",
      authorProfileName: record.authorProfileName ?? "",
      authorProfileId: record.authorProfileId ?? null,
    };
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...AuthContext.authHeader(), ...options.headers },
    });

    if (response.status === 401) { AuthContext.logout(); throw new Error("Sessão expirada"); }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const detail = body.details ? Object.values(body.details)[0] : null;
      throw new Error(detail || body.error || "Não foi possível acessar a API");
    }

    if (response.status === 204) return null;
    return response.json();
  }

  async function getAll(patientId) {
    const body = await request(`${API_URL}?patientId=${encodeURIComponent(patientId)}`);
    return body.data.map(toLocalRecord);
  }

  async function create(record) {
    const body = await request(API_URL, {
      method: "POST",
      body: JSON.stringify(record),
    });
    return toLocalRecord(body.data);
  }

  async function update(id, record) {
    const body = await request(`${API_URL}/${id}`, {
      method: "PUT",
      body: JSON.stringify(record),
    });
    return toLocalRecord(body.data);
  }

  async function remove(id) {
    await request(`${API_URL}/${id}`, { method: "DELETE" });
  }

  return Object.freeze({ create, getAll, remove, update });
})();
