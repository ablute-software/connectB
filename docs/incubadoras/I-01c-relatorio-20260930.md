# I-01c — Relatório: o convite de membro nunca vira founder; aterragem; "Ecosystem organisations"

30/09/2026 · branch `claude/incubadoras`, a partir do `main` (`59cfef14`). **Duas migrações aplicadas em produção ("sim" do Nuno) — ver G.**

## A. O bug do teste do Nuno (17:13–17:16)

A conta criada pelo convite de membro virou founder. A confirmação do e-mail não a trouxe de volta ao convite; ela entrou pela porta normal; o shell tratou-a como founder órfão ("finish your startup account"); o `provision-org` criou-lhe uma org.

| # | Correcção | Onde |
|---|---|---|
| A.1 | O `signUp` do convite de membro leva `data.signup_intent = 'incubator_member'` e `emailRedirectTo = <origin>/auth/callback?next=/invite/incubator/member/pending` | `src/app/invite/incubator/member/[token]/page.tsx` |
| A.2 | RPC `incubator_accept_pending_member_invites()` (security definer, `search_path` fixo, só `authenticated`). Com e-mail **confirmado**, aceita todas as linhas `invited` para esse endereço, em organização aberta e não expirada; se já existir uma linha do mesmo utilizador na mesma organização, reactiva-a | `supabase/migrations/20260930165056_incubator_accept_pending_member_invites.sql` |
| A.3 | `/api/me` devolve `pendingIncubatorMemberInvite` (booleano, lido com o service role, só quando `role = 'none'`) e `signupIntent`. O shell, antes de qualquer `OrphanAccountRepair`, envia essa conta para `/invite/incubator/member/pending`; o mesmo acontece em `landingDestination` (`/` e `/investors`). Essa página chama a RPC → `/ecosystem`; se não aceitar nada: "This invite is no longer valid — ask the organisation to invite you again" + Sign out | `src/lib/landing-redirect.ts` (`goesToPendingMemberInvite`), `src/lib/incubator-pending-server.ts`, `src/components/shell.tsx`, `src/app/invite/incubator/member/pending/page.tsx`, `src/app/api/invite/incubator/member/accept-pending/route.ts` |
| A.4 | `decideRole` sem mudança de ordem | — |
| A.5 | Convite de membro: a pré-visualização devolve só `invitedEmailMasked`. O e-mail é escrito pela pessoa e confirmado no servidor antes de a conta ser criada (`…/member/[token]/check-email`); se não bater, aparece a mensagem do I-01b com o endereço mascarado | `src/app/api/invite/incubator/member/[token]/route.ts` e `…/check-email/route.ts` |
| A.6 | Testes: aterragem (sem org + convite → aceitação; sem org + sem convite → como hoje; `signup_intent` → nunca orphan repair; quem já tem casa não é desviado) em `landing-redirect.test.ts`. A RPC está no script de RLS (secção D) | — |

**Duas diferenças em relação ao texto do prompt, e porquê:**

1. **O `next` do `emailRedirectTo` é o caminho fixo `/invite/incubator/member/pending`, não `/invite/incubator/member/<token>`.**
   - Com a RPC do A.2, o token deixa de ser necessário para aceitar, porque o e-mail confirmado já é a prova.
   - Assim o token nunca vai numa query string nem no e-mail de confirmação do Supabase, o que mantém a regra do I-01 §C.2.
   - "I already have an account — sign in" usa o mesmo `next`.
2. **O callback (`src/app/auth/callback/route.ts`) não precisou de mudança: já honra qualquer `next` relativo** (`${origin}${next}`), com o desvio para `/set-password` quando `password_set` falta. O signup do convite de membro já grava `password_set: true`.
   - Não restringi o `next` do callback a uma regex, porque partiria os outros fluxos que o usam (login, magic link, recovery).
   - Por isso não há teste "next aceite/recusado".

## B. "Ecosystem organisations"

- **Nomes para o utilizador:**
  - A categoria chama-se **Ecosystem organisations**.
  - O workspace chama-se **Ecosystem workspace**, com a rota **`/ecosystem`**; `/incubator` redirecciona para lá.
  - Do lado do founder, o separador passa a **Programmes & organisations**.
  - No backoffice, o menu e a página passam a **Ecosystem organisations**.
- **E-mails:**
  - "<organisation> invited <startup> to Sherlock Deal".
  - "Join <organisation>'s team on Sherlock Deal".
- **Textos:** onde o utilizador lia "incubator", agora lê "organisation" ou o nome próprio da organização.
- **Tipos** (`kind`):
  - **Novos:** `public_agency` (Public agency), `association` (Association), `tech_transfer_office` (Technology transfer office).
  - **Rótulos novos dos que existiam:** `municipal` "Municipal / regional incubator", `university` "University incubator", `private_accelerator` "Accelerator", `corporate` "Corporate programme".
  - **Migração** `20260930165248_incubator_kinds_ecosystem.sql`: o `check` e o comentário da tabela, **e também** `incubator_update_profile()`, que tinha a sua própria cópia da lista. Sem isso, o owner nunca conseguiria escolher um tipo novo nas Settings. O corpo é o mesmo da fundação e só a lista muda; o ACL fica igual.
- **O que não muda:** `incubators`, `incubator_*`, as RPCs, `/api/incubator/**` e o papel `incubator`. "incubator" é o nome técnico da classe "ecosystem organisation" (DECISIONS.md).

## C. Fora desta linha (registado, não feito)

1. **Sessão founder, contas fechadas:** em backoffice › Startups, um separador para organizações fechadas ou eliminadas, com os membros, e por membro "Release email" (respeitando o apagamento do artigo 14) e "Reopen account" (enquanto não estiver purgada). O caso concreto é `alexandrameira.ablute@gmail.com`: conta fechada, convidada para a ALEX trial, e o convite não lhe serve de nada enquanto isto não existir.
2. **Nuno, e-mail de confirmação no spam:** o Supabase Auth envia com o remetente por defeito dele. É configuração em Authentication › SMTP, para usar o SMTP do Resend com um remetente `@sherlockdeal.com`. Não é código.

## D. Ensaio — as duas migrações + `scripts/verify-incubators-i01c.sql`, transacção revertida contra produção

**13/13 PASS.**

| # | Verificação | Resultado |
|---|---|---|
| 1–2 | e-mail não confirmado → 0 aceites, continua sem o sinal de membro | PASS |
| 3 | convite de outra pessoa nunca é aceite → 0 | PASS |
| 4 | organização fechada → 0 | PASS |
| 5–7 | endereço convidado e confirmado → 1 aceite; passa a ter o sinal de membro; correr outra vez não aceita mais nada | PASS |
| 8 | a linha fica `active`, ligada ao utilizador, com `accepted_at` preenchido e o token limpo | PASS |
| 9 | os convites não confirmado, de outra pessoa e da organização fechada continuam `invited` | PASS |
| 10 | `anon` não chama a RPC | PASS |
| 20–21 | `public_agency` e `association` passam o CHECK; um tipo desconhecido continua a ser recusado | PASS |
| 22 | o owner muda o tipo para `tech_transfer_office` pelas Settings (`update_profile` alargada) | PASS |

**Confirmado depois, em produção:**
- A RPC não existe.
- `incubators_kind_check` está igual ao original.
- Não ficou nenhuma fixture `zz-test-i01c-*`.
- 0 ligações "idle in transaction".
- As 2 linhas em `incubators` são as organizações reais do teste do Nuno.

## E. Verificação

| Instrumento | Resultado |
|---|---|
| `tsc --noEmit` | EXIT=0 |
| `vitest run` | EXIT=1 — **4295/4296**. A falha é `market-facts-view.test.ts`, a de locale ICU que já existia |
| `eslint --no-eslintrc …` | EXIT=0 — `✖ 264 problems (0 errors, 264 warnings)`. Uma primeira corrida deu **2 erros** `react/no-unescaped-entities` (aspas no texto do backoffice), a mesma classe que partiu a Vercel nos Prompts 573/574. Corrigidos com `&ldquo;/&rdquo;` e lint repetido |
| `npm run build` | EXIT=0; as rotas `/ecosystem`, `/incubator` (redirect) e `/invite/incubator/member/pending` aparecem na tabela |

## F. Sequência a partir daqui (I-01c §E)

1. **"Sim" para aplicar as duas migrações** (`incubator_accept_pending_member_invites`, `incubator_kinds_ecosystem`). Depois: ledger, renomear os ficheiros para as versões gravadas, e o script `verify-incubators-i01c.sql` contra as tabelas reais.
2. **"Sim" para o merge**, e buildId antes e depois.
3. **D (limpeza), com "sim":** fechar a org criada por engano para `appsalexandra59@gmail.com` com `close_org` (razão: "created by mistake during I-01 production test (I-01c)"); revogar o convite de membro para `alexandrameira.ablute@gmail.com` e manter o de `alexandrameira@ablute.pt`; não apagar nenhum utilizador em `auth`.
4. O Nuno repete o teste: entrar com `appsalexandra59@gmail.com` pela página normal e aterrar no Ecosystem workspace; convidar uma startup de teste; aceitar do lado founder; mudar o nível; terminar.

## G. Migrações aplicadas ("sim" do Nuno)

| | Resultado |
|---|---|
| Ledger | `20260930165056 incubator_accept_pending_member_invites`, `20260930165248 incubator_kinds_ecosystem`; ficheiros renomeados para essas versões |
| ACL | as duas funções: só `postgres`, `service_role`, `authenticated`; `security definer`; `search_path=public` |
| CHECK | `incubators_kind_check` com os nove tipos |
| `verify-incubators-i01c.sql` (tabelas reais, revertido) | **13/13 PASS** |
| Depois | 0 fixtures `zz-test-i01c-*`, 0 ligações "idle in transaction" |
| Advisors | iguais à linha de base, excepto `authenticated_security_definer_function_executable` 84 → 85 (a nova RPC, feita para `authenticated`); `anon_…` fica em 41 |
