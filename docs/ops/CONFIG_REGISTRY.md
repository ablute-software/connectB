# Registo único de configurações da infraestrutura

**Fonte única, curta e sempre atual** do estado do Vercel, do Supabase Auth, do Resend e dos interruptores.
Criado no Prompt 906 (12/10/2026). **Antes de pedir ao Nuno que "confirme" um valor, procura-o aqui e no
`DECISIONS.md`: se já está decidido, não se pergunta; pede-se só a ação que falta, com o valor exato.** A regra
completa está no `CLAUDE.md` ("Registo de configurações").

**Como ler.** Uma tabela por área. Colunas: **Nome · Valor · Estado · Quem decidiu e quando · Fonte**.
- **Valor:** nunca há segredos aqui. Para chaves e palavras-passe, só "definido" ou "por definir".
- **Estado:** `feito` (confirmado ou com prova observável) · `pendente` (decidido ou necessário, e ainda por fazer;
  ou lido pelo código sem decisão registada) · `desconhecido` (não consegui confirmar, tipicamente por falta de
  acesso de gestão ao painel).
- **Fonte:** `DECISIONS L<linha>` = linha do `DECISIONS.md` no momento em que isto foi escrito (as linhas só
  crescem no fim; se uma não bater, procura o título); `904A` = `docs/calls/ETAPA0_PARTE_A_EMAIL.md`;
  `904B` = `docs/calls/ETAPA0_PARTE_B_CODIGO.md`; "observado" = visto por mim em produção, em leitura.

**Como foi verificado (e o que isto NÃO consegue ver).** O Vercel e o painel do Supabase não têm API acessível a esta
sessão, por isso os valores deles só são `feito` quando há **prova do efeito** (por exemplo, o Resend envia, logo a
chave e o remetente estão certos). A base de dados de produção foi lida só em leitura. O que vive só nos painéis fica
`desconhecido` até o Nuno o ler. **Último passe completo: 12/10/2026.**

---

## 1. Vercel (projeto `connect-b`, equipa info-ablute projects, plano Hobby)

Domínio canónico: `https://www.sherlockdeal.com` (o apex `sherlockdeal.com` responde 308 para ele, observado
12/10). Nunca `.vercel.app`. O que o código lê em `process.env.*` (levantamento por `grep` em `src/` e `scripts/`,
12/10): as linhas abaixo cobrem **todas**. "Amb." = ambientes onde a variável existe (`prod`, `prev`); `?` =
desconhecido.

### 1.1 Base de dados e aplicação

| Nome | Valor | Estado | Quem decidiu e quando | Fonte |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` (prod+prev) | definido | feito | desde a criação do projeto | `CLAUDE.md` Stack; a app funciona |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (prod+prev) | definido | feito | idem. **Tem de ser não-sensível** no Vercel, senão o bundle do cliente não a recebe | `CLAUDE.md` Stack |
| `SUPABASE_SERVICE_ROLE_KEY` (prod+prev) | definido | feito | idem | `CLAUDE.md` Stack |
| `NEXT_PUBLIC_APP_URL` (?) | **por confirmar.** Valor a ter: `https://www.sherlockdeal.com` | desconhecido | Nuno 23/07/2026: definir para o domínio próprio e redeploy ("uma só mudança"). Ver **contradição C2** | DECISIONS L138, L153; `src/lib/brand.ts:22` |
| `SUPABASE_URL` | não é preciso | feito | só `scripts/verify-migrations.ts`, como alternativa a `NEXT_PUBLIC_SUPABASE_URL` | `scripts/verify-migrations.ts:96` |

Sem `NEXT_PUBLIC_APP_URL` os links dos emails (convites, Stripe, "Open your workspace") caem no fallback do código,
`https://connect-b-delta.vercel.app`. Se o valor nunca foi posto, os emails de hoje apontam para aí.

### 1.2 Email (Resend, lado do Vercel)

| Nome | Valor | Estado | Quem decidiu e quando | Fonte |
|---|---|---|---|---|
| `RESEND_API_KEY` | definido | feito | Nuno. Prova: 29 envios com sucesso desde 02/09 | observado em `email_send_log` |
| `RESEND_FROM_EMAIL` | `Sherlock Deal <noreply@sherlockdeal.com>` | feito | Claude 02/09/2026 (Prompts 536/537), confirmado em produção: é o `from` de todos os envios 02/09 a 07/10. Ver **C1** | DECISIONS L4076; observado |
| `RESEND_REPLY_TO` | `sherlockdeal.com@gmail.com` | desconhecido | Nuno 06/08/2026 ("pode ser posto hoje") e reafirmado 02/09/2026. **O valor está decidido; o que não consigo ver é se está definido no Vercel.** Verificar sem painel: `/backoffice/email-delivery` mostra `replyToInEffect` | DECISIONS L3628, L4077; 904A |
| `RESEND_WEBHOOK_SECRET` | definido | feito | Decidido 04/09/2026. Sem ele o endpoint rejeita tudo, e há 8 eventos `delivered` gravados (último 07/10) | DECISIONS L4752; observado |
| `SUPPORT_NOTIFY_EMAIL` | **sem decisão registada** | pendente | — | `src/app/api/investor-access-request/route.ts:81`. Sem ela, um pedido de acesso de investidor fica guardado **sem notificar ninguém** |

### 1.3 Pagamentos (Stripe)

| Nome | Valor | Estado | Quem decidiu e quando | Fonte |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | definido | feito | Nuno. Prova: há uma conta com `stripe_customer_id` (10/09/2026). Local: vazia | observado em `orgs`; DECISIONS L2069 |
| `STRIPE_WEBHOOK_SECRET` | por confirmar | desconhecido | — | `src/app/api/stripe/webhook` |
| `STRIPE_PRICE_{GARAGE,MOTHERFUNDING,PRO_SCOUT,ACE_SPOTTER,LEGENDARY_SLEUTH}_{MONTHLY,ANNUAL}` (10 variáveis) | IDs de preço do Stripe; por confirmar um a um | desconhecido | — | `.env.example`; `src/lib/billing.ts`. Nenhuma firma de investimento tem cliente Stripe (0 linhas), por isso os preços de investidor nunca foram exercitados em produção |

### 1.4 IA

| Nome | Valor | Estado | Quem decidiu e quando | Fonte |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | definido | feito | Nuno. Prova: 696 chamadas em `ai_call_log`, a última a 08/10 | observado |
| `AI_REVIEW_MODEL` | **sem decisão registada.** Opcional: sem ela o código usa `claude-sonnet-4-5` | pendente | — | `src/app/api/ai-review/route.ts:318` |
| `AI_CLASSIFY_MODEL` | **sem decisão registada.** Opcional: sem ela o código usa `claude-haiku-4-5` | pendente | — | `src/app/api/classify-interaction/route.ts:10` |

### 1.5 Segurança de ficheiros, Gmail, privacidade

| Nome | Valor | Estado | Quem decidiu e quando | Fonte |
|---|---|---|---|---|
| `VIRUSTOTAL_API_KEY` | por confirmar | desconhecido | Em 10/09/2026 já se dizia que nada confirma que esteja definida. Hoje: 83 documentos `local_only` e 2 `not_scanned`, **nenhum com resultado do VirusTotal**: indício de que não está em uso | DECISIONS L6190; observado em `documents` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | por confirmar | desconhecido | Nuno 22/07/2026 (§8d, ligação ao Gmail). 0 ligações de Gmail em produção, logo nunca exercitado | DECISIONS L1190; `src/lib/google-oauth.ts` |
| `TOKEN_ENCRYPTION_KEY` | por confirmar | desconhecido | idem (cifra AES-256-GCM dos tokens) | DECISIONS L1190; `src/lib/crypto.ts` |
| `NEXT_PUBLIC_PRIVACY_EMAIL` | **sem decisão registada** | pendente | — | `src/lib/controller.ts:47`. Sem ela a página de privacidade não mostra contacto (a página pede-o: "fill CONTROLLER_ADDRESS and NEXT_PUBLIC_PRIVACY_EMAIL") |
| `NEXT_PUBLIC_LINKEDIN_OAUTH_ENABLED` | **por definir, de propósito** | feito | Nuno 22/07/2026: manter desligado (esconde o botão) até haver OAuth do LinkedIn | DECISIONS L1136 |

### 1.6 Crons e plano

| Nome | Valor | Estado | Quem decidiu e quando | Fonte |
|---|---|---|---|---|
| `vercel.json` crons | `/api/automations` às `0 9 * * *` (uma vez por dia) | feito | 22/07/2026. **Hobby: no máximo 1 por dia**; um horário sub-diário faz o deploy falhar (`cron_jobs_limits_reached`) | `vercel.json`; `CLAUDE.md` Stack |
| Plano Vercel | Hobby | feito | — | `CLAUDE.md` Stack |

### 1.7 Só em máquinas de desenvolvimento (não vão para o Vercel)

`DEV_VERIFY_IDENTITY` (posta pelo `npm run dev:verify`; nunca em produção), `CHROME_PATH` (só
`scripts/verify-pair-visual.mjs`). `SENDER_EMAIL` e `BCC_EMAIL` aparecem no `.env.example` mas **nenhum código as lê**:
estão mortas, a limpar do `.env.example` quando alguém lá mexer.

---

## 2. Supabase Auth (projeto `wkjcaoqdvhykrfacsylr`)

**Sem acesso de gestão ao painel nem à Management API** (sem token no ambiente): o que não foi confirmado pelo Nuno é `desconhecido`
ou `pendente`. Caminhos no painel entre parênteses. **SMTP, rate limits, OTP e template: confirmados pelo Nuno em 09/10.**

| Nome | Valor | Estado | Quem decidiu e quando | Fonte |
|---|---|---|---|---|
| Confirmação de email ligada | ligada | feito | início de 08/2026 | DECISIONS L3952 (Prompt 538, 02/09/2026) |
| SMTP próprio (Authentication → Emails → SMTP Settings) | ligado, via Resend: host `smtp.resend.com`, porta `465`, utilizador `resend`, palavra-passe = API key do Resend (**não escrever aqui**), remetente `noreply@sherlockdeal.com`. **A chave tem de ser da conta do Resend onde `sherlockdeal.com` está verificado** (ver §2.1) | **pendente** (a corrigir) | Nuno, feito no painel (decidido 02/09, 30/09 e 09/10/2026). **Desde 12/10 às 10:11 UTC o SMTP recusa tudo** (`550 "The sherlockdeal.com domain is not verified"`): a chave posta no painel é de uma conta onde o domínio não está verificado. O Nuno está a corrigir no painel (13/10/2026); passa a `feito` quando a confirmação do Prompt 911 chegar ao email | DECISIONS L4078, L9470; 904A §A2; logs de Auth de 12/10 (Prompt 911) |
| Limite de envio de emails (Authentication → Rate Limits) | **≥ 300 por hora** | feito | Nuno, feito no painel; **confirmado pelo Nuno em 09/10** | 904A §A2/A3; confirmado pelo Nuno em 09/10 |
| Limite de verificações de token | **≥ 150 por 5 min por IP** (o Supabase vê sempre o IP do Vercel) | feito | idem | 904A §A2; confirmado pelo Nuno em 09/10 |
| Comprimento do código OTP (Sign In / Providers → Email) | **6** | feito | idem | 904A §A2; confirmado pelo Nuno em 09/10 |
| Validade do código OTP | **1800 s** | feito | idem | 904A §A2; confirmado pelo Nuno em 09/10 |
| Template "Confirm signup" (Authentication → Emails → Templates) | o texto de 904A §A4 (assunto `Your Sherlock Deal confirmation code: {{ .Token }}`). **O Prompt 911 não o altera**: o texto final está repetido em `docs/auth/PROMPT_911_REGISTO_POR_CODIGO.md`, para colar de novo se o do painel for diferente | feito | Nuno, colado no painel; **confirmado pelo Nuno em 09/10** | 904A §A4; confirmado pelo Nuno em 09/10; 911 §C |
| Leaked password protection | **ligar, mas requer o plano Pro do Supabase.** Hoje desligada (o advisor de segurança dá `auth_leaked_password_protection` como aviso, visto a 09/10) | pendente | Notada em 904A como "para a Parte B"; ligar depende de o projeto estar no Pro (decisão do Nuno sobre o plano) | 904A §A2; Nuno 12/10 (requer Pro); advisor observado |
| Site URL | `https://www.sherlockdeal.com` (o template do 904 usa `{{ .SiteURL }}/auth/confirm`) | desconhecido | Nunca registado o valor. Em 24/07/2026 viu-se que os links gerados voltam ao Site URL de produção e não ao localhost | DECISIONS L1910; 904A §A4 |
| Redirect URLs (allowlist) | `https://www.sherlockdeal.com/**` (rotas usadas: `/auth/callback`, `/auth/confirm`, `/reset-password`, `/set-password`) | desconhecido | idem. O localhost **não** está na lista (24/07/2026) | DECISIONS L1910; `src/app/auth/*` |
| Plano do Supabase (Pro?) | por confirmar. Só no Pro se pode reencaminhar o IP do cliente nas verificações | desconhecido | — | 904A §A3 |

### 2.1 Como confirmar que o SMTP do Auth funciona (Prompt 911)

O Supabase não mostra "o SMTP falhou" num ecrã: a falha só aparece nos **logs de Auth**. Dois sítios, por ordem de rapidez:

1. **No próprio produto:** `/backoffice/email-delivery` → secção **"Sign-up and recovery emails that failed"** (Prompt 911). Mostra cada
   falha de registo ou de recuperação com a resposta do fornecedor, e um aviso vermelho se houve alguma nas últimas 24 horas.
   Uma falha de **recuperação** é registada pela própria página (o browser chama o Supabase diretamente); uma de **registo** é vista
   pelo servidor. Guarda 90 dias.
2. **No Supabase → Logs → Auth** (ou `auth_logs` na API de logs): procurar `"error_code":"unexpected_failure"` com `gomail`. O
   sinal de que o SMTP está mal é uma linha `request completed` com `status: 500` em `/signup`, `/recover` ou `/resend`, e
   `error` = `gomail: could not send email 1: 550 …`. O sinal de que está bem é a mesma ação com `status: 200` e **nenhum**
   `gomail` nessa hora. Os logs de Auth só guardam **um dia**.

**Regra: a chave do Resend posta no SMTP do Supabase tem de ser da conta onde `sherlockdeal.com` está verificado** (Resend →
Domains → `sherlockdeal.com` → Verified). A de 12/10 era de outra conta; o `550` diz exatamente isso ("The sherlockdeal.com domain
is not verified"). A chave do Vercel (`RESEND_API_KEY`, §1.2) e a do SMTP do Supabase são **duas chaves diferentes** e podem estar em
contas diferentes: confirmar as duas.

**Registo de falhas (tabela `auth_email_failures`, migração `20261013100100`, aplicada em 13/10/2026):** email, ação, estado HTTP,
código e texto do erro, hora. Só o serviço lhe chega (RLS sem políticas); lê-se no Backoffice.

---

## 3. Resend (conta e domínio)

| Nome | Valor | Estado | Quem decidiu e quando | Fonte |
|---|---|---|---|---|
| Domínio `sherlockdeal.com` verificado | verificado (SPF, DKIM e DMARC presentes) | feito | Nuno, entre 27/07 e 02/09/2026. Prova: envios entregues a terceiros desde 02/09. Ver **C1** | 904A §A1; DECISIONS L4076; observado |
| Remetente | `Sherlock Deal <noreply@sherlockdeal.com>` | feito | ver `RESEND_FROM_EMAIL` | §1.2 |
| Reply-to | `sherlockdeal.com@gmail.com` | desconhecido | ver `RESEND_REPLY_TO` | §1.2 |
| Webhook (Resend → `https://www.sherlockdeal.com/api/resend/webhook`) | ativo; eventos a chegar | feito | Decidido 04/09/2026 | observado |
| Plano | **subir para Pro antes da primeira call real** (o gratuito tem teto diário baixo; uma call ≈ 1 000 emails, ≈ 450 em 48 h). Nada foi comprado | pendente | Recomendado 09/10/2026; decisão do Nuno | 904A §A3 |

---

## 4. Interruptores

| Nome | Valor | Estado | Quem decidiu e quando | Fonte |
|---|---|---|---|---|
| `AUTH_CODE_MODE` | **omisso = `on`: todos os registos confirmam o email por código de 6 dígitos na própria página** (`/signup`, convite, convite de membro de incubadora), com o link do email como alternativa. **Escrever `off` é o travão de emergência:** as rotas respondem 404 e as páginas voltam ao fluxo só por link (a mesma regra do `CALLS_MODE`). `allowlist` continua a existir só para testes. Qualquer outro valor (gralha incluída) vale `on`, de propósito. **Não definir.** Hoje em produção: `/api/auth-code/status` respondia 200 a 12/10, por isso **não é `off`**; se está em `allowlist`, não consigo ver (ver Pendentes) | feito | Nuno 13/10/2026 (Prompt 911: "passa a valer para todos"; antes, 904: fora por omissão). **Substitui o 904** (omisso = `off`) | 911 §A; `src/lib/auth-code/mode.ts` |
| `AUTH_CODE_TEST_EMAILS` | **não definir** (só conta com `AUTH_CODE_MODE=allowlist`) | feito | Nuno 13/10/2026 (911: já não depende da allowlist). Se estiver definida no Vercel, não faz mal com `AUTH_CODE_MODE` omisso | 911 §A; `src/lib/auth-code/mode.ts` |
| `CALLS_MODE` | **não definir.** Sem a variável as Calls estão **ligadas** para quem cumpre as regras de papel. `off` = travão de emergência (tudo 404). `allowlist` = restrição opcional | feito | Nuno 12/10/2026 ("nunca foi definido"); desde o Prompt 908 (em produção a 12/10, `buildId nN9bLqb702dsY2jO63klI`) o omisso vale `on`. **Substitui o 905** (omisso = `off`). Ver **C3** | DECISIONS (entrada do 908); `src/lib/calls/mode.ts` |
| `CALLS_TEST_EMAILS` | **não definir** (só conta com `CALLS_MODE=allowlist`) | feito | idem | `src/lib/calls/mode.ts` |

---

## Contradições encontradas

- **C1 — Remetente do Resend (`RESEND_FROM_EMAIL`).** Três decisões em datas diferentes: **27/07/2026** "só `ablute.pt` está
  verificado no Resend" (DECISIONS L931); **06/08/2026** `Sherlock Deal Support <support@sherlockdeal.com>` (L3624);
  **02/09/2026** `Sherlock Deal <noreply@sherlockdeal.com>` (L4076). **Prevalece a última**, e é a que a produção usa
  (`email_send_log`). Incidentes que a base guarda: a 02/09 um envio com `investors@sherlockdeal.com` falhou, e a 14/09
  quatro falharam porque o `from` era o texto `valor-copiado-do-vercel` (um placeholder colado por engano; corrigido
  até 18/09). Não há registo de a de 06/08 (`support@`) ter sido usada (o log só existe desde 02/09).
- **C2 — `NEXT_PUBLIC_APP_URL`.** A decisão de 23/07/2026 diz `https://sherlockdeal.com` (apex); o domínio canónico de
  hoje é `https://www.sherlockdeal.com` (o apex redireciona-lhe, 308) e o `CLAUDE.md` já diz `www`. Valor a pôr: o `www`.
  Além disso não se sabe se a variável está definida (o fallback do código é um `.vercel.app`).
- **C3 — `CALLS_MODE`.** O Prompt 905 (09/10/2026) fixou "omisso = `off`"; o Prompt 908 (12/10/2026, Nuno) inverteu para
  "omisso = `on`, só `off` desliga". Vale o 908; o texto antigo está marcado como substituído em
  `docs/calls/ETAPA1A_ENTIDADE.md`.
- **C4 — Resto do repositório desatualizado.** O `CLAUDE.md` dizia que Resend, Stripe e `ANTHROPIC_API_KEY` eram "para
  mais tarde"; estão todos em uso (provas acima). Corrigido no mesmo commit deste registo. O `.env.example` não tem
  `AUTH_CODE_MODE`, `AUTH_CODE_TEST_EMAILS`, `CALLS_MODE`, `CALLS_TEST_EMAILS` nem `NEXT_PUBLIC_PRIVACY_EMAIL`
  (a acrescentar quando alguém mexer no ficheiro; este prompt não altera código nem configuração).

---

## Pendentes do Nuno

Só o que depende de ação dele em painéis, por ordem. Cada linha cita a do registo e dá o valor exato. **Os itens do
Supabase sobre SMTP, rate limits, OTP e template ficaram `feito` (confirmado pelo Nuno em 09/10).**

1. **Supabase → Authentication → URL Configuration** (§2): confirmar Site URL `https://www.sherlockdeal.com` e
   Redirect URLs `https://www.sherlockdeal.com/**`. Se já estiver assim, dizer só "está".
2. **Vercel → connect-b → Settings → Environment Variables** (§1): confirmar que estão definidas, **sem trocar valores
   já decididos**: `RESEND_REPLY_TO` = `sherlockdeal.com@gmail.com` (alternativa sem painel: `/backoffice/email-delivery`
   mostra `replyToInEffect`); `NEXT_PUBLIC_APP_URL` = `https://www.sherlockdeal.com`. Depois, redeploy.
3. **Vercel** (§4): **não definir `AUTH_CODE_MODE`** (omisso = `on`, o código para todos). Se existir no painel com o valor
   `allowlist`, **apagá-la** (ou pô-la em `on`), senão o registo de quem não está na lista cai no fluxo só por link. Se existir
   `AUTH_CODE_TEST_EMAILS`, pode ficar (já não conta). Depois, redeploy.
3b. **Supabase → Authentication → Emails → SMTP Settings** (§2, §2.1): **a chave posta ali tem de ser a da conta do Resend onde
   `sherlockdeal.com` está verificado.** O Nuno está a corrigir (13/10); depois de corrigido, dizer-me "feito" e eu confirmo nos
   logs de Auth e no registo de falhas.
3c. **Caixa de suporte** (§2.1): as mensagens de erro dizem "write to us at `support@sherlockdeal.com`" (constante
   `AUTH_SUPPORT_EMAIL` em `src/lib/auth-errors.ts`). **Confirmar que essa caixa existe e é lida**; se for outra, diz-me qual e
   muda-se numa linha. (Não há decisão registada: `SUPPORT_NOTIFY_EMAIL` e `NEXT_PUBLIC_PRIVACY_EMAIL` continuam por decidir.)
4. **Vercel** (§1.2): decidir `SUPPORT_NOTIFY_EMAIL` (o endereço da caixa que recebe os pedidos de acesso de
   investidores) e `NEXT_PUBLIC_PRIVACY_EMAIL` (o contacto de privacidade). Sem valor decidido, não há nada para pôr.
5. **Resend → Billing** (§3): ativar o plano **Pro** antes da primeira call real (≈ 1 000 emails por call). Continua por
   ativar.
6. **Supabase → plano e Authentication → Sign In / Providers → Password** (§2): a "leaked password protection" só se liga
   com o plano **Pro**; decidir o plano e, se Pro, ligar a opção.
