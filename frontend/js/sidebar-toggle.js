(() => {
  const STORAGE_KEY = "loreroutine:sidebarCollapsed";
  const appShell = document.querySelector(".app-shell");
  const button = document.querySelector("#sidebar-toggle-button");
  if (!appShell || !button) return;

  const mobileQuery = window.matchMedia("(max-width: 800px)");
  const mobileButton = document.createElement("button");
  const backdrop = document.createElement("button");

  mobileButton.className = "mobile-menu-button";
  mobileButton.type = "button";
  mobileButton.setAttribute("aria-label", "Abrir menu");
  mobileButton.setAttribute("aria-controls", "sidebar-navigation");
  mobileButton.textContent = "☰";

  backdrop.className = "sidebar-backdrop";
  backdrop.type = "button";
  backdrop.setAttribute("aria-label", "Fechar menu");

  const sidebar = appShell.querySelector(".sidebar");
  sidebar.id ||= "sidebar-navigation";
  document.body.append(mobileButton);
  appShell.append(backdrop);

  function applyDesktop(collapsed) {
    appShell.classList.toggle("app-shell--sidebar-collapsed", collapsed);
    button.setAttribute("aria-expanded", String(!collapsed));
  }

  function setMobileOpen(open) {
    appShell.classList.toggle("app-shell--sidebar-open", open);
    mobileButton.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("sidebar-drawer-open", open);
  }

  function syncLayout() {
    setMobileOpen(false);
    applyDesktop(
      mobileQuery.matches ? false : localStorage.getItem(STORAGE_KEY) === "true",
    );
  }

  syncLayout();

  button.addEventListener("click", () => {
    if (mobileQuery.matches) {
      setMobileOpen(false);
      mobileButton.focus();
      return;
    }

    const collapsed = !appShell.classList.contains("app-shell--sidebar-collapsed");
    applyDesktop(collapsed);
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  });

  mobileButton.addEventListener("click", () => setMobileOpen(true));
  backdrop.addEventListener("click", () => setMobileOpen(false));

  sidebar.addEventListener("click", (event) => {
    if (mobileQuery.matches && event.target.closest(".nav-link")) {
      setMobileOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && appShell.classList.contains("app-shell--sidebar-open")) {
      setMobileOpen(false);
      mobileButton.focus();
    }
  });

  mobileQuery.addEventListener("change", syncLayout);
})();
