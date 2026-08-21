# Autoria Imutável das Baixas (Etapa 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantir que a conclusão de uma dose/atividade, e a edição de anotações/sinais vitais, nunca troquem de autor silenciosamente — só quem registrou primeiro pode editar depois, e uma segunda tentativa de outro cuidador é rejeitada pelo backend (inclusive sob concorrência).

**Architecture:** `medication_administrations`/`routine_completions` trocam o upsert incondicional (`ON CONFLICT DO UPDATE`) por um insert atômico (`ON CONFLICT DO NOTHING`) seguido de uma checagem de autoria no service: mesmo autor → edição via `UPDATE` dedicado; autor diferente → erro 409. `nursing_notes`/`vital_signs` ganham uma checagem de autoria (`author_profile_id` da linha vs. `request.profileId`) antes do `UPDATE` já existente, retornando 403 quando não bate. Nenhuma tabela/coluna nova.

**Tech Stack:** Node.js + Express 5, PostgreSQL (`pg`), testes com `node:test`/`node:assert/strict` (mock de repositório, sem banco real nos testes de service).

**Spec:** `docs/superpowers/specs/2026-08-21-jornada-autoria-design.md` (seção "Etapa 1 — Autoria imutável, com edição restrita ao autor original")

## Global Constraints

- Autoria (`author_profile_id`) de uma conclusão original nunca é sobrescrita por um perfil diferente do que a criou.
- Edição de um registro já atribuído só é permitida para o mesmo `author_profile_id`; qualquer outro perfil recebe erro do backend, não só um botão escondido no frontend.
- Autoria sempre vem de `request.profileId` (preenchido pelo middleware `attach-profile` a partir do header `X-Profile-Id`, já validado contra o dono da conta) — nunca de um campo solto no corpo da requisição.
- Registros com `author_profile_id` nulo (criados antes de perfis existirem) continuam editáveis por qualquer perfil — não travar dado legado.
- Nenhuma migration nesta etapa: reaproveita as colunas `author_profile_id`/`completed_at`/`administered_at` já existentes.
- Concorrência (dois cuidadores concluindo quase ao mesmo tempo) é resolvida no próprio SQL (`INSERT ... ON CONFLICT DO NOTHING`), sem lock manual nem checagem-depois-ação.

---

## Task 1: Medicamentos — conclusão à prova de sobrescrita

**Files:**
- Create: `backend/src/errors/medication-administration-conflict-error.js`
- Modify: `backend/src/repositories/medications-repository.js`
- Modify: `backend/src/services/medications-service.js`
- Modify: `backend/src/controllers/medications-controller.js`
- Test: `backend/test/medications-service.test.js`

**Interfaces:**
- Consumes: nada de tasks anteriores (primeira task do plano).
- Produces: `medicationsRepository.findAdministration(scheduleId, date) → { id, status, administeredAt, notes, authorProfileId, authorProfileName } | null`; `medicationsRepository.insertAdministration({ scheduleId, date, status, administeredAt, notes, authorProfileId }) → row | null` (null = perdeu a corrida); `medicationsRepository.updateAdministration(id, { status, administeredAt, notes }) → row`; `MedicationAdministrationConflictError` (usada pela Task 6/7 no frontend via `error.message`).

- [ ] **Step 1: Escrever o erro de conflito**

Crie `backend/src/errors/medication-administration-conflict-error.js`:

```js
class MedicationAdministrationConflictError extends Error {
  constructor({ authorProfileName, administeredAt } = {}) {
    super(
      authorProfileName
        ? `Esta dose já foi registrada por ${authorProfileName}`
        : "Esta dose já foi registrada por outro cuidador",
    );
    this.name = "MedicationAdministrationConflictError";
    this.authorProfileName = authorProfileName ?? null;
    this.administeredAt = administeredAt ?? null;
  }
}

module.exports = MedicationAdministrationConflictError;
```

- [ ] **Step 2: Escrever os testes de service que ainda vão falhar**

Em `backend/test/medications-service.test.js`, troque os três testes existentes que mockam
`setAdministration` (os que se chamam "inclui o profileId de quem administrou a dose",
"registra uma dose tomada no horário pertencente ao medicamento" e "rejeita um horário que não
pertence ao medicamento") pelo bloco abaixo, e adicione o `require` do novo erro no topo do
arquivo:

```js
const MedicationAdministrationConflictError = require("../src/errors/medication-administration-conflict-error");
```

Substitua os três testes antigos por:

```js
  it("insere a primeira conclusão com o profileId de quem administrou", async () => {
    let inserted;
    const service = createMedicationsService({
      scheduleBelongsToMedication: async () => true,
      findAdministration: async () => null,
      async insertAdministration(data) { inserted = data; return { id: "1", ...data }; },
    });
    await service.setAdministration("3", "5", { date: "2026-08-18", status: "taken" }, "9", "4");
    assert.equal(inserted.authorProfileId, "4");
    assert.equal(inserted.scheduleId, "5");
    assert.ok(inserted.administeredAt instanceof Date);
  });

  it("registra uma dose tomada com observações", async () => {
    let inserted;
    const service = createMedicationsService({
      scheduleBelongsToMedication: async () => true,
      findAdministration: async () => null,
      async insertAdministration(data) { inserted = data; return { id: "1", ...data }; },
    });
    await service.setAdministration("3", "5", {
      date: "2026-08-18", status: "taken", notes: "Sem intercorrências",
    });
    assert.equal(inserted.notes, "Sem intercorrências");
  });

  it("rejeita um horário que não pertence ao medicamento", async () => {
    const service = createMedicationsService({ scheduleBelongsToMedication: async () => false });
    await assert.rejects(
      service.setAdministration("3", "5", { date: "2026-08-18", status: "skipped" }),
      MedicationNotFoundError,
    );
  });

  it("trata uma segunda chamada do MESMO autor como edição, sem trocar o autor", async () => {
    let updatedId;
    let updatedData;
    const service = createMedicationsService({
      scheduleBelongsToMedication: async () => true,
      findAdministration: async () => ({
        id: "8", status: "taken", administeredAt: new Date("2026-08-18T08:03:00Z"),
        notes: null, authorProfileId: "4", authorProfileName: "Nathan",
      }),
      async updateAdministration(id, data) { updatedId = id; updatedData = data; return { id, ...data, authorProfileId: "4" }; },
    });
    const result = await service.setAdministration(
      "3", "5", { date: "2026-08-18", status: "skipped" }, "9", "4",
    );
    assert.equal(updatedId, "8");
    assert.equal(updatedData.status, "skipped");
    assert.equal(result.authorProfileId, "4");
  });

  it("rejeita a conclusão de OUTRO autor com MedicationAdministrationConflictError", async () => {
    const service = createMedicationsService({
      scheduleBelongsToMedication: async () => true,
      findAdministration: async () => ({
        id: "8", status: "taken", administeredAt: new Date("2026-08-18T08:03:00Z"),
        notes: null, authorProfileId: "4", authorProfileName: "Nathan",
      }),
      updateAdministration: async () => assert.fail("não deveria editar"),
    });
    await assert.rejects(
      service.setAdministration("3", "5", { date: "2026-08-18", status: "taken" }, "9", "7"),
      MedicationAdministrationConflictError,
    );
  });

  it("registro sem author_profile_id (legado) pode ser editado por qualquer perfil", async () => {
    let updatedId;
    const service = createMedicationsService({
      scheduleBelongsToMedication: async () => true,
      findAdministration: async () => ({
        id: "8", status: "taken", administeredAt: new Date("2026-08-18T08:03:00Z"),
        notes: null, authorProfileId: null, authorProfileName: null,
      }),
      async updateAdministration(id) { updatedId = id; return { id, authorProfileId: null }; },
    });
    await service.setAdministration("3", "5", { date: "2026-08-18", status: "taken" }, "9", "7");
    assert.equal(updatedId, "8");
  });

  it("condição de corrida: dois cuidadores concluindo juntos — o segundo recebe conflito", async () => {
    let findCalls = 0;
    const service = createMedicationsService({
      scheduleBelongsToMedication: async () => true,
      async findAdministration() {
        findCalls += 1;
        if (findCalls === 1) return null;
        return {
          id: "8", status: "taken", administeredAt: new Date("2026-08-18T08:03:00Z"),
          notes: null, authorProfileId: "4", authorProfileName: "Nathan",
        };
      },
      insertAdministration: async () => null,
      updateAdministration: async () => assert.fail("não deveria editar"),
    });
    await assert.rejects(
      service.setAdministration("3", "5", { date: "2026-08-18", status: "taken" }, "9", "7"),
      MedicationAdministrationConflictError,
    );
  });
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `cd backend && npx node --test test/medications-service.test.js`
Expected: FAIL — `createMedicationsService` ainda usa `setAdministration` do repositório, que não
existe mais nos mocks acima (`repository.findAdministration is not a function` ou similar).

- [ ] **Step 4: Trocar o upsert incondicional por insert-only + update dedicado no repositório**

Em `backend/src/repositories/medications-repository.js`, remova a função `setAdministration`
inteira e o `setAdministration` do `module.exports`, substituindo por:

```js
async function findAdministration(scheduleId, date) {
  const result = await pool.query(
    `SELECT a.id, a.status, a.administered_at AS "administeredAt", a.notes,
            a.author_profile_id AS "authorProfileId", cp.name AS "authorProfileName"
     FROM medication_administrations a
     LEFT JOIN caregiver_profiles cp ON cp.id = a.author_profile_id
     WHERE a.schedule_id = $1 AND a.scheduled_date = $2`,
    [scheduleId, date],
  );
  return result.rows[0] ?? null;
}

async function insertAdministration(data) {
  const result = await pool.query(
    `INSERT INTO medication_administrations
       (schedule_id, scheduled_date, status, administered_at, notes, author_profile_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (schedule_id, scheduled_date) DO NOTHING
     RETURNING id, status, administered_at AS "administeredAt", notes,
       author_profile_id AS "authorProfileId"`,
    [data.scheduleId, data.date, data.status, data.administeredAt, data.notes, data.authorProfileId],
  );
  return result.rows[0] ?? null;
}

async function updateAdministration(id, data) {
  const result = await pool.query(
    `UPDATE medication_administrations
     SET status = $1, administered_at = $2, notes = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $4
     RETURNING id, status, administered_at AS "administeredAt", notes,
       author_profile_id AS "authorProfileId"`,
    [data.status, data.administeredAt, data.notes, id],
  );
  return result.rows[0];
}
```

E troque o `module.exports` para:

```js
module.exports = Object.freeze({
  create,
  findAdministration,
  getAll,
  getDaily,
  insertAdministration,
  patientBelongsToUser,
  remove,
  scheduleBelongsToMedication,
  update,
  updateAdministration,
});
```

- [ ] **Step 5: Reescrever `setAdministration` no service**

Em `backend/src/services/medications-service.js`, adicione o `require` no topo:

```js
const MedicationAdministrationConflictError = require("../errors/medication-administration-conflict-error");
```

Troque a função `setAdministration` inteira por:

```js
  async function setAdministration(medicationId, scheduleId, input, userId, profileId) {
    validateId(medicationId, "medicationId");
    validateId(scheduleId, "scheduleId");
    const details = {};
    const date = typeof input.date === "string" ? input.date : "";
    const status = input.status;
    const notes = typeof input.notes === "string" ? input.notes.trim() : "";
    if (!isDate(date)) details.date = "Informe uma data válida";
    if (!new Set(["taken", "skipped"]).has(status)) details.status = "Status inválido";
    if (notes.length > 500) details.notes = "Use no máximo 500 caracteres";
    if (Object.keys(details).length) throw new MedicationValidationError(details);
    if (!(await repository.scheduleBelongsToMedication(medicationId, scheduleId, userId))) {
      throw new MedicationNotFoundError("Horário do medicamento não encontrado");
    }

    const administeredAt = status === "taken" ? new Date() : null;
    const normalizedNotes = notes || null;
    const authorProfileId = profileId ?? null;

    function applyEdit(record) {
      if (record.authorProfileId != null && String(record.authorProfileId) !== String(authorProfileId)) {
        throw new MedicationAdministrationConflictError({
          authorProfileName: record.authorProfileName,
          administeredAt: record.administeredAt,
        });
      }
      return repository.updateAdministration(record.id, {
        status, administeredAt, notes: normalizedNotes,
      });
    }

    const existing = await repository.findAdministration(scheduleId, date);
    if (!existing) {
      const inserted = await repository.insertAdministration({
        scheduleId, date, status, administeredAt, notes: normalizedNotes, authorProfileId,
      });
      if (inserted) return inserted;
      return applyEdit(await repository.findAdministration(scheduleId, date));
    }
    return applyEdit(existing);
  }
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `cd backend && npx node --test test/medications-service.test.js`
Expected: PASS (todos os testes, incluindo os 5 novos)

- [ ] **Step 7: Mapear o novo erro no controller**

Em `backend/src/controllers/medications-controller.js`, adicione o `require` no topo:

```js
const MedicationAdministrationConflictError = require("../errors/medication-administration-conflict-error");
```

E troque a função `handle` por:

```js
function handle(error, response, next) {
  if (error instanceof MedicationValidationError) {
    response.status(400).json({ error: error.message, details: error.details });
  } else if (error instanceof MedicationNotFoundError) {
    response.status(404).json({ error: error.message });
  } else if (error instanceof MedicationAdministrationConflictError) {
    response.status(409).json({
      error: error.message,
      authorProfileName: error.authorProfileName,
      administeredAt: error.administeredAt,
    });
  } else {
    next(error);
  }
}
```

- [ ] **Step 8: Rodar a suíte inteira do backend**

Run: `cd backend && npm test`
Expected: PASS (nenhum outro arquivo de teste referencia `setAdministration` do repositório)

- [ ] **Step 9: Commit**

```bash
git add backend/src/errors/medication-administration-conflict-error.js backend/src/repositories/medications-repository.js backend/src/services/medications-service.js backend/src/controllers/medications-controller.js backend/test/medications-service.test.js
git commit -m "fix: impede sobrescrita de autoria ao concluir dose de medicamento"
```

---

## Task 2: Atividades (rotinas) — conclusão à prova de sobrescrita

Mesmo padrão da Task 1, aplicado a `routine_completions`.

**Files:**
- Create: `backend/src/errors/routine-completion-conflict-error.js`
- Modify: `backend/src/repositories/routines-repository.js`
- Modify: `backend/src/services/routines-service.js`
- Modify: `backend/src/controllers/routines-controller.js`
- Test: `backend/test/routines-service.test.js`

**Interfaces:**
- Consumes: nada da Task 1 (módulo irmão, sem dependência direta).
- Produces: `routinesRepository.findCompletion(routineId, date) → { id, status, completedAt, authorProfileId, authorProfileName } | null`; `routinesRepository.insertCompletion({ routineId, date, status, completedAt, authorProfileId }) → row | null`; `routinesRepository.updateCompletion(id, { status, completedAt }) → row`; `RoutineCompletionConflictError`.

- [ ] **Step 1: Escrever o erro de conflito**

Crie `backend/src/errors/routine-completion-conflict-error.js`:

```js
class RoutineCompletionConflictError extends Error {
  constructor({ authorProfileName, completedAt } = {}) {
    super(
      authorProfileName
        ? `Esta atividade já foi registrada por ${authorProfileName}`
        : "Esta atividade já foi registrada por outro cuidador",
    );
    this.name = "RoutineCompletionConflictError";
    this.authorProfileName = authorProfileName ?? null;
    this.completedAt = completedAt ?? null;
  }
}

module.exports = RoutineCompletionConflictError;
```

- [ ] **Step 2: Escrever os testes de service que ainda vão falhar**

Em `backend/test/routines-service.test.js`, adicione o `require` no topo:

```js
const RoutineCompletionConflictError = require("../src/errors/routine-completion-conflict-error");
```

Troque os dois testes existentes de conclusão ("inclui o profileId de quem concluiu a
atividade" e "registra uma atividade concluída") pelo bloco abaixo:

```js
  it("insere a primeira conclusão com o profileId de quem concluiu", async () => {
    let inserted;
    const service = createRoutinesService({
      existsOnDate: async () => true,
      findCompletion: async () => null,
      async insertCompletion(data) { inserted = data; return { id: "1", ...data }; },
    });
    await service.setCompletion("3", { date: "2026-08-18", status: "completed" }, "9", "4");
    assert.equal(inserted.authorProfileId, "4");
    assert.ok(inserted.completedAt instanceof Date);
  });

  it("registra uma atividade concluída", async () => {
    let inserted;
    const service = createRoutinesService({
      existsOnDate: async () => true,
      findCompletion: async () => null,
      async insertCompletion(data) { inserted = data; return { id: "2", ...data }; },
    });
    await service.setCompletion("1", { date: "2026-08-20", status: "completed" });
    assert.ok(inserted.completedAt instanceof Date);
  });

  it("trata uma segunda chamada do MESMO autor como edição, sem trocar o autor", async () => {
    let updatedId;
    const service = createRoutinesService({
      existsOnDate: async () => true,
      findCompletion: async () => ({
        id: "6", status: "completed", completedAt: new Date("2026-08-20T09:00:00Z"),
        authorProfileId: "4", authorProfileName: "Nathan",
      }),
      async updateCompletion(id, data) { updatedId = id; return { id, ...data, authorProfileId: "4" }; },
    });
    const result = await service.setCompletion(
      "1", { date: "2026-08-20", status: "skipped" }, "9", "4",
    );
    assert.equal(updatedId, "6");
    assert.equal(result.authorProfileId, "4");
  });

  it("rejeita a conclusão de OUTRO autor com RoutineCompletionConflictError", async () => {
    const service = createRoutinesService({
      existsOnDate: async () => true,
      findCompletion: async () => ({
        id: "6", status: "completed", completedAt: new Date("2026-08-20T09:00:00Z"),
        authorProfileId: "4", authorProfileName: "Nathan",
      }),
      updateCompletion: async () => assert.fail("não deveria editar"),
    });
    await assert.rejects(
      service.setCompletion("1", { date: "2026-08-20", status: "completed" }, "9", "7"),
      RoutineCompletionConflictError,
    );
  });

  it("condição de corrida: dois cuidadores concluindo juntos — o segundo recebe conflito", async () => {
    let findCalls = 0;
    const service = createRoutinesService({
      existsOnDate: async () => true,
      async findCompletion() {
        findCalls += 1;
        if (findCalls === 1) return null;
        return {
          id: "6", status: "completed", completedAt: new Date("2026-08-20T09:00:00Z"),
          authorProfileId: "4", authorProfileName: "Nathan",
        };
      },
      insertCompletion: async () => null,
      updateCompletion: async () => assert.fail("não deveria editar"),
    });
    await assert.rejects(
      service.setCompletion("1", { date: "2026-08-20", status: "completed" }, "9", "7"),
      RoutineCompletionConflictError,
    );
  });
```

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `cd backend && npx node --test test/routines-service.test.js`
Expected: FAIL — mocks usam `findCompletion`/`insertCompletion`/`updateCompletion`, que o
service ainda não chama.

- [ ] **Step 4: Trocar o upsert incondicional por insert-only + update dedicado no repositório**

Em `backend/src/repositories/routines-repository.js`, remova a função `setCompletion` inteira
e substitua por:

```js
async function findCompletion(routineId, date) {
  const result = await pool.query(
    `SELECT c.id, c.status, c.completed_at AS "completedAt",
            c.author_profile_id AS "authorProfileId", cp.name AS "authorProfileName"
     FROM routine_completions c
     LEFT JOIN caregiver_profiles cp ON cp.id = c.author_profile_id
     WHERE c.routine_id = $1 AND c.scheduled_date = $2`,
    [routineId, date],
  );
  return result.rows[0] ?? null;
}

async function insertCompletion(data) {
  const result = await pool.query(
    `INSERT INTO routine_completions (routine_id, scheduled_date, status, completed_at, author_profile_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (routine_id, scheduled_date) DO NOTHING
     RETURNING id, status, completed_at AS "completedAt", author_profile_id AS "authorProfileId"`,
    [data.routineId, data.date, data.status, data.completedAt, data.authorProfileId],
  );
  return result.rows[0] ?? null;
}

async function updateCompletion(id, data) {
  const result = await pool.query(
    `UPDATE routine_completions
     SET status = $1, completed_at = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING id, status, completed_at AS "completedAt", author_profile_id AS "authorProfileId"`,
    [data.status, data.completedAt, id],
  );
  return result.rows[0];
}
```

E troque o `module.exports` para:

```js
module.exports = Object.freeze({
  create, existsOnDate, findCompletion, getAll, getDaily, insertCompletion,
  patientBelongsToUser, remove, update, updateCompletion,
});
```

- [ ] **Step 5: Reescrever `setCompletion` no service**

Em `backend/src/services/routines-service.js`, adicione o `require` no topo:

```js
const RoutineCompletionConflictError = require("../errors/routine-completion-conflict-error");
```

Troque a função `setCompletion` inteira por:

```js
  async function setCompletion(id, input, userId, profileId) {
    validateId(id);
    const details = {};
    const date = typeof input.date === "string" ? input.date : "";
    const status = input.status;
    if (!isDate(date)) details.date = "Informe uma data válida";
    if (!new Set(["completed", "skipped"]).has(status)) details.status = "Status inválido";
    if (Object.keys(details).length) throw new RoutineValidationError(details);
    if (!(await repository.existsOnDate(id, date, userId))) throw new RoutineNotFoundError("Atividade não encontrada nesta data");

    const completedAt = status === "completed" ? new Date() : null;
    const authorProfileId = profileId ?? null;

    function applyEdit(record) {
      if (record.authorProfileId != null && String(record.authorProfileId) !== String(authorProfileId)) {
        throw new RoutineCompletionConflictError({
          authorProfileName: record.authorProfileName,
          completedAt: record.completedAt,
        });
      }
      return repository.updateCompletion(record.id, { status, completedAt });
    }

    const existing = await repository.findCompletion(id, date);
    if (!existing) {
      const inserted = await repository.insertCompletion({ routineId: id, date, status, completedAt, authorProfileId });
      if (inserted) return inserted;
      return applyEdit(await repository.findCompletion(id, date));
    }
    return applyEdit(existing);
  }
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `cd backend && npx node --test test/routines-service.test.js`
Expected: PASS

- [ ] **Step 7: Mapear o novo erro no controller**

Em `backend/src/controllers/routines-controller.js`, adicione o `require` no topo:

```js
const RoutineCompletionConflictError = require("../errors/routine-completion-conflict-error");
```

E troque a função `handle` por:

```js
function handle(error, response, next) {
  if (error instanceof RoutineValidationError) response.status(400).json({ error: error.message, details: error.details });
  else if (error instanceof RoutineNotFoundError) response.status(404).json({ error: error.message });
  else if (error instanceof RoutineCompletionConflictError) {
    response.status(409).json({ error: error.message, authorProfileName: error.authorProfileName, completedAt: error.completedAt });
  } else next(error);
}
```

- [ ] **Step 8: Rodar a suíte inteira do backend**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/src/errors/routine-completion-conflict-error.js backend/src/repositories/routines-repository.js backend/src/services/routines-service.js backend/src/controllers/routines-controller.js backend/test/routines-service.test.js
git commit -m "fix: impede sobrescrita de autoria ao concluir atividade"
```

---

## Task 3: Anotações de enfermagem — edição restrita ao autor original

**Files:**
- Create: `backend/src/errors/nursing-note-ownership-error.js`
- Modify: `backend/src/repositories/nursing-notes-repository.js`
- Modify: `backend/src/services/nursing-notes-service.js`
- Modify: `backend/src/controllers/nursing-notes-controller.js`
- Test: `backend/test/nursing-notes-service.test.js`

**Interfaces:**
- Consumes: nada das Tasks 1-2.
- Produces: `nursingNotesRepository.findById(id, userId) → { id, authorProfileId } | null`; `NursingNoteOwnershipError`.

- [ ] **Step 1: Escrever o erro de propriedade**

Crie `backend/src/errors/nursing-note-ownership-error.js`:

```js
class NursingNoteOwnershipError extends Error {
  constructor(message = "Só quem registrou esta anotação pode editá-la") {
    super(message);
    this.name = "NursingNoteOwnershipError";
  }
}

module.exports = NursingNoteOwnershipError;
```

- [ ] **Step 2: Ler o teste de service existente para seguir o padrão**

Abra `backend/test/nursing-notes-service.test.js` e confirme como `createNursingNotesService` é
chamado nos testes existentes (mock de repositório passado como objeto simples, igual aos
outros arquivos de teste deste plano). Não precisa copiar nada aqui — é só para garantir que os
testes novos do Step 3 usam exatamente os mesmos nomes de mock já usados no arquivo (ex.:
`patientBelongsToUser`, `update`).

- [ ] **Step 3: Escrever os testes que ainda vão falhar**

Adicione ao final do `describe("nursing notes service", ...)` em
`backend/test/nursing-notes-service.test.js` (adicionando o `require` do novo erro no topo):

```js
const NursingNoteOwnershipError = require("../src/errors/nursing-note-ownership-error");
```

```js
  it("permite que o autor original edite sua própria anotação", async () => {
    let updatedId;
    const service = createNursingNotesService({
      findById: async () => ({ id: "5", authorProfileId: "4" }),
      async update(id) { updatedId = id; return true; },
    });
    await service.update("5", {
      noteDate: "2026-08-20", noteTime: "22:00", shift: "Noite", noteText: "Texto",
    }, "9", "4");
    assert.equal(updatedId, "5");
  });

  it("rejeita edição de outro perfil com NursingNoteOwnershipError", async () => {
    const service = createNursingNotesService({
      findById: async () => ({ id: "5", authorProfileId: "4" }),
      update: async () => assert.fail("não deveria editar"),
    });
    await assert.rejects(
      service.update("5", {
        noteDate: "2026-08-20", noteTime: "22:00", shift: "Noite", noteText: "Texto",
      }, "9", "7"),
      NursingNoteOwnershipError,
    );
  });

  it("anotação sem author_profile_id (legado) pode ser editada por qualquer perfil", async () => {
    let updatedId;
    const service = createNursingNotesService({
      findById: async () => ({ id: "5", authorProfileId: null }),
      async update(id) { updatedId = id; return true; },
    });
    await service.update("5", {
      noteDate: "2026-08-20", noteTime: "22:00", shift: "Noite", noteText: "Texto",
    }, "9", "7");
    assert.equal(updatedId, "5");
  });

  it("informa quando a anotação não existe", async () => {
    const service = createNursingNotesService({ findById: async () => null });
    await assert.rejects(
      service.update("99", {
        noteDate: "2026-08-20", noteTime: "22:00", shift: "Noite", noteText: "Texto",
      }, "9", "4"),
      NursingNoteNotFoundError,
    );
  });
```

(`NursingNoteNotFoundError` já é importado no topo do arquivo pelos testes existentes.)

- [ ] **Step 4: Rodar os testes e confirmar que falham**

Run: `cd backend && npx node --test test/nursing-notes-service.test.js`
Expected: FAIL — `repository.findById` ainda não existe e `service.update` ainda não recebe
`profileId`.

- [ ] **Step 5: Adicionar `findById` ao repositório**

Em `backend/src/repositories/nursing-notes-repository.js`, adicione:

```js
async function findById(id, userId) {
  const result = await pool.query(
    `SELECT id, author_profile_id AS "authorProfileId"
     FROM nursing_notes
     WHERE id = $1 AND patient_id IN (SELECT id FROM patients WHERE user_id = $2)`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}
```

E troque o `module.exports` para:

```js
module.exports = Object.freeze({ create, findById, getAll, patientBelongsToUser, remove, update });
```

- [ ] **Step 6: Checar autoria antes de editar, no service**

Em `backend/src/services/nursing-notes-service.js`, adicione o `require` no topo:

```js
const NursingNoteOwnershipError = require("../errors/nursing-note-ownership-error");
```

Troque a função `update` por:

```js
  async function update(id, input, userId, profileId) {
    validateId(id);
    const existing = await repository.findById(id, userId);
    if (!existing) throw new NursingNoteNotFoundError();
    if (existing.authorProfileId != null && String(existing.authorProfileId) !== String(profileId ?? "")) {
      throw new NursingNoteOwnershipError();
    }
    if (!(await repository.update(id, validateNote(input ?? {}, true), userId))) throw new NursingNoteNotFoundError();
  }
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `cd backend && npx node --test test/nursing-notes-service.test.js`
Expected: PASS

- [ ] **Step 8: Passar o `profileId` e mapear o novo erro no controller**

Em `backend/src/controllers/nursing-notes-controller.js`, adicione o `require` no topo:

```js
const NursingNoteOwnershipError = require("../errors/nursing-note-ownership-error");
```

Troque a função `handle` por:

```js
function handle(error, response, next) {
  if (error instanceof NursingNoteValidationError) response.status(400).json({ error: error.message, details: error.details });
  else if (error instanceof NursingNoteNotFoundError) response.status(404).json({ error: error.message });
  else if (error instanceof NursingNoteOwnershipError) response.status(403).json({ error: error.message });
  else next(error);
}
```

E troque a action `update` para passar o `profileId`:

```js
    update: action(async (request, response) => {
      await service.update(request.params.id, request.body, request.userId, request.profileId);
      changeBus.publish(request.userId, { resource: "nursing-notes", action: "updated" });
      response.status(204).send();
    }),
```

- [ ] **Step 9: Rodar a suíte inteira do backend**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add backend/src/errors/nursing-note-ownership-error.js backend/src/repositories/nursing-notes-repository.js backend/src/services/nursing-notes-service.js backend/src/controllers/nursing-notes-controller.js backend/test/nursing-notes-service.test.js
git commit -m "fix: restringe edição de anotação de enfermagem ao autor original"
```

---

## Task 4: Sinais vitais — edição restrita ao autor original

Mesmo padrão da Task 3, aplicado a `vital_signs`. Note que o `vitals-controller.js` usa um
padrão de `handleKnownError` diferente do resto do projeto (função que retorna `true`/`false`,
chamada em cada `catch`) — siga esse padrão específico deste arquivo, não o dos outros
controllers.

**Files:**
- Create: `backend/src/errors/vital-sign-ownership-error.js`
- Modify: `backend/src/repositories/vitals-repository.js`
- Modify: `backend/src/services/vitals-service.js`
- Modify: `backend/src/controllers/vitals-controller.js`
- Test: `backend/test/vitals-service.test.js`, `backend/test/vitals-controller.test.js`

**Interfaces:**
- Consumes: nada das Tasks 1-3.
- Produces: `vitalsRepository.findById(id, userId) → { id, authorProfileId } | null`; `VitalSignOwnershipError`.

- [ ] **Step 1: Escrever o erro de propriedade**

Crie `backend/src/errors/vital-sign-ownership-error.js`:

```js
class VitalSignOwnershipError extends Error {
  constructor(message = "Só quem registrou este sinal vital pode editá-lo") {
    super(message);
    this.name = "VitalSignOwnershipError";
  }
}

module.exports = VitalSignOwnershipError;
```

- [ ] **Step 2: Escrever os testes de service que ainda vão falhar**

Adicione ao `backend/test/vitals-service.test.js` (com o `require` do novo erro no topo do
arquivo):

```js
const VitalSignOwnershipError = require("../src/errors/vital-sign-ownership-error");
```

```js
  it("permite que o autor original edite seu próprio registro", async () => {
    let updatedId;
    const service = createVitalsService({
      findById: async () => ({ id: "5", authorProfileId: "4" }),
      async update(id) { updatedId = id; return { id }; },
    });
    await service.update("5", {
      date: "2026-08-20", time: "08:00", shift: "Manhã", bloodPressure: "120/80",
    }, "9", "4");
    assert.equal(updatedId, "5");
  });

  it("rejeita edição de outro perfil com VitalSignOwnershipError", async () => {
    const service = createVitalsService({
      findById: async () => ({ id: "5", authorProfileId: "4" }),
      update: async () => assert.fail("não deveria editar"),
    });
    await assert.rejects(
      service.update("5", {
        date: "2026-08-20", time: "08:00", shift: "Manhã", bloodPressure: "120/80",
      }, "9", "7"),
      VitalSignOwnershipError,
    );
  });

  it("registro sem author_profile_id (legado) pode ser editado por qualquer perfil", async () => {
    let updatedId;
    const service = createVitalsService({
      findById: async () => ({ id: "5", authorProfileId: null }),
      async update(id) { updatedId = id; return { id }; },
    });
    await service.update("5", {
      date: "2026-08-20", time: "08:00", shift: "Manhã", bloodPressure: "120/80",
    }, "9", "7");
    assert.equal(updatedId, "5");
  });

  it("informa quando o registro não existe", async () => {
    const service = createVitalsService({ findById: async () => null });
    await assert.rejects(
      service.update("99", {
        date: "2026-08-20", time: "08:00", shift: "Manhã", bloodPressure: "120/80",
      }, "9", "4"),
      NotFoundError,
    );
  });
```

Confira no topo do arquivo se `NotFoundError` já está importado (`require("../src/errors/not-found-error")`); se não estiver, adicione.

- [ ] **Step 3: Rodar os testes e confirmar que falham**

Run: `cd backend && npx node --test test/vitals-service.test.js`
Expected: FAIL — `repository.findById` ainda não existe.

- [ ] **Step 4: Adicionar `findById` ao repositório**

Em `backend/src/repositories/vitals-repository.js`, adicione:

```js
async function findById(id, userId) {
  const result = await pool.query(
    `SELECT id, author_profile_id AS "authorProfileId"
     FROM vital_signs
     WHERE id = $1 AND patient_id IN (SELECT id FROM patients WHERE user_id = $2)`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}
```

E troque o `module.exports` para:

```js
module.exports = Object.freeze({ create, findById, getAll, patientBelongsToUser, remove, update });
```

- [ ] **Step 5: Checar autoria antes de editar, no service**

Em `backend/src/services/vitals-service.js`, adicione o `require` no topo:

```js
const VitalSignOwnershipError = require("../errors/vital-sign-ownership-error");
```

Troque a função `update` por:

```js
  async function update(id, input, userId, profileId) {
    validateId(id);
    const existing = await repository.findById(id, userId);
    if (!existing) throw new NotFoundError();
    if (existing.authorProfileId != null && String(existing.authorProfileId) !== String(profileId ?? "")) {
      throw new VitalSignOwnershipError();
    }
    const updatedRecord = await repository.update(id, validateAndMap(input ?? {}, true), userId);
    if (!updatedRecord) throw new NotFoundError();
    return updatedRecord;
  }
```

- [ ] **Step 6: Rodar os testes de service e confirmar que passam**

Run: `cd backend && npx node --test test/vitals-service.test.js`
Expected: PASS

- [ ] **Step 7: Mapear o novo erro e passar o `profileId` no controller**

Em `backend/src/controllers/vitals-controller.js`, adicione o `require` no topo:

```js
const VitalSignOwnershipError = require("../errors/vital-sign-ownership-error");
```

Troque `handleKnownError` para incluir o novo erro:

```js
function handleKnownError(error, response) {
  if (error instanceof ValidationError) {
    response.status(400).json({ error: error.message, details: error.details });
    return true;
  }

  if (error instanceof NotFoundError) {
    response.status(404).json({ error: error.message });
    return true;
  }

  if (error instanceof VitalSignOwnershipError) {
    response.status(403).json({ error: error.message });
    return true;
  }

  return false;
}
```

E troque a função `update` para passar o `profileId`:

```js
  async function update(request, response, next) {
    try {
      const vitalSigns = await vitalsService.update(request.params.id, request.body, request.userId, request.profileId);
      changeBus.publish(request.userId, { resource: "vitals", action: "updated" });
      response.status(200).json({ data: vitalSigns });
    } catch (error) {
      if (!handleKnownError(error, response)) next(error);
    }
  }
```

- [ ] **Step 8: Ler `backend/test/vitals-controller.test.js` e ajustar se necessário**

Abra o arquivo e confira se algum teste chama `vitalsService.update` esperando exatamente 3
argumentos (sem `profileId`) de um jeito que quebre com o 4º argumento adicional — como
`profileId` é sempre o último parâmetro e os testes de controller tipicamente checam a
requisição HTTP (não a assinatura exata da chamada ao service), isso não deve quebrar nada; só
ajuste se o teste falhar no Step 9.

- [ ] **Step 9: Rodar a suíte inteira do backend**

Run: `cd backend && npm test`
Expected: PASS. Se `vitals-controller.test.js` falhar por causa do novo parâmetro, ajuste o
mock/asserção correspondente para aceitar o `profileId` adicional e rode de novo.

- [ ] **Step 10: Commit**

```bash
git add backend/src/errors/vital-sign-ownership-error.js backend/src/repositories/vitals-repository.js backend/src/services/vitals-service.js backend/src/controllers/vitals-controller.js backend/test/vitals-service.test.js backend/test/vitals-controller.test.js
git commit -m "fix: restringe edição de sinais vitais ao autor original"
```

---

## Task 5: Frontend — painel "Hoje" do dashboard (medicamentos + atividades)

**Files:**
- Modify: `frontend/js/dashboard.js`

**Interfaces:**
- Consumes: `authorProfileId` já presente nas respostas de `RoutinesRepository.getDaily`/`MedicationsRepository.getDaily` (Tasks 1-2 não mudaram o formato de leitura, só o de escrita); `CaregiverContext.getCurrentId()` (já existe em `frontend/js/caregiver-context.js`).
- Produces: nada consumido por outra task.

- [ ] **Step 1: Levar o `authorProfileId` para os itens do painel "Hoje"**

Em `frontend/js/dashboard.js`, na função `loadTasks`, adicione `authorProfileId` nos dois
`map` que hoje só pegam `authorName` (linhas do `activities.map` e `doses.map`):

```js
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
```

- [ ] **Step 2: Desabilitar as ações quando o item já foi concluído por outro cuidador**

Na função `taskRow` (mesmo arquivo), dentro do `.forEach` que cria os dois botões de ação,
troque:

```js
  ].forEach(({ iconName: buttonIcon, title: actionTitle, action, baseClass, doneClass }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `table-action table-action--icon ${baseClass}${item.status === action ? ` ${doneClass}` : ""}`;
    button.innerHTML = icon(buttonIcon);
    button.title = actionTitle;
```

por:

```js
  ].forEach(({ iconName: buttonIcon, title: actionTitle, action, baseClass, doneClass }) => {
    const lockedByOther = item.status !== "pending" && item.kind !== "event"
      && item.authorProfileId != null
      && String(item.authorProfileId) !== String(CaregiverContext.getCurrentId());
    const button = document.createElement("button");
    button.type = "button";
    button.className = `table-action table-action--icon ${baseClass}${item.status === action ? ` ${doneClass}` : ""}`;
    button.innerHTML = icon(buttonIcon);
    button.title = lockedByOther ? `Já registrado por ${item.authorName}` : actionTitle;
    button.disabled = lockedByOther;
```

(`item.kind !== "event"` porque eventos da agenda usam `completedByProfileName`, não fazem
parte do escopo desta etapa — continuam como estão.)

- [ ] **Step 3: Mostrar a mensagem de conflito quando o backend rejeitar (corrida perdida)**

No listener `todayList.addEventListener("click", ...)`, o `catch` já existe e já usa
`error.message` (que agora vem preenchido por `MedicationAdministrationConflictError`/
`RoutineCompletionConflictError`) — nenhuma mudança de código é necessária aqui, só recarregue
a lista para refletir o estado real depois do erro:

```js
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
```

(Só a linha `await loadTasks();` foi adicionada dentro do `catch`, para o card recarregar já
com o autor real e o botão desabilitado, em vez de ficar preso no estado otimista antigo.)

- [ ] **Step 4: Testar manualmente no navegador**

Run: inicie o backend (`cd backend && npm run dev`) e abra `frontend/index.html` (ou sirva a
pasta `frontend` com um servidor estático simples) em duas abas com perfis de cuidador
diferentes selecionados (`perfis.html`). Marque uma dose como administrada na Aba A; confirme
que na Aba B, depois de recarregar a lista de hoje, os botões daquele item aparecem
desabilitados com o tooltip "Já registrado por <nome da Aba A>", e que clicar mesmo assim (via
DevTools, se o `disabled` bloquear o clique) resulta na mensagem de erro do backend, não em
troca de autor.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/dashboard.js
git commit -m "feat: trava ações de conclusão já registradas por outro cuidador no painel Hoje"
```

---

## Task 6: Frontend — aba diária de medicamentos (`medicamentos.html`)

**Files:**
- Modify: `frontend/js/medications.js`

**Interfaces:**
- Consumes: `dose.authorProfileId` (já vem em `MedicationsRepository.getDaily`, sem mudança de
  formato); `CaregiverContext.getCurrentId()`.

- [ ] **Step 1: Desabilitar os botões de administrar/ignorar quando outro cuidador já concluiu**

Em `frontend/js/medications.js`, na função `loadDaily`, troque o trecho:

```js
    [
      { iconName: "check", action: "taken", title: "Administrado", baseClass: "table-action--success", doneClass: "table-action--done" },
      { iconName: "x", action: "skipped", title: "Ignorado", baseClass: "table-action--danger", doneClass: "table-action--skipped" },
    ].forEach(({ iconName, action, title, baseClass, doneClass }) => {
      const doseButton = button(icon(iconName), action, dose.scheduleId, `table-action table-action--icon ${baseClass}${dose.status === action ? ` ${doneClass}` : ""}`, title);
      actions.append(doseButton);
    });
```

por:

```js
    const lockedByOther = dose.status !== "pending"
      && dose.authorProfileId != null
      && String(dose.authorProfileId) !== String(CaregiverContext.getCurrentId());
    [
      { iconName: "check", action: "taken", title: "Administrado", baseClass: "table-action--success", doneClass: "table-action--done" },
      { iconName: "x", action: "skipped", title: "Ignorado", baseClass: "table-action--danger", doneClass: "table-action--skipped" },
    ].forEach(({ iconName, action, title, baseClass, doneClass }) => {
      const doseTitle = lockedByOther ? `Já registrado por ${dose.authorProfileName}` : title;
      const doseButton = button(icon(iconName), action, dose.scheduleId, `table-action table-action--icon ${baseClass}${dose.status === action ? ` ${doneClass}` : ""}`, doseTitle);
      doseButton.disabled = lockedByOther;
      actions.append(doseButton);
    });
```

- [ ] **Step 2: Recarregar a lista quando o backend rejeitar**

No listener `dailyBody.addEventListener("click", ...)`, adicione o recarregamento no `catch`:

```js
dailyBody.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]"); if (!target) return;
  const medicationId = target.closest("td").dataset.medicationId;
  try {
    await MedicationsRepository.setAdministration(medicationId, target.dataset.id, { date: dailyDate.value, status: target.dataset.action });
    await loadDaily();
  } catch (error) {
    message.textContent = error.message;
    await loadDaily();
  }
});
```

- [ ] **Step 3: Testar manualmente no navegador**

Run: com o backend rodando, abra `medicamentos.html`, marque uma dose como administrada, troque
o perfil de cuidador ativo (`perfis.html` → "Trocar cuidador") e confirme que os botões daquela
dose aparecem desabilitados com o tooltip do autor correto.

- [ ] **Step 4: Commit**

```bash
git add frontend/js/medications.js
git commit -m "feat: trava botões de administração já registrada por outro cuidador"
```

---

## Task 7: Frontend — anotações de enfermagem (gate de edição)

**Files:**
- Modify: `frontend/js/nursing-notes.js`

**Interfaces:**
- Consumes: `item.authorProfileId` (já vem em `NursingNotesRepository.getAll`);
  `CaregiverContext.getCurrentId()`.

- [ ] **Step 1: Esconder o botão "Editar" quando a anotação não for do cuidador atual**

Em `frontend/js/nursing-notes.js`, na função `renderNotes`, troque:

```js
    const actions = document.createElement("td");
    actions.append(
      button(icon("pencil"), "edit", item.id, "table-action table-action--icon", "Editar"),
      button(icon("trash"), "delete", item.id, "table-action table-action--icon table-action--danger", "Excluir"),
    );
```

por:

```js
    const actions = document.createElement("td");
    const isOwnNote = item.authorProfileId == null || String(item.authorProfileId) === String(CaregiverContext.getCurrentId());
    if (isOwnNote) {
      actions.append(button(icon("pencil"), "edit", item.id, "table-action table-action--icon", "Editar"));
    }
    actions.append(button(icon("trash"), "delete", item.id, "table-action table-action--icon table-action--danger", "Excluir"));
```

(A exclusão continua liberada para qualquer perfil — este plano não muda a regra de
`remove`, só a de `update`; se quiser restringir exclusão também, é um pedido separado.)

- [ ] **Step 2: Testar manualmente no navegador**

Run: com o backend rodando, abra `anotacoes-enfermagem.html`, registre uma anotação com o
perfil "Nathan", troque para o perfil "Eric" e confirme que a linha daquela anotação não mostra
mais o botão de lápis (edição), só o de excluir.

- [ ] **Step 3: Commit**

```bash
git add frontend/js/nursing-notes.js
git commit -m "feat: esconde edição de anotação de enfermagem para quem não é o autor"
```

---

## Task 8: Frontend — sinais vitais (gate de edição)

**Files:**
- Modify: `frontend/js/vitals-repository.js`
- Modify: `frontend/js/vitals.js`

**Interfaces:**
- Consumes: `record.authorProfileId` (a API já devolve; só falta o mapeamento local incluir);
  `CaregiverContext.getCurrentId()`.

- [ ] **Step 1: Expor `authorProfileId` no registro local**

Em `frontend/js/vitals-repository.js`, na função `toLocalRecord`, adicione o campo:

```js
      notes: record.notes ?? "",
      authorProfileName: record.authorProfileName ?? "",
      authorProfileId: record.authorProfileId ?? null,
    };
```

- [ ] **Step 2: Esconder o botão "Editar" quando o registro não for do cuidador atual**

Em `frontend/js/vitals.js`, na função `createActionsCell`, troque a assinatura e o corpo para
receber o registro completo em vez de só o id:

```js
function createActionsCell(record) {
  const cell = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "table-actions";

  const isOwnRecord = record.authorProfileId == null || String(record.authorProfileId) === String(CaregiverContext.getCurrentId());
  if (isOwnRecord) {
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "table-action table-action--icon";
    editButton.dataset.action = "edit";
    editButton.dataset.id = record.id;
    editButton.innerHTML = icon("pencil");
    editButton.title = "Editar";
    editButton.setAttribute("aria-label", "Editar");
    actions.append(editButton);
  }

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "table-action table-action--icon table-action--danger";
  deleteButton.dataset.action = "delete";
  deleteButton.dataset.id = record.id;
  deleteButton.innerHTML = icon("trash");
  deleteButton.title = "Excluir";
  deleteButton.setAttribute("aria-label", "Excluir");

  actions.append(deleteButton);
  cell.append(actions);
  return cell;
}
```

- [ ] **Step 3: Atualizar a chamada de `createActionsCell`**

Ainda em `frontend/js/vitals.js`, dentro de `renderHistory`, ache a linha que chama
`createActionsCell(record.id)` (ou equivalente, próxima ao `filteredRecords.forEach`) e troque
para `createActionsCell(record)`, já que a função agora recebe o registro inteiro.

- [ ] **Step 4: Testar manualmente no navegador**

Run: com o backend rodando, abra `sinais-vitais.html`, registre um sinal vital com o perfil
"Nathan", troque para o perfil "Eric" e confirme que a linha daquele registro não mostra mais o
botão de lápis, só o de excluir; confirme também que tentar editar via `PUT` direto na API (ex.
`curl`) com outro `X-Profile-Id` retorna 403.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/vitals-repository.js frontend/js/vitals.js
git commit -m "feat: esconde edição de sinais vitais para quem não é o autor"
```

---

## Task 9: Verificação final

**Files:** nenhum (só validação)

- [ ] **Step 1: Rodar a suíte completa do backend**

Run: `cd backend && npm test`
Expected: PASS, todos os arquivos.

- [ ] **Step 2: Checklist manual de ponta a ponta**

Com o backend (`npm run dev`) e o frontend abertos, usando dois perfis de cuidador diferentes
(ex.: "Nathan" e "Eric" cadastrados em `perfis.html`):

1. Nathan conclui uma dose de medicamento → aparece "Realizado por Nathan".
2. Eric abre a mesma tela (ou recarrega) → o item aparece travado, sem poder reconcluir; se
   tentar via clique forçado, recebe a mensagem "Esta dose já foi registrada por Nathan".
3. Nathan (mesmo perfil) reabre e consegue mudar o status daquele mesmo horário — a autoria
   continua "Nathan".
4. Repita 1-3 para uma atividade (rotina).
5. Nathan cria uma anotação de enfermagem; Eric não vê o botão de editar naquela anotação, só
   o de excluir; Nathan vê o botão de editar normalmente.
6. Repita o item 5 para sinais vitais.

- [ ] **Step 3: Reportar quaisquer divergências antes de considerar a Etapa 1 concluída**

Se algum item do checklist falhar, volte para a task correspondente (1-8) e corrija antes de
prosseguir para a Etapa 2 do design.
