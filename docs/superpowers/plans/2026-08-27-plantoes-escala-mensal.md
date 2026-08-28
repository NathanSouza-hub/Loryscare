# Plantões — Escala Mensal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Plantões" tab where a monthly caregiver shift schedule is built in advance, and make the existing "Iniciar um plantão" button use that schedule as its source of truth instead of always requiring manual entry.

**Architecture:** Follows the existing layered backend (routes → controller → service → repository, one file per concern, Postgres via `pg`) and the existing plain-JS frontend (one repository module + one page-script per resource, static HTML pages with a duplicated sidebar). Two new tables (`schedule_months`, `schedule_month_caregivers`) plus two more (`schedule_shifts`, `schedule_shift_swaps`) model the plan; `work_shifts` (existing, untouched otherwise) gains three nullable columns to link an actual shift back to the schedule slot it fulfilled.

**Tech Stack:** Node.js (CommonJS) + Express 5 + `pg` (PostgreSQL) on the backend; plain HTML/CSS/JS (no bundler, no frontend framework) on the frontend; `node --test` for backend unit tests.

**Spec:** `docs/superpowers/specs/2026-08-27-plantoes-escala-mensal-design.md`

## Global Constraints

- No existing functionality may be removed or change behavior: the manual "Iniciar um plantão" form in `perfis.html` must keep working exactly as it does today when no `scheduleShiftId` is sent.
- No migration may drop or rename a column/table. All schema changes are additive.
- Follow existing naming/style exactly: snake_case columns, camelCase via `AS "camelCase"` in SQL, one error class per failure mode in `src/errors/`, `Object.freeze({...})` on every service/repository/controller export, the `action(callback)` try/catch wrapper in every controller.
- The monthly schedule is scoped by **account (`user_id`) only**, never by patient — matches `work_shifts`/`caregiver_profiles` today.
- No new "admin" role/permission concept — any authenticated profile of the account can manage the schedule, like every other page.
- No "encerrar plantão" (end-shift) feature is built. "Concluído" is derived purely from elapsed time (see spec's status table).
- Regenerating a month that already has a schedule is blocked; the user must delete the existing month's schedule first via a dedicated endpoint.
- Drag-and-drop reorder is native HTML5 (`draggable`), no new dependency; up/down buttons are provided alongside as a non-drag alternative — not a replacement shown only as fallback.
- All new backend business logic (services) is unit-tested with fake repository objects, matching the existing pattern in `backend/test/work-shifts-service.test.js` (no real DB in tests). Repositories and routes are not unit-tested, matching the existing codebase convention — verify them by running the server and exercising the API/UI manually.

---

## File Structure

**Backend — new files:**
- `backend/database/migrations/024_create_schedule_months.sql`
- `backend/database/migrations/025_create_schedule_month_caregivers.sql`
- `backend/database/migrations/026_create_schedule_shifts.sql`
- `backend/database/migrations/027_create_schedule_shift_swaps.sql`
- `backend/database/migrations/028_add_schedule_shift_id_to_work_shifts.sql`
- `backend/src/errors/schedule-month-validation-error.js`
- `backend/src/errors/schedule-month-not-found-error.js`
- `backend/src/errors/schedule-shift-validation-error.js`
- `backend/src/errors/schedule-shift-not-found-error.js`
- `backend/src/repositories/schedule-months-repository.js`
- `backend/src/repositories/schedule-shifts-repository.js`
- `backend/src/services/schedule-months-service.js`
- `backend/src/services/schedule-shifts-service.js`
- `backend/src/controllers/schedule-months-controller.js`
- `backend/src/controllers/schedule-shifts-controller.js`
- `backend/src/routes/schedule-months-routes.js`
- `backend/src/routes/schedule-shifts-routes.js`
- `backend/test/schedule-months-service.test.js`
- `backend/test/schedule-shifts-service.test.js`

**Backend — modified files:**
- `backend/src/app.js` — wire the two new routers; pass `scheduleShiftsRepository` into `createWorkShiftsService`.
- `backend/src/repositories/work-shifts-repository.js` — `createExclusive` accepts `scheduleShiftId`/`scheduledStartAt`/`scheduledEndAt`; add `existsForScheduleShift`.
- `backend/src/services/work-shifts-service.js` — `start()` accepts an optional `scheduleShiftId`.
- `backend/test/work-shifts-service.test.js` — new cases for the schedule-linked path.

**Frontend — new files:**
- `frontend/js/schedule-repository.js`
- `frontend/plantoes.html`
- `frontend/js/plantoes.js`

**Frontend — modified files:**
- `frontend/css/styles.css` — status badges + reorder-list styles.
- `frontend/index.html`, `agenda.html`, `sinais-vitais.html`, `perfil.html`, `pacientes.html`, `medicamentos.html`, `atividades.html`, `anotacoes-enfermagem.html` — add the "Plantões" sidebar link.
- `frontend/perfis.html` — new markup for the schedule-aware shift step.
- `frontend/js/perfis.js` — lookup logic + conditional UI.

---

### Task 1: Database migrations

**Files:**
- Create: `backend/database/migrations/024_create_schedule_months.sql`
- Create: `backend/database/migrations/025_create_schedule_month_caregivers.sql`
- Create: `backend/database/migrations/026_create_schedule_shifts.sql`
- Create: `backend/database/migrations/027_create_schedule_shift_swaps.sql`
- Create: `backend/database/migrations/028_add_schedule_shift_id_to_work_shifts.sql`

**Interfaces:**
- Produces: tables `schedule_months`, `schedule_month_caregivers`, `schedule_shifts`, `schedule_shift_swaps`; new columns `work_shifts.schedule_shift_id`, `work_shifts.scheduled_start_at`, `work_shifts.scheduled_end_at`; unique index `idx_work_shifts_schedule_shift_once`. All later tasks depend on this exact schema.

- [ ] **Step 1: Write `024_create_schedule_months.sql`**

```sql
SET client_encoding TO 'UTF8';

BEGIN;

CREATE TABLE schedule_months (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year SMALLINT NOT NULL,
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  duration_hours SMALLINT NOT NULL CHECK (duration_hours IN (12, 24)),
  first_start_time TIME NOT NULL,
  second_start_time TIME,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, year, month)
);

COMMIT;
```

- [ ] **Step 2: Write `025_create_schedule_month_caregivers.sql`**

```sql
SET client_encoding TO 'UTF8';

BEGIN;

CREATE TABLE schedule_month_caregivers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_month_id BIGINT NOT NULL REFERENCES schedule_months(id) ON DELETE CASCADE,
  profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id) ON DELETE RESTRICT,
  position SMALLINT NOT NULL,
  UNIQUE (schedule_month_id, profile_id),
  UNIQUE (schedule_month_id, position)
);

COMMIT;
```

- [ ] **Step 3: Write `026_create_schedule_shifts.sql`**

```sql
SET client_encoding TO 'UTF8';

BEGIN;

CREATE TABLE schedule_shifts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_month_id BIGINT NOT NULL REFERENCES schedule_months(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_start_at TIMESTAMP NOT NULL,
  scheduled_end_at TIMESTAMP NOT NULL,
  original_profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id) ON DELETE RESTRICT,
  profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_schedule_shifts_month ON schedule_shifts (schedule_month_id);
CREATE INDEX idx_schedule_shifts_profile_window
  ON schedule_shifts (profile_id, scheduled_start_at, scheduled_end_at);

COMMIT;
```

- [ ] **Step 4: Write `027_create_schedule_shift_swaps.sql`**

```sql
SET client_encoding TO 'UTF8';

BEGIN;

CREATE TABLE schedule_shift_swaps (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_shift_id BIGINT NOT NULL REFERENCES schedule_shifts(id) ON DELETE CASCADE,
  previous_profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id),
  new_profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id),
  changed_by_profile_id BIGINT REFERENCES caregiver_profiles(id),
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
```

- [ ] **Step 5: Write `028_add_schedule_shift_id_to_work_shifts.sql`**

```sql
SET client_encoding TO 'UTF8';

BEGIN;

ALTER TABLE work_shifts
  ADD COLUMN schedule_shift_id BIGINT REFERENCES schedule_shifts(id) ON DELETE SET NULL,
  ADD COLUMN scheduled_start_at TIMESTAMP,
  ADD COLUMN scheduled_end_at TIMESTAMP;

CREATE UNIQUE INDEX idx_work_shifts_schedule_shift_once
  ON work_shifts (schedule_shift_id) WHERE schedule_shift_id IS NOT NULL;

COMMIT;
```

- [ ] **Step 6: Apply the migrations to your local database**

Apply them in order, the same way `023_add_important_to_events.sql` (the last existing migration) was applied — e.g. with `psql`, using the credentials from `backend/.env`:

```bash
psql -h localhost -p 5432 -U loreroutine_app -d loreroutine -f backend/database/migrations/024_create_schedule_months.sql
psql -h localhost -p 5432 -U loreroutine_app -d loreroutine -f backend/database/migrations/025_create_schedule_month_caregivers.sql
psql -h localhost -p 5432 -U loreroutine_app -d loreroutine -f backend/database/migrations/026_create_schedule_shifts.sql
psql -h localhost -p 5432 -U loreroutine_app -d loreroutine -f backend/database/migrations/027_create_schedule_shift_swaps.sql
psql -h localhost -p 5432 -U loreroutine_app -d loreroutine -f backend/database/migrations/028_add_schedule_shift_id_to_work_shifts.sql
```

Expected: every command prints `BEGIN`/`CREATE TABLE`/`ALTER TABLE`/`COMMIT` with no errors.

- [ ] **Step 7: Verify the schema**

```bash
psql -h localhost -p 5432 -U loreroutine_app -d loreroutine -c "\d schedule_shifts" -c "\d work_shifts"
```

Expected: `schedule_shifts` shows all 8 columns; `work_shifts` now shows `schedule_shift_id`, `scheduled_start_at`, `scheduled_end_at` in addition to its existing columns.

- [ ] **Step 8: Commit**

```bash
git add backend/database/migrations/024_create_schedule_months.sql backend/database/migrations/025_create_schedule_month_caregivers.sql backend/database/migrations/026_create_schedule_shifts.sql backend/database/migrations/027_create_schedule_shift_swaps.sql backend/database/migrations/028_add_schedule_shift_id_to_work_shifts.sql
git commit -m "feat(db): adiciona tabelas da escala mensal de plantoes"
```

---

### Task 2: `schedule-months` repository + service (TDD)

**Files:**
- Create: `backend/src/errors/schedule-month-validation-error.js`
- Create: `backend/src/errors/schedule-month-not-found-error.js`
- Create: `backend/src/repositories/schedule-months-repository.js`
- Create: `backend/src/services/schedule-months-service.js`
- Test: `backend/test/schedule-months-service.test.js`

**Interfaces:**
- Consumes: `caregiverProfilesRepository.belongsToUser(profileId, userId): Promise<boolean>` (already exists in `backend/src/repositories/caregiver-profiles-repository.js`).
- Produces: `createScheduleMonthsService(repository, caregiverProfilesRepository)` returning `{ create(input, userId), getByYearMonth(year, month, userId), remove(id, userId) }`. `repository` shape: `{ findByYearMonth(userId, year, month), getCaregivers(scheduleMonthId), create({userId, year, month, durationHours, firstStartTime, secondStartTime, caregiverIds, slots}), belongsToUser(id, userId), hasStartedShift(id), remove(id, userId) }`. `slots` items: `{ scheduledStartAt: "YYYY-MM-DD HH:MM:SS", scheduledEndAt: "YYYY-MM-DD HH:MM:SS", profileId }`.

- [ ] **Step 1: Write the error classes**

`backend/src/errors/schedule-month-validation-error.js`:
```js
class ScheduleMonthValidationError extends Error {
  constructor(details) {
    super("Dados da escala inválidos");
    this.name = "ScheduleMonthValidationError";
    this.details = details;
  }
}

module.exports = ScheduleMonthValidationError;
```

`backend/src/errors/schedule-month-not-found-error.js`:
```js
class ScheduleMonthNotFoundError extends Error {
  constructor() {
    super("Escala do mês não encontrada");
    this.name = "ScheduleMonthNotFoundError";
  }
}

module.exports = ScheduleMonthNotFoundError;
```

- [ ] **Step 2: Write the failing test file** — `backend/test/schedule-months-service.test.js`

```js
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const ScheduleMonthValidationError = require("../src/errors/schedule-month-validation-error");
const ScheduleMonthNotFoundError = require("../src/errors/schedule-month-not-found-error");
const createScheduleMonthsService = require("../src/services/schedule-months-service");

function baseInput(overrides = {}) {
  return {
    year: 2026,
    month: 9,
    durationHours: 24,
    firstStartTime: "07:00",
    caregiverIds: ["1", "2", "3"],
    ...overrides,
  };
}

function fakeCaregiverProfiles(validIds = ["1", "2", "3"]) {
  return { belongsToUser: async (id) => validIds.includes(String(id)) };
}

describe("schedule months service", () => {
  it("rejeita mês inválido", async () => {
    const service = createScheduleMonthsService({}, fakeCaregiverProfiles());
    await assert.rejects(service.create(baseInput({ month: 13 }), "9"), ScheduleMonthValidationError);
  });

  it("rejeita duração diferente de 12 ou 24", async () => {
    const service = createScheduleMonthsService({}, fakeCaregiverProfiles());
    await assert.rejects(service.create(baseInput({ durationHours: 8 }), "9"), ScheduleMonthValidationError);
  });

  it("rejeita 12h sem o segundo horário", async () => {
    const service = createScheduleMonthsService({}, fakeCaregiverProfiles());
    await assert.rejects(
      service.create(baseInput({ durationHours: 12, firstStartTime: "06:00" }), "9"),
      ScheduleMonthValidationError,
    );
  });

  it("rejeita segundo horário antes ou igual ao primeiro", async () => {
    const service = createScheduleMonthsService({}, fakeCaregiverProfiles());
    await assert.rejects(
      service.create(baseInput({ durationHours: 12, firstStartTime: "18:00", secondStartTime: "06:00" }), "9"),
      ScheduleMonthValidationError,
    );
  });

  it("rejeita sem cuidadores selecionados", async () => {
    const service = createScheduleMonthsService({}, fakeCaregiverProfiles());
    await assert.rejects(service.create(baseInput({ caregiverIds: [] }), "9"), ScheduleMonthValidationError);
  });

  it("rejeita cuidador duplicado na ordem", async () => {
    const service = createScheduleMonthsService({}, fakeCaregiverProfiles());
    await assert.rejects(service.create(baseInput({ caregiverIds: ["1", "1"] }), "9"), ScheduleMonthValidationError);
  });

  it("rejeita cuidador que não pertence à conta", async () => {
    const service = createScheduleMonthsService({}, fakeCaregiverProfiles(["1"]));
    await assert.rejects(service.create(baseInput({ caregiverIds: ["1", "99"] }), "9"), ScheduleMonthValidationError);
  });

  it("rejeita gerar quando já existe escala para o mês", async () => {
    const repository = { findByYearMonth: async () => ({ id: "5" }) };
    const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
    await assert.rejects(service.create(baseInput(), "9"), ScheduleMonthValidationError);
  });

  it("gera escala de 24h com revezamento contínuo e cruzando o fim do mês", async () => {
    let received;
    const repository = {
      findByYearMonth: async () => null,
      create: async (data) => { received = data; return "10"; },
    };
    const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
    await service.create(baseInput({ year: 2026, month: 9, caregiverIds: ["1", "2"] }), "9");
    assert.equal(received.slots.length, 30);
    assert.equal(received.slots[0].scheduledStartAt, "2026-09-01 07:00:00");
    assert.equal(received.slots[0].scheduledEndAt, "2026-09-02 07:00:00");
    assert.equal(received.slots[0].profileId, "1");
    assert.equal(received.slots[1].profileId, "2");
    assert.equal(received.slots[2].profileId, "1");
    assert.equal(received.slots[29].scheduledStartAt, "2026-09-30 07:00:00");
    assert.equal(received.slots[29].scheduledEndAt, "2026-10-01 07:00:00");
  });

  it("gera escala de 12h com dois períodos por dia sem reiniciar o revezamento a cada dia", async () => {
    let received;
    const repository = {
      findByYearMonth: async () => null,
      create: async (data) => { received = data; return "11"; },
    };
    const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
    await service.create(baseInput({
      year: 2026, month: 9, durationHours: 12, firstStartTime: "06:00", secondStartTime: "18:00",
      caregiverIds: ["1", "2", "3"],
    }), "9");
    assert.equal(received.slots.length, 60);
    assert.deepEqual(received.slots.slice(0, 4).map((slot) => slot.profileId), ["1", "2", "3", "1"]);
    assert.equal(received.slots[0].scheduledStartAt, "2026-09-01 06:00:00");
    assert.equal(received.slots[0].scheduledEndAt, "2026-09-01 18:00:00");
    assert.equal(received.slots[1].scheduledStartAt, "2026-09-01 18:00:00");
    assert.equal(received.slots[1].scheduledEndAt, "2026-09-02 06:00:00");
  });

  it("retorna null quando não existe escala para o mês", async () => {
    const service = createScheduleMonthsService({ findByYearMonth: async () => null }, fakeCaregiverProfiles());
    assert.equal(await service.getByYearMonth(2026, 9, "9"), null);
  });

  it("retorna a escala com os cuidadores quando existe", async () => {
    const repository = {
      findByYearMonth: async () => ({ id: "10", year: 2026, month: 9 }),
      getCaregivers: async () => [{ profileId: "1", position: 1, name: "Maurício" }],
    };
    const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
    const result = await service.getByYearMonth(2026, 9, "9");
    assert.equal(result.caregivers[0].name, "Maurício");
  });

  it("rejeita excluir escala de outra conta", async () => {
    const repository = { belongsToUser: async () => false };
    const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
    await assert.rejects(service.remove("10", "9"), ScheduleMonthNotFoundError);
  });

  it("bloqueia exclusão quando algum plantão do mês já foi iniciado", async () => {
    const repository = { belongsToUser: async () => true, hasStartedShift: async () => true };
    const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
    await assert.rejects(service.remove("10", "9"), ScheduleMonthValidationError);
  });

  it("exclui a escala quando nenhum plantão foi iniciado", async () => {
    let removed = false;
    const repository = {
      belongsToUser: async () => true,
      hasStartedShift: async () => false,
      remove: async () => { removed = true; return true; },
    };
    const service = createScheduleMonthsService(repository, fakeCaregiverProfiles());
    await service.remove("10", "9");
    assert.equal(removed, true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && node --test test/schedule-months-service.test.js`
Expected: FAIL — `Cannot find module '../src/services/schedule-months-service'`.

- [ ] **Step 4: Write `backend/src/services/schedule-months-service.js`**

```js
const ScheduleMonthValidationError = require("../errors/schedule-month-validation-error");
const ScheduleMonthNotFoundError = require("../errors/schedule-month-not-found-error");

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(dateStr, amount) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + amount));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

function buildSlots({ year, month, durationHours, firstStartTime, secondStartTime, caregiverIds }) {
  const totalDays = daysInMonth(year, month);
  const slots = [];
  let caregiverIndex = 0;
  const nextCaregiver = () => {
    const profileId = caregiverIds[caregiverIndex % caregiverIds.length];
    caregiverIndex += 1;
    return profileId;
  };
  for (let day = 1; day <= totalDays; day += 1) {
    const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
    const nextDate = addDays(dateStr, 1);
    if (durationHours === 24) {
      slots.push({
        scheduledStartAt: `${dateStr} ${firstStartTime}:00`,
        scheduledEndAt: `${nextDate} ${firstStartTime}:00`,
        profileId: nextCaregiver(),
      });
    } else {
      slots.push({
        scheduledStartAt: `${dateStr} ${firstStartTime}:00`,
        scheduledEndAt: `${dateStr} ${secondStartTime}:00`,
        profileId: nextCaregiver(),
      });
      slots.push({
        scheduledStartAt: `${dateStr} ${secondStartTime}:00`,
        scheduledEndAt: `${nextDate} ${firstStartTime}:00`,
        profileId: nextCaregiver(),
      });
    }
  }
  return slots;
}

function validateInput(input) {
  const details = {};
  const year = Number(input.year);
  const month = Number(input.month);
  const durationHours = Number(input.durationHours);
  const firstStartTime = typeof input.firstStartTime === "string" ? input.firstStartTime.trim() : "";
  const secondStartTime = typeof input.secondStartTime === "string" ? input.secondStartTime.trim() : "";
  const caregiverIds = Array.isArray(input.caregiverIds) ? input.caregiverIds.map(String) : [];

  if (!Number.isInteger(year) || year < 2020 || year > 2100) details.year = "Informe um ano válido";
  if (!Number.isInteger(month) || month < 1 || month > 12) details.month = "Informe um mês válido";
  if (durationHours !== 12 && durationHours !== 24) details.durationHours = "Escolha 12h ou 24h";
  if (!isTime(firstStartTime)) details.firstStartTime = "Informe um horário válido";
  if (durationHours === 12 && !isTime(secondStartTime)) details.secondStartTime = "Informe um horário válido";
  if (durationHours === 12 && isTime(firstStartTime) && isTime(secondStartTime) && secondStartTime <= firstStartTime) {
    details.secondStartTime = "O segundo período deve começar depois do primeiro";
  }
  if (!caregiverIds.length) details.caregiverIds = "Selecione ao menos um cuidador";
  if (new Set(caregiverIds).size !== caregiverIds.length) {
    details.caregiverIds = "Cada cuidador só pode aparecer uma vez na ordem";
  }
  if (Object.keys(details).length) throw new ScheduleMonthValidationError(details);

  return {
    year, month, durationHours, firstStartTime,
    secondStartTime: durationHours === 12 ? secondStartTime : null,
    caregiverIds,
  };
}

function createScheduleMonthsService(repository, caregiverProfilesRepository) {
  async function create(input, userId) {
    const data = validateInput(input ?? {});
    for (const profileId of data.caregiverIds) {
      if (!(await caregiverProfilesRepository.belongsToUser(profileId, userId))) {
        throw new ScheduleMonthValidationError({ caregiverIds: "Cuidador inválido" });
      }
    }
    if (await repository.findByYearMonth(userId, data.year, data.month)) {
      throw new ScheduleMonthValidationError({
        month: "Já existe uma escala para este mês. Exclua-a antes de gerar novamente.",
      });
    }
    const slots = buildSlots(data);
    const id = await repository.create({ userId, ...data, slots });
    return { id, ...data };
  }

  async function getByYearMonth(year, month, userId) {
    const scheduleMonth = await repository.findByYearMonth(userId, Number(year), Number(month));
    if (!scheduleMonth) return null;
    const caregivers = await repository.getCaregivers(scheduleMonth.id);
    return { ...scheduleMonth, caregivers };
  }

  async function remove(id, userId) {
    if (!(await repository.belongsToUser(id, userId))) throw new ScheduleMonthNotFoundError();
    if (await repository.hasStartedShift(id)) {
      throw new ScheduleMonthValidationError({
        month: "Este mês já tem plantões iniciados; não é possível excluir a escala.",
      });
    }
    await repository.remove(id, userId);
  }

  return Object.freeze({ create, getByYearMonth, remove });
}

module.exports = createScheduleMonthsService;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && node --test test/schedule-months-service.test.js`
Expected: PASS, all 15 assertions.

- [ ] **Step 6: Write `backend/src/repositories/schedule-months-repository.js`** (not unit-tested, matching existing repository convention — verified in Task 3's manual check)

```js
const pool = require("../config/database");

const MONTH_FIELDS = `
  id,
  year,
  month,
  duration_hours AS "durationHours",
  to_char(first_start_time, 'HH24:MI') AS "firstStartTime",
  to_char(second_start_time, 'HH24:MI') AS "secondStartTime"
`;

async function findByYearMonth(userId, year, month) {
  const result = await pool.query(
    `SELECT ${MONTH_FIELDS} FROM schedule_months WHERE user_id = $1 AND year = $2 AND month = $3`,
    [userId, year, month],
  );
  return result.rows[0] ?? null;
}

async function getCaregivers(scheduleMonthId) {
  const result = await pool.query(
    `SELECT smc.profile_id AS "profileId", smc.position, cp.name
     FROM schedule_month_caregivers smc
     JOIN caregiver_profiles cp ON cp.id = smc.profile_id
     WHERE smc.schedule_month_id = $1 ORDER BY smc.position`,
    [scheduleMonthId],
  );
  return result.rows;
}

async function create({ userId, year, month, durationHours, firstStartTime, secondStartTime, caregiverIds, slots }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const monthResult = await client.query(
      `INSERT INTO schedule_months (user_id, year, month, duration_hours, first_start_time, second_start_time)
       VALUES ($1, $2, $3, $4, $5::time, $6::time) RETURNING id`,
      [userId, year, month, durationHours, firstStartTime, secondStartTime],
    );
    const scheduleMonthId = monthResult.rows[0].id;
    for (let index = 0; index < caregiverIds.length; index += 1) {
      await client.query(
        `INSERT INTO schedule_month_caregivers (schedule_month_id, profile_id, position) VALUES ($1, $2, $3)`,
        [scheduleMonthId, caregiverIds[index], index + 1],
      );
    }
    for (const slot of slots) {
      await client.query(
        `INSERT INTO schedule_shifts (schedule_month_id, user_id, scheduled_start_at, scheduled_end_at, original_profile_id, profile_id)
         VALUES ($1, $2, $3::timestamp, $4::timestamp, $5, $5)`,
        [scheduleMonthId, userId, slot.scheduledStartAt, slot.scheduledEndAt, slot.profileId],
      );
    }
    await client.query("COMMIT");
    return scheduleMonthId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function hasStartedShift(scheduleMonthId) {
  const result = await pool.query(
    `SELECT 1 FROM schedule_shifts ss
     JOIN work_shifts ws ON ws.schedule_shift_id = ss.id
     WHERE ss.schedule_month_id = $1 LIMIT 1`,
    [scheduleMonthId],
  );
  return result.rowCount > 0;
}

async function belongsToUser(id, userId) {
  const result = await pool.query("SELECT 1 FROM schedule_months WHERE id = $1 AND user_id = $2", [id, userId]);
  return result.rowCount > 0;
}

async function remove(id, userId) {
  const result = await pool.query(
    "DELETE FROM schedule_months WHERE id = $1 AND user_id = $2 RETURNING id",
    [id, userId],
  );
  return result.rowCount > 0;
}

module.exports = Object.freeze({
  belongsToUser, create, findByYearMonth, getCaregivers, hasStartedShift, remove,
});
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/errors/schedule-month-validation-error.js backend/src/errors/schedule-month-not-found-error.js backend/src/repositories/schedule-months-repository.js backend/src/services/schedule-months-service.js backend/test/schedule-months-service.test.js
git commit -m "feat(schedule-months): adiciona service e repository da escala mensal"
```

---

### Task 3: `schedule-months` controller + routes + app.js wiring

**Files:**
- Create: `backend/src/controllers/schedule-months-controller.js`
- Create: `backend/src/routes/schedule-months-routes.js`
- Modify: `backend/src/app.js`

**Interfaces:**
- Consumes: `createScheduleMonthsService` from Task 2 (`{ create, getByYearMonth, remove }`).
- Produces: `createScheduleMonthsController(service, changeBus)` returning `{ getByYearMonth, create, remove }` (Express handlers); `createScheduleMonthsRouter(controller)` returning an Express `Router` mounted at `/api/schedule-months`.

- [ ] **Step 1: Write `backend/src/controllers/schedule-months-controller.js`**

```js
const ScheduleMonthValidationError = require("../errors/schedule-month-validation-error");
const ScheduleMonthNotFoundError = require("../errors/schedule-month-not-found-error");

function handle(error, response, next) {
  if (error instanceof ScheduleMonthValidationError) response.status(400).json({ error: error.message, details: error.details });
  else if (error instanceof ScheduleMonthNotFoundError) response.status(404).json({ error: error.message });
  else next(error);
}

function createScheduleMonthsController(service, changeBus) {
  const action = (callback) => async (request, response, next) => {
    try { await callback(request, response); } catch (error) { handle(error, response, next); }
  };
  return Object.freeze({
    getByYearMonth: action(async (request, response) => {
      const data = await service.getByYearMonth(request.query.year, request.query.month, request.userId);
      response.json({ data });
    }),
    create: action(async (request, response) => {
      const data = await service.create(request.body, request.userId);
      changeBus.publish(request.userId, { resource: "schedule-months", action: "created" });
      response.status(201).json({ data });
    }),
    remove: action(async (request, response) => {
      await service.remove(request.params.id, request.userId);
      changeBus.publish(request.userId, { resource: "schedule-months", action: "removed" });
      response.status(204).send();
    }),
  });
}

module.exports = createScheduleMonthsController;
```

- [ ] **Step 2: Write `backend/src/routes/schedule-months-routes.js`**

```js
const { Router } = require("express");

function createScheduleMonthsRouter(controller) {
  const router = Router();
  router.get("/", controller.getByYearMonth);
  router.post("/", controller.create);
  router.delete("/:id", controller.remove);
  return router;
}

module.exports = createScheduleMonthsRouter;
```

- [ ] **Step 3: Wire it in `backend/src/app.js`**

Add near the other resource `require`s (after the `work-shifts` block, around line 40):
```js
const createScheduleMonthsController = require("./controllers/schedule-months-controller");
const scheduleMonthsRepository = require("./repositories/schedule-months-repository");
const createScheduleMonthsRouter = require("./routes/schedule-months-routes");
const createScheduleMonthsService = require("./services/schedule-months-service");
```

Add after the `work-shifts` `app.use(...)` block (around line 89):
```js
const scheduleMonthsService = createScheduleMonthsService(scheduleMonthsRepository, caregiverProfilesRepository);
const scheduleMonthsController = createScheduleMonthsController(scheduleMonthsService, changeBus);
app.use("/api/schedule-months", requireAuth, createScheduleMonthsRouter(scheduleMonthsController));
```

- [ ] **Step 4: Verify manually**

```bash
cd backend && npm run dev
```
In another terminal, log in to get a token (replace with real credentials from your local DB) and call:
```bash
curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"SEU_EMAIL","password":"SUA_SENHA"}'
```
Copy the `token` from the response, then:
```bash
curl -s http://localhost:3000/api/schedule-months?year=2026&month=9 -H "Authorization: Bearer TOKEN"
```
Expected: `{"data":null}` (no schedule created yet).

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/schedule-months-controller.js backend/src/routes/schedule-months-routes.js backend/src/app.js
git commit -m "feat(schedule-months): expõe rotas da escala mensal"
```

---

### Task 4: `schedule-shifts` repository + service (TDD)

**Files:**
- Create: `backend/src/errors/schedule-shift-validation-error.js`
- Create: `backend/src/errors/schedule-shift-not-found-error.js`
- Create: `backend/src/repositories/schedule-shifts-repository.js`
- Create: `backend/src/services/schedule-shifts-service.js`
- Test: `backend/test/schedule-shifts-service.test.js`

**Interfaces:**
- Consumes: `caregiverProfilesRepository.belongsToUser(profileId, userId)`.
- Produces: `createScheduleShiftsService(repository, caregiverProfilesRepository)` returning `{ listByMonth(year, month, userId), findCurrentForProfile(profileId, userId), update(id, input, userId, profileId), remove(id, userId), swap(shiftIdA, shiftIdB, userId, profileId) }`. Row shape from the repository (and used by Task 6): `{ id, scheduleMonthId, scheduledDate, scheduledEndDate, scheduledStartTime, scheduledEndTime, scheduledStartAt (Date), scheduledEndAt (Date), originalProfileId, profileId, profileName, workShiftId, workShiftEndedAt }`. `listByMonth`/`findCurrentForProfile` results add a computed `status` field (`"Programado" | "Em andamento" | "Concluído" | "Não realizado"`); `findCurrentForProfile` also adds `alreadyStarted: boolean`.

- [ ] **Step 1: Write the error classes**

`backend/src/errors/schedule-shift-validation-error.js`:
```js
class ScheduleShiftValidationError extends Error {
  constructor(details) {
    super("Dados do plantão inválidos");
    this.name = "ScheduleShiftValidationError";
    this.details = details;
  }
}

module.exports = ScheduleShiftValidationError;
```

`backend/src/errors/schedule-shift-not-found-error.js`:
```js
class ScheduleShiftNotFoundError extends Error {
  constructor() {
    super("Plantão programado não encontrado");
    this.name = "ScheduleShiftNotFoundError";
  }
}

module.exports = ScheduleShiftNotFoundError;
```

- [ ] **Step 2: Write the failing test file** — `backend/test/schedule-shifts-service.test.js`

```js
const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const ScheduleShiftValidationError = require("../src/errors/schedule-shift-validation-error");
const ScheduleShiftNotFoundError = require("../src/errors/schedule-shift-not-found-error");
const createScheduleShiftsService = require("../src/services/schedule-shifts-service");

function fakeCaregiverProfiles(validIds = ["1", "2", "3"]) {
  return { belongsToUser: async (id) => validIds.includes(String(id)) };
}

function row(overrides = {}) {
  return {
    id: "1",
    scheduledStartAt: new Date(Date.now() - 60 * 60 * 1000),
    scheduledEndAt: new Date(Date.now() + 60 * 60 * 1000),
    scheduledDate: "2026-08-27",
    scheduledEndDate: "2026-08-27",
    scheduledStartTime: "06:00",
    scheduledEndTime: "18:00",
    originalProfileId: "1",
    profileId: "1",
    profileName: "Maurício",
    workShiftId: null,
    workShiftEndedAt: null,
    ...overrides,
  };
}

describe("schedule shifts service", () => {
  it("marca como Programado quando não iniciado e dentro da janela", async () => {
    const repository = { listByMonth: async () => [row()] };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    const [result] = await service.listByMonth(2026, 8, "9");
    assert.equal(result.status, "Programado");
  });

  it("marca como Não realizado quando não iniciado e a janela já passou", async () => {
    const repository = {
      listByMonth: async () => [row({
        scheduledStartAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        scheduledEndAt: new Date(Date.now() - 60 * 60 * 1000),
      })],
    };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    const [result] = await service.listByMonth(2026, 8, "9");
    assert.equal(result.status, "Não realizado");
  });

  it("marca como Em andamento quando iniciado e ainda dentro da janela prevista", async () => {
    const repository = { listByMonth: async () => [row({ workShiftId: "50" })] };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    const [result] = await service.listByMonth(2026, 8, "9");
    assert.equal(result.status, "Em andamento");
  });

  it("marca como Concluído quando o plantão real já foi encerrado", async () => {
    const repository = {
      listByMonth: async () => [row({ workShiftId: "50", workShiftEndedAt: new Date() })],
    };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    const [result] = await service.listByMonth(2026, 8, "9");
    assert.equal(result.status, "Concluído");
  });

  it("marca como Concluído quando iniciado, sem encerramento, mas a janela prevista já passou", async () => {
    const repository = {
      listByMonth: async () => [row({
        scheduledStartAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        scheduledEndAt: new Date(Date.now() - 60 * 60 * 1000),
        workShiftId: "50",
        workShiftEndedAt: null,
      })],
    };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    const [result] = await service.listByMonth(2026, 8, "9");
    assert.equal(result.status, "Concluído");
  });

  it("rejeita buscar o plantão atual com profileId inválido", async () => {
    const service = createScheduleShiftsService({}, fakeCaregiverProfiles());
    await assert.rejects(service.findCurrentForProfile("abc", "9"), ScheduleShiftValidationError);
  });

  it("rejeita buscar o plantão atual de um cuidador de outra conta", async () => {
    const service = createScheduleShiftsService({}, fakeCaregiverProfiles([]));
    await assert.rejects(service.findCurrentForProfile("1", "9"), ScheduleShiftValidationError);
  });

  it("retorna null quando não há plantão cobrindo agora", async () => {
    const repository = { findCurrentForProfile: async () => null };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    assert.equal(await service.findCurrentForProfile("1", "9"), null);
  });

  it("retorna alreadyStarted true quando já existe work_shift vinculado", async () => {
    const repository = { findCurrentForProfile: async () => row({ workShiftId: "50" }) };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    const result = await service.findCurrentForProfile("1", "9");
    assert.equal(result.alreadyStarted, true);
    assert.equal(result.status, "Em andamento");
  });

  it("rejeita editar com término antes ou igual ao início", async () => {
    const service = createScheduleShiftsService({}, fakeCaregiverProfiles());
    await assert.rejects(
      service.update("1", {
        profileId: "1", scheduledDate: "2026-08-27", scheduledStartTime: "18:00",
        scheduledEndDate: "2026-08-27", scheduledEndTime: "18:00",
      }, "9", "1"),
      ScheduleShiftValidationError,
    );
  });

  it("rejeita editar para um cuidador que não pertence à conta", async () => {
    const service = createScheduleShiftsService({}, fakeCaregiverProfiles(["1"]));
    await assert.rejects(
      service.update("1", {
        profileId: "99", scheduledDate: "2026-08-27", scheduledStartTime: "06:00", scheduledEndTime: "18:00",
      }, "9", "1"),
      ScheduleShiftValidationError,
    );
  });

  it("grava histórico de troca quando o cuidador responsável muda", async () => {
    let recorded;
    const repository = {
      findById: async () => row({ profileId: "1" }),
      update: async () => true,
      recordSwap: async (entry) => { recorded = entry; },
    };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    await service.update("1", {
      profileId: "2", scheduledDate: "2026-08-27", scheduledStartTime: "06:00", scheduledEndTime: "18:00",
    }, "9", "3");
    assert.deepEqual(recorded, {
      scheduleShiftId: "1", previousProfileId: "1", newProfileId: "2", changedByProfileId: "3",
    });
  });

  it("não grava histórico quando o cuidador não muda, só o horário", async () => {
    let recordCalled = false;
    const repository = {
      findById: async () => row({ profileId: "1" }),
      update: async () => true,
      recordSwap: async () => { recordCalled = true; },
    };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    await service.update("1", {
      profileId: "1", scheduledDate: "2026-08-27", scheduledStartTime: "07:00", scheduledEndTime: "19:00",
    }, "9", "3");
    assert.equal(recordCalled, false);
  });

  it("lança não encontrado ao editar um plantão inexistente", async () => {
    const repository = { findById: async () => null };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    await assert.rejects(
      service.update("1", {
        profileId: "1", scheduledDate: "2026-08-27", scheduledStartTime: "06:00", scheduledEndTime: "18:00",
      }, "9", "3"),
      ScheduleShiftNotFoundError,
    );
  });

  it("lança não encontrado ao excluir um plantão inexistente", async () => {
    const repository = { remove: async () => false };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    await assert.rejects(service.remove("1", "9"), ScheduleShiftNotFoundError);
  });

  it("rejeita trocar um plantão consigo mesmo", async () => {
    const service = createScheduleShiftsService({}, fakeCaregiverProfiles());
    await assert.rejects(service.swap("1", "1", "9", "3"), ScheduleShiftValidationError);
  });

  it("bloqueia troca quando um dos dois já foi iniciado", async () => {
    const repository = { hasWorkShift: async (id) => id === "2" };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    await assert.rejects(service.swap("1", "2", "9", "3"), ScheduleShiftValidationError);
  });

  it("troca os dois plantões e grava as duas entradas de histórico", async () => {
    const recorded = [];
    const repository = {
      hasWorkShift: async () => false,
      swapProfiles: async (idA, idB) => ({
        shiftA: { id: idA, previousProfileId: "1", newProfileId: "2" },
        shiftB: { id: idB, previousProfileId: "2", newProfileId: "1" },
      }),
      recordSwap: async (entry) => recorded.push(entry),
    };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    await service.swap("1", "2", "9", "3");
    assert.equal(recorded.length, 2);
    assert.deepEqual(recorded[0], { scheduleShiftId: "1", previousProfileId: "1", newProfileId: "2", changedByProfileId: "3" });
    assert.deepEqual(recorded[1], { scheduleShiftId: "2", previousProfileId: "2", newProfileId: "1", changedByProfileId: "3" });
  });

  it("lança não encontrado quando a troca não pertence à conta", async () => {
    const repository = { hasWorkShift: async () => false, swapProfiles: async () => null };
    const service = createScheduleShiftsService(repository, fakeCaregiverProfiles());
    await assert.rejects(service.swap("1", "2", "9", "3"), ScheduleShiftNotFoundError);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && node --test test/schedule-shifts-service.test.js`
Expected: FAIL — `Cannot find module '../src/services/schedule-shifts-service'`.

- [ ] **Step 4: Write `backend/src/services/schedule-shifts-service.js`**

```js
const ScheduleShiftValidationError = require("../errors/schedule-shift-validation-error");
const ScheduleShiftNotFoundError = require("../errors/schedule-shift-not-found-error");

function isTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateId(value, field = "id") {
  if (!/^\d+$/.test(String(value ?? "")) || value === "0") {
    throw new ScheduleShiftValidationError({ [field]: "Identificador inválido" });
  }
}

function computeStatus(shift, now) {
  const started = Boolean(shift.workShiftId);
  const windowEnded = new Date(shift.scheduledEndAt) <= now;
  if (started && shift.workShiftEndedAt) return "Concluído";
  if (started && windowEnded) return "Concluído";
  if (started) return "Em andamento";
  if (windowEnded) return "Não realizado";
  return "Programado";
}

function createScheduleShiftsService(repository, caregiverProfilesRepository) {
  async function listByMonth(year, month, userId) {
    const rows = await repository.listByMonth(userId, Number(year), Number(month));
    const now = new Date();
    return rows.map((row) => ({ ...row, status: computeStatus(row, now) }));
  }

  async function findCurrentForProfile(profileId, userId) {
    validateId(profileId, "profileId");
    if (!(await caregiverProfilesRepository.belongsToUser(profileId, userId))) {
      throw new ScheduleShiftValidationError({ profileId: "Cuidador inválido" });
    }
    const now = new Date();
    const pad2 = (value) => String(value).padStart(2, "0");
    const nowText = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    const shift = await repository.findCurrentForProfile(userId, profileId, nowText);
    if (!shift) return null;
    return { ...shift, status: computeStatus(shift, now), alreadyStarted: Boolean(shift.workShiftId) };
  }

  async function update(id, input, userId, profileId) {
    validateId(id);
    const details = {};
    const scheduledDate = typeof input.scheduledDate === "string" ? input.scheduledDate : "";
    const scheduledEndDate = typeof input.scheduledEndDate === "string" && input.scheduledEndDate
      ? input.scheduledEndDate : scheduledDate;
    const scheduledStartTime = typeof input.scheduledStartTime === "string" ? input.scheduledStartTime.trim() : "";
    const scheduledEndTime = typeof input.scheduledEndTime === "string" ? input.scheduledEndTime.trim() : "";
    const newProfileId = input.profileId;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) details.scheduledDate = "Informe uma data válida";
    if (!isTime(scheduledStartTime)) details.scheduledStartTime = "Informe um horário válido";
    if (!isTime(scheduledEndTime)) details.scheduledEndTime = "Informe um horário válido";
    if (!/^\d+$/.test(String(newProfileId ?? ""))) details.profileId = "Selecione um cuidador";
    if (Object.keys(details).length) throw new ScheduleShiftValidationError(details);

    const scheduledStartAt = `${scheduledDate} ${scheduledStartTime}:00`;
    const scheduledEndAt = `${scheduledEndDate} ${scheduledEndTime}:00`;
    if (scheduledEndAt <= scheduledStartAt) {
      throw new ScheduleShiftValidationError({ scheduledEndTime: "O término deve ser depois do início" });
    }
    if (!(await caregiverProfilesRepository.belongsToUser(newProfileId, userId))) {
      throw new ScheduleShiftValidationError({ profileId: "Cuidador inválido" });
    }

    const existing = await repository.findById(id, userId);
    if (!existing) throw new ScheduleShiftNotFoundError();

    const previousProfileId = existing.profileId;
    if (!(await repository.update(id, { profileId: newProfileId, scheduledStartAt, scheduledEndAt }, userId))) {
      throw new ScheduleShiftNotFoundError();
    }
    if (String(previousProfileId) !== String(newProfileId)) {
      await repository.recordSwap({
        scheduleShiftId: id, previousProfileId, newProfileId, changedByProfileId: profileId ?? null,
      });
    }
  }

  async function remove(id, userId) {
    validateId(id);
    if (!(await repository.remove(id, userId))) throw new ScheduleShiftNotFoundError();
  }

  async function swap(shiftIdA, shiftIdB, userId, profileId) {
    validateId(shiftIdA, "shiftIdA");
    validateId(shiftIdB, "shiftIdB");
    if (String(shiftIdA) === String(shiftIdB)) {
      throw new ScheduleShiftValidationError({ shiftIdB: "Escolha dois plantões diferentes" });
    }
    if ((await repository.hasWorkShift(shiftIdA)) || (await repository.hasWorkShift(shiftIdB))) {
      throw new ScheduleShiftValidationError({ shiftIdA: "Não é possível trocar um plantão que já foi iniciado" });
    }
    const result = await repository.swapProfiles(shiftIdA, shiftIdB, userId);
    if (!result) throw new ScheduleShiftNotFoundError();
    await repository.recordSwap({
      scheduleShiftId: result.shiftA.id,
      previousProfileId: result.shiftA.previousProfileId,
      newProfileId: result.shiftA.newProfileId,
      changedByProfileId: profileId ?? null,
    });
    await repository.recordSwap({
      scheduleShiftId: result.shiftB.id,
      previousProfileId: result.shiftB.previousProfileId,
      newProfileId: result.shiftB.newProfileId,
      changedByProfileId: profileId ?? null,
    });
  }

  return Object.freeze({ findCurrentForProfile, listByMonth, remove, swap, update });
}

module.exports = createScheduleShiftsService;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && node --test test/schedule-shifts-service.test.js`
Expected: PASS, all 19 assertions.

- [ ] **Step 6: Write `backend/src/repositories/schedule-shifts-repository.js`**

```js
const pool = require("../config/database");

const SHIFT_FIELDS = `
  ss.id,
  ss.schedule_month_id AS "scheduleMonthId",
  to_char(ss.scheduled_start_at, 'YYYY-MM-DD') AS "scheduledDate",
  to_char(ss.scheduled_end_at, 'YYYY-MM-DD') AS "scheduledEndDate",
  to_char(ss.scheduled_start_at, 'HH24:MI') AS "scheduledStartTime",
  to_char(ss.scheduled_end_at, 'HH24:MI') AS "scheduledEndTime",
  ss.scheduled_start_at AS "scheduledStartAt",
  ss.scheduled_end_at AS "scheduledEndAt",
  ss.original_profile_id AS "originalProfileId",
  ss.profile_id AS "profileId",
  cp.name AS "profileName",
  ws.id AS "workShiftId",
  ws.ended_at AS "workShiftEndedAt"
`;

async function listByMonth(userId, year, month) {
  const result = await pool.query(
    `SELECT ${SHIFT_FIELDS}
     FROM schedule_shifts ss
     JOIN schedule_months sm ON sm.id = ss.schedule_month_id
     JOIN caregiver_profiles cp ON cp.id = ss.profile_id
     LEFT JOIN work_shifts ws ON ws.schedule_shift_id = ss.id
     WHERE ss.user_id = $1 AND sm.year = $2 AND sm.month = $3
     ORDER BY ss.scheduled_start_at`,
    [userId, year, month],
  );
  return result.rows;
}

async function findById(id, userId) {
  const result = await pool.query(
    `SELECT ${SHIFT_FIELDS}
     FROM schedule_shifts ss
     JOIN caregiver_profiles cp ON cp.id = ss.profile_id
     LEFT JOIN work_shifts ws ON ws.schedule_shift_id = ss.id
     WHERE ss.id = $1 AND ss.user_id = $2`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}

async function findCurrentForProfile(userId, profileId, now) {
  const result = await pool.query(
    `SELECT ${SHIFT_FIELDS}
     FROM schedule_shifts ss
     JOIN caregiver_profiles cp ON cp.id = ss.profile_id
     LEFT JOIN work_shifts ws ON ws.schedule_shift_id = ss.id
     WHERE ss.user_id = $1 AND ss.profile_id = $2
       AND ss.scheduled_start_at <= $3::timestamp AND ss.scheduled_end_at > $3::timestamp
     ORDER BY ss.scheduled_start_at DESC LIMIT 1`,
    [userId, profileId, now],
  );
  return result.rows[0] ?? null;
}

async function update(id, changes, userId) {
  const result = await pool.query(
    `UPDATE schedule_shifts SET profile_id = $1, scheduled_start_at = $2::timestamp, scheduled_end_at = $3::timestamp,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $4 AND user_id = $5 RETURNING id`,
    [changes.profileId, changes.scheduledStartAt, changes.scheduledEndAt, id, userId],
  );
  return result.rowCount > 0;
}

async function remove(id, userId) {
  const result = await pool.query(
    "DELETE FROM schedule_shifts WHERE id = $1 AND user_id = $2 RETURNING id",
    [id, userId],
  );
  return result.rowCount > 0;
}

async function swapProfiles(idA, idB, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query(
      `SELECT id, profile_id AS "profileId" FROM schedule_shifts WHERE id IN ($1, $2) AND user_id = $3 FOR UPDATE`,
      [idA, idB, userId],
    );
    if (rows.rowCount !== 2) {
      await client.query("ROLLBACK");
      return null;
    }
    const shiftA = rows.rows.find((row) => String(row.id) === String(idA));
    const shiftB = rows.rows.find((row) => String(row.id) === String(idB));
    await client.query(
      "UPDATE schedule_shifts SET profile_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [shiftB.profileId, shiftA.id],
    );
    await client.query(
      "UPDATE schedule_shifts SET profile_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [shiftA.profileId, shiftB.id],
    );
    await client.query("COMMIT");
    return {
      shiftA: { id: shiftA.id, previousProfileId: shiftA.profileId, newProfileId: shiftB.profileId },
      shiftB: { id: shiftB.id, previousProfileId: shiftB.profileId, newProfileId: shiftA.profileId },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function hasWorkShift(id) {
  const result = await pool.query("SELECT 1 FROM work_shifts WHERE schedule_shift_id = $1", [id]);
  return result.rowCount > 0;
}

async function recordSwap({ scheduleShiftId, previousProfileId, newProfileId, changedByProfileId }) {
  await pool.query(
    `INSERT INTO schedule_shift_swaps (schedule_shift_id, previous_profile_id, new_profile_id, changed_by_profile_id)
     VALUES ($1, $2, $3, $4)`,
    [scheduleShiftId, previousProfileId, newProfileId, changedByProfileId],
  );
}

module.exports = Object.freeze({
  findById, findCurrentForProfile, hasWorkShift, listByMonth, recordSwap, remove, swapProfiles, update,
});
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/errors/schedule-shift-validation-error.js backend/src/errors/schedule-shift-not-found-error.js backend/src/repositories/schedule-shifts-repository.js backend/src/services/schedule-shifts-service.js backend/test/schedule-shifts-service.test.js
git commit -m "feat(schedule-shifts): adiciona service e repository dos plantoes programados"
```

---

### Task 5: `schedule-shifts` controller + routes + app.js wiring

**Files:**
- Create: `backend/src/controllers/schedule-shifts-controller.js`
- Create: `backend/src/routes/schedule-shifts-routes.js`
- Modify: `backend/src/app.js`

**Interfaces:**
- Consumes: `createScheduleShiftsService` from Task 4.
- Produces: `createScheduleShiftsController(service, changeBus)` returning `{ listByMonth, getCurrent, update, remove, swap }`; `createScheduleShiftsRouter(controller)` mounted at `/api/schedule-shifts`.

- [ ] **Step 1: Write `backend/src/controllers/schedule-shifts-controller.js`**

```js
const ScheduleShiftValidationError = require("../errors/schedule-shift-validation-error");
const ScheduleShiftNotFoundError = require("../errors/schedule-shift-not-found-error");

function handle(error, response, next) {
  if (error instanceof ScheduleShiftValidationError) response.status(400).json({ error: error.message, details: error.details });
  else if (error instanceof ScheduleShiftNotFoundError) response.status(404).json({ error: error.message });
  else next(error);
}

function createScheduleShiftsController(service, changeBus) {
  const action = (callback) => async (request, response, next) => {
    try { await callback(request, response); } catch (error) { handle(error, response, next); }
  };
  return Object.freeze({
    listByMonth: action(async (request, response) => {
      response.json({ data: await service.listByMonth(request.query.year, request.query.month, request.userId) });
    }),
    getCurrent: action(async (request, response) => {
      response.json({ data: await service.findCurrentForProfile(request.query.profileId, request.userId) });
    }),
    update: action(async (request, response) => {
      await service.update(request.params.id, request.body, request.userId, request.profileId);
      changeBus.publish(request.userId, { resource: "schedule-shifts", action: "updated" });
      response.status(204).send();
    }),
    remove: action(async (request, response) => {
      await service.remove(request.params.id, request.userId);
      changeBus.publish(request.userId, { resource: "schedule-shifts", action: "removed" });
      response.status(204).send();
    }),
    swap: action(async (request, response) => {
      await service.swap(request.body.shiftIdA, request.body.shiftIdB, request.userId, request.profileId);
      changeBus.publish(request.userId, { resource: "schedule-shifts", action: "swapped" });
      response.status(204).send();
    }),
  });
}

module.exports = createScheduleShiftsController;
```

- [ ] **Step 2: Write `backend/src/routes/schedule-shifts-routes.js`**

```js
const { Router } = require("express");

function createScheduleShiftsRouter(controller) {
  const router = Router();
  router.get("/current", controller.getCurrent);
  router.get("/", controller.listByMonth);
  router.post("/swap", controller.swap);
  router.patch("/:id", controller.update);
  router.delete("/:id", controller.remove);
  return router;
}

module.exports = createScheduleShiftsRouter;
```

- [ ] **Step 3: Wire it in `backend/src/app.js`**

Add near the other `require`s:
```js
const createScheduleShiftsController = require("./controllers/schedule-shifts-controller");
const scheduleShiftsRepository = require("./repositories/schedule-shifts-repository");
const createScheduleShiftsRouter = require("./routes/schedule-shifts-routes");
const createScheduleShiftsService = require("./services/schedule-shifts-service");
```

Add after the `schedule-months` `app.use(...)` block from Task 3:
```js
const scheduleShiftsService = createScheduleShiftsService(scheduleShiftsRepository, caregiverProfilesRepository);
const scheduleShiftsController = createScheduleShiftsController(scheduleShiftsService, changeBus);
app.use("/api/schedule-shifts", requireAuth, attachProfile, createScheduleShiftsRouter(scheduleShiftsController));
```

- [ ] **Step 4: Verify manually**

With the server running (`cd backend && npm run dev`) and a token from Task 3:
```bash
curl -s -X POST http://localhost:3000/api/schedule-months -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"year":2026,"month":9,"durationHours":24,"firstStartTime":"07:00","caregiverIds":["1"]}'
curl -s "http://localhost:3000/api/schedule-shifts?year=2026&month=9" -H "Authorization: Bearer TOKEN"
```
(Replace `"caregiverIds":["1"]` with a real `caregiver_profiles.id` from your local DB — check with `psql ... -c "select id, name from caregiver_profiles"`.)
Expected: the second call returns 30 rows (September has 30 days), each with `status: "Programado"` (or `"Não realizado"` for days already in the past, if you ran this after the 1st).

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/schedule-shifts-controller.js backend/src/routes/schedule-shifts-routes.js backend/src/app.js
git commit -m "feat(schedule-shifts): expõe rotas dos plantoes programados"
```

---

### Task 6: Link `work_shifts` to `schedule_shifts` (TDD)

**Files:**
- Modify: `backend/src/repositories/work-shifts-repository.js`
- Modify: `backend/src/services/work-shifts-service.js`
- Modify: `backend/src/app.js`
- Test: `backend/test/work-shifts-service.test.js`

**Interfaces:**
- Consumes: `scheduleShiftsRepository.findById(id, userId)` (Task 4) returning the row shape described there.
- Produces: `createWorkShiftsService(repository, scheduleShiftsRepository)` — same public shape as before (`{ getCurrent, start }`), but `start(input, userId, profileId)` now also accepts `input.scheduleShiftId`. `repository.createExclusive(shift)` now also accepts `shift.scheduleShiftId`, `shift.scheduledStartAt`, `shift.scheduledEndAt` (all optional/nullable). New repository function `existsForScheduleShift(scheduleShiftId): Promise<boolean>`.

- [ ] **Step 1: Add the new failing tests to `backend/test/work-shifts-service.test.js`**

Append inside the existing `describe("work shifts service", ...)` block, before the closing `});`:
```js
  it("inicia a partir de um plantão programado usando o cuidador atual da escala", async () => {
    let received;
    const service = createWorkShiftsService(
      {
        createExclusive: async (data) => { received = data; return { created: true, shift: { id: "1", profileId: "4", startedTime: "06:07", expectedEndTime: "18:07", durationHours: 12 } }; },
        existsForScheduleShift: async () => false,
      },
      {
        findById: async () => ({
          id: "20", profileId: "4",
          scheduledDate: "2026-08-27", scheduledEndDate: "2026-08-27",
          scheduledStartTime: "06:00", scheduledEndTime: "18:00",
          scheduledStartAt: new Date("2026-08-27T06:00:00"), scheduledEndAt: new Date("2026-08-27T18:00:00"),
        }),
      },
    );
    const result = await service.start({ scheduleShiftId: "20" }, "9", null);
    assert.equal(received.profileId, "4");
    assert.equal(received.durationHours, 12);
    assert.equal(received.scheduleShiftId, "20");
    assert.equal(received.scheduledStartAt, "2026-08-27 06:00:00");
    assert.equal(received.scheduledEndAt, "2026-08-27 18:00:00");
    assert.equal(result.period, "Manhã");
  });

  it("rejeita iniciar duas vezes o mesmo plantão programado", async () => {
    const service = createWorkShiftsService(
      { createExclusive: async () => assert.fail(), existsForScheduleShift: async () => true },
      { findById: async () => ({ id: "20", profileId: "4" }) },
    );
    await assert.rejects(service.start({ scheduleShiftId: "20" }, "9", null), WorkShiftValidationError);
  });

  it("rejeita iniciar um plantão programado que não existe ou não pertence à conta", async () => {
    const service = createWorkShiftsService(
      { createExclusive: async () => assert.fail() },
      { findById: async () => null },
    );
    await assert.rejects(service.start({ scheduleShiftId: "999" }, "9", null), WorkShiftValidationError);
  });

  it("continua funcionando sem scheduleShiftId, exatamente como antes", async () => {
    let received;
    const service = createWorkShiftsService({
      async createExclusive(data) {
        received = data;
        return { created: true, shift: { id: "1", profileId: "4", startedTime: "08:00", expectedEndTime: "20:00", durationHours: 12 } };
      },
    });
    await service.start(pastInput({ startedTime: "08:00", startedDate: "2026-08-20" }), "9", "4");
    assert.equal(received.scheduleShiftId, undefined);
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd backend && node --test test/work-shifts-service.test.js`
Expected: FAIL on the 3 new schedule-linked cases (`existsForScheduleShift`/`findById` not called, or `TypeError` on `scheduleShiftsRepository.findById`), PASS on the existing ones (no regression yet since `start()` hasn't changed).

- [ ] **Step 3: Update `backend/src/services/work-shifts-service.js`**

Change the `createWorkShiftsService` function signature and `start` implementation:
```js
function createWorkShiftsService(repository, scheduleShiftsRepository) {
  async function startFromSchedule(scheduleShiftId, userId) {
    if (!/^\d+$/.test(String(scheduleShiftId ?? ""))) {
      throw new WorkShiftValidationError({ scheduleShiftId: "Identificador inválido" });
    }
    const scheduleShift = await scheduleShiftsRepository.findById(scheduleShiftId, userId);
    if (!scheduleShift) throw new WorkShiftValidationError({ scheduleShiftId: "Plantão programado não encontrado" });
    if (await repository.existsForScheduleShift(scheduleShiftId)) {
      throw new WorkShiftValidationError({ scheduleShiftId: "Este plantão já foi iniciado" });
    }
    const durationHours = Math.round(
      (new Date(scheduleShift.scheduledEndAt) - new Date(scheduleShift.scheduledStartAt)) / 3600000,
    );
    const result = await repository.createExclusive({
      userId,
      profileId: scheduleShift.profileId,
      startedAt: nowTimestamp(),
      durationHours,
      now: nowTimestamp(),
      scheduleShiftId,
      scheduledStartAt: `${scheduleShift.scheduledDate} ${scheduleShift.scheduledStartTime}:00`,
      scheduledEndAt: `${scheduleShift.scheduledEndDate} ${scheduleShift.scheduledEndTime}:00`,
    });
    if (!result.created && String(result.shift.profileId) !== String(scheduleShift.profileId)) {
      throw new WorkShiftValidationError({
        scheduleShiftId: `${result.shift.profileName} já está de plantão até ${result.shift.expectedEndTime}`,
      });
    }
    return { ...attachPeriod(result.shift), alreadyActive: !result.created };
  }

  async function start(input, userId, profileId) {
    const body = input ?? {};
    if (body.scheduleShiftId) return startFromSchedule(body.scheduleShiftId, userId);
    if (!profileId) {
      throw new WorkShiftValidationError({ profileId: "Selecione um cuidador para iniciar o plantão" });
    }
    const { startedAt, durationHours } = validateInput(body);
    const result = await repository.createExclusive({
      userId, profileId, startedAt, durationHours, now: nowTimestamp(),
    });
    if (!result.created && String(result.shift.profileId) !== String(profileId)) {
      throw new WorkShiftValidationError({
        profileId: `${result.shift.profileName} já está de plantão até ${result.shift.expectedEndTime}`,
      });
    }
    return { ...attachPeriod(result.shift), alreadyActive: !result.created };
  }

  async function getCurrent(userId) {
    return attachPeriod(await repository.findCurrent(userId, nowTimestamp()));
  }

  return Object.freeze({ getCurrent, start });
}
```
(Only `createWorkShiftsService`'s body and `start` change; `isDate`, `pad2`, `nowTimestamp`, `periodFromHour`, `attachPeriod`, `validateInput` at the top of the file stay exactly as they are today.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && node --test test/work-shifts-service.test.js`
Expected: PASS, all cases (existing + 4 new).

- [ ] **Step 5: Update `backend/src/repositories/work-shifts-repository.js`**

Change `createExclusive`'s INSERT and add `existsForScheduleShift`:
```js
async function createExclusive(shift) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [shift.userId]);
    const current = await client.query(
      `SELECT ws.profile_id AS "profileId", cp.name AS "profileName",
         to_char(ws.started_at, 'HH24:MI') AS "startedTime",
         to_char(ws.expected_end_at, 'HH24:MI') AS "expectedEndTime",
         ws.duration_hours AS "durationHours"
       FROM work_shifts ws
       JOIN caregiver_profiles cp ON cp.id = ws.profile_id
       WHERE ws.user_id = $1 AND ws.ended_at IS NULL
         AND ws.started_at <= $2::timestamp AND ws.expected_end_at > $2::timestamp
       ORDER BY ws.started_at DESC
       LIMIT 1`,
      [shift.userId, shift.now],
    );
    if (current.rows[0]) {
      await client.query("COMMIT");
      return { created: false, shift: current.rows[0] };
    }
    const result = await client.query(
      `INSERT INTO work_shifts (user_id, profile_id, started_at, duration_hours, expected_end_at, schedule_shift_id, scheduled_start_at, scheduled_end_at)
       VALUES ($1, $2, $3::timestamp, $4::smallint, $3::timestamp + ($4::text || ' hours')::interval, $5, $6::timestamp, $7::timestamp)
       RETURNING ${SHIFT_FIELDS}`,
      [
        shift.userId, shift.profileId, shift.startedAt, shift.durationHours,
        shift.scheduleShiftId ?? null, shift.scheduledStartAt ?? null, shift.scheduledEndAt ?? null,
      ],
    );
    await client.query("COMMIT");
    return { created: true, shift: result.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function existsForScheduleShift(scheduleShiftId) {
  const result = await pool.query("SELECT 1 FROM work_shifts WHERE schedule_shift_id = $1", [scheduleShiftId]);
  return result.rowCount > 0;
}
```
And update the final export line:
```js
module.exports = Object.freeze({ createExclusive, existsForScheduleShift, findCovering, findCurrent });
```
(`SHIFT_FIELDS`, `findCurrent`, `findCovering` stay unchanged.)

- [ ] **Step 6: Update `backend/src/app.js`**

Move the `scheduleShiftsRepository` require above the `work-shifts` block if it isn't already (it was added in Task 5, right after the `work-shifts` requires — either order works since these are just `require()` calls, but for readability move the `work-shifts` service instantiation line so it reads naturally). Change:
```js
const workShiftsService = createWorkShiftsService(workShiftsRepository);
```
to:
```js
const workShiftsService = createWorkShiftsService(workShiftsRepository, scheduleShiftsRepository);
```

- [ ] **Step 7: Verify manually — no regression in the existing manual flow**

With the server running, repeat the manual "Iniciar um plantão" flow from `perfis.html` in the browser (pick a cuidador, fill date/time/duration, submit) exactly as it works today. Expected: works identically, and `psql ... -c "select schedule_shift_id, scheduled_start_at from work_shifts order by id desc limit 1"` shows `schedule_shift_id` as `NULL` for that manually-started shift.

- [ ] **Step 8: Commit**

```bash
git add backend/src/repositories/work-shifts-repository.js backend/src/services/work-shifts-service.js backend/src/app.js backend/test/work-shifts-service.test.js
git commit -m "feat(work-shifts): permite iniciar plantao a partir da escala programada"
```

---

### Task 7: Frontend — sidebar link + `schedule-repository.js` + `plantoes.html`/`plantoes.js` skeleton

**Files:**
- Create: `frontend/js/schedule-repository.js`
- Create: `frontend/plantoes.html`
- Create: `frontend/js/plantoes.js`
- Modify: `frontend/index.html`, `frontend/agenda.html`, `frontend/sinais-vitais.html`, `frontend/perfil.html`, `frontend/pacientes.html`, `frontend/medicamentos.html`, `frontend/atividades.html`, `frontend/anotacoes-enfermagem.html`

**Interfaces:**
- Consumes: `AuthContext.authHeader()`, `AuthContext.logout()`, `API_BASE_URL` (all existing globals from `config.js`/`auth-context.js`).
- Produces: global `ScheduleRepository` with `{ getMonth(year, month), generateMonth(data), deleteMonth(id), listShifts(year, month), getCurrentShift(profileId), updateShift(id, data), deleteShift(id), swapShifts(shiftIdA, shiftIdB) }` — used by `plantoes.js` (this task and Tasks 8–11) and by `perfis.js` (Task 12).

- [ ] **Step 1: Add the sidebar link to every existing page with a sidebar**

In each of `frontend/index.html`, `frontend/agenda.html`, `frontend/sinais-vitais.html`, `frontend/perfil.html`, `frontend/pacientes.html`, `frontend/medicamentos.html`, `frontend/atividades.html`, `frontend/anotacoes-enfermagem.html`, find this line inside `<nav class="sidebar__nav">`:
```html
          <a class="nav-link" href="agenda.html">Agenda</a>
```
(on `agenda.html` itself it reads `<a class="nav-link nav-link--active" href="agenda.html">Agenda</a>` — same edit applies, just keep the `nav-link--active` class where it already is) and add right after it:
```html
          <a class="nav-link" href="plantoes.html">Plantões</a>
```

- [ ] **Step 2: Write `frontend/js/schedule-repository.js`**

```js
const ScheduleRepository = (() => {
  const MONTHS_URL = `${API_BASE_URL}/api/schedule-months`;
  const SHIFTS_URL = `${API_BASE_URL}/api/schedule-shifts`;

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...AuthContext.authHeader(), ...options.headers },
    });
    if (response.status === 401) { AuthContext.logout(); throw new Error("Sessão expirada"); }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.details ? Object.values(body.details)[0] : body.error || "Falha ao acessar a API");
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async function getMonth(year, month) {
    return (await request(`${MONTHS_URL}?year=${year}&month=${month}`)).data;
  }
  async function generateMonth(data) {
    return (await request(MONTHS_URL, { method: "POST", body: JSON.stringify(data) })).data;
  }
  async function deleteMonth(id) {
    await request(`${MONTHS_URL}/${id}`, { method: "DELETE" });
  }
  async function listShifts(year, month) {
    return (await request(`${SHIFTS_URL}?year=${year}&month=${month}`)).data;
  }
  async function getCurrentShift(profileId) {
    return (await request(`${SHIFTS_URL}/current?profileId=${profileId}`)).data;
  }
  async function updateShift(id, data) {
    await request(`${SHIFTS_URL}/${id}`, { method: "PATCH", body: JSON.stringify(data) });
  }
  async function deleteShift(id) {
    await request(`${SHIFTS_URL}/${id}`, { method: "DELETE" });
  }
  async function swapShifts(shiftIdA, shiftIdB) {
    await request(`${SHIFTS_URL}/swap`, { method: "POST", body: JSON.stringify({ shiftIdA, shiftIdB }) });
  }

  return Object.freeze({
    deleteMonth, deleteShift, generateMonth, getCurrentShift, getMonth, listShifts, swapShifts, updateShift,
  });
})();
```

- [ ] **Step 3: Write `frontend/plantoes.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Escala mensal de plantões no Lory's Care." />
    <title>Plantões | Lory's Care</title>
    <link rel="stylesheet" href="css/styles.css?v=20260827-1" />
  </head>
  <body>
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar__header">
          <a class="brand" href="index.html"><span class="brand__icon"></span>Lory's<span> Care</span></a>
          <button class="sidebar-toggle-button" id="sidebar-toggle-button" type="button" aria-label="Recolher menu">☰</button>
        </div>
        <p class="sidebar__tagline">Cuidado que acolhe.</p>
        <select class="patient-switcher" id="patient-switcher" aria-label="Selecionar paciente"></select>
        <div class="sidebar-user-card" id="sidebar-user-card">
          <div class="sidebar-user-card__avatar" id="sidebar-user-avatar"></div>
          <div class="sidebar-user-card__info">
            <p class="sidebar-user-card__name" id="sidebar-user-name"></p>
            <p class="sidebar-user-card__role">Cuidador</p>
          </div>
        </div>
        <nav class="sidebar__nav">
          <a class="nav-link" href="index.html">Dashboard</a>
          <a class="nav-link" href="pacientes.html">Paciente</a>
          <a class="nav-link" href="sinais-vitais.html">Sinais vitais</a>
          <a class="nav-link" href="medicamentos.html">Medicamentos</a>
          <a class="nav-link" href="atividades.html">Atividades</a>
          <a class="nav-link" href="anotacoes-enfermagem.html">Anotações enfermagem</a>
          <a class="nav-link" href="agenda.html">Agenda</a>
          <a class="nav-link nav-link--active" href="plantoes.html">Plantões</a>
        </nav>
        <div class="sidebar-bottom-card">
          <span class="icon sidebar-bottom-card__icon"></span>
          <p>Acolher é estar presente.<br />Cuidar é fazer a diferença todos os dias.</p>
        </div>
      </aside>

      <div class="main-area">
        <header class="topbar"><div class="container topbar__content"><p class="current-date" id="current-date"></p><div class="account-menu" id="account-menu"></div></div></header>

        <main class="main-content container">
          <section class="page-header">
            <h1>Plantões</h1>
            <p>Monte a escala mensal dos cuidadores e acompanhe cada plantão programado.</p>
          </section>

          <section class="history-panel" aria-labelledby="month-label">
            <div class="history-panel__header">
              <div><p class="eyebrow">Escala</p><h2 id="month-label">Mês</h2></div>
              <div class="history-panel__header-actions">
                <select id="month-select" aria-label="Mês"></select>
                <select id="year-select" aria-label="Ano"></select>
              </div>
            </div>
            <p class="form-message" id="month-message" aria-live="polite"></p>

            <div id="generate-panel" hidden></div>
            <div id="summary-panel" hidden></div>
          </section>

          <section class="history-panel" id="shifts-panel" aria-labelledby="shifts-label" hidden>
            <div class="history-panel__header"><div><p class="eyebrow">Plantões</p><h2 id="shifts-label">Escala do mês</h2></div></div>
            <div class="table-wrapper" id="shifts-wrapper">
              <table>
                <thead><tr><th>Data</th><th>Início</th><th>Término</th><th>Cuidador</th><th>Turno</th><th>Status</th><th>Ações</th></tr></thead>
                <tbody id="shifts-body"></tbody>
              </table>
            </div>
          </section>
        </main>
        <footer><div class="container"><p><span class="footer-heart"></span>Lory's Care — apoio para o cuidado cotidiano.</p></div></footer>
      </div>
    </div>
    <script src="js/config.js"></script>
    <script src="js/auth-context.js"></script>
    <script src="js/caregiver-profiles-repository.js?v=20260824-1"></script>
    <script src="js/caregiver-context.js"></script>
    <script src="js/icons.js"></script>
    <script src="js/ui-icons.js?v=20260821-1"></script>
    <script src="js/account-menu.js"></script>
    <script src="js/sidebar-toggle.js"></script>
    <script src="js/patient-context.js"></script>
    <script src="js/live-updates.js"></script>
    <script src="js/schedule-repository.js"></script>
    <script src="js/plantoes.js?v=20260827-1"></script>
  </body>
</html>
```

- [ ] **Step 4: Write `frontend/js/plantoes.js`** (skeleton: month/year pickers + load-or-empty state; generation form body filled in Task 8)

```js
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
```

- [ ] **Step 5: Verify manually in the browser**

Start both servers (`cd backend && npm run dev`; serve `frontend/` the way the project already does — same as any other page), log in, navigate to `plantoes.html` via the new sidebar link. Expected: page loads with the current month/year selected, shows no error, and (since no schedule exists yet) leaves `generate-panel`/`summary-panel`/`shifts-panel` all effectively empty (they're `hidden`/blank — real content arrives in Tasks 8–9). Confirm the "Plantões" link also appears and works from `index.html`, `agenda.html`, and at least one other page.

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html frontend/agenda.html frontend/sinais-vitais.html frontend/perfil.html frontend/pacientes.html frontend/medicamentos.html frontend/atividades.html frontend/anotacoes-enfermagem.html frontend/plantoes.html frontend/js/plantoes.js frontend/js/schedule-repository.js
git commit -m "feat(frontend): adiciona aba Plantoes com esqueleto de mes/ano"
```

---

### Task 8: Frontend — generation form (caregivers + reorder + duration/time) and month deletion

**Files:**
- Modify: `frontend/plantoes.html`
- Modify: `frontend/js/plantoes.js`
- Modify: `frontend/css/styles.css`

**Interfaces:**
- Consumes: `CaregiverProfilesRepository.getAll()` (existing), `ScheduleRepository.generateMonth`/`deleteMonth`/`getMonth` (Task 7).
- Produces: fills `#generate-panel` (create flow) and `#summary-panel` (existing-month summary + delete) from Task 7's skeleton. No new public interface consumed by later tasks beyond what Task 7 already declared.

- [ ] **Step 1: Add the generate-form and summary markup to `frontend/plantoes.html`**

Replace `<div id="generate-panel" hidden></div>` and `<div id="summary-panel" hidden></div>` with:
```html
            <div id="generate-panel" hidden>
              <h3>Gerar escala do mês</h3>
              <form id="generate-form">
                <div class="form-grid">
                  <div class="form-field">
                    <label for="duration-select">Tipo de plantão</label>
                    <select id="duration-select" name="durationHours" required>
                      <option value="12">12 horas</option>
                      <option value="24">24 horas</option>
                    </select>
                  </div>
                  <div class="form-field"><label for="first-start-time">Início do 1º período</label><input id="first-start-time" name="firstStartTime" type="time" required /></div>
                  <div class="form-field" id="second-start-field"><label for="second-start-time">Início do 2º período</label><input id="second-start-time" name="secondStartTime" type="time" /></div>
                  <div class="form-field form-field--full">
                    <label>Cuidadores participantes</label>
                    <div class="weekday-options" id="caregiver-checklist"></div>
                  </div>
                  <div class="form-field form-field--full">
                    <label>Ordem do revezamento</label>
                    <ul class="reorder-list" id="reorder-list"></ul>
                  </div>
                </div>
                <div class="form-actions">
                  <button class="primary-button" type="submit">Gerar escala do mês</button>
                  <p class="form-message" id="generate-message" aria-live="polite"></p>
                </div>
              </form>
            </div>
            <div id="summary-panel" hidden>
              <div class="history-panel__header">
                <div><p class="eyebrow">Configuração</p><h3 id="summary-text"></h3></div>
                <button class="secondary-button" id="delete-month-button" type="button">Excluir escala do mês</button>
              </div>
              <p class="form-message" id="summary-message" aria-live="polite"></p>
            </div>
```

- [ ] **Step 2: Add reorder-list and status-badge CSS to `frontend/css/styles.css`**

Append at the end of the file (after the last responsive media-query block):
```css
.reorder-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  list-style: none;
  padding: 0;
  margin: 0;
}

.reorder-list__item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 10px 14px;
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.reorder-list__item[draggable="true"] {
  cursor: grab;
}

.reorder-list__position {
  font-weight: 600;
  color: var(--text-secondary);
  width: 1.5rem;
}

.reorder-list__name {
  flex: 1;
}

.reorder-list__buttons {
  display: flex;
  gap: 0.25rem;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  background: var(--surface-muted);
  color: var(--text-secondary);
}

.status-badge--scheduled {
  background: var(--primary-light);
  color: var(--primary-dark);
}

.status-badge--in-progress {
  background: var(--warning-light);
  color: #8a5a00;
}

.status-badge--done {
  background: var(--success-light);
  color: var(--success);
}

.status-badge--missed {
  background: var(--danger-light);
  color: var(--danger);
}
```

- [ ] **Step 3: Implement the generation form logic in `frontend/js/plantoes.js`**

Add these declarations near the top (after the existing `const` block from Task 7):
```js
const generateForm = document.querySelector("#generate-form");
const generateMessage = document.querySelector("#generate-message");
const durationSelect = document.querySelector("#duration-select");
const secondStartField = document.querySelector("#second-start-field");
const caregiverChecklist = document.querySelector("#caregiver-checklist");
const reorderList = document.querySelector("#reorder-list");
const summaryText = document.querySelector("#summary-text");
const summaryMessage = document.querySelector("#summary-message");
const deleteMonthButton = document.querySelector("#delete-month-button");

let allCaregivers = [];
let orderedCaregiverIds = [];
let currentScheduleMonth = null;
```

Add this block right after `populateMonthYearSelects()`'s definition (still before it's called at the bottom):
```js
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
```

- [ ] **Step 4: Wire it into `loadMonth()`**

Replace the body of `loadMonth()` from Task 7 with:
```js
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
    shiftsPanel.hidden = false;
  } catch (error) {
    monthMessage.textContent = error.message;
  }
}
```

Also update the bottom of the file (after `populateMonthYearSelects();`) to load the caregiver list once at startup, before the first `loadMonth()` call:
```js
populateMonthYearSelects();
document.querySelector("#current-date").textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date());
toggleSecondStartField();
CaregiverProfilesRepository.getAll().then((caregivers) => {
  allCaregivers = caregivers;
  loadMonth();
}).catch((error) => { monthMessage.textContent = error.message; });
```
(Remove the old plain `loadMonth();` call at the very bottom — it's now inside the `.then(...)`.)

- [ ] **Step 5: Verify manually in the browser**

Navigate to a month with no schedule yet. Expected: checklist shows all your caregivers; checking two or three of them adds them to the reorder list in check-order; the ↑/↓ buttons and dragging an item both change the order; submitting with a valid 12h or 24h config succeeds and the page reloads into the summary view; "Excluir escala do mês" removes it and returns to the generate form.

- [ ] **Step 6: Commit**

```bash
git add frontend/plantoes.html frontend/js/plantoes.js frontend/css/styles.css
git commit -m "feat(frontend): formulario de geracao da escala mensal com revezamento"
```

---

### Task 9: Frontend — schedule table with computed status

**Files:**
- Modify: `frontend/js/plantoes.js`

**Interfaces:**
- Consumes: `ScheduleRepository.listShifts(year, month)` (Task 7), row shape from Task 4/5 (`status`, `scheduledDate`, `scheduledStartTime`, `scheduledEndTime`, `profileId`, `profileName`, `id`).
- Produces: `#shifts-body` populated; used by Tasks 10–11 as the row source for edit/delete/swap actions.

- [ ] **Step 1: Add status-badge and period helpers, and a `renderShifts`/`loadShifts` pair**

Add near the top of `plantoes.js` (after `MONTH_NAMES`):
```js
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
```

Add near the other `const` declarations:
```js
const shiftsBody = document.querySelector("#shifts-body");
let currentShifts = [];
```

Add a `renderShifts`/`loadShifts` pair (placed after the reorder-list code from Task 8):
```js
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
```

- [ ] **Step 2: Call `loadShifts()` after a month is loaded**

In `loadMonth()`, right before `shiftsPanel.hidden = false;`, add:
```js
    await loadShifts();
```

- [ ] **Step 3: Refresh on realtime updates**

Add near the bottom of the file, after the `CaregiverProfilesRepository.getAll()...` block:
```js
LiveUpdates.connect((event) => {
  if (["schedule-months", "schedule-shifts"].includes(event.resource)) loadMonth();
});
```

- [ ] **Step 4: Verify manually in the browser**

With a generated month open, confirm the table shows one row per slot with the correct date/times/cuidador, a "Turno" column like `24h · Manhã`, and a status pill reading "Programado" for future slots and "Não realizado" for any slot whose window is already in the past (test by generating a past month, e.g. last month).

- [ ] **Step 5: Commit**

```bash
git add frontend/js/plantoes.js
git commit -m "feat(frontend): exibe a tabela da escala com status calculado"
```

---

### Task 10: Frontend — edit and delete a single scheduled shift

**Files:**
- Modify: `frontend/plantoes.html`
- Modify: `frontend/js/plantoes.js`

**Interfaces:**
- Consumes: `ScheduleRepository.updateShift(id, data)`, `ScheduleRepository.deleteShift(id)` (Task 7); `currentShifts` array (Task 9).

- [ ] **Step 1: Add an edit form panel to `frontend/plantoes.html`**

Right before `</section>` that closes the `shifts-panel` section, add:
```html
            <div id="edit-shift-panel" hidden>
              <h3>Editar plantão</h3>
              <form id="edit-shift-form">
                <div class="form-grid">
                  <div class="form-field form-field--full"><label for="edit-shift-profile">Cuidador</label><select id="edit-shift-profile" name="profileId" required></select></div>
                  <div class="form-field"><label for="edit-shift-date">Data</label><input id="edit-shift-date" name="scheduledDate" type="date" required /></div>
                  <div class="form-field"><label for="edit-shift-start">Início</label><input id="edit-shift-start" name="scheduledStartTime" type="time" required /></div>
                  <div class="form-field"><label for="edit-shift-end-date">Data de término</label><input id="edit-shift-end-date" name="scheduledEndDate" type="date" required /></div>
                  <div class="form-field"><label for="edit-shift-end">Término</label><input id="edit-shift-end" name="scheduledEndTime" type="time" required /></div>
                </div>
                <div class="form-actions">
                  <button class="primary-button" type="submit">Salvar alterações</button>
                  <button class="secondary-button" type="button" id="cancel-edit-shift-button">Cancelar</button>
                  <p class="form-message" id="edit-shift-message" aria-live="polite"></p>
                </div>
              </form>
            </div>
```

- [ ] **Step 2: Add action buttons to each row**

In `plantoes.js`, replace the `const actionsCell = document.createElement("td");` line inside `shiftRow(shift)` with:
```js
  const actionsCell = document.createElement("td");
  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "table-action table-action--icon";
  editButton.innerHTML = icon("pencil");
  editButton.title = "Editar";
  editButton.addEventListener("click", () => openEditShift(shift));
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "table-action table-action--icon table-action--danger";
  deleteButton.innerHTML = icon("trash");
  deleteButton.title = "Excluir";
  deleteButton.addEventListener("click", () => deleteShiftRow(shift));
  actionsCell.append(editButton, deleteButton);
```

- [ ] **Step 3: Implement `openEditShift`, form submit, and `deleteShiftRow`**

Add near the other `const` declarations:
```js
const editShiftPanel = document.querySelector("#edit-shift-panel");
const editShiftForm = document.querySelector("#edit-shift-form");
const editShiftMessage = document.querySelector("#edit-shift-message");
const cancelEditShiftButton = document.querySelector("#cancel-edit-shift-button");
let editingShiftId = null;
```

Add this block after `loadShifts()`'s definition:
```js
function openEditShift(shift) {
  editingShiftId = shift.id;
  editShiftForm.elements.profileId.replaceChildren();
  allCaregivers.forEach((caregiver) => editShiftForm.elements.profileId.add(new Option(caregiver.name, caregiver.id)));
  editShiftForm.elements.profileId.value = shift.profileId;
  editShiftForm.elements.scheduledDate.value = shift.scheduledDate;
  editShiftForm.elements.scheduledStartTime.value = shift.scheduledStartTime;
  editShiftForm.elements.scheduledEndDate.value = shift.scheduledEndDate;
  editShiftForm.elements.scheduledEndTime.value = shift.scheduledEndTime;
  editShiftMessage.textContent = "";
  editShiftPanel.hidden = false;
}

cancelEditShiftButton.addEventListener("click", () => { editShiftPanel.hidden = true; editingShiftId = null; });

editShiftForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  editShiftMessage.textContent = "Salvando...";
  try {
    const data = Object.fromEntries(new FormData(editShiftForm).entries());
    await ScheduleRepository.updateShift(editingShiftId, data);
    editShiftPanel.hidden = true;
    editingShiftId = null;
    await loadShifts();
  } catch (error) {
    editShiftMessage.textContent = error.message;
  }
});

async function deleteShiftRow(shift) {
  if (!window.confirm(`Excluir o plantão de ${shift.profileName} em ${formatDateLabel(shift.scheduledDate)}?`)) return;
  try {
    await ScheduleRepository.deleteShift(shift.id);
    await loadShifts();
  } catch (error) {
    monthMessage.textContent = error.message;
  }
}
```

- [ ] **Step 4: Verify manually in the browser**

On a generated month, click "Editar" on a row, change the cuidador and/or the time, save, and confirm the row updates without any other row changing. Click "Excluir" on a row, confirm it, and confirm only that row disappears.

- [ ] **Step 5: Commit**

```bash
git add frontend/plantoes.html frontend/js/plantoes.js
git commit -m "feat(frontend): permite editar e excluir um plantao individual"
```

---

### Task 11: Frontend — swap two shifts ("Trocar plantão")

**Files:**
- Modify: `frontend/js/plantoes.js`

**Interfaces:**
- Consumes: `ScheduleRepository.swapShifts(shiftIdA, shiftIdB)` (Task 7).

- [ ] **Step 1: Add a "Trocar" button and swap-selection state**

Add near the other `let` declarations: `let pendingSwapId = null;`

In `shiftRow(shift)`, after the `deleteButton` is appended, add a third button:
```js
  const swapButton = document.createElement("button");
  swapButton.type = "button";
  swapButton.className = "table-action";
  swapButton.textContent = pendingSwapId === shift.id
    ? "Cancelar troca"
    : pendingSwapId
      ? "Trocar com este"
      : "Trocar";
  swapButton.addEventListener("click", () => handleSwapClick(shift));
  actionsCell.append(swapButton);
```

- [ ] **Step 2: Implement `handleSwapClick`**

Add after `deleteShiftRow`'s definition:
```js
async function handleSwapClick(shift) {
  if (pendingSwapId === shift.id) {
    pendingSwapId = null;
    await loadShifts();
    return;
  }
  if (!pendingSwapId) {
    pendingSwapId = shift.id;
    await loadShifts();
    return;
  }
  const otherId = pendingSwapId;
  pendingSwapId = null;
  try {
    await ScheduleRepository.swapShifts(otherId, shift.id);
    await loadShifts();
  } catch (error) {
    monthMessage.textContent = error.message;
    await loadShifts();
  }
}
```

- [ ] **Step 3: Verify manually in the browser**

Click "Trocar" on one row (its label becomes "Cancelar troca", every other row's button becomes "Trocar com este"), then click "Trocar com este" on a different row. Confirm the two rows' "Cuidador" cells swap and no other row changes. Confirm clicking "Trocar" then "Cancelar troca" on the same row aborts cleanly. Confirm trying to swap a row whose status is already "Em andamento"/"Concluído" (start one manually via `perfis.html` first, matching Task 12, or start one directly from the schedule to test) surfaces the backend's "Não é possível trocar um plantão que já foi iniciado" message.

- [ ] **Step 4: Commit**

```bash
git add frontend/js/plantoes.js
git commit -m "feat(frontend): adiciona troca de plantao entre dois registros da escala"
```

---

### Task 12: Integrate the schedule into "Iniciar um plantão" (`perfis.html`/`perfis.js`)

**Files:**
- Modify: `frontend/perfis.html`
- Modify: `frontend/js/perfis.js`

**Interfaces:**
- Consumes: `ScheduleRepository.getCurrentShift(profileId)` (Task 7); `WorkShiftsRepository.start(data)` (existing, unchanged — `data` now may include `scheduleShiftId`).

- [ ] **Step 1: Add `schedule-repository.js` to `frontend/perfis.html`**

Add this script tag right before `<script src="js/perfis.js...">`:
```html
    <script src="js/schedule-repository.js"></script>
```

- [ ] **Step 2: Restructure the `shift-step` markup**

Replace the entire `<div class="profile-picker" id="shift-step" hidden>` block with:
```html
    <div class="profile-picker" id="shift-step" hidden>
      <div>
        <a class="brand" href="index.html"><span class="brand__icon"></span>Lory's<span> Care</span></a>
        <h1 id="shift-step-title">Iniciar plantão?</h1>
        <p id="shift-step-description">Ninguém está de plantão agora. Se você está começando a cuidar, registre o início — isso garante que só você possa lançar anotações no seu horário.</p>
      </div>
      <section class="form-panel" style="max-width: 360px; width: 100%;">
        <div class="form-field form-field--full"><label for="shift-profile">Cuidador</label><select id="shift-profile" required><option value="">Selecione</option></select></div>

        <div id="scheduled-shift-card" hidden>
          <p class="eyebrow">Seu plantão</p>
          <p id="scheduled-shift-summary" style="font-weight: 600; margin-bottom: 16px;"></p>
          <div class="form-actions">
            <button class="primary-button" type="button" id="start-scheduled-button">Iniciar plantão</button>
            <button class="secondary-button" type="button" id="skip-shift-button">Agora não</button>
          </div>
          <p><button class="secondary-button" type="button" id="show-extraordinary-button">Iniciar plantão extraordinário</button></p>
        </div>

        <div id="no-scheduled-shift-message" hidden>
          <p class="form-message">Não encontramos um plantão programado para você neste horário.</p>
        </div>

        <form id="shift-form" hidden>
          <div class="form-grid">
            <div class="form-field"><label for="shift-date">Início</label><input id="shift-date" name="startedDate" type="date" required /></div>
            <div class="form-field"><label for="shift-time">Hora</label><input id="shift-time" name="startedTime" type="time" required /></div>
            <div class="form-field form-field--full">
              <label for="shift-duration">Duração</label>
              <select id="shift-duration" name="durationHours" required>
                <option value="12">12 horas</option>
                <option value="24">24 horas</option>
              </select>
            </div>
          </div>
          <div class="form-actions">
            <button class="primary-button" type="submit">Iniciar plantão extraordinário</button>
            <button class="secondary-button" type="button" id="skip-extraordinary-button">Agora não</button>
            <p class="form-message" id="shift-message" aria-live="polite"></p>
          </div>
        </form>
      </section>
    </div>
```
(Note: `shift-profile` is no longer inside `shift-form` — it now drives the lookup directly; the manual form only carries date/time/duration, matching the "não pedir novamente data/hora/duração quando a escala já sabe" requirement while keeping the exact same fields for the extraordinary path.)

- [ ] **Step 3: Rewrite the shift-step logic in `frontend/js/perfis.js`**

Replace `showShiftStep`, the `shiftForm.addEventListener("submit", ...)` block, `skipShiftButton`'s listener, and `startShiftButton`'s listener with:
```js
const scheduledShiftCard = document.querySelector("#scheduled-shift-card");
const scheduledShiftSummary = document.querySelector("#scheduled-shift-summary");
const noScheduledShiftMessage = document.querySelector("#no-scheduled-shift-message");
const startScheduledButton = document.querySelector("#start-scheduled-button");
const showExtraordinaryButton = document.querySelector("#show-extraordinary-button");
const skipExtraordinaryButton = document.querySelector("#skip-extraordinary-button");
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
skipShiftButton.addEventListener("click", () => {
  if (CaregiverContext.getCurrentId()) { goToApp(); return; }
  backToProfiles();
});
skipExtraordinaryButton.addEventListener("click", backToProfiles);
startShiftButton.addEventListener("click", () => { showShiftStep(); });
```
(`localDate`/`localTime`/`goToApp`/`caregiverProfiles`/`CaregiverContext`/`profileStep`/`shiftStepTitle`/`shiftMessage`/`shiftStep`/`shiftForm`/`skipShiftButton`/`startShiftButton`/`profileButton`/`pinForm`-related code above and below this block stay exactly as they are today; `loadProfiles()` still populates `#shift-profile`'s options the same way it does now.)

- [ ] **Step 4: End-to-end manual verification**

With both servers running:
1. In `plantoes.html`, generate a schedule for the current month that includes a slot covering right now for some cuidador (e.g. 24h starting at an hour before now).
2. Go to `perfis.html`, click "Iniciar um plantão", select that cuidador in the dropdown.
   Expected: the "Seu plantão" card appears with the correct hours/duration, no manual fields shown.
3. Click "Iniciar plantão". Expected: redirected into the app; in `plantoes.html`, that row's status is now "Em andamento".
4. Go back to `perfis.html`, "Trocar" → select the same cuidador again.
   Expected: "Este plantão já foi iniciado." is shown, no way to start it again.
5. Select a cuidador with no schedule slot covering now.
   Expected: "Não encontramos um plantão programado para você neste horário." appears, and the manual form (relabeled "Iniciar plantão extraordinário") is shown and still works, producing a `work_shifts` row with `schedule_shift_id = NULL`.
6. While a scheduled slot is shown (step 2), click "Iniciar plantão extraordinário" instead.
   Expected: the manual form appears alongside/instead, and submitting it still works (covers the emergency override case).
7. In `plantoes.html`, do a "Trocar" between two future (not-yet-started) slots for two different cuidadores, then repeat step 2 for the cuidador who is now assigned to the slot that covers "now".
   Expected: the "Seu plantão" card reflects the post-swap assignment, not the original one.

- [ ] **Step 5: Commit**

```bash
git add frontend/perfis.html frontend/js/perfis.js
git commit -m "feat(frontend): integra Iniciar um plantao com a escala mensal"
```

---

## Self-Review Notes

- **Spec coverage:** every numbered requirement in the spec (data model, generation, table + Turno column, edit, swap, integration with "Iniciar um plantão", duplicate prevention, swap reflecting in start, status table, midnight-crossing shifts) maps to a task above — Tasks 1–6 (backend/data model/business rules), Tasks 7–11 (schedule management UI), Task 12 (integration + end-to-end verification).
- **Type consistency checked:** `scheduleShiftId` (camelCase, string/number-as-string ids) is used identically in `perfis.js` → `WorkShiftsRepository.start()` → `work-shifts-controller.js` (`request.body`) → `work-shifts-service.js` (`body.scheduleShiftId`) → `schedule-shifts-repository.findById`. The row fields returned by `schedule-shifts-repository.js` (`scheduledDate`, `scheduledEndDate`, `scheduledStartTime`, `scheduledEndTime`, `scheduledStartAt`, `scheduledEndAt`, `profileId`, `profileName`, `workShiftId`, `workShiftEndedAt`) are the same names used in `schedule-shifts-service.js`, its tests, `work-shifts-service.js`'s `startFromSchedule`, and `plantoes.js`/`perfis.js` on the frontend.
- **No placeholders:** every step has literal code, exact file paths, and concrete verification commands; no "add error handling" or "similar to Task N" placeholders remain.
