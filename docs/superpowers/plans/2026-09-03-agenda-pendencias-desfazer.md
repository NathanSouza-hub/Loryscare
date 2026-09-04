# Agenda: pendências do dia anterior no sino + desfazer conclusão — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No Dashboard (agenda do dia), avisar no sino sobre atividades/medicamentos/eventos que ficaram pendentes no dia anterior (com o cuidador escalado naquele horário, via Plantões, quando houver), e permitir que quem marcou algo como concluído/não-realizado desfaça a marcação clicando de novo no mesmo botão.

**Architecture:** Reaproveita o padrão já existente de `getDaily(date, patientId, userId)` nos três módulos (`routines`, `medications`, `events`) para um novo `getMissed(patientId, userId)` que fixa a data em "ontem" (calculado no service, em JS) e cruza com `schedule_shifts` para achar o cuidador escalado. O "desfazer" reaproveita a trava de autoria já implementada em atividades/medicamentos (Etapa 1 da autoria imutável) — adiciona `"pending"` como status válido (remove a linha de conclusão) — e leva essa mesma trava pela primeira vez para eventos (que hoje não têm proteção nenhuma).

**Tech Stack:** Node.js (`node:test`, sem framework de mock — repositórios são objetos simples passados nos testes), Express, PostgreSQL (`pg`), frontend em JS puro (Repository Pattern, sem build step).

**Spec:** `docs/superpowers/specs/2026-09-03-agenda-pendencias-desfazer-design.md`

## Global Constraints

- Nenhuma migration de banco — todas as colunas necessárias (`author_profile_id`, `completed_by_profile_id`, etc.) já existem.
- "Ontem" é sempre calculado no servidor (JS, `new Date()` menos 1 dia), nunca recebido do cliente.
- Sem escala (`schedule_shifts`) cobrindo o horário → `onDutyProfileName` vem `null`, e o item ainda aparece no sino (sem nome).
- Reverter para `"pending"` só é permitido para quem é o autor/`completed_by_profile_id` do registro; outro perfil recebe o mesmo erro 409 de conflito já usado hoje para edição.
- Sino continua existindo só no Dashboard (`index.html`) — não adicionar sino em outras páginas.
- Seguir exatamente os padrões já existentes nos três módulos (repository pattern, `Object.freeze` nos exports, `action()`/`handle()` nos controllers, mensagens de erro em português).

---

## Task 1: Rotinas — pendências de ontem (`getMissed`)

**Files:**
- Modify: `backend/src/repositories/routines-repository.js`
- Modify: `backend/src/services/routines-service.js`
- Modify: `backend/src/controllers/routines-controller.js`
- Modify: `backend/src/routes/routines-routes.js`
- Test: `backend/test/routines-service.test.js`

**Interfaces:**
- Produces: `RoutinesService.getMissed(patientId, userId) => Promise<Array<{id, title, time, onDutyProfileName}>>`
- Produces: `RoutinesRepository.getMissed(date, patientId, userId) => Promise<Array<{id, title, time, onDutyProfileName}>>` (não testado isoladamente — mesma convenção de `getDaily`, verificado manualmente)
- Rota: `GET /api/routines/missed?patientId=X`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final do `describe("routines service", ...)` em `backend/test/routines-service.test.js`, antes do `});` final:

```javascript
  it("busca pendências de ontem repassando a data calculada e os ids", async () => {
    let received;
    const service = createRoutinesService({
      async getMissed(date, patientId, userId) { received = { date, patientId, userId }; return [{ id: "1" }]; },
    });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const pad = (value) => String(value).padStart(2, "0");
    const expectedDate = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;

    const result = await service.getMissed("3", "9");

    assert.deepEqual(result, [{ id: "1" }]);
    assert.equal(received.date, expectedDate);
    assert.equal(received.patientId, "3");
    assert.equal(received.userId, "9");
  });

  it("rejeita getMissed sem patientId válido", async () => {
    const service = createRoutinesService({ getMissed: async () => assert.fail() });
    await assert.rejects(service.getMissed("abc", "9"), RoutineValidationError);
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd backend && node --test test/routines-service.test.js`
Expected: FAIL — `service.getMissed is not a function`

- [ ] **Step 3: Implementar `getMissed` no service**

Em `backend/src/services/routines-service.js`, adicionar antes de `return Object.freeze({ ... })`:

```javascript
  function yesterday() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  async function getMissed(patientId, userId) {
    validateId(patientId, "patientId");
    return repository.getMissed(yesterday(), patientId, userId);
  }
```

E incluir `getMissed` no `Object.freeze({ create, getAll, getDaily, getMissed, remove, setCompletion, update })`.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd backend && node --test test/routines-service.test.js`
Expected: PASS

- [ ] **Step 5: Implementar a query no repository**

Em `backend/src/repositories/routines-repository.js`, adicionar (antes do `module.exports`):

```javascript
async function getMissed(date, patientId, userId) {
  const result = await pool.query(
    `SELECT r.id, r.title, to_char(r.scheduled_time, 'HH24:MI') AS time,
       cp.name AS "onDutyProfileName"
     FROM routines r
     LEFT JOIN routine_completions c ON c.routine_id = r.id AND c.scheduled_date = $1
     LEFT JOIN schedule_shifts ss ON ss.user_id = $3
       AND ss.scheduled_start_at <= ($1::text || ' ' || to_char(r.scheduled_time, 'HH24:MI'))::timestamp
       AND ss.scheduled_end_at > ($1::text || ' ' || to_char(r.scheduled_time, 'HH24:MI'))::timestamp
     LEFT JOIN caregiver_profiles cp ON cp.id = ss.profile_id
     WHERE r.is_active = TRUE AND r.start_date <= $1
       AND r.patient_id = $2
       AND r.patient_id IN (SELECT id FROM patients WHERE user_id = $3)
       AND COALESCE(c.status, 'pending') = 'pending'
     ORDER BY r.scheduled_time, r.title`,
    [date, patientId, userId],
  );
  return result.rows;
}
```

E adicionar `getMissed` no `module.exports = Object.freeze({ create, existsOnDate, findCompletion, getAll, getDaily, getMissed, insertCompletion, patientBelongsToUser, remove, update, updateCompletion });`.

- [ ] **Step 6: Expor o controller e a rota**

Em `backend/src/controllers/routines-controller.js`, dentro do `Object.freeze({ ... })` retornado por `createRoutinesController`, adicionar:

```javascript
    getMissed: action(async (request, response) => response.json({ data: await service.getMissed(request.query.patientId, request.userId) })),
```

Em `backend/src/routes/routines-routes.js`, adicionar logo após `router.get("/daily", controller.getDaily);`:

```javascript
  router.get("/missed", controller.getMissed);
```

- [ ] **Step 7: Rodar a suíte inteira do backend**

Run: `cd backend && node --test`
Expected: PASS, sem regressões

- [ ] **Step 8: Commit**

```bash
git add backend/src/repositories/routines-repository.js backend/src/services/routines-service.js backend/src/controllers/routines-controller.js backend/src/routes/routines-routes.js backend/test/routines-service.test.js
git commit -m "feat(routines): adiciona endpoint de pendencias do dia anterior"
```

---

## Task 2: Medicamentos — pendências de ontem (`getMissed`)

**Files:**
- Modify: `backend/src/repositories/medications-repository.js`
- Modify: `backend/src/services/medications-service.js`
- Modify: `backend/src/controllers/medications-controller.js`
- Modify: `backend/src/routes/medications-routes.js`
- Test: `backend/test/medications-service.test.js`

**Interfaces:**
- Produces: `MedicationsService.getMissed(patientId, userId) => Promise<Array<{medicationId, scheduleId, title, time, onDutyProfileName}>>`
- Produces: `MedicationsRepository.getMissed(date, patientId, userId)` (mesma forma, não testado isoladamente)
- Rota: `GET /api/medications/missed?patientId=X`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `backend/test/medications-service.test.js` (mesmo `describe` do arquivo, antes do fechamento):

```javascript
  it("busca pendências de ontem repassando a data calculada e os ids", async () => {
    let received;
    const service = createMedicationsService({
      async getMissed(date, patientId, userId) { received = { date, patientId, userId }; return [{ medicationId: "1", scheduleId: "2" }]; },
    });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const pad = (value) => String(value).padStart(2, "0");
    const expectedDate = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;

    const result = await service.getMissed("3", "9");

    assert.deepEqual(result, [{ medicationId: "1", scheduleId: "2" }]);
    assert.equal(received.date, expectedDate);
    assert.equal(received.patientId, "3");
    assert.equal(received.userId, "9");
  });

  it("rejeita getMissed sem patientId válido", async () => {
    const service = createMedicationsService({ getMissed: async () => assert.fail() });
    await assert.rejects(service.getMissed("abc", "9"), MedicationValidationError);
  });
```

Confirme que `MedicationValidationError` já está importado no topo do arquivo de teste; se não estiver, adicione `const MedicationValidationError = require("../src/errors/medication-validation-error");`.

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd backend && node --test test/medications-service.test.js`
Expected: FAIL — `service.getMissed is not a function`

- [ ] **Step 3: Implementar `getMissed` no service**

Em `backend/src/services/medications-service.js`, adicionar antes de `return Object.freeze({ ... })`:

```javascript
  function yesterday() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  async function getMissed(patientId, userId) {
    validateId(patientId, "patientId");
    return repository.getMissed(yesterday(), patientId, userId);
  }
```

E incluir `getMissed` no `Object.freeze({ create, getAll, getDaily, getMissed, remove, setAdministration, update })`.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd backend && node --test test/medications-service.test.js`
Expected: PASS

- [ ] **Step 5: Implementar a query no repository**

Em `backend/src/repositories/medications-repository.js`, adicionar (antes do `module.exports`):

```javascript
async function getMissed(date, patientId, userId) {
  const result = await pool.query(
    `SELECT m.id AS "medicationId", s.id AS "scheduleId", m.name AS title,
       to_char(s.scheduled_time, 'HH24:MI') AS time, cp.name AS "onDutyProfileName"
     FROM medications m
     JOIN medication_schedules s ON s.medication_id = m.id AND s.is_active = TRUE
     LEFT JOIN medication_administrations a ON a.schedule_id = s.id AND a.scheduled_date = $1
     LEFT JOIN schedule_shifts ss ON ss.user_id = $3
       AND ss.scheduled_start_at <= ($1::text || ' ' || to_char(s.scheduled_time, 'HH24:MI'))::timestamp
       AND ss.scheduled_end_at > ($1::text || ' ' || to_char(s.scheduled_time, 'HH24:MI'))::timestamp
     LEFT JOIN caregiver_profiles cp ON cp.id = ss.profile_id
     WHERE m.is_active = TRUE
       AND m.start_date <= $1 AND (m.end_date IS NULL OR m.end_date >= $1)
       AND m.patient_id = $2
       AND m.patient_id IN (SELECT id FROM patients WHERE user_id = $3)
       AND COALESCE(a.status, 'pending') = 'pending'
     ORDER BY s.scheduled_time, m.name`,
    [date, patientId, userId],
  );
  return result.rows;
}
```

E adicionar `getMissed` no `module.exports = Object.freeze({ create, findAdministration, getAll, getDaily, getMissed, insertAdministration, patientBelongsToUser, remove, scheduleBelongsToMedication, update, updateAdministration });`.

- [ ] **Step 6: Expor o controller e a rota**

Em `backend/src/controllers/medications-controller.js`, adicionar dentro do `Object.freeze({ ... })`:

```javascript
    getMissed: action(async (request, response) => response.json({ data: await service.getMissed(request.query.patientId, request.userId) })),
```

Em `backend/src/routes/medications-routes.js`, adicionar logo após `router.get("/daily", controller.getDaily);`:

```javascript
  router.get("/missed", controller.getMissed);
```

- [ ] **Step 7: Rodar a suíte inteira do backend**

Run: `cd backend && node --test`
Expected: PASS, sem regressões

- [ ] **Step 8: Commit**

```bash
git add backend/src/repositories/medications-repository.js backend/src/services/medications-service.js backend/src/controllers/medications-controller.js backend/src/routes/medications-routes.js backend/test/medications-service.test.js
git commit -m "feat(medications): adiciona endpoint de pendencias do dia anterior"
```

---

## Task 3: Eventos — pendências de ontem (`getMissed`)

**Files:**
- Modify: `backend/src/repositories/events-repository.js`
- Modify: `backend/src/services/events-service.js`
- Modify: `backend/src/controllers/events-controller.js`
- Modify: `backend/src/routes/events-routes.js`
- Test: `backend/test/events-service.test.js`

**Interfaces:**
- Produces: `EventsService.getMissed(patientId, userId) => Promise<Array<{id, title, time, onDutyProfileName}>>`
- Produces: `EventsRepository.getMissed(date, patientId, userId)` (mesma forma, não testado isoladamente)
- Rota: `GET /api/events/missed?patientId=X`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `backend/test/events-service.test.js` (confira o import de `EventValidationError` no topo; adicione se faltar):

```javascript
  it("busca pendências de ontem repassando a data calculada e os ids", async () => {
    let received;
    const service = createEventsService({
      async getMissed(date, patientId, userId) { received = { date, patientId, userId }; return [{ id: "1" }]; },
    });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const pad = (value) => String(value).padStart(2, "0");
    const expectedDate = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;

    const result = await service.getMissed("3", "9");

    assert.deepEqual(result, [{ id: "1" }]);
    assert.equal(received.date, expectedDate);
    assert.equal(received.patientId, "3");
    assert.equal(received.userId, "9");
  });

  it("rejeita getMissed sem patientId válido", async () => {
    const service = createEventsService({ getMissed: async () => assert.fail() });
    await assert.rejects(service.getMissed("abc", "9"), EventValidationError);
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd backend && node --test test/events-service.test.js`
Expected: FAIL — `service.getMissed is not a function`

- [ ] **Step 3: Implementar `getMissed` no service**

Em `backend/src/services/events-service.js`, adicionar antes de `return Object.freeze({ ... })`:

```javascript
  function yesterday() {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  async function getMissed(patientId, userId) {
    validateId(patientId, "patientId");
    return repository.getMissed(yesterday(), patientId, userId);
  }
```

E incluir `getMissed` no `Object.freeze({ create, getAll, getDaily, getMissed, getUpcoming, remove, setStatus, update })`.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd backend && node --test test/events-service.test.js`
Expected: PASS

- [ ] **Step 5: Implementar a query no repository**

Em `backend/src/repositories/events-repository.js`, adicionar (antes do `module.exports`):

```javascript
async function getMissed(date, patientId, userId) {
  const result = await pool.query(
    `SELECT e.id, e.title, to_char(e.event_time, 'HH24:MI') AS time,
       cp.name AS "onDutyProfileName"
     FROM events e
     LEFT JOIN schedule_shifts ss ON ss.user_id = $3
       AND ss.scheduled_start_at <= ($1::text || ' ' || to_char(e.event_time, 'HH24:MI'))::timestamp
       AND ss.scheduled_end_at > ($1::text || ' ' || to_char(e.event_time, 'HH24:MI'))::timestamp
     LEFT JOIN caregiver_profiles cp ON cp.id = ss.profile_id
     WHERE e.event_date = $1 AND e.status = 'pending'
       AND e.patient_id = $2
       AND e.patient_id IN (SELECT id FROM patients WHERE user_id = $3)
     ORDER BY e.event_time, e.title`,
    [date, patientId, userId],
  );
  return result.rows;
}
```

E adicionar `getMissed` no `module.exports = Object.freeze({ create, createMany, getAll, getDaily, getMissed, getUpcoming, patientBelongsToUser, remove, setStatus, update });`.

- [ ] **Step 6: Expor o controller e a rota**

Em `backend/src/controllers/events-controller.js`, adicionar dentro do `Object.freeze({ ... })`:

```javascript
    getMissed: action(async (request, response) => response.json({ data: await service.getMissed(request.query.patientId, request.userId) })),
```

Em `backend/src/routes/events-routes.js`, adicionar logo após `router.get("/daily", controller.getDaily);`:

```javascript
  router.get("/missed", controller.getMissed);
```

- [ ] **Step 7: Rodar a suíte inteira do backend**

Run: `cd backend && node --test`
Expected: PASS, sem regressões

- [ ] **Step 8: Commit**

```bash
git add backend/src/repositories/events-repository.js backend/src/services/events-service.js backend/src/controllers/events-controller.js backend/src/routes/events-routes.js backend/test/events-service.test.js
git commit -m "feat(events): adiciona endpoint de pendencias do dia anterior"
```

---

## Task 4: Frontend — seção "Não realizado ontem" no sino

**Depende de:** Tasks 1, 2 e 3 (usa os três endpoints `/missed`).

**Files:**
- Modify: `frontend/js/routines-repository.js`
- Modify: `frontend/js/medications-repository.js`
- Modify: `frontend/js/events-repository.js`
- Modify: `frontend/index.html`
- Modify: `frontend/js/dashboard.js`

**Interfaces:**
- Consumes: `GET /api/routines/missed`, `GET /api/medications/missed`, `GET /api/events/missed` (Tasks 1-3)
- Produces: `RoutinesRepository.getMissed(patientId)`, `MedicationsRepository.getMissed(patientId)`, `EventsRepository.getMissed(patientId)` — todos `=> Promise<Array<{..., time, onDutyProfileName}>>`

- [ ] **Step 1: Adicionar `getMissed` nos três repositórios do frontend**

Em `frontend/js/routines-repository.js`, adicionar antes do `return Object.freeze(...)`:

```javascript
  async function getMissed(patientId) { return (await request(`${API_URL}/missed?patientId=${encodeURIComponent(patientId)}`)).data; }
```

E incluir `getMissed` no `Object.freeze({ create, getAll, getDaily, getMissed, remove, setCompletion, update })`.

Em `frontend/js/medications-repository.js`, mesma coisa:

```javascript
  async function getMissed(patientId) { return (await request(`${API_URL}/missed?patientId=${encodeURIComponent(patientId)}`)).data; }
```

Incluir em `Object.freeze({ create, getAll, getDaily, getMissed, remove, setAdministration, update })`.

Em `frontend/js/events-repository.js`, mesma coisa:

```javascript
  async function getMissed(patientId) { return (await request(`${API_URL}/missed?patientId=${encodeURIComponent(patientId)}`)).data; }
```

Incluir em `Object.freeze({ create, getAll, getDaily, getMissed, getUpcoming, remove, setStatus, update })`.

- [ ] **Step 2: Adicionar a seção no HTML do painel de notificações**

Em `frontend/index.html`, dentro de `<div class="notifications__panel" id="notifications-panel" hidden>` (linhas 49-53 hoje), adicionar a nova seção ANTES do bloco "Eventos próximos" existente:

```html
              <div class="notifications__panel" id="notifications-panel" hidden>
                <p class="notifications__title">Não realizado ontem</p>
                <p class="notifications__empty" id="notifications-missed-empty">Nenhuma pendência de ontem.</p>
                <ul class="notifications__list" id="notifications-missed-list"></ul>
                <p class="notifications__title">Eventos próximos</p>
                <p class="notifications__empty" id="notifications-empty">Nenhum evento nos próximos dias.</p>
                <ul class="notifications__list" id="notifications-list"></ul>
              </div>
```

Não é necessário CSS novo — reaproveita `.notifications__title`, `.notifications__empty` e `.notifications__list`, já existentes em `frontend/css/styles.css`.

- [ ] **Step 3: Estender `dashboard.js` para carregar e renderizar as pendências**

Em `frontend/js/dashboard.js`, adicionar os novos elementos junto aos outros `const` do topo do arquivo (perto da linha 22):

```javascript
const notificationsMissedEmpty = document.querySelector("#notifications-missed-empty");
const notificationsMissedList = document.querySelector("#notifications-missed-list");
```

Adicionar a função `missedRow` logo depois de `notificationRow` (por volta da linha 283):

```javascript
function missedVerb(kind) {
  if (kind === "medication") return "não foi aplicado(a)";
  if (kind === "event") return "não foi realizado";
  return "não foi realizada";
}

function missedRow(item) {
  const row = document.createElement("li");
  row.className = "notifications__item";
  const title = document.createElement("p");
  title.className = "notifications__item-title";
  title.textContent = `${item.title} ${missedVerb(item.kind)}`;
  const when = document.createElement("p");
  when.className = "notifications__item-when";
  when.textContent = item.onDutyProfileName ? `${item.onDutyProfileName} estava de plantão` : "Ontem";
  row.append(title, when);
  return row;
}
```

Substituir a função `loadNotifications` inteira (linhas 285-292) por:

```javascript
async function loadNotifications() {
  const [upcoming, missedRoutines, missedMedications, missedEvents] = await Promise.all([
    EventsRepository.getUpcoming(patientId, 3),
    RoutinesRepository.getMissed(patientId),
    MedicationsRepository.getMissed(patientId),
    EventsRepository.getMissed(patientId),
  ]);
  const missed = [
    ...missedRoutines.map((item) => ({ ...item, kind: "routine" })),
    ...missedMedications.map((item) => ({ ...item, kind: "medication" })),
    ...missedEvents.map((item) => ({ ...item, kind: "event" })),
  ];

  notificationsMissedList.replaceChildren();
  notificationsMissedEmpty.hidden = missed.length > 0;
  missed.forEach((item) => notificationsMissedList.append(missedRow(item)));

  notificationsList.replaceChildren();
  notificationsEmpty.hidden = upcoming.length > 0;
  upcoming.forEach((item) => notificationsList.append(notificationRow(item)));

  const totalBadge = upcoming.length + missed.length;
  notificationsBadge.hidden = totalBadge === 0;
  if (totalBadge) notificationsBadge.textContent = String(totalBadge);
}
```

- [ ] **Step 4: Verificar manualmente no navegador**

Com o backend rodando (`cd backend && node src/server.js`) e o frontend servido localmente (ex.: `cd frontend && python -m http.server 5500`):
1. Crie/edite um medicamento ou atividade com horário de ontem e deixe sem marcar (não clique em concluir/não realizado para a data de ontem).
2. Abra o Dashboard, clique no sino.
3. Confirme que aparece a seção "Não realizado ontem" com o item, e o nome do cuidador escalado (se houver escala de Plantões cobrindo aquele horário) ou sem nome (se não houver).
4. Marque o item como concluído para ontem (usando o seletor de data da agenda) e recarregue — confirme que ele some do sino.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/routines-repository.js frontend/js/medications-repository.js frontend/js/events-repository.js frontend/index.html frontend/js/dashboard.js
git commit -m "feat(dashboard): mostra pendencias do dia anterior no sino de notificacoes"
```

---

## Task 5: Rotinas — desfazer conclusão (voltar para `pending`)

**Files:**
- Modify: `backend/src/repositories/routines-repository.js`
- Modify: `backend/src/services/routines-service.js`
- Test: `backend/test/routines-service.test.js`

**Interfaces:**
- Modifica: `RoutinesService.setCompletion(id, { date, status }, userId, profileId)` — `status` agora aceita `"pending"` além de `"completed"`/`"skipped"`; retorna `null` quando reverte.
- Produces: `RoutinesRepository.removeCompletion(id) => Promise<boolean>`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `backend/test/routines-service.test.js`:

```javascript
  it("reverte para pendente removendo a conclusão quando o autor é o mesmo", async () => {
    let removedId;
    const service = createRoutinesService({
      existsOnDate: async () => true,
      findCompletion: async () => ({
        id: "6", status: "completed", completedAt: new Date("2026-08-20T09:00:00Z"),
        authorProfileId: "4", authorProfileName: "Nathan",
      }),
      async removeCompletion(id) { removedId = id; return true; },
    });
    const result = await service.setCompletion("1", { date: "2026-08-20", status: "pending" }, "9", "4");
    assert.equal(removedId, "6");
    assert.equal(result, null);
  });

  it("rejeita reverter conclusão de OUTRO autor", async () => {
    const service = createRoutinesService({
      existsOnDate: async () => true,
      findCompletion: async () => ({
        id: "6", status: "completed", completedAt: new Date("2026-08-20T09:00:00Z"),
        authorProfileId: "4", authorProfileName: "Nathan",
      }),
      removeCompletion: async () => assert.fail("não deveria remover"),
    });
    await assert.rejects(
      service.setCompletion("1", { date: "2026-08-20", status: "pending" }, "9", "7"),
      RoutineCompletionConflictError,
    );
  });

  it("reverter sem conclusão prévia é no-op", async () => {
    const service = createRoutinesService({
      existsOnDate: async () => true,
      findCompletion: async () => null,
      removeCompletion: async () => assert.fail("não deveria remover"),
    });
    const result = await service.setCompletion("1", { date: "2026-08-20", status: "pending" }, "9", "4");
    assert.equal(result, null);
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd backend && node --test test/routines-service.test.js`
Expected: FAIL — `"pending"` é rejeitado como "Status inválido" (`RoutineValidationError`), não bate com o `assert.equal(removedId, "6")` esperado.

- [ ] **Step 3: Implementar a reversão no service**

Em `backend/src/services/routines-service.js`, dentro de `setCompletion`, trocar:

```javascript
    if (!new Set(["completed", "skipped"]).has(status)) details.status = "Status inválido";
```

por:

```javascript
    if (!new Set(["completed", "skipped", "pending"]).has(status)) details.status = "Status inválido";
```

Logo depois de `if (!(await repository.existsOnDate(id, date, userId))) throw new RoutineNotFoundError(...)` e ANTES do cálculo de `completedAt`/`authorProfileId`, adicionar o desvio para reversão:

```javascript
    if (status === "pending") {
      const existing = await repository.findCompletion(id, date);
      if (!existing) return null;
      if (existing.authorProfileId != null && String(existing.authorProfileId) !== String(profileId ?? null)) {
        throw new RoutineCompletionConflictError({
          authorProfileName: existing.authorProfileName,
          completedAt: existing.completedAt,
        });
      }
      await repository.removeCompletion(existing.id);
      return null;
    }
```

(O restante da função — cálculo de `completedAt`, `insertCompletion`/`applyEdit` — continua exatamente como está, só roda para `"completed"`/`"skipped"`.)

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd backend && node --test test/routines-service.test.js`
Expected: PASS

- [ ] **Step 5: Implementar `removeCompletion` no repository**

Em `backend/src/repositories/routines-repository.js`, adicionar:

```javascript
async function removeCompletion(id) {
  const result = await pool.query("DELETE FROM routine_completions WHERE id = $1 RETURNING id", [id]);
  return result.rowCount > 0;
}
```

Incluir `removeCompletion` no `module.exports`.

- [ ] **Step 6: Rodar a suíte inteira do backend**

Run: `cd backend && node --test`
Expected: PASS, sem regressões

- [ ] **Step 7: Commit**

```bash
git add backend/src/repositories/routines-repository.js backend/src/services/routines-service.js backend/test/routines-service.test.js
git commit -m "feat(routines): permite reverter conclusao para pendente"
```

---

## Task 6: Medicamentos — desfazer administração (voltar para `pending`)

**Files:**
- Modify: `backend/src/repositories/medications-repository.js`
- Modify: `backend/src/services/medications-service.js`
- Test: `backend/test/medications-service.test.js`

**Interfaces:**
- Modifica: `MedicationsService.setAdministration(medicationId, scheduleId, { date, status, notes }, userId, profileId)` — `status` agora aceita `"pending"`; retorna `null` quando reverte.
- Produces: `MedicationsRepository.removeAdministration(id) => Promise<boolean>`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `backend/test/medications-service.test.js` (confira se `MedicationAdministrationConflictError` já está importado; se não, `const MedicationAdministrationConflictError = require("../src/errors/medication-administration-conflict-error");`):

```javascript
  it("reverte para pendente removendo a administração quando o autor é o mesmo", async () => {
    let removedId;
    const service = createMedicationsService({
      scheduleBelongsToMedication: async () => true,
      findAdministration: async () => ({
        id: "6", status: "taken", administeredAt: new Date("2026-08-20T09:00:00Z"),
        authorProfileId: "4", authorProfileName: "Nathan",
      }),
      async removeAdministration(id) { removedId = id; return true; },
    });
    const result = await service.setAdministration("1", "2", { date: "2026-08-20", status: "pending" }, "9", "4");
    assert.equal(removedId, "6");
    assert.equal(result, null);
  });

  it("rejeita reverter administração de OUTRO autor", async () => {
    const service = createMedicationsService({
      scheduleBelongsToMedication: async () => true,
      findAdministration: async () => ({
        id: "6", status: "taken", administeredAt: new Date("2026-08-20T09:00:00Z"),
        authorProfileId: "4", authorProfileName: "Nathan",
      }),
      removeAdministration: async () => assert.fail("não deveria remover"),
    });
    await assert.rejects(
      service.setAdministration("1", "2", { date: "2026-08-20", status: "pending" }, "9", "7"),
      MedicationAdministrationConflictError,
    );
  });

  it("reverter sem administração prévia é no-op", async () => {
    const service = createMedicationsService({
      scheduleBelongsToMedication: async () => true,
      findAdministration: async () => null,
      removeAdministration: async () => assert.fail("não deveria remover"),
    });
    const result = await service.setAdministration("1", "2", { date: "2026-08-20", status: "pending" }, "9", "4");
    assert.equal(result, null);
  });
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd backend && node --test test/medications-service.test.js`
Expected: FAIL — `"pending"` rejeitado como "Status inválido"

- [ ] **Step 3: Implementar a reversão no service**

Em `backend/src/services/medications-service.js`, dentro de `setAdministration`, trocar:

```javascript
    if (!new Set(["taken", "skipped"]).has(status)) details.status = "Status inválido";
```

por:

```javascript
    if (!new Set(["taken", "skipped", "pending"]).has(status)) details.status = "Status inválido";
```

Logo depois de `if (!(await repository.scheduleBelongsToMedication(medicationId, scheduleId, userId))) throw new MedicationNotFoundError(...)` e ANTES do cálculo de `administeredAt`, adicionar:

```javascript
    if (status === "pending") {
      const existing = await repository.findAdministration(scheduleId, date);
      if (!existing) return null;
      if (existing.authorProfileId != null && String(existing.authorProfileId) !== String(profileId ?? null)) {
        throw new MedicationAdministrationConflictError({
          authorProfileName: existing.authorProfileName,
          administeredAt: existing.administeredAt,
        });
      }
      await repository.removeAdministration(existing.id);
      return null;
    }
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd backend && node --test test/medications-service.test.js`
Expected: PASS

- [ ] **Step 5: Implementar `removeAdministration` no repository**

Em `backend/src/repositories/medications-repository.js`, adicionar:

```javascript
async function removeAdministration(id) {
  const result = await pool.query("DELETE FROM medication_administrations WHERE id = $1 RETURNING id", [id]);
  return result.rowCount > 0;
}
```

Incluir `removeAdministration` no `module.exports`.

- [ ] **Step 6: Rodar a suíte inteira do backend**

Run: `cd backend && node --test`
Expected: PASS, sem regressões

- [ ] **Step 7: Commit**

```bash
git add backend/src/repositories/medications-repository.js backend/src/services/medications-service.js backend/test/medications-service.test.js
git commit -m "feat(medications): permite reverter administracao para pendente"
```

---

## Task 7: Eventos — trava de autoria + desfazer conclusão

**Files:**
- Create: `backend/src/errors/event-completion-conflict-error.js`
- Modify: `backend/src/repositories/events-repository.js`
- Modify: `backend/src/services/events-service.js`
- Modify: `backend/src/controllers/events-controller.js`
- Test: `backend/test/events-service.test.js`

**Interfaces:**
- Produces: `EventCompletionConflictError` (mesmo formato de `RoutineCompletionConflictError`/`MedicationAdministrationConflictError`, propriedades `authorProfileName`/`completedAt`) — 409
- Modifica: `EventsService.setStatus(id, { status }, userId, profileId)` — `status` aceita `"completed"`/`"skipped"`/`"pending"`; primeira conclusão por qualquer perfil ainda funciona; qualquer chamada seguinte só é aceita do mesmo `completed_by_profile_id`.
- Produces: `EventsRepository.findById(id, userId) => Promise<{id, status, completedAt, completedByProfileId, completedByProfileName} | null>`

- [ ] **Step 1: Criar a classe de erro**

Criar `backend/src/errors/event-completion-conflict-error.js`:

```javascript
class EventCompletionConflictError extends Error {
  constructor({ authorProfileName, completedAt } = {}) {
    super(
      authorProfileName
        ? `Este evento já foi registrado por ${authorProfileName}`
        : "Este evento já foi registrado por outro cuidador",
    );
    this.name = "EventCompletionConflictError";
    this.authorProfileName = authorProfileName ?? null;
    this.completedAt = completedAt ?? null;
  }
}

module.exports = EventCompletionConflictError;
```

- [ ] **Step 2: Escrever os testes que falham**

No topo de `backend/test/events-service.test.js`, adicionar (se ainda não houver import de erro de conflito):

```javascript
const EventCompletionConflictError = require("../src/errors/event-completion-conflict-error");
```

Adicionar os testes:

```javascript
  it("permite que qualquer perfil conclua um evento ainda pendente", async () => {
    let received;
    const service = createEventsService({
      async setStatus(id, status, userId, profileId) {
        received = { id, status, userId, profileId };
        return { id, status, completedAt: new Date(), completedByProfileId: profileId };
      },
    });
    const result = await service.setStatus("1", { status: "completed" }, "9", "4");
    assert.equal(received.profileId, "4");
    assert.equal(result.completedByProfileId, "4");
  });

  it("rejeita segunda conclusão de OUTRO perfil com EventCompletionConflictError", async () => {
    const service = createEventsService({
      setStatus: async () => null,
      findById: async () => ({
        id: "1", status: "completed", completedAt: new Date("2026-08-20T09:00:00Z"),
        completedByProfileId: "4", completedByProfileName: "Nathan",
      }),
    });
    await assert.rejects(
      service.setStatus("1", { status: "skipped" }, "9", "7"),
      EventCompletionConflictError,
    );
  });

  it("lança EventNotFoundError quando o evento não existe/não é da conta", async () => {
    const service = createEventsService({
      setStatus: async () => null,
      findById: async () => null,
    });
    await assert.rejects(service.setStatus("1", { status: "completed" }, "9", "7"), EventNotFoundError);
  });

  it("reverte para pendente quando o mesmo perfil concluiu", async () => {
    let received;
    const service = createEventsService({
      async setStatus(id, status, userId, profileId) {
        received = { id, status, userId, profileId };
        return { id, status: "pending", completedAt: null, completedByProfileId: null };
      },
    });
    const result = await service.setStatus("1", { status: "pending" }, "9", "4");
    assert.equal(received.status, "pending");
    assert.equal(result.completedByProfileId, null);
  });
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `cd backend && node --test test/events-service.test.js`
Expected: FAIL — `"pending"` é rejeitado como "Status inválido"; testes de conflito falham porque `setStatus` hoje não usa `findById`.

- [ ] **Step 4: Implementar a autoria e a reversão no service**

Em `backend/src/services/events-service.js`, importar o novo erro no topo:

```javascript
const EventCompletionConflictError = require("../errors/event-completion-conflict-error");
```

Trocar o corpo de `setStatus`:

```javascript
  async function setStatus(id, input, userId, profileId) {
    validateId(id);
    const status = input.status;
    if (!new Set(["completed", "skipped", "pending"]).has(status)) throw new EventValidationError({ status: "Status inválido" });
    const result = await repository.setStatus(id, status, userId, profileId ?? null);
    if (result) return result;
    const existing = await repository.findById(id, userId);
    if (!existing) throw new EventNotFoundError();
    throw new EventCompletionConflictError({
      authorProfileName: existing.completedByProfileName,
      completedAt: existing.completedAt,
    });
  }
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `cd backend && node --test test/events-service.test.js`
Expected: PASS

- [ ] **Step 6: Implementar a trava de autoria e `findById` no repository**

Em `backend/src/repositories/events-repository.js`, substituir `setStatus` por:

```javascript
async function setStatus(id, status, userId, profileId) {
  const completedAt = status === "completed" ? new Date() : null;
  const completedByProfileId = status === "pending" ? null : profileId;
  const result = await pool.query(
    `UPDATE events SET status = $1, completed_at = $2, completed_by_profile_id = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $4 AND patient_id IN (SELECT id FROM patients WHERE user_id = $5)
       AND (completed_by_profile_id IS NULL OR completed_by_profile_id = $6)
     RETURNING id, status, completed_at AS "completedAt", completed_by_profile_id AS "completedByProfileId"`,
    [status, completedAt, completedByProfileId, id, userId, profileId],
  );
  return result.rows[0] ?? null;
}

async function findById(id, userId) {
  const result = await pool.query(
    `SELECT e.id, e.status, e.completed_at AS "completedAt",
       e.completed_by_profile_id AS "completedByProfileId", cp.name AS "completedByProfileName"
     FROM events e
     LEFT JOIN caregiver_profiles cp ON cp.id = e.completed_by_profile_id
     WHERE e.id = $1 AND e.patient_id IN (SELECT id FROM patients WHERE user_id = $2)`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}
```

Incluir `findById` no `module.exports = Object.freeze({ create, createMany, findById, getAll, getDaily, getMissed, getUpcoming, patientBelongsToUser, remove, setStatus, update });` (`setStatus` já estava listado).

- [ ] **Step 7: Tratar o novo erro no controller**

Em `backend/src/controllers/events-controller.js`, importar e tratar o novo erro na função `handle`:

```javascript
const EventCompletionConflictError = require("../errors/event-completion-conflict-error");

function handle(error, response, next) {
  if (error instanceof EventValidationError) response.status(400).json({ error: error.message, details: error.details });
  else if (error instanceof EventNotFoundError) response.status(404).json({ error: error.message });
  else if (error instanceof EventCompletionConflictError) {
    response.status(409).json({ error: error.message, authorProfileName: error.authorProfileName, completedAt: error.completedAt });
  } else next(error);
}
```

- [ ] **Step 8: Rodar a suíte inteira do backend**

Run: `cd backend && node --test`
Expected: PASS, sem regressões

- [ ] **Step 9: Verificar manualmente que a trava de autoria não quebrou o fluxo normal de eventos**

Com o backend rodando, crie um evento, marque como concluído com um perfil, confirme 200; tente marcar com outro perfil (`x-profile-id` diferente no header), confirme 409; marque de novo com o perfil original mudando para `"pending"`, confirme 200 e que o evento volta a aparecer como pendente em `GET /api/events/daily`.

- [ ] **Step 10: Commit**

```bash
git add backend/src/errors/event-completion-conflict-error.js backend/src/repositories/events-repository.js backend/src/services/events-service.js backend/src/controllers/events-controller.js backend/test/events-service.test.js
git commit -m "feat(events): adiciona trava de autoria e permite reverter conclusao"
```

---

## Task 8: Frontend — desfazer clicando de novo no botão

**Depende de:** Tasks 5, 6 e 7 (usa o suporte a `status: "pending"` nos três endpoints).

**Files:**
- Modify: `frontend/js/dashboard.js`

**Interfaces:**
- Consumes: `RoutinesRepository.setCompletion(id, { date, status })`, `MedicationsRepository.setAdministration(medicationId, scheduleId, { date, status })`, `EventsRepository.setStatus(id, status)` — todos já existentes, agora aceitando `status: "pending"`.

- [ ] **Step 1: Repassar `authorProfileId` dos eventos em `loadTasks`**

Em `frontend/js/dashboard.js`, dentro de `loadTasks()`, no bloco `...dailyEvents.map((eventItem) => ({ ... }))`, adicionar o campo que falta (logo depois de `authorName: eventItem.completedByProfileName,`):

```javascript
      authorName: eventItem.completedByProfileName,
      authorProfileId: eventItem.completedByProfileId,
```

- [ ] **Step 2: Travar os botões de eventos para quem não concluiu**

Em `taskRow()`, remover a exceção de eventos da checagem `lockedByOther`. Trocar:

```javascript
    const lockedByOther = item.status !== "pending" && item.kind !== "event"
      && item.authorProfileId != null
      && String(item.authorProfileId) !== String(CaregiverContext.getCurrentId());
```

por:

```javascript
    const lockedByOther = item.status !== "pending"
      && item.authorProfileId != null
      && String(item.authorProfileId) !== String(CaregiverContext.getCurrentId());
```

- [ ] **Step 3: Desfazer ao clicar de novo no botão já ativo**

Em `todayList.addEventListener("click", ...)` (dashboard.js), o bloco que hoje é:

```javascript
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
```

passa a ser:

```javascript
const item = events.find((entry) => String(entry.id) === target.dataset.id && entry.kind === target.dataset.kind);
```

Aguarde — `events` já é o nome de uma variável de outro módulo (`agenda.js`); em `dashboard.js` a lista equivalente vive só dentro de `loadTasks()` e não é guardada em variável de módulo. Adicione uma variável de módulo para isso: logo abaixo de `let patientId = null;` (topo do arquivo), adicionar:

```javascript
let currentItems = [];
```

Em `loadTasks()`, logo após a linha `].sort((first, second) => ...)` que monta `items`, adicionar:

```javascript
  currentItems = items;
```

Agora, no listener de clique, usar `currentItems` para descobrir o status atual do item clicado e decidir se o clique deve reverter para `"pending"`:

```javascript
todayList.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const item = currentItems.find((entry) => entry.kind === target.dataset.kind && String(entry.id) === target.dataset.id);
  const desiredStatus = item && item.status === target.dataset.action ? "pending" : target.dataset.action;
  try {
    if (target.dataset.kind === "routine") {
      await RoutinesRepository.setCompletion(target.dataset.id, { date: selectedDate, status: desiredStatus });
    } else if (target.dataset.kind === "event") {
      await EventsRepository.setStatus(target.dataset.id, desiredStatus);
    } else {
      await MedicationsRepository.setAdministration(target.dataset.medicationId, target.dataset.id, { date: selectedDate, status: desiredStatus });
    }
    await loadTasks();
  } catch (error) {
    message.textContent = error.message;
    await loadTasks();
  }
});
```

- [ ] **Step 4: Verificar manualmente no navegador**

Com dois perfis de cuidador cadastrados na mesma conta:
1. Com o perfil A ativo, marque uma atividade/medicamento/evento como concluído.
2. Confirme que os botões dessa linha ficam desabilitados quando você troca para o perfil B (`Trocar` no menu do usuário) — inclusive para eventos, que antes não travavam.
3. Volte para o perfil A e clique de novo no botão verde (já ativo/marcado) — confirme que o item volta para a lista de pendentes (sai da seção "Realizadas").
4. Repita para o botão vermelho (não realizado/ignorado) de cada um dos três tipos.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/dashboard.js
git commit -m "feat(dashboard): permite desfazer marcacao clicando de novo no botao"
```

---

## Self-Review Notes

- **Cobertura da spec:** "Pendências no sino" → Tasks 1-4 (um `getMissed` por módulo + UI). "Desfazer conclusão" → Tasks 5-8 (reversão em atividades/medicamentos, trava de autoria + reversão em eventos, UI). Atribuição via `schedule_shifts` está nas queries de `getMissed` das Tasks 1-3. "Sem escala → sem nome" está coberto pelo `LEFT JOIN` (produz `NULL`) e pelo `missedRow` do frontend (Task 4, Step 3) que omite o trecho quando `onDutyProfileName` é falsy.
- **Consistência de tipos:** `getMissed(patientId, userId)` no service e `getMissed(date, patientId, userId)` no repository usam a mesma ordem de parâmetros que `getDaily` já usa nos três módulos — confirmado nas Tasks 1-3. `status: "pending"` é o mesmo literal nos três `setCompletion`/`setAdministration`/`setStatus`. `currentItems`/`item.kind`/`item.status` (Task 8) usam exatamente os nomes já produzidos por `loadTasks()` (Task 8, Step 1 e o `items.map` existente).
- **Sem placeholders:** todo step tem código completo e caminho de arquivo exato; nenhuma migration é necessária (confirmado nas Global Constraints).
