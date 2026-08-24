(() => {
  const NAV_ICONS = {
    "index.html": "home",
    "pacientes.html": "user",
    "sinais-vitais.html": "heartPulse",
    "medicamentos.html": "pill",
    "atividades.html": "clipboardList",
    "anotacoes-enfermagem.html": "notebookPen",
    "agenda.html": "calendarDays",
  };

  function fillIcon(selector, name) {
    document.querySelectorAll(selector).forEach((el) => { el.innerHTML = ICONS[name] || ""; });
  }

  fillIcon(".brand__icon", "heart");
  fillIcon(".sidebar-bottom-card__icon", "heart");
  fillIcon(".footer-heart", "heart");
  fillIcon(".notifications__bell-icon", "bell");

  document.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = ICONS[el.dataset.icon] || "";
  });

  const toggleButton = document.querySelector("#sidebar-toggle-button");
  if (toggleButton) toggleButton.innerHTML = ICONS.menu;

  document.querySelectorAll(".nav-link").forEach((link) => {
    const iconName = NAV_ICONS[link.getAttribute("href")];
    if (!iconName) return;
    const label = link.textContent.trim();
    link.innerHTML = `${icon(iconName)}<span class="nav-link__label">${label}</span>`;
  });

  function initials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    const first = parts[0][0] || "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
  }

  const avatarEl = document.querySelector("#sidebar-user-avatar");
  const nameEl = document.querySelector("#sidebar-user-name");
  if (avatarEl && nameEl && typeof AuthContext !== "undefined") {
    const userName = AuthContext.getUserName();
    nameEl.textContent = userName;
    const avatar = AuthContext.getAvatar();
    if (avatar) {
      avatarEl.innerHTML = "";
      const img = document.createElement("img");
      img.src = avatar;
      img.alt = "";
      avatarEl.append(img);
    } else {
      avatarEl.textContent = initials(userName);
    }
  }

  const roleEl = document.querySelector(".sidebar-user-card__role");
  if (roleEl && typeof CaregiverContext !== "undefined") {
    const profileName = CaregiverContext.getCurrentName();
    roleEl.replaceChildren();
    const label = document.createElement("span");
    label.textContent = profileName || "Cuidador";
    roleEl.append(label);
    if (profileName) {
      const switchLink = document.createElement("button");
      switchLink.type = "button";
      switchLink.className = "sidebar-user-card__switch";
      switchLink.textContent = "Trocar";
      switchLink.addEventListener("click", () => {
        CaregiverContext.clearCurrent();
        location.href = "perfis.html";
      });
      roleEl.append(document.createTextNode(" · "), switchLink);

      if (typeof WorkShiftsRepository !== "undefined") {
        WorkShiftsRepository.getCurrent().then((current) => {
          if (!current || String(current.profileId) !== String(CaregiverContext.getCurrentId())) return;
          const [hour, minute] = current.expectedEndTime.split(":");
          const endLabel = minute === "00" ? `${hour}h` : `${hour}h${minute}`;
          const shiftLabel = document.createElement("span");
          shiftLabel.className = "sidebar-user-card__shift";
          shiftLabel.textContent = ` · Plantão até ${endLabel}`;
          roleEl.append(shiftLabel);
        }).catch(() => {});
      }
    }
  }
})();
