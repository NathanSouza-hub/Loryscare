# Login e cadastro com conta Google — Design

**Data:** 2026-08-24
**Status:** aditivo ao fluxo de autenticação por e-mail/senha já existente (`auth-service.js`).

## Contexto e objetivo

Hoje a única forma de entrar no Lory's Care é criando uma conta com e-mail e senha
(`POST /api/auth/signup` / `POST /api/auth/login`). O objetivo é adicionar "Continuar com
Google" como uma segunda forma de entrar/cadastrar, sem remover a existente:

- Quem já tem conta continua entrando por e-mail/senha normalmente.
- Quem clicar em "Continuar com Google" pela primeira vez ganha uma conta nova automaticamente,
  sem precisar escolher senha.
- Se o e-mail da conta Google já é o de uma conta existente (criada por senha), a conta é
  vinculada automaticamente — a mesma conta passa a aceitar login pelos dois caminhos.

Fora de escopo: acesso a dados do Google (Gmail, Agenda, Contatos) — só usamos o Google como
prova de identidade (nome + e-mail verificado), nada além disso. Também fora de escopo: login
por outros provedores (Facebook, Apple etc.) e MFA.

## Estado atual (levantamento)

- `users` (`007_create_users.sql`): `password_hash VARCHAR(255) NOT NULL` — hoje toda conta
  **precisa** de senha. Isso muda: contas só-Google não terão senha até o dono decidir definir
  uma.
- `auth-service.js`: `signUp`/`logIn` validam e retornam `{ token, user }` via `issueToken`
  (JWT assinado com `JWT_SECRET`, payload `{ userId }`). O novo fluxo Google reaproveita
  `issueToken` — não muda o formato do token nem o middleware `require-auth.js`.
- `changePassword` hoje sempre exige `currentPassword` e falha se não bater com o hash salvo
  (`bcrypt.compare`). Para conta sem senha isso quebra — precisa virar condicional.
- Frontend: `login.html`/`cadastro.html` têm formulário de e-mail/senha (`login.js`/
  `cadastro.js`) chamando `AuthRepository.logIn`/`signUp`. `AuthContext.setSession(token,
  userName)` já existe como o jeito canônico de persistir sessão (embora `login.js` hoje escreva
  direto no `localStorage` em vez de usar esse helper — não é bug bloqueante, mas o código novo
  vai usar `setSession`).
- Nenhuma dependência de OAuth/Google no `package.json` do backend hoje.

## Abordagem escolhida

**Google Identity Services (GIS)**, o botão "Sign in with Google" padrão: o navegador do usuário
troca informação diretamente com o Google (script `https://accounts.google.com/gsi/client`); ao
concluir, o Google devolve para o nosso callback JS um **ID token** (JWT assinado pelo Google,
contendo `sub` (id do usuário no Google), `email`, `email_verified`, `name`). O frontend manda
esse token pro nosso backend, que valida a assinatura com a biblioteca oficial
`google-auth-library` (usando o `GOOGLE_CLIENT_ID` como "audience" esperada) e extrai os dados —
sem nunca precisar de "client secret" nem de redirecionamento servidor-a-servidor.

Alternativa descartada: fluxo OAuth 2.0 "Authorization Code" completo (redirect para o Google,
volta com um `code`, troca por token com client secret). Só compensaria se precisássemos chamar
APIs do Google em nome do usuário — não é o caso aqui, e adicionaria complexidade (gerenciar
`redirect_uri`, `state` anti-CSRF, client secret no servidor) sem benefício.

## Mudanças concretas

### Migration

`023_add_google_auth_to_users.sql`:

```sql
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN google_id VARCHAR(255) UNIQUE;
```

### Backend — dependência nova

`google-auth-library` (pacote oficial do Google, mantido por eles, usado só para
`client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })`).

### Backend — config

`.env` / `.env.example` ganha `GOOGLE_CLIENT_ID=`. Client ID **não é segredo** (é enviado ao
navegador de qualquer forma), então pode aparecer também direto no HTML do frontend — só o
"client secret" seria sensível, e este fluxo não usa client secret nenhum.

### Backend — `users-repository.js`

- `create(user)`: passa a aceitar `googleId` opcional e `passwordHash` opcional (`null` quando
  vier só do Google).
- Novo `findByGoogleId(googleId)`.
- Novo `linkGoogleId(userId, googleId)` (`UPDATE users SET google_id = $1 WHERE id = $2`).
- `getPasswordHash(id)` já existe e será reaproveitado para decidir se a conta tem senha.

### Backend — `auth-service.js`

Nova função `signInWithGoogle(idToken)`:

```
payload = verifyIdToken(idToken, audience: GOOGLE_CLIENT_ID)   // lança se assinatura/audience inválida
SE !payload.email_verified: rejeita (AuthenticationError)
usuario = findByGoogleId(payload.sub)
SE encontrado: emite token e retorna
SENÃO:
  usuario = findByEmail(payload.email)
  SE encontrado (conta por senha já existia):
    linkGoogleId(usuario.id, payload.sub)   // vincula automaticamente
  SENÃO:
    usuario = create({ name: payload.name, email: payload.email, googleId: payload.sub, passwordHash: null })
  emite token e retorna
```

`changePassword(userId, input)` passa a checar primeiro se a conta tem `passwordHash`:

```
usuario = getPasswordHash(userId)
SE usuario.passwordHash existe:
  exige e valida currentPassword (comportamento atual, sem mudança)
SENÃO (conta só-Google, primeira senha):
  ignora/nao exige currentPassword, só valida a nova senha (>= 8 caracteres) e salva
```

### Backend — controller/rotas

`POST /api/auth/google` (público, sem `requireAuth`, mesmo padrão de `/signup` e `/login`),
corpo `{ idToken }`, resposta `{ data: { token, user } }` — mesmo formato de `logIn`/`signUp`,
então o frontend reaproveita o mesmo tratamento de sucesso.

### Frontend

- `login.html` e `cadastro.html`: carregam `https://accounts.google.com/gsi/client` e renderizam
  o botão oficial do Google (`google.accounts.id.initialize` + `renderButton`) acima do
  formulário existente, com um "ou" separando dos campos de e-mail/senha.
- `auth-repository.js`: novo `signInWithGoogle(idToken)` → `POST /api/auth/google`.
- Callback do botão do Google → `AuthRepository.signInWithGoogle(credential)` →
  `AuthContext.setSession(token, user.name)` → `location.href = "perfis.html"` (mesmo destino
  pós-login já usado hoje).
- `perfil.html`, aba "Mudar senha": `AuthRepository.getProfile()` passa a incluir `hasPassword`
  (booleano, sem expor o hash). Se `false`, o título vira "Definir senha", o campo "Senha atual"
  fica oculto/não obrigatório, e o texto do botão vira "Definir senha".

## Casos de borda

- **`email_verified: false`** no token do Google (raro, mas existe para alguns domínios
  corporativos mal configurados): rejeitado com mensagem clara — não criamos/vinculamos conta
  com e-mail não confirmado.
- **Token expirado ou assinatura inválida**: `verifyIdToken` lança; vira 401 igual aos outros
  erros de autenticação (`AuthenticationError`).
- **Mesma pessoa clica Google duas vezes**: segunda vez cai direto no `findByGoogleId`, login
  normal, sem duplicar conta.
- **Conta só-Google que nunca define senha**: continua funcionando normalmente para sempre — só
  não consegue logar por e-mail/senha (não tem senha), o que é esperado.

## Configuração externa necessária (só você consegue fazer)

Vou te guiar passo a passo quando chegarmos na implementação, mas o resumo é: criar um projeto
no [Google Cloud Console](https://console.cloud.google.com/), configurar a "tela de consentimento
OAuth" (nome do app, e-mail de suporte), criar uma credencial "ID do cliente OAuth" do tipo
"Aplicativo da Web", e adicionar `http://localhost:5500` (e depois o domínio de produção, se
houver) em "Origens JavaScript autorizadas". Isso gera o `GOOGLE_CLIENT_ID` usado acima. Não
requer que eu tenha acesso à sua conta Google — só preciso do Client ID gerado.

## Compatibilidade

Preserva login/cadastro por e-mail e senha, formato do JWT, `require-auth.js`,
`attach-profile.js`, e todos os fluxos de perfil de cuidador (PIN, plantão) já implementados.
Nenhuma migration remove coluna ou tabela; `google_id` é aditivo; `password_hash` deixa de ser
`NOT NULL` mas continua sendo usado exatamente como hoje para quem tem senha.

## Testes

- `auth-service.test.js`: `signInWithGoogle` com token válido (conta nova, conta existente por
  e-mail → vincula, conta já vinculada por `google_id` → loga), token com `email_verified:
  false` (rejeita), `verifyIdToken` lançando (token inválido/expirado → rejeita). Mock do
  verificador do Google injetado por parâmetro (mesmo padrão de injeção de repositório já usado
  no projeto), não chama a rede de verdade.
- `changePassword` com conta sem `passwordHash` (define sem pedir senha atual) e com
  `passwordHash` existente (comportamento atual inalterado).

## Migrations necessárias

1. `023_add_google_auth_to_users.sql` — `password_hash` deixa de ser `NOT NULL`, adiciona
   `google_id` (único, opcional).
