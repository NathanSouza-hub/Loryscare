const monthSelect = document.querySelector("#month-select");
const yearSelect = document.querySelector("#year-select");
const monthLabel = document.querySelector("#month-label");
const monthMessage = document.querySelector("#month-message");
const generatePanel = document.querySelector("#generate-panel");
const summaryPanel = document.querySelector("#summary-panel");
const shiftsPanel = document.querySelector("#shifts-panel");
const generateForm = document.querySelector("#generate-form");
const generateMessage = document.querySelector("#generate-message");
const durationSelect = document.querySelector("#duration-select");
const secondStartField = document.querySelector("#second-start-field");
const caregiverChecklist = document.querySelector("#caregiver-checklist");
const reorderList = document.querySelector("#reorder-list");
const summaryText = document.querySelector("#summary-text");
const summaryMessage = document.querySelector("#summary-message");
const deleteMonthButton = document.querySelector("#delete-month-button");

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

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

function formatDateLabel(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

let allCaregivers = [];
let orderedCaregiverIds = [];
let currentScheduleMonth = null;
const shiftsBody = document.querySelector("#shifts-body");
let currentShifts = [];

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

    item.append(position, name, buttons);
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

function shiftRow(shift) {
  const row = document.createElement("tr");
  const cell = (text) => { const td = document.createElement("td"); td.textContent = text; return td; };

  const badge = document.createElement("span");
  badge.className = `status-badge ${STATUS_BADGE_CLASS[shift.status] || ""}`;
  badge.textContent = shift.status;
  const statusCell = document.createElement("td");
  statusCell.append(badge);

  const turnCell = cell(`${currentScheduleMonth.durationHours}h · ${periodFromHour(Number(shift.scheduledStartTime.slice(0, 2)))}`);

  const actionsCell = document.createElement("td");

  row.append(
    cell(formatDateLabel(shift.scheduledDate)),
    cell(shift.scheduledStartTime),
    cell(shift.scheduledEndTime),
    cell(shift.profileName),
    turnCell,
    statusCell,
    actionsCell,
  );
  return row;
}

async function loadShifts() {
  const year = Number(yearSelect.value);
  const month = Number(monthSelect.value);
  currentShifts = await ScheduleRepository.listShifts(year, month);
  shiftsBody.replaceChildren();
  currentShifts.forEach((shift) => shiftsBody.append(shiftRow(shift)));
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
  secondStartField.hidden = durationSelect.value !== "12";
  document.querySelector("#second-start-time").required = durationSelect.value === "12";
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
      secondStartTime: formData.durationHours === "12" ? formData.secondStartTime : null,
      caregiverIds: orderedCaregiverIds,
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
  const year = Number(yearSelect.value);
  const month = Number(monthSelect.value);
  monthLabel.textContent = `${MONTH_NAMES[month - 1]} / ${year}`;
  monthMessage.textContent = "Carregando...";
  generatePanel.hidden = true;
  summaryPanel.hidden = true;
  shiftsPanel.hidden = true;
  try {
    currentScheduleMonth = await ScheduleRepository.getMonth(year, month);
    monthMessage.textContent = "";
    if (!currentScheduleMonth) {
      orderedCaregiverIds = [];
      generateForm.reset();
      toggleSecondStartField();
      renderCaregiverChecklist();
      renderReorderList();
      generatePanel.hidden = false;
      return;
    }
    const durationLabel = currentScheduleMonth.durationHours === 12 ? "12 horas" : "24 horas";
    const periodsLabel = currentScheduleMonth.secondStartTime
      ? `${currentScheduleMonth.firstStartTime} e ${currentScheduleMonth.secondStartTime}`
      : currentScheduleMonth.firstStartTime;
    const namesLabel = currentScheduleMonth.caregivers.map((caregiver) => caregiver.name).join(" → ");
    summaryText.textContent = `${durationLabel} · início(s) às ${periodsLabel} · ${namesLabel}`;
    summaryMessage.textContent = "";
    summaryPanel.hidden = false;
    await loadShifts();
    shiftsPanel.hidden = false;
  } catch (error) {
    monthMessage.textContent = error.message;
  }
}

monthSelect.addEventListener("change", loadMonth);
yearSelect.addEventListener("change", loadMonth);

populateMonthYearSelects();
document.querySelector("#current-date").textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date());
toggleSecondStartField();
CaregiverProfilesRepository.getAll().then((caregivers) => {
  allCaregivers = caregivers;
  loadMonth();
}).catch((error) => { monthMessage.textContent = error.message; });

LiveUpdates.connect((event) => {
  if (["schedule-months", "schedule-shifts"].includes(event.resource)) loadMonth();
});
