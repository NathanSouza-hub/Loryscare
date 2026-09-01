const profileGrid = document.querySelector("#profile-grid");
const emptyProfiles = document.querySelector("#empty-profiles");
const message = document.querySelector("#message");
const profileStep = document.querySelector("#profile-step");
const pinStep = document.querySelector("#pin-step");
const pinStepTitle = document.querySelector("#pin-step-title");
const pinStepDescription = document.querySelector("#pin-step-description");
const pinForm = document.querySelector("#pin-form");
const pinInput = document.querySelector("#pin-input");
const pinInputLabel = document.querySelector("#pin-input-label");
const pinConfirmField = document.querySelector("#pin-confirm-field");
const pinConfirmInput = document.querySelector("#pin-confirm-input");
const pinMessage = document.querySelector("#pin-message");
const pinCancelButton = document.querySelector("#pin-cancel-button");
const shiftStep = document.querySelector("#shift-step");
const shiftStepTitle = document.querySelector("#shift-step-title");
const shiftForm = document.querySelector("#shift-form");
const shiftMessage = document.querySelector("#shift-message");
const shiftStepBackButton = document.querySelector("#shift-step-back-button");
const startShiftButton = document.querySelector("#start-shift-button");
let caregiverProfiles = [];
let pendingProfile = null;

function initials(name) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function localTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function goToApp() {
  location.href = "index.html";
}

function showPinStep(profile) {
  pendingProfile = profile;
  pinForm.reset();
  pinMessage.textContent = "";
  if (profile.hasPin) {
    pinStepTitle.textContent = `Digite o PIN de ${profile.name}`;
    pinStepDescription.textContent = "Isso garante que só você acesse o seu próprio perfil.";
    pinInputLabel.textContent = "PIN";
    pinConfirmField.hidden = true;
    pinConfirmInput.required = false;
  } else {
    pinStepTitle.textContent = `Defina um PIN para ${profile.name}`;
    pinStepDescription.textContent = "Primeiro acesso: escolha um PIN de 4 dígitos para proteger este perfil.";
    pinInputLabel.textContent = "Novo PIN";
    pinConfirmField.hidden = false;
    pinConfirmInput.required = true;
  }
  profileStep.hidden = true;
  pinStep.hidden = false;
  pinInput.focus();
}

pinCancelButton.addEventListener("click", () => {
  pendingProfile = null;
  pinStep.hidden = true;
  profileStep.hidden = false;
});

pinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingProfile) return;
  const pin = pinInput.value;
  if (!/^\d{4}$/.test(pin)) {
    pinMessage.textContent = "Informe um PIN de 4 dígitos.";
    return;
  }
  const submitButton = document.querySelector("#pin-submit-button");
  submitButton.disabled = true;
  pinMessage.textContent = "Verificando...";
  try {
    if (pendingProfile.hasPin) {
      await CaregiverProfilesRepository.verifyPin(pendingProfile.id, pin);
    } else {
      if (pin !== pinConfirmInput.value) throw new Error("Os PINs não coincidem.");
      await CaregiverProfilesRepository.setPin(pendingProfile.id, pin);
    }
    CaregiverContext.setCurrent(pendingProfile);
    goToApp();
  } catch (error) {
    pinMessage.textContent = error.message;
    pinForm.reset();
    pinInput.focus();
  } finally {
    submitButton.disabled = false;
  }
});

function profileButton(profile) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "profile-avatar";

  const circle = document.createElement("span");
  circle.className = "profile-avatar__circle";
  circle.style.background = profile.avatarColor;
  circle.textContent = initials(profile.name);

  const name = document.createElement("span");
  name.className = "profile-avatar__name";
  name.textContent = profile.name;

  button.append(circle, name);
  button.addEventListener("click", () => showPinStep(profile));
  return button;
}

const scheduledShiftCard = document.querySelector("#scheduled-shift-card");
const scheduledShiftSummary = document.querySelector("#scheduled-shift-summary");
const noScheduledShiftMessage = document.querySelector("#no-scheduled-shift-message");
const startScheduledButton = document.querySelector("#start-scheduled-button");
const showExtraordinaryButton = document.querySelector("#show-extraordinary-button");
let currentScheduledShift = null;

function periodFromHour(hour) {
  if (hour >= 6 && hour < 12) return "Manhã";
  if (hour >= 12 && hour < 18) return "Tarde";
  if (hour >= 18) return "Noite";
  return "Madrugada";
}

async function showShiftStep() {
  shiftStepTitle.textContent = "Iniciar plantão";
  shiftMessage.textContent = "";
  shiftForm.hidden = true;
  scheduledShiftCard.hidden = true;
  noScheduledShiftMessage.hidden = true;
  profileStep.hidden = true;
  shiftStep.hidden = false;
  await refreshScheduleLookup();
}

async function refreshScheduleLookup() {
  const profileId = document.querySelector("#shift-profile").value;
  currentScheduledShift = null;
  shiftMessage.textContent = "";
  scheduledShiftCard.hidden = true;
  noScheduledShiftMessage.hidden = true;
  shiftForm.hidden = true;
  if (!profileId) return;
  try {
    currentScheduledShift = await ScheduleRepository.getCurrentShift(profileId);
  } catch (error) {
    shiftMessage.textContent = error.message;
    return;
  }
  if (currentScheduledShift && !currentScheduledShift.alreadyStarted) {
    const durationHours = Math.round(
      (new Date(`${currentScheduledShift.scheduledEndDate}T${currentScheduledShift.scheduledEndTime}`)
        - new Date(`${currentScheduledShift.scheduledDate}T${currentScheduledShift.scheduledStartTime}`)) / 3600000,
    );
    scheduledShiftSummary.textContent = `Hoje — ${currentScheduledShift.scheduledStartTime} às ${currentScheduledShift.scheduledEndTime} — ${durationHours} horas`;
    scheduledShiftCard.hidden = false;
  } else if (currentScheduledShift && currentScheduledShift.alreadyStarted) {
    shiftMessage.textContent = "Este plantão já foi iniciado.";
  } else {
    noScheduledShiftMessage.hidden = false;
    showExtraordinaryFormFields();
  }
}

function showExtraordinaryFormFields() {
  scheduledShiftCard.hidden = true;
  shiftForm.hidden = false;
  shiftForm.elements.startedDate.value = localDate();
  shiftForm.elements.startedTime.value = localTime();
}

document.querySelector("#shift-profile").addEventListener("change", refreshScheduleLookup);
showExtraordinaryButton.addEventListener("click", showExtraordinaryFormFields);

startScheduledButton.addEventListener("click", async () => {
  const profileId = document.querySelector("#shift-profile").value;
  const profile = caregiverProfiles.find((item) => String(item.id) === String(profileId));
  if (!profile || !currentScheduledShift) return;
  shiftMessage.textContent = "Salvando...";
  try {
    CaregiverContext.setCurrent(profile);
    await WorkShiftsRepository.start({ scheduleShiftId: currentScheduledShift.id });
    goToApp();
  } catch (error) {
    shiftMessage.textContent = error.message;
  }
});

shiftForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const profileId = document.querySelector("#shift-profile").value;
  const profile = caregiverProfiles.find((item) => String(item.id) === String(profileId));
  if (!profile) { shiftMessage.textContent = "Selecione um cuidador"; return; }
  shiftMessage.textContent = "Salvando...";
  try {
    const data = Object.fromEntries(new FormData(shiftForm).entries());
    CaregiverContext.setCurrent(profile);
    await WorkShiftsRepository.start(data);
    goToApp();
  } catch (error) {
    shiftMessage.textContent = error.message;
  }
});

function backToProfiles() {
  shiftStep.hidden = true;
  profileStep.hidden = false;
}
shiftStepBackButton.addEventListener("click", backToProfiles);
startShiftButton.addEventListener("click", () => { showShiftStep(); });

async function loadProfiles() {
  try {
    const profiles = await CaregiverProfilesRepository.getAll();
    caregiverProfiles = profiles;
    profileGrid.replaceChildren();
    emptyProfiles.hidden = profiles.length > 0;
    const shiftProfileSelect = document.querySelector("#shift-profile");
    shiftProfileSelect.replaceChildren(new Option("Selecione", ""));
    profiles.forEach((profile) => shiftProfileSelect.add(new Option(profile.name, profile.id)));
    profiles.forEach((profile) => profileGrid.append(profileButton(profile)));
  } catch (error) {
    message.textContent = error.message;
  }
}

loadProfiles();
