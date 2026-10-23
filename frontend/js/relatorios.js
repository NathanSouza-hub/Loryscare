const PaymentReportsTab = (() => {
  const listView = document.querySelector("#reports-list-view");
  const detailView = document.querySelector("#report-detail-view");
  const createForm = document.querySelector("#report-create-form");
  const createMessage = document.querySelector("#report-create-message");
  const cycleSelect = document.querySelector("#report-cycle-select");
  const startDateInput = document.querySelector("#report-start-date");
  const endDateInput = document.querySelector("#report-end-date");
  const listMessage = document.querySelector("#reports-list-message");
  const listEmpty = document.querySelector("#reports-empty");
  const tableWrapper = document.querySelector("#reports-table-wrapper");
  const tableBody = document.querySelector("#reports-table-body");
  const detailEyebrow = document.querySelector("#report-detail-eyebrow");
  const detailLabel = document.querySelector("#report-detail-label");
  const detailMessage = document.querySelector("#report-detail-message");
  const detailEmpty = document.querySelector("#report-detail-empty");
  const warningsBox = document.querySelector("#report-warnings");
  const caregiversBox = document.querySelector("#report-caregivers");
  const summaryCaregivers = document.querySelector("#report-summary-caregivers");
  const summaryShifts = document.querySelector("#report-summary-shifts");
  const summaryHours = document.querySelector("#report-summary-hours");
  const summaryTotal = document.querySelector("#report-summary-total");
  const backButton = document.querySelector("#report-back-button");
  const addButton = document.querySelector("#report-add-button");
  const recalculateButton = document.querySelector("#report-recalculate-button");
  const printAllButton = document.querySelector("#report-print-all-button");
  const modalOverlay = document.querySelector("#report-modal-overlay");
  const modalTitle = document.querySelector("#report-modal-title");
  const modalForm = document.querySelector("#report-modal-form");
  const modalFields = document.querySelector("#report-modal-fields");
  const modalMessage = document.querySelector("#report-modal-message");
  const closeModalButton = document.querySelector("#close-report-modal-button");
  const printContainer = document.querySelector("#report-print");

  const currencyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

  let caregivers = [];
  let currentReport = null;
  let modalSubmit = null;
  let activated = false;

  function formatCents(cents) {
    return currencyFormatter.format(cents / 100);
  }

  function formatDate(isoDate) {
    const [year, month, day] = isoDate.split("-");
    return `${day}/${month}/${year}`;
  }

  function formatShortDate(isoDate) {
    const [year, month, day] = isoDate.split("-").map(Number);
    const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()];
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")} (${weekday})`;
  }

  function formatHours(minutes) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}h${String(rest).padStart(2, "0")}` : `${hours}h`;
  }

  function cycleLabel(cycleDay) {
    return `Dia ${String(cycleDay).padStart(2, "0")}`;
  }

  function periodLabel(report) {
    return `${formatDate(report.startDate)} a ${formatDate(report.endDate)}`;
  }

  function todayLabel() {
    return new Intl.DateTimeFormat("pt-BR").format(new Date());
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function actionButton(label, onClick, extraClass = "") {
    const button = element("button", `table-action ${extraClass}`.trim(), label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }

  function adjustmentLabel(item) {
    return item.amountCents < 0 ? "Desconto" : "Acréscimo";
  }

  // Mesmo resumo para a tela e para o PDF: os valores impressos são sempre os exibidos.
  function summarize(report, profileId = null) {
    const groups = new Map();
    for (const item of report.items) {
      if (profileId && String(item.profileId) !== String(profileId)) continue;
      const key = String(item.profileId);
      if (!groups.has(key)) {
        groups.set(key, {
          profileId: key, profileName: item.profileName, shifts: [], adjustments: [],
          shiftCount: 0, minutes: 0, totalCents: 0, missingCount: 0,
        });
      }
      const group = groups.get(key);
      if (item.kind === "shift") {
        group.shifts.push(item);
        group.shiftCount += 1;
        group.minutes += item.durationMinutes;
        if (item.amountCents === null) group.missingCount += 1;
      } else {
        group.adjustments.push(item);
      }
      group.totalCents += item.amountCents ?? 0;
    }
    const list = [...groups.values()];
    return {
      groups: list,
      caregiverCount: list.length,
      shiftCount: list.reduce((sum, group) => sum + group.shiftCount, 0),
      minutes: list.reduce((sum, group) => sum + group.minutes, 0),
      totalCents: list.reduce((sum, group) => sum + group.totalCents, 0),
      missingCount: list.reduce((sum, group) => sum + group.missingCount, 0),
    };
  }

  // ---------- Lista ----------

  async function loadList() {
    listMessage.textContent = "";
    try {
      const reports = await PaymentReportsRepository.list();
      tableBody.replaceChildren(...reports.map(reportRow));
      listEmpty.hidden = reports.length > 0;
      tableWrapper.hidden = reports.length === 0;
    } catch (error) {
      listMessage.textContent = error.message;
    }
  }

  function reportRow(report) {
    const row = document.createElement("tr");
    row.append(element("td", "", cycleLabel(report.cycleDay)), element("td", "", periodLabel(report)));
    const totalCell = element("td", "", formatCents(report.totalCents));
    if (report.missingAmountCount) {
      totalCell.append(element("span", "report-missing-badge", `${report.missingAmountCount} sem valor`));
    }
    const actions = element("td");
    const wrapper = element("div", "table-actions");
    wrapper.append(
      actionButton("Abrir", () => openReport(report.id)),
      actionButton("Excluir", () => deleteReport(report), "table-action--danger"),
    );
    actions.append(wrapper);
    row.append(totalCell, actions);
    return row;
  }

  async function deleteReport(report) {
    if (!window.confirm(`Excluir o relatório ${cycleLabel(report.cycleDay)} (${periodLabel(report)})? A escala não será alterada.`)) return;
    try {
      await PaymentReportsRepository.remove(report.id);
      await loadList();
    } catch (error) {
      listMessage.textContent = error.message;
    }
  }

  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (endDateInput.value && startDateInput.value && endDateInput.value < startDateInput.value) {
      createMessage.textContent = "A data final deve ser igual ou posterior à inicial.";
      return;
    }
    createMessage.textContent = "Criando...";
    try {
      const created = await PaymentReportsRepository.create({
        cycleDay: Number(cycleSelect.value), startDate: startDateInput.value, endDate: endDateInput.value,
      });
      createMessage.textContent = "";
      createForm.reset();
      await openReport(created.id);
    } catch (error) {
      createMessage.textContent = error.message;
    }
  });

  // ---------- Detalhe ----------

  function showList() {
    currentReport = null;
    detailView.hidden = true;
    listView.hidden = false;
    loadList();
  }

  async function openReport(id) {
    detailMessage.textContent = "";
    try {
      currentReport = await PaymentReportsRepository.get(id);
      listView.hidden = true;
      detailView.hidden = false;
      renderDetail();
    } catch (error) {
      listMessage.textContent = error.message;
      showList();
    }
  }

  async function reloadReport() {
    if (!currentReport) return;
    try {
      currentReport = await PaymentReportsRepository.get(currentReport.id);
      renderDetail();
    } catch (error) {
      detailMessage.textContent = error.message;
    }
  }

  function renderWarnings(report, summary) {
    const messages = [];
    if (summary.missingCount) {
      messages.push(`${summary.missingCount} plantão(ões) sem valor: o valor do plantão não estava definido em Pagamentos para o mês. Use “Editar” para informar o valor.`);
    }
    for (const other of report.warnings.overlappingReports) {
      messages.push(`O relatório ${cycleLabel(other.cycleDay)} (${periodLabel(other)}) cobre parte das mesmas datas. Confira para não pagar plantões em dobro.`);
    }
    warningsBox.replaceChildren(...messages.map((text) => element("p", "report-warning", text)));
    warningsBox.hidden = messages.length === 0;
  }

  function renderDetail() {
    const report = currentReport;
    const summary = summarize(report);
    detailEyebrow.textContent = `Relatório · pagamento ${cycleLabel(report.cycleDay).toLowerCase()}`;
    detailLabel.textContent = periodLabel(report);
    summaryCaregivers.textContent = String(summary.caregiverCount);
    summaryShifts.textContent = String(summary.shiftCount);
    summaryHours.textContent = formatHours(summary.minutes);
    summaryTotal.textContent = formatCents(summary.totalCents);
    renderWarnings(report, summary);
    detailEmpty.hidden = summary.groups.length > 0;
    caregiversBox.replaceChildren(...summary.groups.map(caregiverBlock));
  }

  function amountCell(item) {
    if (item.amountCents === null) return element("td", "report-amount report-amount--missing", "sem valor");
    return element("td", `report-amount${item.amountCents < 0 ? " report-amount--negative" : ""}`, formatCents(item.amountCents));
  }

  function itemActions(item) {
    const cell = element("td");
    const wrapper = element("div", "table-actions");
    wrapper.append(
      actionButton("Editar", () => openEditItem(item)),
      actionButton("Remover", () => removeItem(item), "table-action--danger"),
    );
    cell.append(wrapper);
    return cell;
  }

  function caregiverBlock(group) {
    const block = element("article", "report-caregiver");
    const header = element("div", "report-caregiver__header");
    const title = element("div");
    title.append(
      element("h3", "", group.profileName),
      element("p", "report-caregiver__meta", `Plantões: ${group.shiftCount} · Horas: ${formatHours(group.minutes)} · Total: ${formatCents(group.totalCents)}`),
    );
    const actions = element("div", "table-actions report-caregiver__actions");
    actions.append(
      actionButton("+ Plantão", () => openAddItem({ profileId: group.profileId, type: "shift" })),
      actionButton("+ Desconto/acréscimo", () => openAddItem({ profileId: group.profileId, type: "discount" })),
      actionButton("PDF", () => printReport(group.profileId)),
    );
    header.append(title, actions);

    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>Data</th><th>Horário</th><th>Duração</th><th>Valor</th><th>Descrição</th><th>Ações</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const item of group.shifts) {
      const row = document.createElement("tr");
      row.append(
        element("td", "", formatShortDate(item.startDate)),
        element("td", "", `${item.startTime} → ${item.endTime}`),
        element("td", "", formatHours(item.durationMinutes)),
        amountCell(item),
        element("td", "table-cell--wrap", item.description || (item.scheduleShiftId ? "" : "Adicionado manualmente")),
        itemActions(item),
      );
      body.append(row);
    }
    for (const item of group.adjustments) {
      const row = element("tr", "report-adjustment-row");
      const label = element("td", "", adjustmentLabel(item));
      label.colSpan = 3;
      row.append(label, amountCell(item), element("td", "table-cell--wrap", item.description || ""), itemActions(item));
      body.append(row);
    }
    table.append(body);
    const wrapper = element("div", "table-wrapper");
    wrapper.append(table);
    block.append(header, wrapper);
    return block;
  }

  async function removeItem(item) {
    const what = item.kind === "shift" ? `o plantão de ${formatShortDate(item.startDate)}` : `o ${adjustmentLabel(item).toLowerCase()} “${item.description}”`;
    if (!window.confirm(`Remover ${what} de ${item.profileName} deste relatório? A escala não será alterada.`)) return;
    try {
      await PaymentReportsRepository.removeItem(currentReport.id, item.id);
      await reloadReport();
    } catch (error) {
      detailMessage.textContent = error.message;
    }
  }

  recalculateButton.addEventListener("click", async () => {
    if (!window.confirm("Recalcular pela escala? Os plantões serão copiados novamente da escala e dos valores atuais de Pagamentos. Edições, remoções e plantões adicionados à mão serão perdidos; descontos e acréscimos são mantidos.")) return;
    detailMessage.textContent = "Recalculando...";
    try {
      await PaymentReportsRepository.recalculate(currentReport.id);
      detailMessage.textContent = "";
      await reloadReport();
    } catch (error) {
      detailMessage.textContent = error.message;
    }
  });

  backButton.addEventListener("click", showList);
  addButton.addEventListener("click", () => openAddItem({ type: "shift" }));
  printAllButton.addEventListener("click", () => printReport(null));

  // ---------- Modal de edição ----------

  function field(labelText, control, { full = false } = {}) {
    const wrapper = element("div", `form-field${full ? " form-field--full" : ""}`);
    if (!control.id) control.id = `report-field-${Math.random().toString(36).slice(2, 9)}`;
    const label = element("label", "", labelText);
    label.htmlFor = control.id;
    wrapper.append(label, control);
    return wrapper;
  }

  function input(type, name, value = "", attributes = {}) {
    const node = document.createElement("input");
    node.type = type;
    node.name = name;
    node.value = value;
    for (const [key, attrValue] of Object.entries(attributes)) node.setAttribute(key, attrValue);
    return node;
  }

  function amountInput(name, cents) {
    const value = cents === null || cents === undefined ? "" : (Math.abs(cents) / 100).toFixed(2);
    return input("number", name, value, { min: "0", step: "0.01", inputmode: "decimal", required: "" });
  }

  function select(name, options, selected) {
    const node = document.createElement("select");
    node.name = name;
    for (const [value, label] of options) {
      const option = element("option", "", label);
      option.value = value;
      option.selected = String(value) === String(selected);
      node.append(option);
    }
    return node;
  }

  function openModal(title, fields, onSubmit) {
    modalTitle.textContent = title;
    modalFields.replaceChildren(...fields);
    modalMessage.textContent = "";
    modalSubmit = onSubmit;
    modalOverlay.hidden = false;
    modalFields.querySelector("input, select")?.focus();
  }

  function closeModal() {
    modalOverlay.hidden = true;
    modalSubmit = null;
  }

  closeModalButton.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (event) => { if (event.target === modalOverlay) closeModal(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modalOverlay.hidden) closeModal(); });

  modalForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!modalSubmit) return;
    modalMessage.textContent = "Salvando...";
    try {
      await modalSubmit(new FormData(modalForm));
      closeModal();
      await reloadReport();
    } catch (error) {
      modalMessage.textContent = error.message;
    }
  });

  function openEditItem(item) {
    const title = item.kind === "shift"
      ? `Plantão de ${item.profileName} · ${formatShortDate(item.startDate)} ${item.startTime} → ${item.endTime}`
      : `${adjustmentLabel(item)} de ${item.profileName}`;
    const descriptionInput = input("text", "description", item.description || "", { maxlength: "120" });
    if (item.kind === "adjustment") descriptionInput.required = true;
    openModal(title, [
      field("Valor (R$)", amountInput("amount", item.amountCents)),
      field(item.kind === "shift" ? "Descrição (opcional, ex.: feriado)" : "Descrição", descriptionInput, { full: true }),
    ], (data) => PaymentReportsRepository.updateItem(currentReport.id, item.id, {
      amount: data.get("amount"), description: data.get("description"),
    }));
  }

  function caregiverOptions() {
    const known = new Map(caregivers.filter((profile) => profile.isActive).map((profile) => [String(profile.id), profile.name]));
    for (const item of currentReport.items) known.set(String(item.profileId), item.profileName);
    return [...known.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }

  function openAddItem({ profileId = null, type }) {
    const typeSelect = select("type", [["shift", "Plantão"], ["discount", "Desconto"], ["bonus", "Acréscimo"]], type);
    const shiftFields = [
      field("Data", input("date", "date", currentReport.startDate, { required: "" })),
      field("Início", input("time", "startTime", "07:00", { required: "" })),
      field("Término", input("time", "endTime", "19:00", { required: "" })),
    ];
    const descriptionInput = input("text", "description", "", { maxlength: "120" });
    const descriptionField = field("Descrição", descriptionInput, { full: true });
    const hint = element("p", "earnings-note form-field--full", "Término igual ou antes do início = termina no dia seguinte (plantão noturno ou de 24h).");

    function syncType() {
      const isShift = typeSelect.value === "shift";
      for (const wrapper of shiftFields) {
        wrapper.hidden = !isShift;
        wrapper.querySelector("input").required = isShift;
      }
      hint.hidden = !isShift;
      descriptionInput.required = !isShift;
      descriptionField.querySelector("label").textContent = isShift ? "Descrição (opcional)" : "Descrição (ex.: vale, adiantamento, bônus)";
    }
    typeSelect.addEventListener("change", syncType);

    openModal("Adicionar ao relatório", [
      field("Cuidador", select("profileId", caregiverOptions(), profileId)),
      field("Tipo", typeSelect),
      ...shiftFields,
      hint,
      field("Valor (R$)", amountInput("amount", null)),
      descriptionField,
    ], (data) => {
      const kindType = data.get("type");
      const base = { profileId: data.get("profileId"), amount: data.get("amount"), description: data.get("description") };
      const payload = kindType === "shift"
        ? { ...base, kind: "shift", date: data.get("date"), startTime: data.get("startTime"), endTime: data.get("endTime") }
        : { ...base, kind: "adjustment", direction: kindType };
      return PaymentReportsRepository.addItem(currentReport.id, payload);
    });
    syncType();
  }

  // ---------- PDF (impressão) ----------

  function printTable(group) {
    const table = element("table", "report-print__table");
    table.innerHTML = "<thead><tr><th>Data</th><th>Horário</th><th>Duração</th><th class=\"report-print__amount\">Valor</th><th>Observação</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const item of group.shifts) {
      const row = document.createElement("tr");
      row.append(
        element("td", "", formatShortDate(item.startDate)),
        element("td", "", `${item.startTime} → ${item.endTime}`),
        element("td", "", formatHours(item.durationMinutes)),
        element("td", "report-print__amount", item.amountCents === null ? "sem valor" : formatCents(item.amountCents)),
        element("td", "", item.description || ""),
      );
      body.append(row);
    }
    for (const item of group.adjustments) {
      const row = element("tr", "report-print__adjustment");
      const label = element("td", "", `${adjustmentLabel(item)}: ${item.description || ""}`);
      label.colSpan = 3;
      row.append(label, element("td", "report-print__amount", formatCents(item.amountCents)), element("td"));
      body.append(row);
    }
    table.append(body);
    return table;
  }

  function buildPrintDocument(report, summary, singleCaregiver) {
    const header = element("header", "report-print__header");
    header.append(
      element("h1", "", `Lory's Care — Relatório de pagamento (${cycleLabel(report.cycleDay).toLowerCase()})`),
      element("p", "", `Período: ${periodLabel(report)}`),
      element("p", "", `Emitido em: ${todayLabel()}`),
    );
    const sections = summary.groups.map((group) => {
      const section = element("section", "report-print__caregiver");
      const footer = element("p", "report-print__subtotal");
      footer.append(
        element("span", "", `Plantões: ${group.shiftCount} · Horas: ${formatHours(group.minutes)}`),
        element("strong", "", `Total: ${formatCents(group.totalCents)}`),
      );
      section.append(element("h2", "", group.profileName), printTable(group), footer);
      return section;
    });
    const nodes = [header, ...sections];
    if (!singleCaregiver) {
      const total = element("p", "report-print__grand-total");
      total.append(
        element("span", "", `Cuidadores: ${summary.caregiverCount} · Plantões: ${summary.shiftCount} · Horas: ${formatHours(summary.minutes)}`),
        element("strong", "", `TOTAL GERAL: ${formatCents(summary.totalCents)}`),
      );
      nodes.push(total);
    }
    printContainer.replaceChildren(...nodes);
  }

  function printReport(profileId) {
    const report = currentReport;
    const summary = summarize(report, profileId);
    if (!summary.groups.length) {
      detailMessage.textContent = "Nada para imprimir neste relatório.";
      return;
    }
    if (summary.missingCount && !window.confirm(`${summary.missingCount} plantão(ões) estão sem valor e aparecerão como “sem valor” no PDF. Gerar mesmo assim?`)) return;
    buildPrintDocument(report, summary, Boolean(profileId));
    const previousTitle = document.title;
    const who = profileId ? ` - ${summary.groups[0].profileName}` : "";
    document.title = `Relatório pagamento ${cycleLabel(report.cycleDay).toLowerCase()} - ${report.startDate} a ${report.endDate}${who}`;
    document.body.classList.add("printing-report");
    window.addEventListener("afterprint", () => {
      document.title = previousTitle;
      document.body.classList.remove("printing-report");
    }, { once: true });
    window.print();
  }

  // ---------- Integração com a página ----------

  async function activate() {
    if (!activated) {
      activated = true;
      try {
        caregivers = await CaregiverProfilesRepository.getAll();
      } catch (error) {
        listMessage.textContent = error.message;
      }
    }
    if (currentReport) await reloadReport();
    else await loadList();
  }

  function handleLiveUpdate(event) {
    if (!activated || event.resource !== "payment-reports") return;
    if (!modalOverlay.hidden) return;
    if (currentReport) reloadReport();
    else loadList();
  }

  return Object.freeze({ activate, handleLiveUpdate });
})();
