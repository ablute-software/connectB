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
`desconhecido` até o Nuno o ler. **Último passe completo: 12/10/2026; Supabase Auth atualizado a 13/10/2026 com o que o Nuno confirmou.**

---

## Regra: um passo de painel só fica `feito` depois de um teste real (lição de 12–13/10/2026)

**Um passo feito num painel (Supabase, Resend, Vercel) só passa a `feito` depois de um teste real com um email de fora, confirmado nos
logs do Auth** (ou no sítio onde o efeito se vê) — não porque alguém disse "já está". A 12/10 o SMTP do Supabase estava "feito" desde
09/10 e foi **a chave do Resend** (de uma conta sem `sherlockdeal.com` verificado) que partiu todos os envios durante 23 horas,
sem que nada o dissesse; e o OTP estava com 8 dígitos enquanto este registo dizia 6.
Quem escreve "feito" aqui escreve também **que teste o provou e quando** (ex.: "recuperação a 200 às 09:38 nos logs de Auth").

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
| `RESEND_REPLY_TO` | **já não é lida. Não definir; se existir no Vercel, apagar.** Os emails da plataforma saem **sem Reply-To** e com um rodapé: "This is an automated message. Replies are not read. Need help? Contact us at sherlockdeal.com/contact" (com ligação a `/contact`). Nos emails de uma call, o Reply-To passa a ser o "Contact email for applicants" dessa call, quando existir (Prompt 907+). **Quando `support@sherlockdeal.com` tiver reencaminhamento, passa a ser esse o Reply-To por omissão** | feito | Nuno, **13/10/2026** (substitui a decisão de 06/08 e 02/09, que apontava para `sherlockdeal.com@gmail.com`: a caixa do dono nunca deve aparecer a utilizadores) | Prompt 911 (follow-up); `src/lib/email-footer.ts`, `src/lib/resend.ts` |
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
| `AI_REVIEW_MODEL` | **sem decisão registada.** Opcional: sem ela o código usa `claude-sonnet-4-5`. Desde o Prompt 909 também lê o modelo da importação de calls por documentos (mesmo cliente e mesma `ANTHROPIC_API_KEY`; **nenhuma variável nova**) | pendente | — | `src/app/api/ai-review/route.ts:318`; `src/lib/calls/ai-import/anthropic.ts` |
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
| Lembrete de Calls (48 h antes do fecho) | **sem cron novo**: é mais um passo independente de `/api/automations` (`callDraftReminders` na resposta). Com um cron diário, quem não abre a app recebe o lembrete entre 24 e 48 h antes do prazo; quem abre a área Calls recebe-o logo | feito (código) · por testar em produção | Nuno, 09/10/2026 (spec §23) / Prompt 907, 14/10/2026 | `src/lib/calls/applicant/notices.ts`; `src/app/api/automations/route.ts` |
| Duração máxima de uma função (`maxDuration`) | A maioria das rotas: 30 ou 60 s. **`/api/calls/[id]/import-ai`: 300 s** (a leitura do modelo corre depois da resposta, com `waitUntil`, e tem relógio próprio de 270 s). A build de um preview aceitou 300 s neste projeto; que a Vercel o **cumpra** em runtime só se prova com uma importação longa | feito (código) · por provar em produção | Nuno, 14/10/2026 (Prompt 909, Adenda 2) | `src/app/api/calls/[id]/import-ai/route.ts`; `src/lib/calls/ai-import/job.ts` |
| Leitura de PDF na importação por IA | `unpdf` (texto por página, na plataforma) em vez de enviar o PDF ao modelo; partes lidas em paralelo (até 6 chamadas por importação, mesmo modelo e chave). Sem variáveis novas | feito (código) · por medir em produção | Nuno, 15/10/2026 (Prompt 909, Adenda 2b) | `src/lib/calls/ai-import/extract.ts`, `chunks.ts`, `propose.ts` |
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
| SMTP próprio (Authentication → Emails → SMTP Settings) | ligado, via Resend: host `smtp.resend.com`, porta `465`, utilizador `resend`, palavra-passe = **chave nova da conta do Resend de `sherlockdeal.com@gmail.com`** (**não escrever aqui**; é a conta onde `sherlockdeal.com` está verificado), remetente `noreply@sherlockdeal.com`. **A chave tem de ser da conta do Resend onde `sherlockdeal.com` está verificado** (ver §2.1) | **feito** | Nuno, 13/10/2026 (trocou a chave no painel). **A chave anterior era de uma conta sem o domínio e partiu todos os envios entre 12/10 às 10:11 UTC e 13/10 por volta das 09:30** (`550 "The sherlockdeal.com domain is not verified"`). **Prova:** a recuperação de palavra-passe respondeu **200 às 09:38** nos logs de Auth (teste real com um email de fora). O registo por código ainda não tem prova: é o passo 1 de produção do 911 | DECISIONS L4078, L9470; 904A §A2; logs de Auth de 12–13/10; Nuno 13/10 |
| Limite de envio de emails (Authentication → Rate Limits) | **≥ 300 por hora** | feito | Nuno, feito no painel; **confirmado pelo Nuno em 09/10** | 904A §A2/A3; confirmado pelo Nuno em 09/10 |
| Limite de verificações de token | **≥ 150 por 5 min por IP** (o Supabase vê sempre o IP do Vercel) | feito | idem | 904A §A2; confirmado pelo Nuno em 09/10 |
| Comprimento do código OTP (Sign In / Providers → Email) | **6** | feito | Nuno, 13/10/2026: **estava com 8** (o registo de 09/10 dizia 6 sem que o painel o tivesse) e foi corrigido para 6 | 904A §A2; Nuno 13/10 |
| Validade do código OTP | **1800 s** | feito | Nuno, 13/10/2026 (confirmado ao corrigir o comprimento) | 904A §A2; Nuno 13/10 |
| Template "Confirm signup" (Authentication → Emails → Templates) | **provisório**, posto pelo Nuno a 13/10/2026: **botão de link primeiro, código como alternativa, link com `next=%2F`** (volta sempre à raiz). Fica assim **até ao template final do Prompt 911**, que usa `next={{ .RedirectTo }}` para o link voltar ao destino de cada registo (a plataforma, um convite, ou — no 907 — a call e a página do candidato). O texto final está em `docs/auth/PROMPT_911_REGISTO_POR_CODIGO.md` §C, **para colar depois do deploy** | **provisório** (a trocar pelo final) | Nuno, 13/10/2026; o final é do 911 | Nuno 13/10; 911 §C |
| Leaked password protection | **ligar, mas requer o plano Pro do Supabase.** Hoje desligada (o advisor de segurança dá `auth_leaked_password_protection` como aviso, visto a 09/10) | pendente | Notada em 904A como "para a Parte B"; ligar depende de o projeto estar no Pro (decisão do Nuno sobre o plano) | 904A §A2; Nuno 12/10 (requer Pro); advisor observado |
| Site URL | `https://www.sherlockdeal.com` (o template usa `{{ .SiteURL }}/auth/confirm`) | feito | Nuno, 13/10/2026 (confirmou Site URL e Redirect URLs no painel). Em 24/07/2026 já se tinha visto que os links gerados voltam ao Site URL de produção e não ao localhost | Nuno 13/10; DECISIONS L1910 |
| Redirect URLs (allowlist) | `https://www.sherlockdeal.com/**`, `https://sherlockdeal.com/**`, `https://connect-b-delta.vercel.app/**` (rotas usadas: `/auth/callback`, `/auth/confirm`, `/reset-password`, `/set-password`, e agora o destino de cada registo: `/`, `/invite/<token>`, `/invite/incubator/member/pending`, `/call/…`). **O `emailRedirectTo` que o código envia tem de estar nesta lista, senão o Supabase troca-o pelo Site URL** (e o link volta à raiz) | feito | Nuno, 13/10/2026. O localhost **não** está na lista | Nuno 13/10; DECISIONS L1910; `src/lib/auth-redirect.ts` |
| Plano do Supabase (Pro?) | por confirmar. Só no Pro se pode reencaminhar o IP do cliente nas verificações | desconhecido | — | 904A §A3 |

### 2.2 Contacto de suporte: não há endereço público (Nuno, 13/10/2026)

**Não existe um endereço de suporte público até `support@sherlockdeal.com` ter reencaminhamento** (hoje não tem). Por isso:
- as mensagens de erro de autenticação **não mostram nenhum endereço**: em vez de "write to us at …" dizem "If it keeps failing, contact us" e
  "contact us" é uma ligação a **`/contact`**, o formulário de contacto (`src/lib/auth-errors.ts`: `CONTACT_PATH`, `CONTACT_PHRASE`;
  `src/components/auth/AuthMessage.tsx`). Um teste proíbe qualquer endereço da plataforma ou do dono no código desses ecrãs;
- **`sherlockdeal.com@gmail.com` nunca deve aparecer a utilizadores.** Um `Reply-To` vê-se quando alguém responde a um email, e era esse o valor
  de `RESEND_REPLY_TO`; por isso **o Nuno mandou-o remover a 13/10/2026** (§1.2): os emails da plataforma saem sem Reply-To e dizem no rodapé
  "This is an automated message. Replies are not read. Need help? Contact us at sherlockdeal.com/contact". **Isto vale também para os
  templates de email do Supabase Auth** (Confirm signup, Reset password, …), que são emails da plataforma: o texto final do 911 (§C do relatório)
  já leva esse rodapé, e cola-se no painel.
- Quando `support@sherlockdeal.com` tiver reencaminhamento, esse endereço passa a ser o Reply-To por omissão (muda-se numa constante).

### 2.1 Como confirmar que o SMTP do Auth funciona (Prompt 911)

O Supabase não mostra "o SMTP falhou" num ecrã: a falha só aparece nos **logs de Auth**. Dois sítios, por ordem de rapidez:

1. **No próprio produto:** `/backoffice/email-delivery` → secção **"Sign-up and recovery emails that failed"** (Prompt 911). Mostra cada
   falha de registo, de recuperação **ou de login sem palavra-passe** (link/código do investor, pré-visualização de convidado, `/pair`) com a resposta do fornecedor, e um aviso vermelho se houve alguma nas últimas 24 horas.
   Uma falha de **recuperação ou de login** é registada pela própria página (o browser chama o Supabase diretamente); uma de **registo** é vista
   pelo servidor. Guarda 90 dias.
2. **No Supabase → Logs → Auth** (ou `auth_logs` na API de logs): procurar `"error_code":"unexpected_failure"` com `gomail`. O
   sinal de que o SMTP está mal é uma linha `request completed` com `status: 500` em `/signup`, `/recover` ou `/resend`, e
   `error` = `gomail: could not send email 1: 550 …`. O sinal de que está bem é a mesma ação com `status: 200` e **nenhum**
   `gomail` nessa hora. Os logs de Auth só guardam **um dia**.

**Regra: a chave do Resend posta no SMTP do Supabase tem de ser da conta onde `sherlockdeal.com` está verificado** (Resend →
Domains → `sherlockdeal.com` → Verified). A de 12/10 era de outra conta; o `550` diz exatamente isso ("The sherlockdeal.com domain
is not verified"). A chave do Vercel (`RESEND_API_KEY`, §1.2) e a do SMTP do Supabase são **duas chaves diferentes** e podem estar em
contas diferentes: confirmar as duas.

**Registo de falhas (tabela `auth_email_failures`, migrações `20261013100100` e `20261013110000` — esta acrescenta a ação `login` —, aplicadas em 13/10/2026):** email, ação, estado HTTP,
código e texto do erro, hora. Só o serviço lhe chega (RLS sem políticas); lê-se no Backoffice.

---

## 3. Resend (conta e domínio)

| Nome | Valor | Estado | Quem decidiu e quando | Fonte |
|---|---|---|---|---|
| Domínio `sherlockdeal.com` verificado | verificado (SPF, DKIM e DMARC presentes) | feito | Nuno, entre 27/07 e 02/09/2026. Prova: envios entregues a terceiros desde 02/09. Ver **C1** | 904A §A1; DECISIONS L4076; observado |
| Remetente | `Sherlock Deal <noreply@sherlockdeal.com>` | feito | ver `RESEND_FROM_EMAIL` | §1.2 |
| Reply-to | **nenhum por omissão** (ver `RESEND_REPLY_TO`, §1.2). O rodapé de todo o email da plataforma manda para `/contact` | feito | Nuno, 13/10/2026 | §1.2; Prompt 911 (follow-up) |
| Webhook (Resend → `https://www.sherlockdeal.com/api/resend/webhook`) | ativo; eventos a chegar | feito | Decidido 04/09/2026 | observado |
| Plano | **subir para Pro antes da primeira call real** (o gratuito tem teto diário baixo; uma call ≈ 1 000 emails, ≈ 450 em 48 h). Nada foi comprado | pendente | Recomendado 09/10/2026; decisão do Nuno | 904A §A3 |

---

## 4. Interruptores

| Nome | Valor | Estado | Quem decidiu e quando | Fonte |
|---|---|---|---|---|
| `AUTH_CODE_MODE` | **omisso = `on`: todos os registos confirmam o email por código de 6 dígitos na própria página** (`/signup`, convite, convite de membro de incubadora), com o link do email como alternativa. **Escrever `off` é o travão de emergência:** as rotas respondem 404 e as páginas voltam ao fluxo só por link (a mesma regra do `CALLS_MODE`). **O `allowlist` do 904 foi reformado:** o valor `allowlist` vale agora `on`, para todos (a produção **tinha-o definido**: a 13/10, depois do primeiro deploy do 911, `/api/auth-code/register` respondia 404 a um email que não estava na lista, o que só acontece com `allowlist`; por isso o código foi mudado para não depender de apagar a variável). Qualquer outro valor (gralha incluída) vale `on`, de propósito. **Não definir** (se existir, pode apagar-se; não faz mal ficar) | feito | Nuno 13/10/2026 (Prompt 911: "passa a valer para todos"; antes, 904: fora por omissão). **Substitui o 904** (omisso = `off`) | 911 §A; `src/lib/auth-code/mode.ts` |
| `AUTH_CODE_TEST_EMAILS` | **já não é lida** (a allowlist foi reformada no 911). Se existir no Vercel, pode apagar-se | feito | Nuno 13/10/2026 (911: "já não depende da allowlist") | 911 §A; `src/lib/auth-code/mode.ts` |
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

1. ~~Supabase → URL Configuration~~ — **feito pelo Nuno a 13/10** (Site URL e as três Redirect URLs, §2).
1b. **Supabase → Authentication → Emails → Templates → Confirm signup** (§2): **colar o template final do 911 (§C do relatório) DEPOIS do
   deploy**, para o link do email voltar ao destino de cada registo. Até lá o provisório (botão primeiro, `next=%2F`) funciona para o registo
   normal e para a confirmação pelo link; só o registo por uma call (907) precisa do final para voltar à call.
2. **Vercel → connect-b → Settings → Environment Variables** (§1): confirmar que está definida, **sem trocar valores já decididos**:
   `NEXT_PUBLIC_APP_URL` = `https://www.sherlockdeal.com`. **`RESEND_REPLY_TO` já não é lida** (13/10): se existir, pode apagar-se, por arrumação.
   Depois, redeploy.
3. **Vercel** (§4): **nada a fazer** para o código funcionar. `AUTH_CODE_MODE=allowlist` (que a produção tem) e `AUTH_CODE_TEST_EMAILS`
   já não contam: o código vale para todos. Quando tiveres o painel aberto, podes apagar as duas por arrumação; só `AUTH_CODE_MODE=off`
   (escrito) faz alguma coisa (o travão de emergência).
3b. ~~Supabase → SMTP~~ — **feito pelo Nuno a 13/10** com uma chave nova da conta de `sherlockdeal.com@gmail.com`; recuperação confirmada a 200 às 09:38. Falta só a prova do **registo por código** (passo 1 de produção do 911).
3c. ~~Caixa de suporte~~ — **decidido pelo Nuno a 13/10:** não há endereço público; as mensagens ligam ao formulário `/contact` (§2.2).
   Quando `support@sherlockdeal.com` tiver reencaminhamento, diz-me e passa a poder mostrar-se (muda-se numa constante).
4. **Vercel** (§1.2): decidir `SUPPORT_NOTIFY_EMAIL` (o endereço da caixa que recebe os pedidos de acesso de
   investidores) e `NEXT_PUBLIC_PRIVACY_EMAIL` (o contacto de privacidade). Sem valor decidido, não há nada para pôr.
5. **Resend → Billing** (§3): ativar o plano **Pro** antes da primeira call real (≈ 1 000 emails por call). Continua por
   ativar.
6. **Supabase → plano e Authentication → Sign In / Providers → Password** (§2): a "leaked password protection" só se liga
   com o plano **Pro**; decidir o plano e, se Pro, ligar a opção.
