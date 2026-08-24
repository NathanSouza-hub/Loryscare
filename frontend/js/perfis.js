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
const skipShiftButton = document.querySelector("#skip-shift-button");
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

function showShiftStep(profile = null) {
  shiftStepTitle.textContent = profile ? `Iniciar plantão de ${profile.name}?` : "Iniciar plantão";
  shiftForm.elements.profileId.value = profile?.id || "";
  shiftForm.elements.startedDate.value = localDate();
  shiftForm.elements.startedTime.value = localTime();
  shiftMessage.textContent = "";
  profileStep.hidden = true;
  shiftStep.hidden = false;
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

shiftForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  shiftMessage.textContent = "Salvando...";
  try {
    const data = Object.fromEntries(new FormData(shiftForm).entries());
    const profile = caregiverProfiles.find((item) => String(item.id) === String(data.profileId));
    if (!profile) throw new Error("Selecione um cuidador");
    CaregiverContext.setCurrent(profile);
    delete data.profileId;
    await WorkShiftsRepository.start(data);
    goToApp();
  } catch (error) {
    shiftMessage.textContent = error.message;
  }
});

skipShiftButton.addEventListener("click", () => {
  if (CaregiverContext.getCurrentId()) { goToApp(); return; }
  shiftStep.hidden = true;
  profileStep.hidden = false;
});
startShiftButton.addEventListener("click", () => {
  showShiftStep();
});

async function loadProfiles() {
  try {
    const profiles = await CaregiverProfilesRepository.getAll();
    caregiverProfiles = profiles;
    profileGrid.replaceChildren();
    emptyProfiles.hidden = profiles.length > 0;
    shiftForm.elements.profileId.replaceChildren(new Option("Selecione", ""));
    profiles.forEach((profile) => shiftForm.elements.profileId.add(new Option(profile.name, profile.id)));
    profiles.forEach((profile) => profileGrid.append(profileButton(profile)));
  } catch (error) {
    message.textContent = error.message;
  }
}

loadProfiles();
