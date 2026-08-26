const currentDateElement = document.querySelector("#current-date");
const vitalsForm = document.querySelector("#vitals-form");
const dateInput = document.querySelector("#date");
const timeInput = document.querySelector("#time");
const shiftInput = document.querySelector("#shift");
const formMessage = document.querySelector("#form-message");
const submitButton = document.querySelector("#submit-button");

const tabButtons = document.querySelectorAll("[data-tab]");
const tabNovo = document.querySelector("#tab-novo");
const tabHistorico = document.querySelector("#tab-historico");

const editForm = document.querySelector("#edit-form");
const editTimeInput = document.querySelector("#edit-time");
const editShiftInput = document.querySelector("#edit-shift");
const editPanel = document.querySelector("#edit-panel");
const editFormMessage = document.querySelector("#edit-form-message");
const editSubmitButton = document.querySelector("#edit-submit-button");
const cancelEditButton = document.querySelector("#cancel-edit-button");
const historyBody = document.querySelector("#vitals-history");
const historyTableWrapper = document.querySelector("#history-table-wrapper");
const emptyHistory = document.querySelector("#empty-history");
const recordsCount = document.querySelector("#records-count");
const filtersForm = document.querySelector("#history-filters");
const clearFiltersButton = document.querySelector("#clear-filters-button");
const printButton = document.querySelector("#print-button");

let patientId = null;
let editingRecordId = null;
let records = [];

function showTab(name) {
  tabNovo.hidden = name !== "novo";
  tabHistorico.hidden = name !== "historico";
  tabButtons.forEach((btn) => btn.classList.toggle("tab-button--active", btn.dataset.tab === name));
}

tabButtons.forEach((btn) => btn.addEventListener("click", () => showTab(btn.dataset.tab)));

function selectShiftFromHour(hour) {
  if (hour >= 6 && hour < 12) return "Manhã";
  if (hour >= 12 && hour < 18) return "Tarde";
  if (hour >= 18) return "Noite";
  return "Madrugada";
}

function fillCurrentDateTime() {
  const now = new Date();
  dateInput.value = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  timeInput.value = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ].join(":");
  shiftInput.value = selectShiftFromHour(now.getHours());
}

function syncShiftWithTime(time, shift) {
  const hour = Number(time.value.split(":")[0]);
  if (Number.isInteger(hour)) shift.value = selectShiftFromHour(hour);
}

timeInput.addEventListener("input", () => syncShiftWithTime(timeInput, shiftInput));
editTimeInput.addEventListener("input", () => syncShiftWithTime(editTimeInput, editShiftInput));

vitalsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!patientId) {
    formMessage.textContent = "Cadastre um paciente em \"Paciente\" para começar.";
    return;
  }

  const record = { ...Object.fromEntries(new FormData(vitalsForm).entries()), patientId };
  submitButton.disabled = true;
  formMessage.textContent = "Salvando...";

  try {
    await VitalsRepository.create(record);
    vitalsForm.reset();
    fillCurrentDateTime();
    formMessage.textContent = "Sinais vitais registrados com sucesso.";
    records = await VitalsRepository.getAll(patientId);
    renderHistory();
  } catch (error) {
    formMessage.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

function formatDateTime(date, time) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(`${date}T${time}:00`));
}

function createCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value || "—";
  return cell;
}

function getFilteredRecords() {
  const filters = Object.fromEntries(new FormData(filtersForm).entries());
  return records
    .filter((record) => !filters.startDate || record.date >= filters.startDate)
    .filter((record) => !filters.endDate || record.date <= filters.endDate)
    .filter((record) => !filters.shift || record.shift === filters.shift)
    .sort((first, second) => `${second.date}T${second.time}`.localeCompare(`${first.date}T${first.time}`));
}

function createActionsCell(record) {
  const cell = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "table-actions";

  const isOwnRecord = record.authorProfileId == null || String(record.authorProfileId) === String(CaregiverContext.getCurrentId());
  if (isOwnRecord) {
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "table-action table-action--icon";
    editButton.dataset.action = "edit";
    editButton.dataset.id = record.id;
    editButton.innerHTML = icon("pencil");
    editButton.title = "Editar";
    editButton.setAttribute("aria-label", "Editar");
    actions.append(editButton);
  }

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "table-action table-action--icon table-action--danger";
  deleteButton.dataset.action = "delete";
  deleteButton.dataset.id = record.id;
  deleteButton.innerHTML = icon("trash");
  deleteButton.title = "Excluir";
  deleteButton.setAttribute("aria-label", "Excluir");

  actions.append(deleteButton);
  cell.append(actions);
  return cell;
}

function renderHistory() {
  const filteredRecords = getFilteredRecords();

  historyBody.replaceChildren();
  recordsCount.textContent = `${filteredRecords.length} de ${records.length} ${records.length === 1 ? "registro" : "registros"}`;
  emptyHistory.hidden = filteredRecords.length > 0;
  historyTableWrapper.hidden = filteredRecords.length === 0;

  filteredRecords.forEach((record) => {
    const row = document.createElement("tr");
    row.append(
      createCell(formatDateTime(record.date, record.time)),
      createCell(record.shift),
      createCell(record.bloodPressure),
      createCell(record.heartRate ? `${record.heartRate} bpm` : "—"),
      createCell(record.oxygenSaturation ? `${record.oxygenSaturation}%` : "—"),
      createCell(record.temperature ? `${record.temperature} °C` : "—"),
      createCell(record.bloodGlucose ? `${record.bloodGlucose} mg/dL` : "—"),
      createCell(record.notes),
      createCell(record.authorProfileName),
      createActionsCell(record),
    );
    historyBody.append(row);
  });
}

function startEditing(recordId) {
  const record = records.find((item) => item.id === recordId);
  if (!record) return;

  editingRecordId = recordId;
  Object.entries(record).forEach(([fieldName, value]) => {
    const field = editForm.elements.namedItem(fieldName);
    if (field) field.value = value;
  });

  editPanel.hidden = false;
  editFormMessage.textContent = "";
  editForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function finishEditing() {
  editingRecordId = null;
  editForm.reset();
  editPanel.hidden = true;
  editFormMessage.textContent = "";
}

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const record = Object.fromEntries(new FormData(editForm).entries());
  editSubmitButton.disabled = true;
  editFormMessage.textContent = "Salvando...";

  try {
    await VitalsRepository.update(editingRecordId, record);
    finishEditing();
    records = await VitalsRepository.getAll(patientId);
    renderHistory();
  } catch (error) {
    editFormMessage.textContent = error.message;
  } finally {
    editSubmitButton.disabled = false;
  }
});

cancelEditButton.addEventListener("click", () => finishEditing());
filtersForm.addEventListener("input", renderHistory);

clearFiltersButton.addEventListener("click", () => {
  filtersForm.reset();
  renderHistory();
});

printButton.addEventListener("click", () => {
  const filters = Object.fromEntries(new FormData(filtersForm).entries());
  const params = new URLSearchParams({ patientId: patientId || "" });
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.shift) params.set("shift", filters.shift);
  window.open(`historico-impressao.html?${params.toString()}`, "_blank");
});

historyBody.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;

  const { action, id } = actionButton.dataset;

  if (action === "edit") {
    startEditing(id);
    return;
  }

  if (action === "delete" && window.confirm("Deseja excluir este registro?")) {
    try {
      await VitalsRepository.remove(id);
      records = records.filter((record) => record.id !== id);
      if (editingRecordId === id) finishEditing();
      renderHistory();
    } catch (error) {
      editFormMessage.textContent = error.message;
    }
  }
});

async function loadHistory() {
  try {
    records = await VitalsRepository.getAll(patientId);
    renderHistory();
  } catch (error) {
    emptyHistory.textContent = "Não foi possível carregar o histórico. Verifique se a API está ativa.";
    emptyHistory.hidden = false;
    historyTableWrapper.hidden = true;
  }
}

currentDateElement.textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date());
fillCurrentDateTime();
showTab("novo");

PatientContext.ready().then((id) => {
  patientId = id;
  if (!patientId) {
    formMessage.textContent = "Cadastre um paciente em \"Paciente\" para começar.";
    submitButton.disabled = true;
    emptyHistory.textContent = "Cadastre um paciente em \"Paciente\" para começar.";
    emptyHistory.hidden = false;
    return;
  }
  loadHistory();
});

LiveUpdates.connect((event) => {
  if (event.resource === "vitals" && patientId) loadHistory();
});
