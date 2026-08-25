const form = document.querySelector("#event-form");
const eventFormPanel = document.querySelector("#event-form-panel");
const newEventButton = document.querySelector("#new-event-button");
const message = document.querySelector("#form-message");
const submitButton = document.querySelector("#submit-button");
const cancelButton = document.querySelector("#cancel-button");
const monthLabel = document.querySelector("#calendar-month-label");
const calendarGrid = document.querySelector("#calendar-grid");
const prevMonthButton = document.querySelector("#prev-month-button");
const nextMonthButton = document.querySelector("#next-month-button");
const dailyDateLabel = document.querySelector("#daily-date-label");
const dailyBody = document.querySelector("#daily-body");
const dailyWrapper = document.querySelector("#daily-wrapper");
const emptyDaily = document.querySelector("#empty-daily");
const repeatWeekly = document.querySelector("#repeat-weekly");
const recurrenceFields = document.querySelector("#recurrence-fields");
const repeatUntil = document.querySelector("#repeat-until");
const eventImportant = document.querySelector("#event-important");

const WEEKDAY_ORDER = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const STATUS_LABELS = { pending: "Pendente", completed: "Concluído", skipped: "Não realizado" };

let events = [];
let editingId = null;
let patientId = null;
let viewYear;
let viewMonth;
let selectedDate;

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function pad(value) { return String(value).padStart(2, "0"); }
function dateKey(year, month, day) { return `${year}-${pad(month + 1)}-${pad(day)}`; }

function formData() {
  const data = Object.fromEntries(new FormData(form).entries());
  data.repeatWeekly = repeatWeekly.checked;
  data.repeatWeekdays = [...form.querySelectorAll('[name="repeatWeekdays"]:checked')].map((input) => Number(input.value));
  data.important = eventImportant.checked;
  return { ...data, patientId };
}

function updateRecurrenceFields() {
  recurrenceFields.hidden = !repeatWeekly.checked;
  repeatUntil.required = repeatWeekly.checked;
}

function cell(value) { const element = document.createElement("td"); element.textContent = value || "—"; return element; }
function button(label, action, id, className = "table-action", title = "") {
  const element = document.createElement("button"); element.type = "button"; element.innerHTML = label;
  element.className = className; element.dataset.action = action; element.dataset.id = id;
  if (title) { element.title = title; element.setAttribute("aria-label", title); }
  return element;
}

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }

function renderCalendar() {
  monthLabel.textContent = `${MONTH_NAMES[viewMonth]} ${viewYear}`;
  calendarGrid.replaceChildren();

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const totalDays = daysInMonth(viewYear, viewMonth);
  const today = localDate();

  for (let i = 0; i < firstWeekday; i += 1) {
    const filler = document.createElement("div");
    filler.className = "calendar__day calendar__day--muted";
    calendarGrid.append(filler);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const key = dateKey(viewYear, viewMonth, day);
    const dayButton = document.createElement("button");
    dayButton.type = "button";
    dayButton.className = "calendar__day";
    if (key === today) dayButton.classList.add("calendar__day--today");
    if (key === selectedDate) dayButton.classList.add("calendar__day--selected");
    dayButton.dataset.date = key;

    const number = document.createElement("span");
    number.className = "calendar__day-number";
    number.textContent = String(day);
    dayButton.append(number);

    const dayEvents = events.filter((item) => item.eventDate === key);
    if (dayEvents.length) {
      const dot = document.createElement("span");
      dot.className = "calendar__day-dot";
      dot.textContent = String(dayEvents.length);
      dayButton.append(dot);
    }

    calendarGrid.append(dayButton);
  }
}

function renderDaily() {
  const dayEvents = events.filter((item) => item.eventDate === selectedDate)
    .sort((first, second) => first.eventTime.localeCompare(second.eventTime));

  dailyDateLabel.textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(`${selectedDate}T00:00:00`));
  dailyBody.replaceChildren();
  emptyDaily.hidden = dayEvents.length > 0;
  dailyWrapper.hidden = dayEvents.length === 0;

  dayEvents.forEach((item) => {
    const row = document.createElement("tr");
    const actions = document.createElement("td");
    actions.append(
      button(icon("check"), "completed", item.id, `table-action table-action--icon table-action--success${item.status === "completed" ? " table-action--done" : ""}`, "Concluir"),
      button(icon("x"), "skipped", item.id, `table-action table-action--icon table-action--danger${item.status === "skipped" ? " table-action--skipped" : ""}`, "Não realizado"),
      button(icon("pencil"), "edit", item.id, "table-action table-action--icon", "Editar"),
      button(icon("trash"), "delete", item.id, "table-action table-action--icon table-action--danger", "Excluir"),
    );
    row.append(cell(item.eventTime), cell(item.title), cell(item.category), cell(STATUS_LABELS[item.status]), cell(item.completedByProfileName), actions);
    dailyBody.append(row);
  });
}

async function loadMonth() {
  const start = dateKey(viewYear, viewMonth, 1);
  const end = dateKey(viewYear, viewMonth, daysInMonth(viewYear, viewMonth));
  events = await EventsRepository.getAll(patientId, start, end);
  renderCalendar();
  renderDaily();
}

function showForm() { eventFormPanel.hidden = false; eventFormPanel.scrollIntoView({ behavior: "smooth", block: "start" }); }
function hideForm() { eventFormPanel.hidden = true; }

function finishEditing(text = "") {
  editingId = null; form.reset(); form.elements.eventDate.value = selectedDate;
  repeatWeekly.disabled = false;
  eventImportant.checked = true;
  updateRecurrenceFields();
  submitButton.textContent = "Cadastrar evento"; message.textContent = text;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault(); submitButton.disabled = true; message.textContent = "Salvando...";
  try {
    const wasEditing = Boolean(editingId);
    let result;
    if (wasEditing) await EventsRepository.update(editingId, formData()); else result = await EventsRepository.create(formData());
    const count = result?.data?.count;
    finishEditing(wasEditing ? "Evento atualizado." : count ? `${count} eventos cadastrados.` : "Evento cadastrado.");
    hideForm();
    await loadMonth();
  } catch (error) { message.textContent = error.message; } finally { submitButton.disabled = false; }
});

cancelButton.addEventListener("click", () => { finishEditing(); hideForm(); });
repeatWeekly.addEventListener("change", updateRecurrenceFields);

newEventButton.addEventListener("click", () => {
  finishEditing();
  form.elements.eventDate.value = selectedDate;
  showForm();
});

calendarGrid.addEventListener("click", (event) => {
  const target = event.target.closest("[data-date]");
  if (!target) return;
  selectedDate = target.dataset.date;
  form.elements.eventDate.value = selectedDate;
  renderCalendar();
  renderDaily();
});

dailyBody.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]"); if (!target) return;
  const item = events.find((entry) => String(entry.id) === target.dataset.id);
  if (target.dataset.action === "edit" && item) {
    editingId = String(item.id);
    form.elements.title.value = item.title;
    form.elements.category.value = item.category || "";
    form.elements.eventDate.value = item.eventDate;
    form.elements.eventTime.value = item.eventTime;
    form.elements.notes.value = item.notes || "";
    eventImportant.checked = item.important !== false;
    repeatWeekly.checked = false;
    repeatWeekly.disabled = true;
    updateRecurrenceFields();
    submitButton.textContent = "Salvar alterações";
    showForm();
    return;
  }
  if (target.dataset.action === "delete") {
    if (!window.confirm("Excluir este evento?")) return;
    try { await EventsRepository.remove(target.dataset.id); await loadMonth(); }
    catch (error) { message.textContent = error.message; }
    return;
  }
  if (target.dataset.action === "completed" || target.dataset.action === "skipped") {
    try { await EventsRepository.setStatus(target.dataset.id, target.dataset.action); await loadMonth(); }
    catch (error) { message.textContent = error.message; }
  }
});

prevMonthButton.addEventListener("click", () => {
  viewMonth -= 1;
  if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
  loadMonth().catch((error) => { message.textContent = error.message; });
});

nextMonthButton.addEventListener("click", () => {
  viewMonth += 1;
  if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
  loadMonth().catch((error) => { message.textContent = error.message; });
});

document.querySelector("#current-date").textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date());

const now = new Date();
viewYear = now.getFullYear();
viewMonth = now.getMonth();
selectedDate = localDate(now);
form.elements.eventDate.value = selectedDate;

PatientContext.ready().then((id) => {
  patientId = id;
  if (!patientId) {
    message.textContent = "Cadastre um paciente em \"Paciente\" para começar.";
    submitButton.disabled = true;
    return;
  }
  loadMonth().catch((error) => { message.textContent = `${error.message}. Verifique se a API está ativa.`; });
});

LiveUpdates.connect((event) => {
  if (event.resource === "events" && patientId) loadMonth();
});
