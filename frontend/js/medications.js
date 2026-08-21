const form = document.querySelector("#medication-form");
const message = document.querySelector("#form-message");
const submitButton = document.querySelector("#submit-button");
const cancelButton = document.querySelector("#cancel-button");
const activeField = document.querySelector("#active-field");
const frequencySelect = document.querySelector("#frequency");
const firstDoseField = document.querySelector("#first-dose-field");
const firstDoseTime = document.querySelector("#first-dose-time");
const timesInput = document.querySelector("#times");
const timesHint = document.querySelector("#times-hint");
const dailyDate = document.querySelector("#daily-date");
const dailyBody = document.querySelector("#daily-body");
const dailyWrapper = document.querySelector("#daily-wrapper");
const emptyDaily = document.querySelector("#empty-daily");
const treatmentsBody = document.querySelector("#treatments-body");
const treatmentsWrapper = document.querySelector("#treatments-wrapper");
const emptyTreatments = document.querySelector("#empty-treatments");
const treatmentsCount = document.querySelector("#treatments-count");
const tabButtons = document.querySelectorAll("[data-tab]");
const tabMedicamento = document.querySelector("#tab-medicamento");
const tabAcompanhamento = document.querySelector("#tab-acompanhamento");
const tabConfiguracao = document.querySelector("#tab-configuracao");
let treatments = [];
let editingId = null;
let patientId = null;

function showTab(name) {
  tabMedicamento.hidden = name !== "medicamento";
  tabAcompanhamento.hidden = name !== "acompanhamento";
  tabConfiguracao.hidden = name !== "configuracao";
  tabButtons.forEach((btn) => btn.classList.toggle("tab-button--active", btn.dataset.tab === name));
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function pad(value) { return String(value).padStart(2, "0"); }

function computeSchedule(startTime, intervalHours) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const doseCount = 24 / intervalHours;
  const times = [];
  for (let i = 0; i < doseCount; i += 1) {
    const totalMinutes = (hours * 60 + minutes + i * intervalHours * 60) % (24 * 60);
    times.push(`${pad(Math.floor(totalMinutes / 60))}:${pad(totalMinutes % 60)}`);
  }
  return times.sort();
}

function updateComputedTimes() {
  const frequency = frequencySelect.value;
  if (frequency === "custom") {
    firstDoseField.hidden = true;
    timesInput.readOnly = false;
    timesHint.textContent = "Separe vários horários por vírgula.";
    return;
  }
  firstDoseField.hidden = false;
  timesInput.readOnly = true;
  if (!firstDoseTime.value) {
    timesInput.value = "";
    timesHint.textContent = "Informe o primeiro horário para calcular os demais automaticamente.";
    return;
  }
  const computed = computeSchedule(firstDoseTime.value, Number(frequency));
  timesInput.value = computed.join(", ");
  timesHint.textContent = `Calculado automaticamente: ${computed.join(", ")}.`;
}

frequencySelect.addEventListener("change", updateComputedTimes);
firstDoseTime.addEventListener("input", updateComputedTimes);

function formData() {
  const { frequency, ...data } = Object.fromEntries(new FormData(form).entries());
  return { ...data, times: data.times.split(",").map((time) => time.trim()).filter(Boolean), patientId, isActive: form.elements.isActive.checked, isFixed: form.elements.isFixed.checked };
}

function cell(value) { const element = document.createElement("td"); element.textContent = value || "—"; return element; }
function button(label, action, id, className = "table-action", title = "") {
  const element = document.createElement("button"); element.type = "button"; element.innerHTML = label;
  element.className = className; element.dataset.action = action; element.dataset.id = id;
  if (title) { element.title = title; element.setAttribute("aria-label", title); }
  return element;
}

function renderTreatments() {
  treatmentsBody.replaceChildren();
  treatmentsCount.textContent = `${treatments.length} ${treatments.length === 1 ? "tratamento" : "tratamentos"}`;
  emptyTreatments.hidden = treatments.length > 0; treatmentsWrapper.hidden = treatments.length === 0;
  treatments.forEach((item) => {
    const row = document.createElement("tr");
    const actions = document.createElement("td"); actions.append(button(icon("pencil"), "edit", item.id, "table-action table-action--icon", "Editar"), button(icon("trash"), "delete", item.id, "table-action table-action--icon table-action--danger", "Excluir"));
    const fixedCell = document.createElement("td");
    fixedCell.innerHTML = item.isFixed ? `${icon("pin")}Fixo` : "Temporário";
    row.append(cell(item.name), cell(item.dosage), cell(item.schedules.map((s) => s.time).join(", ")), cell(`${item.startDate}${item.endDate ? ` a ${item.endDate}` : " em diante"}`), fixedCell, cell(item.isActive ? "Ativo" : "Inativo"), actions);
    treatmentsBody.append(row);
  });
}

async function loadTreatments() { treatments = await MedicationsRepository.getAll(patientId); renderTreatments(); }

async function loadDaily() {
  const doses = await MedicationsRepository.getDaily(dailyDate.value, patientId);
  dailyBody.replaceChildren(); emptyDaily.hidden = doses.length > 0; dailyWrapper.hidden = doses.length === 0;
  const labels = { pending: "Pendente", taken: "Administrado", skipped: "Ignorado" };
  doses.forEach((dose) => {
    const row = document.createElement("tr"); const actions = document.createElement("td");
    const lockedByOther = dose.status !== "pending"
      && dose.authorProfileId != null
      && String(dose.authorProfileId) !== String(CaregiverContext.getCurrentId());
    [
      { iconName: "check", action: "taken", title: "Administrado", baseClass: "table-action--success", doneClass: "table-action--done" },
      { iconName: "x", action: "skipped", title: "Ignorado", baseClass: "table-action--danger", doneClass: "table-action--skipped" },
    ].forEach(({ iconName, action, title, baseClass, doneClass }) => {
      const doseTitle = lockedByOther ? `Já registrado por ${dose.authorProfileName}` : title;
      const doseButton = button(icon(iconName), action, dose.scheduleId, `table-action table-action--icon ${baseClass}${dose.status === action ? ` ${doneClass}` : ""}`, doseTitle);
      doseButton.disabled = lockedByOther;
      actions.append(doseButton);
    });
    actions.dataset.medicationId = dose.medicationId;
    row.append(cell(dose.time), cell(dose.name), cell(dose.dosage), cell(labels[dose.status]), cell(dose.authorProfileName), actions); dailyBody.append(row);
  });
}

function finishEditing(text = "") {
  editingId = null; form.reset(); form.elements.startDate.value = localDate(); form.elements.isActive.checked = true;
  form.elements.isFixed.checked = false;
  frequencySelect.value = "custom"; firstDoseTime.value = ""; updateComputedTimes();
  activeField.hidden = true; cancelButton.hidden = true; submitButton.textContent = "Cadastrar tratamento"; message.textContent = text;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault(); submitButton.disabled = true; message.textContent = "Salvando...";
  try {
    if (editingId) await MedicationsRepository.update(editingId, formData()); else await MedicationsRepository.create(formData());
    finishEditing(editingId ? "Tratamento atualizado." : "Tratamento cadastrado.");
    await Promise.all([loadTreatments(), loadDaily()]);
    showTab("configuracao");
  } catch (error) { message.textContent = error.message; } finally { submitButton.disabled = false; }
});

treatmentsBody.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]"); if (!target) return;
  const item = treatments.find((entry) => String(entry.id) === target.dataset.id);
  if (target.dataset.action === "edit" && item) {
    editingId = String(item.id); form.elements.name.value = item.name; form.elements.dosage.value = item.dosage;
    frequencySelect.value = "custom"; firstDoseTime.value = ""; updateComputedTimes();
    form.elements.times.value = item.schedules.map((s) => s.time).join(", "); form.elements.startDate.value = item.startDate;
    form.elements.endDate.value = item.endDate || ""; form.elements.instructions.value = item.instructions || "";
    form.elements.isActive.checked = item.isActive; form.elements.isFixed.checked = Boolean(item.isFixed);
    activeField.hidden = false; cancelButton.hidden = false;
    submitButton.textContent = "Salvar alterações";
    showTab("medicamento");
  }
  if (target.dataset.action === "delete" && window.confirm("Excluir este tratamento e seu histórico?")) {
    try { await MedicationsRepository.remove(target.dataset.id); await Promise.all([loadTreatments(), loadDaily()]); }
    catch (error) { message.textContent = error.message; }
  }
});

dailyBody.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]"); if (!target) return;
  const medicationId = target.closest("td").dataset.medicationId;
  try {
    await MedicationsRepository.setAdministration(medicationId, target.dataset.id, { date: dailyDate.value, status: target.dataset.action });
    await loadDaily();
  } catch (error) {
    message.textContent = error.message;
    await loadDaily();
  }
});

cancelButton.addEventListener("click", () => { finishEditing(); showTab("configuracao"); });
dailyDate.addEventListener("change", () => loadDaily().catch((error) => { message.textContent = error.message; }));
tabButtons.forEach((btn) => btn.addEventListener("click", () => showTab(btn.dataset.tab)));
document.querySelector("#current-date").textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date());
dailyDate.value = localDate(); form.elements.startDate.value = localDate();
updateComputedTimes();
showTab("medicamento");

PatientContext.ready().then((id) => {
  patientId = id;
  if (!patientId) {
    message.textContent = "Cadastre um paciente em \"Paciente\" para começar.";
    submitButton.disabled = true;
    return;
  }
  Promise.all([loadTreatments(), loadDaily()]).catch((error) => { message.textContent = `${error.message}. Verifique se a API está ativa.`; });
});

LiveUpdates.connect((event) => {
  if (event.resource === "medications" && patientId) Promise.all([loadTreatments(), loadDaily()]);
});
