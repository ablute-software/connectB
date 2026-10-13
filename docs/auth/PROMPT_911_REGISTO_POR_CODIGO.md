# Prompt 911 — registo por código de 6 dígitos em todos os sítios, e erros legíveis (13/10/2026)

**Branch:** `claude/911-signup-code`, a partir de `main` (não leva nada do 909). **Migração:** `20261013100100_auth_email_failures.sql`
(uma tabela nova, aditiva; teste seco revertido e depois **aplicada em produção a 13/10/2026**). **Variáveis novas:** nenhuma.
Registo de configurações atualizado (`docs/ops/CONFIG_REGISTRY.md`: `AUTH_CODE_MODE`, SMTP, §2.1, Pendentes).

## O que se passava
1. Desde 12/10 às 10:11 UTC o SMTP do Supabase Auth (Resend) recusa tudo: `550 "The sherlockdeal.com domain is not verified"`.
   A chave posta no SMTP é de uma conta do Resend onde o domínio não está verificado. **O Nuno está a corrigir no painel.**
2. O ecrã mostrava `{}`: o `supabase-js` devolve um erro 500 cuja mensagem é um objeto vazio, e as páginas imprimiam `error.message`.
3. O código de 6 dígitos só existia em `/auth-code-test`. O template "Confirm signup" já traz o código em destaque, por isso quem
   se registava em `/signup` recebia um código sem sítio onde o pôr.

## A. Registo por código em todos os caminhos
Todos os caminhos que criam conta com email e palavra-passe usam agora o mecanismo do 904 (as mesmas rotas `/api/auth-code/*`,
os mesmos limites e bloqueios: 5 tentativas, reenvio aos 60 s, teto por hora, limite por IP). Não há segunda implementação: o
passo do código é um só componente (`CodeStep.tsx` + `EmailCodeConfirm.tsx`), usado também pela página de teste do 904.

| Caminho | Ficheiro | O que acontece depois do código certo |
|---|---|---|
| Registo normal (startup) | `src/app/signup/page.tsx` | o browser fica com sessão, provisiona-se a organização (`/api/provision-org`, com todos os campos do formulário, como antes), aceita-se os termos e segue para o `next` |
| Convite de equipa | `src/app/invite/[token]/page.tsx` | aceita-se o convite e vai para `/` |
| Convite de membro de incubadora | `src/app/invite/incubator/member/[token]/page.tsx` | a conta nasce com `signup_intent = incubator_member` (decidido **no servidor**, só esse valor é aceite do browser); aceita-se o convite e vai para `/ecosystem` |
| **Registo de investidor** | `/signup?as=investor` | **não cria conta**: é um pedido de acesso (não é registo com palavra-passe), por isso não entra |

**Outros `auth.signUp(` no código:** não há mais nenhum. Um teste (`auth-code-paths-911.test.ts`) lista todos os sítios que o chamam e
falha se aparecer um quarto: hoje são as três páginas (só como recurso quando o código está desligado) e a porta do servidor do
mecanismo de código. O resto do código que cria contas (provisionamento, reclamações de investidor) parte de uma conta que já existe.

**Fluxo:** formulário → "Create account" → na mesma página "We sent a code to [email]" com "Resend code" e "Change email" → código
certo → segue como antes. O link do email continua a funcionar (`/auth/confirm`, o botão do template).

**Dados do formulário não se perdem.** Ao enviar o código, a página guarda o formulário **sem a palavra-passe** (como o aviso do
link, em `localStorage`, durante 30 minutos, o que o código vale). Recarregar volta à caixa do código para esse email, com tudo
preenchido; a caixa pede a palavra-passe outra vez (nunca é guardada). "Change email" volta ao formulário, ainda preenchido.

**`AUTH_CODE_MODE`.** Omisso = `on`, **para todos**. Escrever `off` é o travão de emergência: as rotas respondem 404 e cada página
cai no fluxo só por link que tinha (o teste "`AUTH_CODE_MODE=off` volta ao link" prova-o). Qualquer outro valor vale `on`, de
propósito: uma gralha não pode desligar o código em silêncio, porque o email já o traz.

## B. Erros legíveis e alerta interno
- **Uma função** (`src/lib/auth-errors.ts`) transforma qualquer erro numa frase, e **nenhum** ecrã de autenticação mostra já um objeto,
  JSON ou `{}`. Falha de envio: *"We couldn't send the email right now. Please try again in a few minutes. If it keeps failing, write
  to us at support@sherlockdeal.com."* · limite: *"Too many attempts. Please wait a few minutes."* · código errado/expirado: a frase do 904
  (com as tentativas que restam) · o resto: uma frase genérica com o código do erro em letra pequena. Aplicada ao registo, ao convite,
  à recuperação, ao login, ao set-password, ao reset-password e ao acesso de investidor.
- **Registo de falhas:** cada falha de envio (registo, reenvio, recuperação, convite) fica em `auth_email_failures` (email, ação,
  erro, hora) e vê-se em **Backoffice → Email delivery → "Sign-up and recovery emails that failed"**, com um aviso vermelho se houve
  alguma nas últimas 24 horas e quantas pessoas. A recuperação é pelo browser, por isso a própria página comunica a recusa a uma
  rota pública (só regista falhas de envio e limites, ação de uma lista fixa, limitada por IP, resposta sempre igual). Guarda 90 dias.
- **`CONFIG_REGISTRY.md`:** §2.1 diz como confirmar que o SMTP funciona (o que procurar nos logs do Auth e no registo de falhas) e
  a regra "a chave do Resend do SMTP tem de ser da conta onde `sherlockdeal.com` está verificado".

### Uma troca que decidi e que o Nuno deve conhecer
O mecanismo do 904 respondia **a mesma frase** ("We sent a code") quer o email tivesse conta ou não, e engolia os erros do
fornecedor, para não revelar se uma conta existe. Isso é exatamente o que esconderia esta falha: toda a gente veria "enviámos o
código" e nada chegaria. Agora, quando o envio **pelo SMTP do Auth** falha (conta nova ou por confirmar), a pessoa é avisada e a
falha é registada. **Custo:** enquanto o SMTP estiver em baixo, a resposta de um email que já é conta confirmada (que sai pelo Resend,
não por este SMTP) continua a ser "enviámos", e portanto **durante uma avaria** distingue-se "conta confirmada" de "não confirmada".
Só existe enquanto o remetente está em baixo; a alternativa era ninguém saber. A falha do email "já tem conta" fica **registada mas
não mostrada**, pela mesma razão.

## C. Template "Confirm signup" (colar no Supabase, depois do deploy)
**O texto não muda em relação ao do 904 (§A4), que o Nuno colou a 09/10.** Se o do painel já é este, não há nada a colar. Subject:

`Your Sherlock Deal confirmation code: {{ .Token }}`

```html
<div style="font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #111827;">
  <h2 style="font-size: 18px; margin: 0 0 12px;">Confirm your email</h2>
  <p style="font-size: 14px; line-height: 1.5; margin: 0 0 16px;">
    Enter this code on the page where you registered. It expires in 30 minutes.
  </p>
  <p style="font-size: 32px; font-weight: 700; letter-spacing: 8px; text-align: center; margin: 0 0 20px; padding: 16px; background: #F3F4F6; border-radius: 8px;">
    {{ .Token }}
  </p>
  <p style="font-size: 13px; line-height: 1.5; color: #4B5563; margin: 0 0 8px;">
    Prefer a link? You can also confirm with one click:
  </p>
  <p style="margin: 0 0 20px;">
    <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=%2Fset-password"
       style="display: inline-block; background: #0E7490; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 10px 18px; border-radius: 8px;">
      Confirm my email
    </a>
  </p>
  <p style="font-size: 12px; color: #6B7280; margin: 0;">
    If you did not register on Sherlock Deal, you can ignore this email.
  </p>
</div>
```

O template "Reset password" não muda. **Ordem:** o template com o código **já está no painel** desde 09/10, por isso o que faltava era
a página ter onde o pôr: **primeiro o deploy** (feito antes de te pedir nada), **depois** o teste. Se um dia se trocar o template
por um sem código, fazê-lo só depois de o deploy estar em produção.

**O que o link faz** (para quem prefere o link ao código): confirma o email e leva a `/set-password`, porque a conta nasce com uma
palavra-passe aleatória inutilizável (a escolhida só é aplicada depois do código, para ninguém poder registar o email de outra
pessoa com uma palavra-passe sua). Quem se registou em `/signup` e confirmou **pelo link** não passa pelo passo de provisionar a
organização com o formulário completo: a conta tem nome, startup, país e cargo (vão nos metadados), e o resto do formulário
(website, setor, ronda…) não. É o comportamento do 904, mantido; o caminho normal é o código.

## Em produção, depois do deploy (o Nuno clica, eu confirmo nos logs do Auth e na base)
**Antes de tudo:** o SMTP tem de estar corrigido no painel (ver Pendentes do registo). Sem isso o passo 1 mostra a frase de falha de
envio, **que é o comportamento certo** e fica registada no Backoffice.
1. Registar `sherlockdeal.com+codigo2@gmail.com` em `/signup` (campos todos, termos) e confirmar com o código do email. Eu confirmo:
   - **logs de Auth:** `user_confirmation_requested` com `status: 200` e sem `gomail`; depois `login`/`user_signedup`;
   - **base:** `select email, email_confirmed_at, raw_user_meta_data->>'password_set' from auth.users where email = '…'` → confirmado, `password_set = true`;
   - **organização:** uma linha em `org_members` para esse utilizador e a `orgs` com o nome que escreveste.
2. "Forgot password" com `sherlockdeal.com@gmail.com`: o email com o link chega e a mudança de palavra-passe funciona como antes
   (a recuperação não mudou; só a mensagem de erro).
3. **Se algum envio falhar:** abre **Backoffice → Email delivery**: a falha aparece lá com a resposta do Supabase.

Limpeza da conta de teste no fim, **com autorização dele**. Não se apagam contas que já existiam.

## Quem falhou (logs de Auth, janela completa de 12/10 10:11 UTC até agora)
9 pedidos recusados com `550`, de 4 pessoas — **exatamente as que o Nuno indicou, e mais nenhuma**:

| Email | Ação | Quando (UTC) | Observação |
|---|---|---|---|
| `alexandragmeira@gmail.com` | recuperação de palavra-passe (2×) | 12/10 10:11–10:12 | conta existente |
| `pedro.loureiro@spaceo.pt` | recuperação de palavra-passe | 12/10 10:59 | conta existente |
| `ivaz@ctvc.pt` (Inês Vaz) | registo (4×) | 12/10 16:19–16:21 | **sem conta**: o registo falhado não deixa utilizador em `auth.users` |
| `malhaoverde@gmail.com` (David Verde) | registo (2×) | 12/10 16:22 | **sem conta**, idem |

Confirmado também na base: **nenhum utilizador foi criado em `auth.users` desde 12/10 09:00 UTC**. Os logs de Auth guardam um
dia; daqui em diante isto vê-se no Backoffice, sem depender deles.

## Verificações
Ver o fim deste ficheiro (preenchido antes do merge).

Na árvore commitada de `claude/911-signup-code` (todas por código de saída):

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit` | **EXIT=0** |
| `npx eslint --no-eslintrc --config .eslintrc.json --ext .js,.jsx,.ts,.tsx src` | **EXIT=0** — 0 erros, 252 avisos (os mesmos de antes; nenhum novo) |
| `npx vitest run` | **EXIT=0** — 345 ficheiros, **5374 testes** (na árvore já fundida com a `main` de 13/10) |
| `npm run build` (`NODE_OPTIONS=--max-old-space-size=6144`) | **EXIT=0** — as 6 rotas novas/tocadas (`/api/auth-code/{register,resend,verify,status}`, `/api/auth-failures/report`, `/api/backoffice/auth-email-failures`) saem **ƒ (dinâmicas)** |

**Testes novos (`auth-errors`, `client`, `pending-storage`, `failure-log`, `EmailCodeConfirm`, `auth-failures/report`, `auth-code-paths-911`):**
registo por código em cada um dos 3 caminhos (o que cada página envia e o que faz depois); o link continua a confirmar (o template e
`/auth/confirm` não foram tocados; testado que a conta nasce não confirmada e que o código a confirma); recarregar não perde o passo do
código nem o formulário (e a palavra-passe nunca é guardada); **nenhum erro aparece como `{}`** (14 formas de erro, incluindo o
`AuthApiError` cuja mensagem é `{}` e o corpo vazio); `AUTH_CODE_MODE=off` volta ao link (rotas 404 e as páginas só chamam `signUp`
quando recebem esse 404). Três testes existentes mudaram de sentido de propósito: o omisso de `AUTH_CODE_MODE` passou de `off` a `on`.

**Verificado no browser** (modo demo, rotas simuladas dentro da página, `dev:verify` com identidade confirmada: `cwd` e `sha 4cc52284`):
a frase de falha de envio aparece em vez de `{}`; "Create account" leva à caixa do código na mesma página; **recarregar volta à caixa
do código** com a palavra-passe a ser pedida; "Change email" volta ao formulário **ainda preenchido**; um código errado mostra "That
code didn't work. 4 attempts left." e limpa a caixa; o código certo termina em provisionamento e redireciona. Captura:
[`screenshots-911/01-signup-code-box-wrong-code.jpg`](screenshots-911/01-signup-code-box-wrong-code.jpg).

## O que NÃO foi provado, e porquê
- **O envio real do código por email**: não tenho sessão nem caixa de email; o SMTP está a ser corrigido pelo Nuno. É o passo 1 de
  produção. Até lá os testes usam fornecedores simulados, que modelam a falha `550` tal como o Supabase a devolveu.
- **Que o Supabase real devolve `status: 500` + `unexpected_failure` ao `signUp` feito no servidor**: é o que os logs de Auth mostram
  para o `signUp` do browser (o mesmo endpoint). A classificação também apanha o texto `gomail`/`550`, por isso não depende só disso.
- **O ecrã do Backoffice com dados reais**: provado com dados simulados; o primeiro registo real aparece na próxima falha.
- **Os convites de ponta a ponta**: precisam de um convite real e de uma conta nova; os testes cobrem o que cada página envia e faz
  depois. O passo 1 de produção cobre `/signup`; os convites, quando houver um para testar.
- **Registo de investidor com palavra-passe**: não existe (é um pedido de acesso). O **login sem palavra-passe** do investidor
  (`InvestorSignInForm`, `signInWithOtp`) também envia email pelo mesmo SMTP e também mostra agora uma frase em vez do texto bruto, mas
  **não** está no registo de falhas (o pedido era registo e recuperação); fica como possível acrescento.
