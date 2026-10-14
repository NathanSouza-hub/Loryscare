const ThemeToggle = (() => {
  const STORAGE_KEY = "loreroutine:theme";
  const THEMES = ["light", "dark", "system"];
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  const SVG_ATTRS = 'xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const OPTIONS = [
    {
      theme: "light",
      label: "Tema claro",
      icon: `<svg ${SVG_ATTRS}><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/>`
        + '<path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/>'
        + '<path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
    },
    {
      theme: "dark",
      label: "Tema escuro",
      icon: `<svg ${SVG_ATTRS}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`,
    },
    {
      theme: "system",
      label: "Tema do sistema",
      icon: `<svg ${SVG_ATTRS}><rect width="20" height="14" x="2" y="3" rx="2"/>`
        + '<line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>',
    },
  ];

  function getPreference() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return THEMES.includes(stored) ? stored : "system";
    } catch (error) {
      return "system";
    }
  }

  function resolve(preference) {
    if (preference === "system") return darkQuery.matches ? "dark" : "light";
    return preference;
  }

  function apply(preference) {
    document.documentElement.dataset.theme = resolve(preference);
    document.querySelectorAll(".theme-toggle__button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.theme === preference));
    });
  }

  function setPreference(preference) {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch (error) {
      // Sem localStorage o tema ainda muda nesta página.
    }
    apply(preference);
  }

  function render(container) {
    container.classList.add("theme-toggle");
    container.setAttribute("role", "group");
    container.setAttribute("aria-label", "Tema");
    container.replaceChildren();
    OPTIONS.forEach(({ theme, label, icon }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "theme-toggle__button";
      button.dataset.theme = theme;
      button.title = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = icon;
      button.addEventListener("click", () => setPreference(theme));
      container.append(button);
    });
  }

  document.querySelectorAll("[data-theme-toggle]").forEach(render);
  apply(getPreference());

  darkQuery.addEventListener("change", () => {
    if (getPreference() === "system") apply("system");
  });
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) apply(getPreference());
  });

  return Object.freeze({ getPreference, setPreference });
})();
