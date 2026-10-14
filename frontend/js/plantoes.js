const monthSelect = document.querySelector("#month-select");
const yearSelect = document.querySelector("#year-select");
const monthLabel = document.querySelector("#month-label");
const monthMessage = document.querySelector("#month-message");
const generatePanel = document.querySelector("#generate-panel");
const summaryPanel = document.querySelector("#summary-panel");
const shiftsPanel = document.querySelector("#shifts-panel");
const printScheduleButton = document.querySelector("#print-schedule-button");
const generateForm = document.querySelector("#generate-form");
const generateMessage = document.querySelector("#generate-message");
const durationSelect = document.querySelector("#duration-select");
const secondStartField = document.querySelector("#second-start-field");
const caregiverChecklist = document.querySelector("#caregiver-checklist");
const reorderList = document.querySelector("#reorder-list");
const summaryDuration = document.querySelector("#summary-duration");
const summaryStartTime = document.querySelector("#summary-start-time");
const summaryCaregivers = document.querySelector("#summary-caregivers");
const summaryMessage = document.querySelector("#summary-message");
const deleteMonthButton = document.querySelector("#delete-month-button");
const calendarGrid = document.querySelector("#shifts-calendar-grid");
const swapPendingMessage = document.querySelector("#swap-pending-message");
const dayModalOverlay = document.querySelector("#day-modal-overlay");
const dayModalTitle = document.querySelector("#day-modal-title");
const dayModalMessage = document.querySelector("#day-modal-message");
const dayModalBody = document.querySelector("#day-modal-body");
const closeDayModalButton = document.querySelector("#close-day-modal-button");
const tabButtons = document.querySelectorAll(".tab-button");
const tabEscala = document.querySelector("#tab-escala");
const tabPagamentos = document.querySelector("#tab-pagamentos");
const paymentsLabel = document.querySelector("#payments-label");
const paymentsMessage = document.querySelector("#payments-message");
const paymentsEmpty = document.querySelector("#payments-empty");
const earningsSummary = document.querySelector("#earnings-summary");
const earningsShiftCount = document.querySelector("#earnings-shift-count");
const earningsRate = document.querySelector("#earnings-rate");
const earningsTotal = document.querySelector("#earnings-total");
const earningsNote = document.querySelector("#earnings-note");
const ratesToggleButton = document.querySelector("#rates-toggle-button");
const ratesForm = document.querySelector("#rates-form");
const ratesList = document.querySelector("#rates-list");
const ratesMessage = document.querySelector("#rates-message");
const ratesCancelButton = document.querySelector("#rates-cancel-button");

const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const shiftCountFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

let editingShiftId = null;
let splittingShiftId = null;
let pendingSwapId = null;
let selectedDate = null;

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const WEEKDAY_ORDER = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const STATUS_BADGE_CLASS = {
  "Programado": "status-badge--scheduled",
  "Em andamento": "status-badge--in-progress",
  "Concluído": "status-badge--done",
  "Não realizado": "status-badge--missed",
};

function periodFromHour(hour) {
  if (hour >= 6 && hour < 12) return "Manhã";
  if (hour >= 12 && hour < 18) return "Tarde";
  if (hour >= 18) return "Noite";
  return "Madrugada";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function timeAfter12Hours(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return `${pad2((hours + 12) % 24)}:${pad2(minutes)}`;
}

function dateKey(year, monthIndex0, day) {
  return `${year}-${pad2(monthIndex0 + 1)}-${pad2(day)}`;
}

function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function formatDateLabel(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

function shiftDurationHours(shift) {
  const start = new Date(`${shift.scheduledDate}T${shift.scheduledStartTime}:00`);
  const end = new Date(`${shift.scheduledEndDate}T${shift.scheduledEndTime}:00`);
  return (end - start) / 3600000;
}

function calendarEventsForDate(key) {
  return calendarShifts.flatMap((shift) => {
    const events = [];
    if (shift.scheduledEndDate === key) {
      events.push({ type: "exit", time: shift.scheduledEndTime, shift });
    }
    if (shift.scheduledDate === key) {
      events.push({ type: "enter", time: shift.scheduledStartTime, shift });
    }
    return events;
  }).sort((eventA, eventB) => (
    eventA.time.localeCompare(eventB.time)
      || (eventA.type === eventB.type ? 0 : (eventA.type === "exit" ? -1 : 1))
      || eventA.shift.profileName.localeCompare(eventB.shift.profileName, "pt-BR")
  ));
}

let allCaregivers = [];
let orderedCaregiverIds = [];
let generateRates = {};
let currentScheduleMonth = null;
let currentShifts = [];
let calendarShifts = [];

function populateMonthYearSelects() {
  MONTH_NAMES.forEach((name, index) => monthSelect.add(new Option(name, String(index + 1))));
  const currentYear = new Date().getFullYear();
  for (let year = currentYear - 1; year <= currentYear + 2; year += 1) {
    yearSelect.add(new Option(String(year), String(year)));
  }
  const now = new Date();
  monthSelect.value = String(now.getMonth() + 1);
  yearSelect.value = String(now.getFullYear());
}

function renderReorderList() {
  reorderList.replaceChildren();
  orderedCaregiverIds.forEach((profileId, index) => {
    const caregiver = allCaregivers.find((item) => String(item.id) === String(profileId));
    if (!caregiver) return;
    const item = document.createElement("li");
    item.className = "reorder-list__item";
    item.draggable = true;
    item.dataset.profileId = String(profileId);

    const position = document.createElement("span");
    position.className = "reorder-list__position";
    position.textContent = String(index + 1);

    const name = document.createElement("span");
    name.className = "reorder-list__name";
    name.textContent = caregiver.name;

    const buttons = document.createElement("span");
    buttons.className = "reorder-list__buttons";
    const upButton = document.createElement("button");
    upButton.type = "button";
    upButton.className = "table-action table-action--icon";
    upButton.innerHTML = "↑";
    upButton.title = "Mover para cima";
    upButton.disabled = index === 0;
    upButton.addEventListener("click", () => moveCaregiver(index, index - 1));
    const downButton = document.createElement("button");
    downButton.type = "button";
    downButton.className = "table-action table-action--icon";
    downButton.innerHTML = "↓";
    downButton.title = "Mover para baixo";
    downButton.disabled = index === orderedCaregiverIds.length - 1;
    downButton.addEventListener("click", () => moveCaregiver(index, index + 1));
    buttons.append(upButton, downButton);

    const rateInput = document.createElement("input");
    rateInput.type = "number";
    rateInput.min = "0";
    rateInput.step = "0.01";
    rateInput.inputMode = "decimal";
    rateInput.placeholder = "Valor do plantão (R$)";
    rateInput.className = "reorder-list__rate";
    rateInput.setAttribute("aria-label", `Valor do plantão de ${caregiver.name}`);
    rateInput.value = generateRates[profileId] ?? "";
    rateInput.addEventListener("input", () => { generateRates[profileId] = rateInput.value; });

    item.append(position, name, rateInput, buttons);
    reorderList.append(item);
  });
}

function moveCaregiver(from, to) {
  const [moved] = orderedCaregiverIds.splice(from, 1);
  orderedCaregiverIds.splice(to, 0, moved);
  renderReorderList();
}

reorderList.addEventListener("dragstart", (event) => {
  const item = event.target.closest(".reorder-list__item");
  if (item) event.dataTransfer.setData("text/plain", item.dataset.profileId);
});
reorderList.addEventListener("dragover", (event) => event.preventDefault());
reorderList.addEventListener("drop", (event) => {
  event.preventDefault();
  const draggedId = event.dataTransfer.getData("text/plain");
  const targetItem = event.target.closest(".reorder-list__item");
  if (!targetItem || targetItem.dataset.profileId === draggedId) return;
  const from = orderedCaregiverIds.findIndex((id) => String(id) === draggedId);
  const to = orderedCaregiverIds.findIndex((id) => String(id) === targetItem.dataset.profileId);
  if (from === -1 || to === -1) return;
  moveCaregiver(from, to);
});

function renderCalendar() {
  calendarGrid.replaceChildren();
  const year = Number(yearSelect.value);
  const monthIndex0 = Number(monthSelect.value) - 1;
  const firstWeekday = new Date(year, monthIndex0, 1).getDay();
  const totalDays = daysInMonth(year, monthIndex0);
  const today = dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  for (let i = 0; i < firstWeekday; i += 1) {
    const filler = document.createElement("div");
    filler.className = "calendar__day calendar__day--muted";
    calendarGrid.append(filler);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const key = dateKey(year, monthIndex0, day);
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

    const dayEvents = calendarEventsForDate(key);
    if (dayEvents.length) {
      const events = document.createElement("div");
      events.className = "calendar__shift-events";
      dayEvents.forEach((event) => {
        const row = document.createElement("span");
        row.className = `calendar__shift-event calendar__shift-event--${event.type}`;
        row.style.setProperty("--caregiver-color", event.shift.profileColor || "#64748b");

        const time = document.createElement("span");
        time.className = "calendar__shift-event-time";
        time.textContent = event.time;

        const arrow = document.createElement("span");
        arrow.className = "calendar__shift-event-arrow";
        arrow.textContent = "→";
        arrow.setAttribute("aria-hidden", "true");

        const name = document.createElement("span");
        name.className = "calendar__shift-event-name";
        name.textContent = event.shift.profileName;

        const action = event.type === "enter" ? "Entra" : "Sai";
        row.setAttribute("aria-label", `${action}: ${event.shift.profileName}, às ${event.time}`);
        row.append(time, arrow, name);
        events.append(row);
      });
      dayButton.append(events);
    }

    dayButton.addEventListener("click", () => openDayModal(key));
    calendarGrid.append(dayButton);
  }
}

function swapButtonLabel(shift) {
  if (pendingSwapId === shift.id) return "Cancelar troca";
  if (pendingSwapId) return "Trocar com este";
  return "Trocar";
}

function shiftCard(shift) {
  const card = document.createElement("div");
  card.className = "day-shift-card";

  const header = document.createElement("div");
  header.className = "day-shift-card__header";
  const dot = document.createElement("span");
  dot.className = "day-shift-card__dot";
  dot.style.background = shift.profileColor || "#64748b";
  const name = document.createElement("span");
  name.className = "day-shift-card__name";
  name.textContent = shift.profileName;
  const badge = document.createElement("span");
  badge.className = `status-badge ${STATUS_BADGE_CLASS[shift.status] || ""}`;
  badge.textContent = shift.status;
  header.append(dot, name, badge);

  const time = document.createElement("p");
  time.className = "day-shift-card__time";
  const durationHours = shiftDurationHours(shift);
  time.textContent = `${shift.scheduledStartTime} – ${shift.scheduledEndTime} · ${durationHours}h · ${periodFromHour(Number(shift.scheduledStartTime.slice(0, 2)))}`;

  const actions = document.createElement("div");
  actions.className = "day-shift-card__actions";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "table-action";
  editButton.textContent = "Editar";
  editButton.addEventListener("click", () => {
    splittingShiftId = null;
    editingShiftId = editingShiftId === shift.id ? null : shift.id;
    renderDayModal();
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "table-action table-action--danger";
  deleteButton.textContent = "Excluir";
  deleteButton.addEventListener("click", () => deleteShiftRow(shift));

  const swapButton = document.createElement("button");
  swapButton.type = "button";
  swapButton.className = "table-action";
  swapButton.textContent = swapButtonLabel(shift);
  swapButton.addEventListener("click", () => handleSwapClick(shift));

  actions.append(editButton, deleteButton, swapButton);

  if (durationHours === 24 && !shift.workShiftId) {
    const splitButton = document.createElement("button");
    splitButton.type = "button";
    splitButton.className = "table-action";
    splitButton.textContent = "Dividir em 12h + 12h";
    splitButton.addEventListener("click", () => {
      editingShiftId = null;
      splittingShiftId = splittingShiftId === shift.id ? null : shift.id;
      renderDayModal();
    });
    actions.append(splitButton);
  }

  card.append(header, time, actions);

  if (editingShiftId === shift.id) card.append(editShiftForm(shift));
  if (splittingShiftId === shift.id) card.append(splitShiftForm(shift));

  return card;
}

function editShiftForm(shift) {
  const wrapper = document.createElement("form");
  wrapper.className = "day-shift-card__inline-form";

  const grid = document.createElement("div");
  grid.className = "form-grid";

  const profileField = document.createElement("div");
  profileField.className = "form-field form-field--full";
  const profileLabel = document.createElement("label");
  profileLabel.textContent = "Cuidador";
  const profileSelect = document.createElement("select");
  profileSelect.name = "profileId";
  profileSelect.required = true;
  allCaregivers.forEach((caregiver) => profileSelect.add(new Option(caregiver.name, caregiver.id)));
  profileSelect.value = shift.profileId;
  profileField.append(profileLabel, profileSelect);

  const dateField = document.createElement("div");
  dateField.className = "form-field day-shift-card__schedule-field";
  const dateLabel = document.createElement("label");
  dateLabel.textContent = "Data";
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.name = "scheduledDate";
  dateInput.required = true;
  dateInput.value = shift.scheduledDate;
  dateField.append(dateLabel, dateInput);

  const startField = document.createElement("div");
  startField.className = "form-field day-shift-card__schedule-field";
  const startLabel = document.createElement("label");
  startLabel.textContent = "Início";
  const startInput = document.createElement("input");
  startInput.type = "time";
  startInput.name = "scheduledStartTime";
  startInput.required = true;
  startInput.value = shift.scheduledStartTime;
  startField.append(startLabel, startInput);

  const endDateField = document.createElement("div");
  endDateField.className = "form-field day-shift-card__schedule-field";
  const endDateLabel = document.createElement("label");
  endDateLabel.textContent = "Data de término";
  const endDateInput = document.createElement("input");
  endDateInput.type = "date";
  endDateInput.name = "scheduledEndDate";
  endDateInput.required = true;
  endDateInput.value = shift.scheduledEndDate;
  endDateField.append(endDateLabel, endDateInput);

  const endField = document.createElement("div");
  endField.className = "form-field day-shift-card__schedule-field";
  const endLabel = document.createElement("label");
  endLabel.textContent = "Término";
  const endInput = document.createElement("input");
  endInput.type = "time";
  endInput.name = "scheduledEndTime";
  endInput.required = true;
  endInput.value = shift.scheduledEndTime;
  endField.append(endLabel, endInput);

  grid.append(profileField, dateField, startField, endDateField, endField);

  const actions = document.createElement("div");
  actions.className = "form-actions";
  const saveButton = document.createElement("button");
  saveButton.className = "primary-button";
  saveButton.type = "submit";
  saveButton.textContent = "Salvar alterações";
  const cancelButton = document.createElement("button");
  cancelButton.className = "secondary-button";
  cancelButton.type = "button";
  cancelButton.textContent = "Cancelar";
  cancelButton.addEventListener("click", () => { editingShiftId = null; renderDayModal(); });
  const message = document.createElement("p");
  message.className = "form-message";

  actions.append(saveButton, cancelButton, message);
  wrapper.append(grid, actions);

  wrapper.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Salvando...";
    try {
      const data = Object.fromEntries(new FormData(wrapper).entries());
      await ScheduleRepository.updateShift(shift.id, data);
      editingShiftId = null;
      await loadShifts();
    } catch (error) {
      message.textContent = error.message;
    }
  });

  return wrapper;
}

function splitShiftForm(shift) {
  const wrapper = document.createElement("form");
  wrapper.className = "day-shift-card__inline-form";

  const grid = document.createElement("div");
  grid.className = "form-grid";
  const field = document.createElement("div");
  field.className = "form-field form-field--full";
  const label = document.createElement("label");
  label.textContent = "Quem cobre as últimas 12h";
  const select = document.createElement("select");
  select.name = "coveringProfileId";
  select.required = true;
  allCaregivers.forEach((caregiver) => select.add(new Option(caregiver.name, caregiver.id)));
  field.append(label, select);
  grid.append(field);

  const actions = document.createElement("div");
  actions.className = "form-actions";
  const confirmButton = document.createElement("button");
  confirmButton.className = "primary-button";
  confirmButton.type = "submit";
  confirmButton.textContent = "Confirmar divisão";
  const cancelButton = document.createElement("button");
  cancelButton.className = "secondary-button";
  cancelButton.type = "button";
  cancelButton.textContent = "Cancelar";
  cancelButton.addEventListener("click", () => { splittingShiftId = null; renderDayModal(); });
  const message = document.createElement("p");
  message.className = "form-message";

  actions.append(confirmButton, cancelButton, message);
  wrapper.append(grid, actions);

  wrapper.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "Dividindo...";
    try {
      await ScheduleRepository.splitShift(shift.id, select.value);
      splittingShiftId = null;
      await loadShifts();
    } catch (error) {
      message.textContent = error.message;
    }
  });

  return wrapper;
}

function renderDayModal() {
  if (!selectedDate) return;
  const dayShifts = currentShifts.filter((shift) => shift.scheduledDate === selectedDate);
  dayModalTitle.textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(`${selectedDate}T00:00:00`));
  dayModalMessage.textContent = "";
  dayModalBody.replaceChildren();
  if (!dayShifts.length) {
    const empty = document.createElement("p");
    empty.className = "empty-history";
    empty.textContent = "Nenhum plantão programado neste dia.";
    dayModalBody.append(empty);
  } else {
    dayShifts.forEach((shift) => dayModalBody.append(shiftCard(shift)));
  }
  dayModalOverlay.hidden = false;
}

function openDayModal(key) {
  selectedDate = key;
  editingShiftId = null;
  splittingShiftId = null;
  renderCalendar();
  renderDayModal();
}

function closeDayModal() {
  dayModalOverlay.hidden = true;
  selectedDate = null;
  editingShiftId = null;
  splittingShiftId = null;
  renderCalendar();
}

closeDayModalButton.addEventListener("click", closeDayModal);
dayModalOverlay.addEventListener("click", (event) => {
  if (event.target === dayModalOverlay) closeDayModal();
});

async function deleteShiftRow(shift) {
  if (!window.confirm(`Excluir o plantão de ${shift.profileName} em ${formatDateLabel(shift.scheduledDate)}?`)) return;
  try {
    await ScheduleRepository.deleteShift(shift.id);
    await loadShifts();
  } catch (error) {
    dayModalMessage.textContent = error.message;
  }
}

function updateSwapPendingMessage() {
  swapPendingMessage.hidden = !pendingSwapId;
  if (!pendingSwapId) return;
  swapPendingMessage.replaceChildren();
  swapPendingMessage.append(document.createTextNode("Troca pendente — clique em outro plantão para concluir. "));
  const cancelLink = document.createElement("button");
  cancelLink.type = "button";
  cancelLink.className = "table-action";
  cancelLink.textContent = "Cancelar troca";
  cancelLink.addEventListener("click", async () => { pendingSwapId = null; await loadShifts(); });
  swapPendingMessage.append(cancelLink);
}

async function handleSwapClick(shift) {
  if (pendingSwapId === shift.id) {
    pendingSwapId = null;
    await loadShifts();
    return;
  }
  if (!pendingSwapId) {
    pendingSwapId = shift.id;
    await loadShifts();
    return;
  }
  const otherId = pendingSwapId;
  pendingSwapId = null;
  try {
    await ScheduleRepository.swapShifts(otherId, shift.id);
    await loadShifts();
  } catch (error) {
    dayModalMessage.textContent = error.message;
    await loadShifts();
  }
}

async function loadShifts() {
  const year = Number(yearSelect.value);
  const month = Number(monthSelect.value);
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousMonthYear = month === 1 ? year - 1 : year;
  const [shifts, previousMonthShifts] = await Promise.all([
    ScheduleRepository.listShifts(year, month),
    ScheduleRepository.listShifts(previousMonthYear, previousMonth),
  ]);
  currentShifts = shifts;
  const currentStarts = new Set(currentShifts.map(
    (shift) => `${shift.scheduledDate}T${shift.scheduledStartTime}`,
  ));
  calendarShifts = [
    ...previousMonthShifts.filter((shift) => (
      currentStarts.has(`${shift.scheduledEndDate}T${shift.scheduledEndTime}`)
    )),
    ...currentShifts,
  ];
  updateSwapPendingMessage();
  renderCalendar();
  renderDayModal();
}

function renderCaregiverChecklist() {
  caregiverChecklist.replaceChildren();
  allCaregivers.forEach((caregiver) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(caregiver.id);
    input.checked = orderedCaregiverIds.includes(String(caregiver.id));
    input.addEventListener("change", () => {
      if (input.checked) orderedCaregiverIds.push(String(caregiver.id));
      else orderedCaregiverIds = orderedCaregiverIds.filter((id) => id !== String(caregiver.id));
      renderReorderList();
    });
    label.append(input, document.createTextNode(` ${caregiver.name}`));
    caregiverChecklist.append(label);
  });
}

function toggleSecondStartField() {
  secondStartField.hidden = true;
  document.querySelector("#second-start-time").required = false;
}
durationSelect.addEventListener("change", toggleSecondStartField);

generateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (orderedCaregiverIds.length === 0) {
    generateMessage.textContent = "Selecione ao menos um cuidador";
    return;
  }
  generateMessage.textContent = "Gerando...";
  try {
    const formData = Object.fromEntries(new FormData(generateForm).entries());
    await ScheduleRepository.generateMonth({
      year: Number(yearSelect.value),
      month: Number(monthSelect.value),
      durationHours: Number(formData.durationHours),
      firstStartTime: formData.firstStartTime,
      secondStartTime: formData.durationHours === "12" ? timeAfter12Hours(formData.firstStartTime) : null,
      caregiverIds: orderedCaregiverIds,
      caregiverRates: Object.fromEntries(orderedCaregiverIds
        .filter((id) => String(generateRates[id] ?? "").trim() !== "")
        .map((id) => [id, generateRates[id]])),
    });
    await loadMonth();
  } catch (error) {
    generateMessage.textContent = error.message;
  }
});

deleteMonthButton.addEventListener("click", async () => {
  if (!currentScheduleMonth || !window.confirm("Excluir a escala inteira deste mês?")) return;
  summaryMessage.textContent = "Excluindo...";
  try {
    await ScheduleRepository.deleteMonth(currentScheduleMonth.id);
    await loadMonth();
  } catch (error) {
    summaryMessage.textContent = error.message;
  }
});

async function loadMonth() {
  pendingSwapId = null;
  closeDayModal();
  const year = Number(yearSelect.value);
  const month = Number(monthSelect.value);
  monthLabel.textContent = `${MONTH_NAMES[month - 1]} / ${year}`;
  monthMessage.textContent = "";
  generatePanel.hidden = true;
  summaryPanel.hidden = true;
  shiftsPanel.hidden = true;
  try {
    currentScheduleMonth = await ScheduleRepository.getMonth(year, month);
    monthMessage.textContent = "";
    if (!currentScheduleMonth) {
      currentShifts = [];
      calendarShifts = [];
      orderedCaregiverIds = [];
      generateRates = {};
      generateForm.reset();
      toggleSecondStartField();
      renderCaregiverChecklist();
      renderReorderList();
      generatePanel.hidden = false;
      await loadPayments();
      return;
    }
    const durationLabel = currentScheduleMonth.durationHours === 12 ? "12 horas" : "24 horas";
    const periodsLabel = currentScheduleMonth.secondStartTime
      ? `${currentScheduleMonth.firstStartTime} e ${currentScheduleMonth.secondStartTime}`
      : currentScheduleMonth.firstStartTime;
    const namesLabel = currentScheduleMonth.caregivers.map((caregiver) => caregiver.name).join(" → ");
    summaryDuration.textContent = durationLabel;
    summaryStartTime.textContent = periodsLabel;
    summaryCaregivers.textContent = namesLabel;
    summaryMessage.textContent = "";
    summaryPanel.hidden = false;
    await loadShifts();
    shiftsPanel.hidden = false;
    await loadPayments();
  } catch (error) {
    monthMessage.textContent = error.message;
  }
}

function showTab(name) {
  tabEscala.hidden = name !== "escala";
  tabPagamentos.hidden = name !== "pagamentos";
  tabButtons.forEach((btn) => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle("tab-button--active", active);
    btn.setAttribute("aria-selected", String(active));
  });
}
tabButtons.forEach((btn) => btn.addEventListener("click", () => showTab(btn.dataset.tab)));

function formatCents(cents) {
  return currencyFormatter.format(cents / 100);
}

function showPaymentsEmpty(text) {
  paymentsEmpty.textContent = text;
  paymentsEmpty.hidden = false;
}

function rateCaregivers() {
  const caregivers = new Map();
  currentScheduleMonth.caregivers.forEach((caregiver) => caregivers.set(String(caregiver.profileId), caregiver.name));
  currentShifts.forEach((shift) => {
    if (!caregivers.has(String(shift.profileId))) caregivers.set(String(shift.profileId), shift.profileName);
  });
  return [...caregivers].map(([profileId, name]) => ({ profileId, name }));
}

function renderRatesForm() {
  const rated = new Set((currentScheduleMonth.ratedProfileIds || []).map(String));
  ratesList.replaceChildren();
  rateCaregivers().forEach(({ profileId, name }) => {
    const item = document.createElement("li");
    item.className = "rates-list__item";
    const inputId = `rate-input-${profileId}`;

    const label = document.createElement("label");
    label.className = "rates-list__name";
    label.htmlFor = inputId;
    label.textContent = name;

    const status = document.createElement("span");
    status.className = `rates-list__status${rated.has(profileId) ? " rates-list__status--set" : ""}`;
    status.textContent = rated.has(profileId) ? "Valor definido" : "Sem valor";

    const input = document.createElement("input");
    input.id = inputId;
    input.type = "number";
    input.min = "0";
    input.step = "0.01";
    input.inputMode = "decimal";
    input.name = profileId;
    input.placeholder = rated.has(profileId) ? "Novo valor (R$)" : "Valor (R$)";

    item.append(label, status, input);
    ratesList.append(item);
  });
}

function closeRatesForm() {
  ratesForm.hidden = true;
  ratesForm.reset();
  ratesMessage.textContent = "";
}

async function loadPayments() {
  const year = Number(yearSelect.value);
  const month = Number(monthSelect.value);
  const profileName = CaregiverContext.getCurrentName();
  const periodLabel = `${MONTH_NAMES[month - 1]} / ${year}`;
  paymentsLabel.textContent = profileName ? `Pagamento de ${profileName} · ${periodLabel}` : `Seu pagamento · ${periodLabel}`;
  paymentsMessage.textContent = "";
  paymentsEmpty.hidden = true;
  earningsSummary.hidden = true;
  earningsNote.hidden = true;
  closeRatesForm();
  ratesToggleButton.hidden = !currentScheduleMonth;

  if (!currentScheduleMonth) {
    showPaymentsEmpty("Nenhuma escala gerada para este mês. Gere a escala na aba Escala.");
    return;
  }
  if (!CaregiverContext.getCurrentId()) {
    showPaymentsEmpty("Selecione um perfil para ver quanto você vai receber.");
    return;
  }
  try {
    const earnings = await ScheduleRepository.getEarnings(currentScheduleMonth.id);
    earningsShiftCount.textContent = shiftCountFormatter.format(earnings.shiftCount);
    earningsRate.textContent = earnings.rateCents === null ? "Não definido" : formatCents(earnings.rateCents);
    earningsTotal.textContent = earnings.totalCents === null
      ? "Defina o valor do plantão para calcular"
      : formatCents(earnings.totalCents);
    earningsSummary.hidden = false;
    earningsNote.hidden = false;
  } catch (error) {
    paymentsMessage.textContent = error.message;
  }
}

ratesToggleButton.addEventListener("click", () => {
  if (!ratesForm.hidden) {
    closeRatesForm();
    return;
  }
  renderRatesForm();
  ratesForm.hidden = false;
});
ratesCancelButton.addEventListener("click", closeRatesForm);

ratesForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const rates = Object.fromEntries([...new FormData(ratesForm).entries()]
    .filter(([, value]) => String(value).trim() !== ""));
  if (!Object.keys(rates).length) {
    ratesMessage.textContent = "Preencha ao menos um valor";
    return;
  }
  ratesMessage.textContent = "Salvando...";
  try {
    await ScheduleRepository.setRates(currentScheduleMonth.id, rates);
    await loadMonth();
  } catch (error) {
    ratesMessage.textContent = error.message;
  }
});

monthSelect.addEventListener("change", loadMonth);
yearSelect.addEventListener("change", loadMonth);

printScheduleButton.addEventListener("click", () => {
  const previousTitle = document.title;
  const monthName = MONTH_NAMES[Number(monthSelect.value) - 1];
  document.title = `Escala de plantões - ${monthName} ${yearSelect.value}`;
  window.addEventListener("afterprint", () => { document.title = previousTitle; }, { once: true });
  window.print();
});

populateMonthYearSelects();
showTab("escala");
document.querySelector("#current-date").textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date());
toggleSecondStartField();
CaregiverProfilesRepository.getAll().then((caregivers) => {
  allCaregivers = caregivers;
  loadMonth();
}).catch((error) => { monthMessage.textContent = error.message; });

LiveUpdates.connect((event) => {
  if (["schedule-months", "schedule-shifts"].includes(event.resource)) loadMonth();
});
