const PatientContext = (() => {
  const STORAGE_KEY = "loreroutine:patientId";
  const API_URL = `${API_BASE_URL}/api/patients`;

  function getCurrentId() {
    return localStorage.getItem(STORAGE_KEY) || null;
  }

  function setCurrentId(id) {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  }

  function renderSwitcher(patients) {
    const select = document.querySelector("#patient-switcher");
    if (!select) return;
    select.replaceChildren();
    if (!patients.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Nenhum paciente cadastrado";
      select.append(option);
      select.disabled = true;
      return;
    }
    select.disabled = false;
    patients.forEach((patient) => {
      const option = document.createElement("option");
      option.value = patient.id;
      option.textContent = patient.fullName;
      select.append(option);
    });
    select.value = getCurrentId() || "";
    select.addEventListener("change", () => {
      setCurrentId(select.value);
      location.reload();
    });
  }

  async function init() {
    let patients;
    try {
      const response = await fetch(API_URL, { headers: { ...AuthContext.authHeader() } });
      if (response.status === 401) {
        AuthContext.logout();
        return getCurrentId();
      }
      if (!response.ok) throw new Error("Falha ao carregar pacientes");
      const body = await response.json();
      patients = body.data ?? [];
    } catch (error) {
      // A API pode estar temporariamente indisponível (ex.: reiniciando).
      // Nesse caso mantemos a última seleção salva em vez de apagá-la.
      return getCurrentId();
    }
    const currentId = getCurrentId();
    const stillExists = patients.some((patient) => String(patient.id) === currentId);
    if (!stillExists) setCurrentId(patients.length ? String(patients[0].id) : null);
    renderSwitcher(patients);
    return getCurrentId();
  }

  const readyPromise = init();

  return Object.freeze({
    getCurrentId,
    setCurrentId,
    ready: () => readyPromise,
  });
})();
