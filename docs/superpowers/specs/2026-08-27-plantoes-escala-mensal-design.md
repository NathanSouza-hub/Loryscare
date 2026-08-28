# Plantões — escala mensal e integração com "Iniciar um plantão" — Design

**Data:** 2026-08-27
**Depende de:** `caregiver_profiles`, `work_shifts` (migration 021), autenticação por usuário + perfil
(`x-profile-id`), tudo já implementado.

## Contexto e objetivo

Hoje, "iniciar um plantão" (`work_shifts`) é sempre manual: em `perfis.html`, quem começa a
cuidar escolhe o cuidador, a data, a hora e a duração num formulário livre. Não existe nenhum
planejamento prévio — cada início é digitado na hora.

Objetivo: adicionar uma aba **Plantões** onde a escala do mês (quem cuida, em quais dias e
horários) é montada com antecedência, e fazer o botão "Iniciar um plantão" passar a **usar essa
escala como fonte de verdade** — localizando automaticamente o plantão programado do cuidador
selecionado, sem pedir de novo data/hora/duração. O fluxo manual continua existindo, intacto,
como "plantão extraordinário" para emergências ou para quando não há escala.

Fora de escopo (não pedido, não implementado agora):
- Papel de "administrador" separado de cuidador — não existe hoje no sistema (todo perfil tem os
  mesmos poderes) e não será criado. Qualquer pessoa logada na conta pode montar/editar a escala.
- Botão de "encerrar plantão" — hoje não existe (a coluna `ended_at` de `work_shifts` nunca é
  preenchida por nenhum fluxo). O status "Concluído" é derivado por tempo em vez de depender de
  um encerramento manual (ver seção de status).
- Escala por paciente — `work_shifts` e `caregiver_profiles` já são escopados só pela conta
  (`user_id`), não por paciente (ver "Estado atual" abaixo). A escala mensal segue o mesmo
  escopo.

## Estado atual (levantamento)

- `work_shifts`: `id, user_id, profile_id, started_at, duration_hours, expected_end_at, ended_at,
  created_at`. Exclusividade por **conta inteira** (não por cuidador): `createExclusive` faz
  `SELECT ... FOR UPDATE` em `users` e só permite um plantão ativo por `user_id` de cada vez.
  Confirma que "quem está de plantão" é um conceito único por conta, não por paciente — bate com
  o relato do design doc `2026-08-21-jornada-autoria-design.md` (3 cuidadores revezando o cuidado
  de uma única pessoa, mesma conta, troca de perfil).
- `caregiver_profiles`: `id, user_id, name, avatar_color, is_active, pin_hash`. Lista já usada em
  `perfis.html`/`perfis.js` via `CaregiverProfilesRepository.getAll()`.
- Fluxo atual do botão "Iniciar um plantão" (`frontend/perfis.html` + `perfis.js`): botão
  `#start-shift-button` chama `showShiftStep()` sem perfil pré-selecionado → formulário com
  `<select id="shift-profile">` (lista de cuidadores), `startedDate`, `startedTime`,
  `durationHours` → `WorkShiftsRepository.start(data)` → `POST /api/work-shifts`. Não usa PIN
  nesse caminho (this já é assim hoje; não será alterado).
- `work-shifts-service.start(input, userId, profileId)`: valida data/hora/duração, calcula
  `expected_end_at = started_at + duration_hours`, delega a `createExclusive`.
- Nenhuma tabela de escala/planejamento existe hoje. Nenhuma migration remove nada — tudo aqui é
  aditivo.
- Frontend é HTML/CSS/JS puro, sem bundler e sem dependências de terceiros — não há biblioteca de
  drag-and-drop instalada.

## Modelo de dados (novo, aditivo)

```sql
CREATE TABLE schedule_months (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year SMALLINT NOT NULL,
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  duration_hours SMALLINT NOT NULL CHECK (duration_hours IN (12, 24)),
  first_start_time TIME NOT NULL,
  second_start_time TIME,              -- só quando duration_hours = 12
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, year, month)
);

CREATE TABLE schedule_month_caregivers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_month_id BIGINT NOT NULL REFERENCES schedule_months(id) ON DELETE CASCADE,
  profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id) ON DELETE RESTRICT,
  position SMALLINT NOT NULL,
  UNIQUE (schedule_month_id, profile_id),
  UNIQUE (schedule_month_id, position)
);

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

CREATE TABLE schedule_shift_swaps (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_shift_id BIGINT NOT NULL REFERENCES schedule_shifts(id) ON DELETE CASCADE,
  previous_profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id),
  new_profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id),
  changed_by_profile_id BIGINT REFERENCES caregiver_profiles(id),
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- work_shifts (tabela existente) ganha colunas novas, nada é removido/renomeado:
ALTER TABLE work_shifts
  ADD COLUMN schedule_shift_id BIGINT REFERENCES schedule_shifts(id) ON DELETE SET NULL,
  ADD COLUMN scheduled_start_at TIMESTAMP,
  ADD COLUMN scheduled_end_at TIMESTAMP;

CREATE UNIQUE INDEX idx_work_shifts_schedule_shift_once
  ON work_shifts (schedule_shift_id) WHERE schedule_shift_id IS NOT NULL;
```

Um `work_shift` sem `schedule_shift_id` é, por definição, o plantão extraordinário/manual que já
existe hoje — não precisa de coluna booleana adicional. `started_at`/`expected_end_at` continuam
sendo o horário **real** (comportamento e nomes já existentes, sem mudança); `scheduled_start_at`/
`scheduled_end_at` em `work_shifts` são um **snapshot** tirado no momento do início real, para que
o previsto fique registrado para sempre mesmo que o `schedule_shift` original seja depois editado
ou excluído.

## Fluxo 1 — Nova aba "Plantões"

- Sidebar: `<a class="nav-link" href="plantoes.html">Plantões</a>` adicionado depois de "Agenda"
  em todos os HTML que têm o menu (mesmo padrão de duplicação manual já usado hoje).
- `frontend/plantoes.html` + `frontend/js/plantoes.js` + `frontend/js/schedule-repository.js`,
  seguindo exatamente a estrutura de `agenda.html`/`agenda.js` (mesmo `app-shell`, `page-header`,
  `history-panel`, `table-wrapper`, classes de formulário `.form-grid`/`.form-field`, botões
  `.primary-button`/`.secondary-button`).
- Dois `<select>` de Mês/Ano no topo. Ao trocar, recarrega a escala daquele mês.
- **Sem escala para o mês selecionado:** mostra o formulário de geração (ver Fluxo 2).
- **Com escala:** mostra um resumo read-only da configuração (tipo, horários, ordem dos
  cuidadores) + botão "Excluir escala do mês" (com confirmação), e a tabela de plantões do mês
  (ver Fluxo 3).

## Fluxo 2 — Gerar escala do mês

Formulário:
- Tipo de plantão: `<select>` 12h/24h (mesmo padrão de `shift-duration` em `perfis.html`).
- Horários: 12h → dois campos `time` ("Início do 1º período" / "Início do 2º período"); 24h → um
  campo `time` ("Início do plantão"). Nenhum horário pré-definido pelo sistema.
- Lista de cuidadores da conta (`CaregiverProfilesRepository.getAll()`, já existente) com
  checkbox para selecionar quem participa do revezamento daquele mês.
- Lista ordenável dos selecionados: cada item tem alça `draggable="true"` (drag-and-drop HTML5
  nativo, sem biblioteca nova) **e** botões ↑/↓ ao lado como alternativa acessível/sem drag.
- Botão "Gerar escala do mês".

Backend (`POST /api/schedule-months`), tudo em uma transação:
1. Se já existe `schedule_months` para `(user_id, year, month)` → `ScheduleMonthValidationError`
   ("Já existe uma escala para este mês. Exclua-a antes de gerar novamente.") — não regenera
   nem substitui silenciosamente.
2. Cria a linha em `schedule_months`.
3. Cria as linhas de `schedule_month_caregivers` na ordem enviada.
4. Gera os `schedule_shifts` do mês inteiro por rodízio simples, avançando o índice a cada slot
   gerado (não reinicia a cada dia):
   - 24h: 1 slot/dia, de `first_start_time` até `first_start_time` do dia seguinte.
   - 12h: 2 slots/dia (`first_start_time`→`second_start_time` e `second_start_time`→
     `first_start_time` do dia seguinte).
   - `scheduled_start_at`/`scheduled_end_at` são sempre `TIMESTAMP` completos (data+hora), então
     um plantão que atravessa a meia-noite (18h→06h, ou qualquer 24h) é um único registro — cobre
     o requisito de tratar corretamente virada de dia.
   - `original_profile_id = profile_id = caregivers[i % caregivers.length]`.

## Fluxo 3 — Tabela da escala + edição individual

Colunas: Data, Início, Término, Cuidador, Status (ver seção de status), Ações. Reaproveita o
padrão de tabela já usado em `agenda.html`/histórico — sem calendário visual novo.

- **Editar** (`PATCH /api/schedule-shifts/:id`): abre formulário inline/modal reaproveitando
  `.form-panel`/`.form-grid` para trocar `profile_id` e/ou os horários **daquele registro só**.
  Nenhum outro `schedule_shift` do mês é recalculado. Se o `profile_id` mudar, grava uma entrada
  em `schedule_shift_swaps` (`previous_profile_id`, `new_profile_id`, `changed_by_profile_id` =
  perfil atual da requisição, `changed_at = now()`).
- **Excluir** (`DELETE /api/schedule-shifts/:id`): remove só aquele registro. Se havia um
  `work_shift` vinculado, ele fica com `schedule_shift_id = NULL` (`ON DELETE SET NULL`) — o
  registro operacional não é apagado, só perde o vínculo.
- **Trocar** (`POST /api/schedule-shifts/swap` com `{ shiftIdA, shiftIdB }`): inverte só o
  `profile_id` dos dois registros (o `original_profile_id` de cada um nunca muda) e grava duas
  entradas em `schedule_shift_swaps`, uma por plantão trocado. Bloqueado
  (`ScheduleShiftValidationError`) se qualquer um dos dois já tiver `work_shift` vinculado —
  trocar responsável de um plantão que já virou trabalho real não faz sentido operacional.

## Fluxo 4 — Integração com "Iniciar um plantão" (`perfis.html`/`perfis.js`)

O formulário manual atual (`#shift-form`: cuidador, data, hora, duração) **continua existindo e
funcionando exatamente como hoje** — é o caminho extraordinário. O que muda é o que acontece antes
dele ser mostrado:

1. Ao selecionar/mudar o cuidador em `#shift-profile`, chama `GET
   /api/schedule-shifts/current?profileId=<id>` (rota nova; não depende de `X-Profile-Id` porque
   é chamada justamente antes de definir o perfil corrente na sessão — valida `profileId` como
   query param pertencente à conta autenticada).
2. **Achou um `schedule_shift` cobrindo agora (`scheduled_start_at <= now < scheduled_end_at`) e
   sem `work_shift` vinculado:** esconde os campos de data/hora/duração; mostra um cartão "Seu
   plantão — Hoje, 06:00 às 18:00 — 12 horas" com um único botão "Iniciar plantão". Ao confirmar,
   `POST /api/work-shifts` recebe `{ scheduleShiftId }` em vez dos campos manuais.
3. **Achou, mas já tem `work_shift` vinculado:** mostra "Este plantão já foi iniciado." e não
   permite novo início para aquele `scheduleShiftId` (índice único no banco garante mesmo sob
   concorrência).
4. **Não achou nenhum `schedule_shift` cobrindo agora para esse cuidador:** mostra "Não
   encontramos um plantão programado para você neste horário." e revela o formulário manual
   existente, com o botão renomeado para "Iniciar plantão extraordinário".
5. Mesmo quando um plantão programado foi encontrado (caso 2), um link secundário discreto
   "Iniciar plantão extraordinário" continua acessível, revelando o formulário manual — cobre o
   caso de emergência sem esconder a opção manual.

`work-shifts-service.start(input, userId, profileId)` passa a aceitar `scheduleShiftId`
opcional:
- Se vier `scheduleShiftId`: valida que o `schedule_shift` pertence à conta e que não tem
  `work_shift` vinculado ainda; usa o `profile_id` **atual** do `schedule_shift` (reflete trocas
  feitas depois da geração, ignorando qualquer `profileId` manual do request); copia
  `scheduled_start_at`/`scheduled_end_at` para o novo `work_shift`; `started_at = now()` (real).
  Continua respeitando a exclusividade por conta já existente (`createExclusive`).
- Se não vier `scheduleShiftId`: comportamento idêntico ao atual (nenhuma regressão) —
  `schedule_shift_id`/`scheduled_start_at`/`scheduled_end_at` ficam `NULL`, ou seja, extraordinário.

## Status (calculado, não armazenado)

Sem coluna `status` — evita estado duplicado, no mesmo espírito do design doc de jornada já
existente ("calculado on-the-fly na leitura"):

| Status | Condição |
|---|---|
| Programado | sem `work_shift` vinculado e `now() <= scheduled_end_at` |
| Em andamento | `work_shift` vinculado com `ended_at IS NULL` (inclui atrasado — não fecha sozinho) |
| Concluído | `work_shift` vinculado com `ended_at IS NOT NULL`, OU vinculado e `now() > scheduled_end_at` |
| Não realizado | sem `work_shift` vinculado e `now() > scheduled_end_at` |

## Validações principais

- `schedule-month-validation-error` (seguindo o padrão de uma classe de erro por módulo em
  `src/errors/`): mês 1–12, ano entre 2020–2100, `durationHours` em {12,24}, horários em
  `HH:MM`, `secondStartTime` obrigatório só quando `durationHours = 12`, pelo menos 1 cuidador,
  todos os `profileId` validados com `caregiverProfilesRepository.belongsToUser` (reaproveitado).
- Gerar mês/ano já existente → erro tratado no Fluxo 2.
- Excluir `schedule_months` → bloqueado se qualquer `schedule_shift` do mês tiver `work_shift`
  vinculado ("Este mês já tem plantões iniciados; não é possível excluir a escala.").
- `schedule-shift-validation-error`: editar/trocar exige que o novo `profile_id` pertença à conta;
  troca bloqueada se qualquer um dos dois já estiver vinculado a um `work_shift` (Fluxo 3).
- `work-shifts-service.start` com `scheduleShiftId`: erro "Este plantão já foi iniciado." se já
  vinculado; erro de validação se o `scheduleShiftId` não pertencer à conta.
- `GET /api/schedule-shifts/current`: valida `profileId` numérico e pertencente à conta antes de
  buscar.

## Rotas novas

```
POST   /api/schedule-months                  -- gera a escala do mês (Fluxo 2)
GET    /api/schedule-months?year=&month=     -- config do mês (ou null)
DELETE /api/schedule-months/:id              -- exclui a escala inteira do mês

GET    /api/schedule-shifts?year=&month=     -- lista os plantões do mês (com status calculado)
GET    /api/schedule-shifts/current?profileId=  -- lookup usado por perfis.js (Fluxo 4)
PATCH  /api/schedule-shifts/:id              -- edita um plantão
DELETE /api/schedule-shifts/:id              -- exclui um plantão
POST   /api/schedule-shifts/swap             -- troca dois plantões
```

Todas atrás de `requireAuth`; `attachProfile` aplicado onde fizer sentido (edição/troca podem
usar `request.profileId` como `changed_by_profile_id`), seguindo o padrão de montagem de rotas já
usado em `app.js`.

## Compatibilidade

Nenhuma migration remove coluna ou tabela. O formulário manual de `perfis.html`, a exclusividade
de plantão por conta, o indicador "Plantão até 18h" na sidebar (`ui-icons.js`) e todo o resto do
sistema (autenticação, pacientes, agenda, medicamentos, atividades, sinais vitais, anotações,
dashboard, histórico, design system, responsividade) continuam funcionando exatamente como hoje.

## Migrations necessárias

1. `024_create_schedule_months.sql`
2. `025_create_schedule_month_caregivers.sql`
3. `026_create_schedule_shifts.sql`
4. `027_create_schedule_shift_swaps.sql`
5. `028_add_schedule_shift_id_to_work_shifts.sql`

## Testes

- `schedule-months-service.test.js`: validação de entrada; bloqueio de mês duplicado; geração
  correta dos slots (12h com 2 períodos/dia, 24h com 1/dia, rodízio contínuo entre dias, plantão
  cruzando meia-noite como registro único).
- `schedule-shifts-service.test.js`: edição individual não altera outros registros; troca inverte
  só os dois `profile_id` e grava histórico; edição/troca bloqueada quando já iniciado.
- `work-shifts-service.test.js` (estende o existente): iniciar com `scheduleShiftId` usa o
  cuidador atual do schedule (mesmo após troca), grava snapshot de horários previstos, rejeita
  iniciar duas vezes o mesmo `scheduleShiftId`; iniciar sem `scheduleShiftId` permanece idêntico
  ao comportamento atual (regressão).
- Verificação manual no navegador do fluxo ponta a ponta: gerar escala → editar um plantão →
  trocar dois → iniciar pelo botão em "Quem está cuidando agora?" → conferir "Em andamento" na
  tabela → tentar iniciar de novo e ver o bloqueio → cenário sem plantão programado caindo no
  extraordinário.
