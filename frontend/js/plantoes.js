const monthSelect = document.querySelector("#month-select");
const yearSelect = document.querySelector("#year-select");
const monthLabel = document.querySelector("#month-label");
const monthMessage = document.querySelector("#month-message");
const generatePanel = document.querySelector("#generate-panel");
const summaryPanel = document.querySelector("#summary-panel");
const shiftsPanel = document.querySelector("#shifts-panel");

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

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

async function loadMonth() {
  const year = Number(yearSelect.value);
  const month = Number(monthSelect.value);
  monthLabel.textContent = `${MONTH_NAMES[month - 1]} / ${year}`;
  monthMessage.textContent = "Carregando...";
  generatePanel.hidden = true;
  summaryPanel.hidden = true;
  shiftsPanel.hidden = true;
  try {
    const scheduleMonth = await ScheduleRepository.getMonth(year, month);
    monthMessage.textContent = "";
    if (!scheduleMonth) {
      generatePanel.hidden = false;
      return;
    }
    summaryPanel.hidden = false;
    shiftsPanel.hidden = false;
  } catch (error) {
    monthMessage.textContent = error.message;
  }
}

monthSelect.addEventListener("change", loadMonth);
yearSelect.addEventListener("change", loadMonth);

populateMonthYearSelects();
document.querySelector("#current-date").textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date());
loadMonth();
