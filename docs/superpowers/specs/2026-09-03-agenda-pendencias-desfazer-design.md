# Agenda do dia — pendências do dia anterior no sino e desfazer conclusão — Design

**Data:** 2026-09-03
**Depende de:** autoria imutável em atividades/medicamentos (`2026-08-21-jornada-autoria-design.md`, Etapa 1, já implementada), escala mensal de plantões (`schedule_shifts`, já implementada).

## Contexto e objetivo

Hoje, na Agenda do dia (Dashboard/`index.html`), um cuidador pode marcar atividades, medicamentos
e eventos como concluídos ou não realizados, mas:

1. Se algo fica pendente até o fim do dia (ex.: um medicamento nunca marcado como aplicado),
   ninguém é avisado no dia seguinte, e não há como saber quem estava de plantão naquele horário.
2. Um clique errado no botão verde (concluir) ou vermelho (não realizado) não pode ser desfeito —
   não existe caminho de volta para "pendente".

Objetivo: 1) mostrar no sino de notificações (já existente no Dashboard) os itens que ficaram
pendentes no dia anterior, com o nome de quem estava escalado naquele horário quando disponível;
2) permitir que o próprio cuidador que marcou algo desfaça a marcação (volta para pendente),
mantendo a regra de que ninguém mais pode mexer na marcação de outra pessoa.

Fora de escopo: sino em outras páginas além do Dashboard; acúmulo de pendências de mais de um dia
(a lista sempre reflete o dia anterior ao atual, calculado no servidor); alterar a lógica de
geração de ocorrências de atividades/medicamentos/eventos.

## Estado atual (levantamento)

- `routines`/`medications` já seguem o padrão de autoria imutável (Etapa 1): a primeira conclusão
  é `INSERT ... ON CONFLICT DO NOTHING`; edições subsequentes só são aceitas do mesmo
  `author_profile_id` (senão 409 `RoutineCompletionConflictError`/`MedicationAdministrationConflictError`).
  Mas o `status` aceito hoje é só `completed`/`skipped` — não existe `pending` como alvo.
- `events.setStatus` (`events-repository.js`) faz um `UPDATE` incondicional, sobrescrevendo
  `completed_by_profile_id` a cada chamada, sem checar autoria nenhuma.
- `getDaily(date, patientId, userId)` já existe nos três módulos (`routines`, `medications`,
  `events`) e monta exatamente a lista de ocorrências esperadas de uma data com o status atual
  (`pending` quando não há registro de conclusão). É a base para achar o que ficou pendente.
- O sino (`#notifications-*`) só existe no Dashboard (`index.html`/`dashboard.js`) e hoje mostra
  só `EventsRepository.getUpcoming` (eventos futuros marcados como importantes). Não existe
  conceito de "pendência do dia anterior" em lugar nenhum.
- `schedule_shifts` (aba Plantões) guarda, por conta (`user_id`), quem está escalado em cada
  janela `[scheduled_start_at, scheduled_end_at)`. Não é por paciente.
- Nenhuma tabela nova é necessária para nada disto: `author_profile_id`/`completed_by_profile_id`
  já existem nas três tabelas envolvidas, e "pendente" já é o estado natural de qualquer ocorrência
  sem registro de conclusão.

## Parte 1 — Pendências do dia anterior no sino

### Cálculo (sem nova tabela)

Cada módulo (`routines`, `medications`, `events`) ganha um método `getMissed(patientId, userId)`
que reaproveita a mesma lógica de `getDaily`, mas:
- fixa a data em `CURRENT_DATE - INTERVAL '1 day'` (calculado no servidor, não recebido do
  cliente — evita depender do relógio do navegador e mantém a regra "sempre o dia anterior");
- filtra só `status = 'pending'` (o que já ficou concluído/pulado não entra);
- faz `LEFT JOIN schedule_shifts ss ON ss.user_id = $userId AND ss.scheduled_start_at <=
  (data || ' ' || horário)::timestamp AND ss.scheduled_end_at > (data || ' ' || horário)::timestamp`
  e `LEFT JOIN caregiver_profiles cp2 ON cp2.id = ss.profile_id` para trazer
  `onDutyProfileName` (`NULL` quando não há escala cobrindo aquele horário).

Cada `getMissed` retorna, por item: `id`, `title`/`name`, `time`, `onDutyProfileName`.

### Endpoints novos

- `GET /api/routines/missed?patientId=X`
- `GET /api/medications/missed?patientId=X`
- `GET /api/events/missed?patientId=X`

Mesma validação de `patientId`/ownership já usada em `getDaily`. Sem migration.

### Frontend

`RoutinesRepository.getMissed`, `MedicationsRepository.getMissed`, `EventsRepository.getMissed`
(mesma forma dos `getDaily`/`getUpcoming` já existentes nesses repositórios).

`dashboard.js#loadNotifications()` passa a buscar também os três `getMissed` em paralelo com o
`getUpcoming` já existente. O painel do sino ganha uma segunda seção, **"Não realizado ontem"**,
acima ou abaixo de "Eventos próximos" (mantendo o mesmo componente de lista/empty-state), com uma
linha por item:

```
Losartana não foi aplicada — Mauricio estava de plantão
Fisioterapia não foi realizada
```

(sem o trecho "— fulano estava de plantão" quando `onDutyProfileName` é `null`, conforme decidido).
Texto por tipo: medicamento → "não foi aplicado(a)"; atividade → "não foi realizada"; evento →
"não foi realizado". O badge do sino soma `upcoming.length + missedTotal`.

## Parte 2 — Desfazer uma conclusão (voltar para pendente)

### Atividades e medicamentos

`setCompletion`/`setAdministration` passam a aceitar `"pending"` no conjunto de status válidos.
Quando o status pedido é `"pending"`:
- roda a mesma checagem de autoria já existente (`applyEdit`): se o registro pertence a outro
  perfil, 409 (mesmo erro de hoje, reaproveitado — não é preciso criar erro novo);
- se pertence ao mesmo perfil (ou não há registro nenhum — no-op), a linha de
  `routine_completions`/`medication_administrations` é **removida** (não fica um status
  `"pending"` gravado) — restaura o estado "sem conclusão", igual a uma ocorrência nunca marcada,
  liberando inclusive para qualquer cuidador marcar de novo.
- Repositórios ganham `removeCompletion(id)` / `removeAdministration(id)`, espelhando
  `updateCompletion`/`updateAdministration` que já existem.

### Eventos (ganha a mesma trava de autoria que atividades/medicamentos já têm)

Hoje `events.setStatus` sobrescreve `completed_by_profile_id` sem checar nada — é o único dos três
tipos sem proteção. Passa a seguir o mesmo princípio da Etapa 1, adaptado (eventos não têm tabela
de conclusão separada, o status vive na própria linha):

```sql
UPDATE events SET status = $1, completed_at = $2, completed_by_profile_id = $3, updated_at = NOW()
WHERE id = $4 AND patient_id IN (...)
  AND (completed_by_profile_id IS NULL OR completed_by_profile_id = $5)
RETURNING ...
```

`rowCount = 0` → busca o evento à parte para decidir entre 404 (não existe/não é da conta) e 409
(já concluído por outro perfil) — reaproveita o padrão de erro 409 já usado em
routines/medications, com uma classe nova `EventCompletionConflictError` (mesmo formato dos outros
dois). `setStatus` no service passa a aceitar `"pending"` também, que grava `status='pending',
completed_at=NULL, completed_by_profile_id=NULL` (mesmo `UPDATE`, sujeito à mesma trava de
autoria).

### Frontend (`dashboard.js`)

- `taskRow()`: a exceção `item.kind !== "event"` sai da checagem `lockedByOther` — eventos passam
  a travar os botões para quem não foi quem concluiu, igual atividades/medicamentos já fazem.
  Para isso, `loadTasks()` precisa passar `authorProfileId: eventItem.completedByProfileId` no
  item mapeado de eventos (hoje só manda `authorName`).
- Clique no botão: quando o botão clicado já é o estado ativo do item
  (`item.status === target.dataset.action`), o clique manda `status: "pending"` em vez do valor
  normal do botão — isso vale para os três `kind`s (`routine`, `medication`, `event`) no mesmo
  listener de `todayList`.
- Nenhuma mudança visual nova além disso: o botão continua sendo o mesmo ícone verde/vermelho já
  usado hoje para marcar; clicar de novo nele desfaz.

## Compatibilidade

Nenhuma migration. Preserva o comportamento de conclusão/edição já existente para
atividades/medicamentos (Etapa 1) — só adiciona `"pending"` como alvo válido adicional. Eventos
passam a exigir a mesma autoria de quem já vale para os outros dois tipos (mudança de
comportamento: hoje qualquer cuidador pode sobrescrever a conclusão de um evento de outro; depois
da mudança, não pode mais — alinhado ao que o dono do sistema já quer conforme este pedido e o
design de autoria imutável).

## Plano de testes

- `routines-service`/`medications-service`: revert por autor correto remove a linha; revert por
  outro autor lança o erro de conflito existente; revert sem conclusão prévia é no-op.
- `events-service`: primeira conclusão por qualquer perfil funciona; segunda tentativa por outro
  perfil lança `EventCompletionConflictError`; revert pelo mesmo perfil volta para `pending` com
  `completed_by_profile_id = NULL`; revert por outro perfil é rejeitado.
- `getMissed` (três módulos): ocorrência de ontem sem conclusão aparece; ocorrência concluída não
  aparece; atribuição bate com o `schedule_shifts` vigente no horário; sem escala no mês,
  `onDutyProfileName` vem `null` e o item ainda aparece (sem nome).
