const message = document.querySelector("#dashboard-message");
const todayList = document.querySelector("#today-list");
const todayEmpty = document.querySelector("#today-empty");
const vitalsList = document.querySelector("#vitals-today-list");
const vitalsEmpty = document.querySelector("#vitals-today-empty");
const notesList = document.querySelector("#notes-today-list");
const notesEmpty = document.querySelector("#notes-today-empty");
const tasksDate = document.querySelector("#tasks-date");
const dashboardTitle = document.querySelector("#dashboard-title");
const tabButtons = document.querySelectorAll("[data-tab]");
const tabAgenda = document.querySelector("#tab-agenda");
const tabVitais = document.querySelector("#tab-vitais");
const tabAnotacoes = document.querySelector("#tab-anotacoes");
const notifications = document.querySelector("#notifications");
const notificationsButton = document.querySelector("#notifications-button");
const notificationsBadge = document.querySelector("#notifications-badge");
const notificationsPanel = document.querySelector("#notifications-panel");
const notificationsEmpty = document.querySelector("#notifications-empty");
const notificationsList = document.querySelector("#notifications-list");

let patientId = null;

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const today = localDate();
let selectedDate = today;

function verseOfTheDay() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - startOfYear) / 86400000);
  return PSALMS[dayOfYear % PSALMS.length];
}

function showTab(name) {
  tabAgenda.hidden = name !== "agenda";
  tabVitais.hidden = name !== "vitais";
  tabAnotacoes.hidden = name !== "anotacoes";
  tabButtons.forEach((btn) => btn.classList.toggle("tab-button--active", btn.dataset.tab === name));
}

function taskIconMeta(item) {
  if (item.kind === "medication") return { cls: "task-icon--medication", iconName: "pill" };
  if (item.subtitle.includes("Alimenta")) return { cls: "task-icon--food", iconName: "coffee" };
  if (item.subtitle.includes("Higiene")) return { cls: "task-icon--hygiene", iconName: "showerHead" };
  return { cls: "", iconName: "clipboardList" };
}

function taskRow(item) {
  const row = document.createElement("li");
  row.className = `today-item${item.status !== "pending" ? " today-item--done" : ""}`;

  const time = document.createElement("span");
  time.className = "today-item__time";
  time.textContent = item.time;

  const { cls, iconName } = taskIconMeta(item);
  const taskIcon = document.createElement("span");
  taskIcon.className = `task-icon${cls ? ` ${cls}` : ""}`;
  taskIcon.innerHTML = icon(iconName);

  const info = document.createElement("div");
  info.className = "today-item__info";
  const title = document.createElement("p");
  title.className = "today-item__title";
  const titleText = item.isFixed ? `${icon("pin")}${item.title}` : item.title;
  title.innerHTML = titleText;
  if (item.authorName) {
    const author = document.createElement("span");
    author.className = "today-item__author";
    author.textContent = ` · ${item.authorName}`;
    title.append(author);
  }
  const subtitle = document.createElement("p");
  subtitle.className = "today-item__subtitle";
  subtitle.textContent = item.subtitle;
  info.append(title, subtitle);

  const actions = document.createElement("div");
  actions.className = "today-item__actions";
  [
    { iconName: "check", title: item.doneLabel, action: item.doneStatus, baseClass: "table-action--success", doneClass: "table-action--done" },
    { iconName: "x", title: item.skipLabel, action: item.skipStatus, baseClass: "table-action--danger", doneClass: "table-action--skipped" },
  ].forEach(({ iconName: buttonIcon, title: actionTitle, action, baseClass, doneClass }) => {
    const lockedByOther = item.status !== "pending" && item.kind !== "event"
      && item.authorProfileId != null
      && String(item.authorProfileId) !== String(CaregiverContext.getCurrentId());
    const button = document.createElement("button");
    button.type = "button";
    button.className = `table-action table-action--icon ${baseClass}${item.status === action ? ` ${doneClass}` : ""}`;
    button.innerHTML = icon(buttonIcon);
    button.title = lockedByOther ? `Já registrado por ${item.authorName}` : actionTitle;
    button.setAttribute("aria-label", lockedByOther ? `Já registrado por ${item.authorName}` : actionTitle);
    button.disabled = lockedByOther;
    button.dataset.kind = item.kind;
    button.dataset.id = item.id;
    button.dataset.action = action;
    if (item.medicationId) button.dataset.medicationId = item.medicationId;
    actions.append(button);
  });

  row.append(time, taskIcon, info, actions);
  return row;
}

function vitalRow(record) {
  const row = document.createElement("li");
  row.className = "today-item";

  const time = document.createElement("span");
  time.className = "today-item__time";
  time.textContent = record.time;

  const info = document.createElement("div");
  info.className = "today-item__info";
  const title = document.createElement("p");
  title.className = "today-item__title";
  title.textContent = [
    record.bloodPressure && `PA ${record.bloodPressure}`,
    record.heartRate && `FC ${record.heartRate} bpm`,
    record.oxygenSaturation && `Sat ${record.oxygenSaturation}%`,
    record.temperature && `Temp ${record.temperature} °C`,
    record.bloodGlucose && `Glicemia ${record.bloodGlucose} mg/dL`,
  ].filter(Boolean).join(" · ") || "Sem medições registradas";
  info.append(title);

  row.append(time, info);
  return row;
}

function noteRow(note) {
  const row = document.createElement("li");
  row.className = "today-item highlighted-row";

  const time = document.createElement("span");
  time.className = "today-item__time";
  time.textContent = note.noteTime;

  const noteIcon = document.createElement("span");
  noteIcon.className = "today-item__note-icon";
  noteIcon.innerHTML = icon("pencil");

  const info = document.createElement("div");
  info.className = "today-item__info";
  const text = document.createElement("p");
  text.className = "today-item__note-text";
  text.textContent = note.noteText;
  info.append(text);

  const author = document.createElement("span");
  author.className = "today-item__note-author";
  author.innerHTML = `${icon("user")}<span>${note.authorProfileName || "Sem responsável"}</span>`;

  row.append(time, noteIcon, info, author);
  return row;
}

async function loadTasks() {
  const [activities, doses, dailyEvents] = await Promise.all([
    RoutinesRepository.getDaily(selectedDate, patientId),
    MedicationsRepository.getDaily(selectedDate, patientId),
    EventsRepository.getDaily(selectedDate, patientId),
  ]);

  const items = [
    ...activities.map((activity) => ({
      time: activity.time,
      kind: "routine",
      id: activity.id,
      title: activity.title,
      subtitle: `Atividade · ${activity.category}`,
      status: activity.status,
      isFixed: activity.isFixed,
      authorName: activity.authorProfileName,
      authorProfileId: activity.authorProfileId,
      doneLabel: "Concluir",
      doneStatus: "completed",
      skipLabel: "Não realizada",
      skipStatus: "skipped",
    })),
    ...doses.map((dose) => ({
      time: dose.time,
      kind: "medication",
      id: dose.scheduleId,
      medicationId: dose.medicationId,
      title: dose.name,
      subtitle: `Medicamento · ${dose.dosage}`,
      status: dose.status,
      authorName: dose.authorProfileName,
      authorProfileId: dose.authorProfileId,
      doneLabel: "Administrado",
      doneStatus: "taken",
      skipLabel: "Ignorado",
      skipStatus: "skipped",
    })),
    ...dailyEvents.map((eventItem) => ({
      time: eventItem.time,
      kind: "event",
      id: eventItem.id,
      title: eventItem.title,
      subtitle: `Evento${eventItem.category ? ` · ${eventItem.category}` : ""}`,
      status: eventItem.status,
      authorName: eventItem.completedByProfileName,
      doneLabel: "Concluir",
      doneStatus: "completed",
      skipLabel: "Não realizado",
      skipStatus: "skipped",
    })),
  ].sort((first, second) => first.time.localeCompare(second.time) || first.title.localeCompare(second.title));

  todayEmpty.textContent = selectedDate === today ? "Nenhuma tarefa programada para hoje." : "Nenhuma tarefa programada para esta data.";
  todayList.replaceChildren();
  todayEmpty.hidden = items.length > 0;
  items.forEach((item) => todayList.append(taskRow(item)));
  updateSummary(items);
}

function updateSummary(items) {
  const set = (id, value) => { const el = document.querySelector(id); if (el) el.textContent = String(value); };
  const nowTime = new Date().toTimeString().slice(0, 5);
  const isToday = selectedDate === today;
  const done = items.filter((item) => item.status === item.doneStatus).length;
  const late = items.filter((item) => item.status === "pending" && isToday && item.time < nowTime).length;
  const pending = items.filter((item) => item.status === "pending").length - late;
  set("#summary-scheduled", items.length);
  set("#summary-done", done);
  set("#summary-pending", pending);
  set("#summary-late", late);
}

async function loadVitals() {
  const records = await VitalsRepository.getAll(patientId);
  const dateRecords = records.filter((record) => record.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time));
  vitalsEmpty.textContent = selectedDate === today ? "Nenhum sinal vital registrado hoje." : "Nenhum sinal vital registrado nesta data.";
  vitalsList.replaceChildren();
  vitalsEmpty.hidden = dateRecords.length > 0;
  dateRecords.forEach((record) => vitalsList.append(vitalRow(record)));
}

async function loadNotes() {
  const dateNotes = await NursingNotesRepository.getAll(patientId, { date: selectedDate });
  notesEmpty.textContent = selectedDate === today ? "Nenhuma anotação registrada hoje." : "Nenhuma anotação registrada nesta data.";
  notesList.replaceChildren();
  notesEmpty.hidden = dateNotes.length > 0;
  dateNotes.forEach((note) => notesList.append(noteRow(note)));
}

function daysUntilLabel(dateValue) {
  const diff = Math.round((new Date(`${dateValue}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
  if (diff <= 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  return `Em ${diff} dias`;
}

function notificationRow(item) {
  const row = document.createElement("li");
  row.className = "notifications__item";
  const title = document.createElement("p");
  title.className = "notifications__item-title";
  title.textContent = item.title;
  const when = document.createElement("p");
  when.className = "notifications__item-when";
  when.textContent = `${daysUntilLabel(item.eventDate)} · ${item.eventTime}`;
  row.append(title, when);
  return row;
}

async function loadNotifications() {
  const upcoming = await EventsRepository.getUpcoming(patientId, 3);
  notificationsList.replaceChildren();
  notificationsEmpty.hidden = upcoming.length > 0;
  notificationsBadge.hidden = upcoming.length === 0;
  if (upcoming.length) notificationsBadge.textContent = String(upcoming.length);
  upcoming.forEach((item) => notificationsList.append(notificationRow(item)));
}

notificationsButton.addEventListener("click", (event) => {
  event.stopPropagation();
  notificationsPanel.hidden = !notificationsPanel.hidden;
});

document.addEventListener("click", (event) => {
  if (!notificationsPanel.hidden && !notifications.contains(event.target)) notificationsPanel.hidden = true;
});

todayList.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  try {
    if (target.dataset.kind === "routine") {
      await RoutinesRepository.setCompletion(target.dataset.id, { date: selectedDate, status: target.dataset.action });
    } else if (target.dataset.kind === "event") {
      await EventsRepository.setStatus(target.dataset.id, target.dataset.action);
    } else {
      await MedicationsRepository.setAdministration(target.dataset.medicationId, target.dataset.id, { date: selectedDate, status: target.dataset.action });
    }
    await loadTasks();
  } catch (error) {
    message.textContent = error.message;
    await loadTasks();
  }
});

tasksDate.addEventListener("change", () => {
  selectedDate = tasksDate.value || today;
  Promise.all([loadTasks(), loadVitals(), loadNotes()]).catch((error) => { message.textContent = error.message; });
});

tabButtons.forEach((btn) => btn.addEventListener("click", () => showTab(btn.dataset.tab)));
showTab("agenda");

dashboardTitle.textContent = `Olá, ${AuthContext.getUserName()}!`;
document.querySelector("#current-date").textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date());
const verse = verseOfTheDay();
document.querySelector("#daily-verse-text").textContent = verse.text ? `"${verse.text}"` : "Texto deste versículo em breve.";
document.querySelector("#daily-verse-reference").textContent = verse.reference;
tasksDate.value = today;

PatientContext.ready().then((id) => {
  patientId = id;
  if (!patientId) {
    message.textContent = "Cadastre um paciente em \"Paciente\" para começar.";
    todayEmpty.hidden = false;
    vitalsEmpty.hidden = false;
    notificationsButton.disabled = true;
    tasksDate.disabled = true;
    return;
  }
  Promise.all([loadTasks(), loadVitals(), loadNotes(), loadNotifications()]).catch((error) => { message.textContent = `${error.message}. Verifique se a API está ativa.`; });
});

LiveUpdates.connect((event) => {
  if (!patientId) return;
  if (["routines", "medications", "events"].includes(event.resource)) loadTasks();
  if (event.resource === "vitals") loadVitals();
  if (event.resource === "nursing-notes") loadNotes();
});
