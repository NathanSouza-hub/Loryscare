# Jornada, autoria imutável e registro retroativo — Design

**Data:** 2026-08-21
**Status:** substitui o fluxo de "plantão" da Fase 2 (`2026-08-21-perfis-compartilhados-design.md`)
**Depende de:** perfis de cuidador (`caregiver_profiles`, `x-profile-id`) já implementados.

## Contexto e objetivo

3 cuidadores (Nathan, Eric e um terceiro) se revezam no mesmo paciente em turnos de 12h ou 24h,
usando a mesma conta com troca de perfil (sem senha própria — ver design da Fase 1). Hoje isso
gera dois problemas reais:

1. **Autoria sobrescrita.** Quando um cuidador conclui uma dose/atividade e outro cuidador
   interage depois com a mesma ocorrência, a autoria (`author_profile_id`) e o horário podem
   acabar trocando para o segundo, porque o "dar baixa" é implementado como upsert incondicional.
2. **Seleção manual de Manhã/Tarde/Noite/Turno/Plantão.** O sistema já calcula isso a partir do
   horário no frontend, mas ainda pede confirmação manual e usa a linguagem de "plantão", que o
   dono do sistema quer abandonar em favor de "jornada" (período de trabalho de 12h/24h que o
   cuidador escolhe ao começar a trabalhar).

Objetivo: dado que a autoria de uma ação é sempre o **perfil autenticado que a realizou**
(independente de jornada), garantir que essa autoria nunca seja sobrescrita silenciosamente,
permitir correção apenas por quem originalmente registrou, adicionar o conceito de jornada
(12h/24h) como metadado do período de trabalho — não como campo de atribuição — e permitir
lançar retroativamente algo que aconteceu antes de hoje sem confundir "quando aconteceu" com
"quando foi digitado".

Fora de escopo: login individual por cuidador (PIN/senha por perfil) — a troca de perfil
continua sendo confiança dentro da mesma conta, como já documentado na Fase 1. Jornada não é
uma fronteira de autorização, é só um registro do período trabalhado.

## Estado atual (levantamento)

- `medications-repository.setAdministration` e `routines-repository.setCompletion` fazem
  `INSERT ... ON CONFLICT (schedule_id|routine_id, scheduled_date) DO UPDATE SET status =
  EXCLUDED.status, ..., author_profile_id = EXCLUDED.author_profile_id` — **toda chamada
  subsequente sobrescreve quem concluiu e quando**, sem checar se já havia conclusão. Esta é a
  causa raiz do bug relatado.
- `nursing-notes-repository.update` e (a implementar) `vitals-repository.update` não verificam
  autoria nenhuma hoje — qualquer perfil da conta pode editar a anotação/sinal vital de outro.
- `UNIQUE (schedule_id, scheduled_date)` / `UNIQUE (routine_id, scheduled_date)` já isolam cada
  horário (00h/08h/16h) como ocorrência própria — não precisa mudar nada aqui.
- `shift` (Manhã/Tarde/Noite/Madrugada) já é calculado no frontend a partir da hora
  (`shiftFromHour`/`selectShiftFromHour`) e é `NOT NULL` em `vital_signs` e `nursing_notes` —
  dá pra manter a coluna e só parar de expor/exigir escolha manual, calculando no backend.
  `medications`/`routines`/`events` não têm coluna de turno.
- `nursing_notes` (note_date + note_time vs. created_at) e `vital_signs` (measured_at vs.
  created_at) já distinguem "quando aconteceu" de "quando foi registrado" — falta só permitir
  escolher uma data/hora passada no formulário e bloquear datas futuras.
- Não existe tabela de jornada/sessão de trabalho.
- O campo de data usado para marcar dose/atividade (`daily-date`) não tem `min`/`max`, ou seja
  já é possível (sem querer) marcar como concluído um dia futuro.

## Etapa 1 — Autoria imutável, com edição restrita ao autor original

### Regra

```
POST (primeira conclusão):
  SE não existe conclusão para esta ocorrência:
      cria com completed_by = perfil autenticado, completed_at = agora
  SE já existe conclusão de OUTRO perfil:
      rejeita com 409 "Já concluído por <nome> às <hora>"
  SE já existe conclusão do MESMO perfil:
      trata como edição (ver abaixo)

EDIÇÃO:
  Só o perfil dono da conclusão (author_profile_id) pode alterar status/observações depois.
  completed_by e completed_at da conclusão original NUNCA mudam.
  Qualquer outro perfil tentando editar recebe 403 "Só quem concluiu pode editar".
```

Isso cobre concorrência (dois cuidadores clicando quase juntos): o `INSERT ... ON CONFLICT DO
NOTHING` é atômico — quem chegar primeiro no banco vence, o segundo recebe 0 linhas afetadas e
o service converte isso em 409, sem lock manual nem race condition.

### Mudanças concretas

**`medication_administrations` / `routine_completions` (SQL, sem migration destrutiva):**

```sql
-- medications-repository.setAdministration (troca o upsert incondicional por insert-only)
INSERT INTO medication_administrations (schedule_id, scheduled_date, status, administered_at, notes, author_profile_id)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (schedule_id, scheduled_date) DO NOTHING
RETURNING id, status, administered_at, notes, author_profile_id;
-- rowCount === 0 → já existe: repository busca a linha existente e devolve pro service decidir
-- 409 (autor diferente) ou seguir pro fluxo de edição (autor igual)
```

Nova função `updateAdministration`/`updateCompletion` (UPDATE simples, sem tocar
`author_profile_id`), usada só quando `author_profile_id` da linha == `profileId` da requisição.

Rotas novas: `PATCH /api/medications/:id/schedules/:scheduleId/administrations` (ou similar) e
equivalente em routines, reaproveitando o mesmo path de leitura (`getDaily`) para decidir no
frontend se mostra botão de concluir ou de editar.

**`nursing_notes.update` / `vitals.update`:** adicionar checagem `author_profile_id ===
request.profileId` no service antes de delegar ao repository; senão lança um novo erro 403
(`NursingNoteOwnershipError` / `VitalSignOwnershipError`, seguindo o padrão de
`*-not-found-error.js` já existente). Registros antigos sem `author_profile_id` (criados antes
da Fase 1) ficam editáveis por qualquer perfil, para não travar dado legado.

**Erros novos** (seguindo o padrão de uma classe por módulo em `src/errors/`):
`medication-administration-conflict-error.js` (409), `routine-completion-conflict-error.js`
(409), `medication-administration-ownership-error.js` (403),
`routine-completion-ownership-error.js` (403), `nursing-note-ownership-error.js` (403),
`vital-sign-ownership-error.js` (403).

**Frontend:** no card/linha da ocorrência, se `authorProfileId !== profileId atual` → mostra só
leitura ("Realizado por Nathan · 08:03", sem botão de ação); se for o mesmo autor → mostra botão
"Editar" no lugar de "Concluir". Nenhuma migration de banco necessária nesta etapa.

## Etapa 2 — Remover Manhã/Tarde/Noite/Turno/Plantão da interface

- Tira os `<select id="shift">` de `sinais-vitais.html` e `anotacoes-enfermagem.html` (criação,
  edição e filtro) e o texto "plantão" da UI (`plantao-hint`, labels, `historico-impressao`).
- `vitals-service`/`nursing-notes-service` passam a calcular `shift` internamente a partir do
  horário informado (reaproveita `shiftFromHour`, movido para o backend), em vez de validar um
  valor recebido do formulário. Coluna `shift` continua existindo no banco (não é migration
  destrutiva) — só deixa de ser visível/obrigatória para o usuário.
- Sem mudança de schema.

## Etapa 3 — Jornada (12h/24h)

Nova tabela, escopada por cuidador (não por paciente — jornada é do cuidador, não de quem ele
atende naquele momento):

```sql
CREATE TABLE work_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id BIGINT NOT NULL REFERENCES caregiver_profiles(id) ON DELETE CASCADE,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_hours SMALLINT NOT NULL CHECK (duration_hours IN (12, 24)),
  expected_end_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ended_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_work_sessions_one_active_per_profile
  ON work_sessions (profile_id) WHERE status = 'active';
```

O índice único parcial garante no próprio banco a regra "não pode ter duas jornadas ativas do
mesmo cuidador" (ponto 21), sem precisar checar e depois inserir (evita race condition aqui
também).

- Tela "Iniciar jornada": duração 12h/24h → calcula `expected_end_at` no backend
  (`started_at + duration_hours`).
- Indicador discreto de jornada ativa (ex.: chip na sidebar, "07:00 → 19:00 · 12h"), usando a
  identidade visual atual.
- "Encerrar jornada" seta `ended_at`/`status = 'ended'`. Encerramento automático quando passar
  de `expected_end_at` é possível mas não obrigatório para o MVP — pode ficar como faixa
  "atrasada" visual em vez de fechar sozinho, para não cortar uma jornada que atrasou de verdade.
- **Não** entra em nenhuma query de atribuição — é só uma tela e uma tabela novas.

## Etapa 4 — Registro retroativo

- Nos formulários de anotação e sinais vitais, campo de data/hora do acontecimento deixa de ser
  travado em "agora": vira editável, com valor padrão = agora.
- Backend (`vitals-service`/`nursing-notes-service`) rejeita `event_at` no futuro (compara com
  `NOW()` do servidor) — aplica-se só a registro de acontecimento passado, não à agenda
  (`events`), que continua permitindo datas futuras normalmente.
- Em medicamentos/atividades, o seletor de data (`daily-date`) ganha `max = hoje` para a ação de
  concluir (a navegação para ver dias futuros continua liberada, só a conclusão é bloqueada).
- "Registrado posteriormente": calculado on-the-fly na leitura (não precisa coluna nova),
  comparando `created_at` com `event_at` (note_date+note_time ou measured_at): mostra o selo
  quando a diferença for maior que 30 minutos OU quando a data do acontecimento for de um dia
  anterior ao de `created_at`. Cobre digitação normal (poucos minutos) sem marcar como
  retroativo.

## Etapa 5 — Histórico

- Telas de histórico (`historico-impressao`, listagens de anotações/sinais vitais) já mostram
  autor via `authorProfileName`; adiciona o selo "Registrado posteriormente" da Etapa 4 e
  garante ordenação por horário do acontecimento (`event_at`), não por `created_at`.
- Sem mudança de schema.

## Compatibilidade

Preserva autenticação, pacientes, agenda, medicamentos, atividades, sinais vitais, anotações,
dashboard, filtros, histórico, seleção de paciente, design system e responsividade. Nenhuma
migration remove coluna ou tabela; `work_sessions` é aditiva; `shift` continua existindo, só
para de ser exigida do usuário.

## Migrations necessárias

1. `021_create_work_sessions.sql` — cria `work_sessions` + índice único parcial (Etapa 3).

Nenhuma outra migration é necessária: Etapas 1, 2, 4 e 5 são mudanças de código
(service/repository/frontend), reaproveitando colunas já existentes.
