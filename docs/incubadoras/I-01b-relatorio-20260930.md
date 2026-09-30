# I-01b — Relatório: e-mail do convite, owner/admin, inglês

30/09/2026 · branch `claude/incubadoras` · base `d06a84ba` · commits `e3dc85e1` (I-01b), `9dc4a900` (e-mail mascarado + check-email), `5ed290d4` (merge do `origin/main` com o fix do `dev:verify`) · **migração ainda não aplicada, nada em produção, sem merge para o main.**

Complementa o [relatório do I-01](I-01-relatorio-20260930.md): as secções 2–4 dele continuam válidas, com as alterações abaixo.

## A. O convite só é aceite pelo e-mail convidado

- **SQL** (`20260930150000_incubators_foundation.sql`):
  - `incubator_accept_invite` compara `lower(auth.jwt() ->> 'email')` com o e-mail do convite antes de qualquer escrita e devolve `{ok:false, error:'invite_email_mismatch', invited_email_masked}`.
  - `incubator_mask_email()` devolve os 2 primeiros caracteres + `…@` + domínio.
  - `incubator_decline_invite` faz a mesma verificação. Por isso passa a exigir sessão: sai de "só service-role" e ganha grant para `authenticated`.
- **Rotas:** `api/invite/incubator/[token]/accept` e `…/decline` correm com a sessão do caller.
- **Página do convite:**
  - Com sessão de outro endereço: *"This invite was sent to n…@startup.pt. Sign in with that email, or ask <incubator> to send the invite to the address you use."*, mais "You are signed in as …" e o botão **Sign out**. Terminar a sessão guarda o convite e leva ao login com `next=/invite/incubator/continue`.
  - Sem sessão, Accept e Decline estão escondidos e aparecem só Create account / I already have an account.
  - Com o endereço certo: Accept e Decline.
- **Pré-visualização pública** (`GET /api/invite/incubator/[token]`): devolve só `invitedEmailMasked` (2 caracteres + `…@domínio`), nunca o endereço inteiro (decisão do Nuno, 30/09). Na página, o aviso de endereço errado passa a aparecer só depois da resposta do servidor ao clique.
- **Signup** a partir do convite: o founder escreve o e-mail. Antes de a conta ser criada, o signup chama o `POST /api/invite/incubator/[token]/check-email` (autorizado pelo token e limitado por IP, como a pré-visualização), que responde só se o endereço bate certo e dá a versão mascarada.
  - Se não bater, aparece a mensagem do I-01b com o endereço mascarado e **nenhuma conta é criada**.
  - Por baixo do campo há uma pista: "Use the address <incubator> invited (fo…@domínio)".
  - O stub guardado no browser leva só a versão mascarada e o nome da incubadora.
- A verificação no aceitar e no recusar (SQL) mantém-se como estava.

## B. Owner/admin

- `permissions.ts`: capability nova `manage_programs: ['owner', 'admin']`.
- `src/lib/incubator-founder-gate.ts` → `requireProgramManager(req, {allowNoOrg?})`. É usado nas cinco rotas do founder e responde 403 `not_org_admin` com a nota. Aceitar e recusar admitem quem ainda não tem org, e o SQL responde a esse caso.
- **SQL:** `incubator_caller_org_can_manage(org)`, com `org_members.role in ('owner','admin')`, é usada em accept, decline, set_sharing_level, set_public_badge e no ramo founder de end_relationship.
- **Programmes:** manager e member vêem tudo em leitura, com *"Only owners and admins can accept invites, change sharing or end a programme."* A leitura (`founder_incubator_relationships`, `founder_incubator_access_log`) continua aberta a qualquer membro da org.

## C. Inglês

Passaram a inglês todos os ecrãs novos:

- `/incubator` (Portfolio, Team, Settings)
- backoffice › Incubators, incluindo a entrada no menu
- as duas páginas de convite e a de continuação
- Settings › Programmes
- o selector "Switch to"
- o cartão do shell para contas só de incubadora
- os textos e erros das rotas
- os dados demo
- os quatro e-mails, com o nível 1 e o D3 nas versões literais do I-01b

Há testes que falham se reaparecer texto de interface em português: `incubators.test.ts` e `incubator-emails.test.ts`.

## D. Ensaio de RLS — migração inteira, em transacção revertida contra produção

O ficheiro ensaiado é exactamente o que vai ser aplicado, incluindo o `alter table email_send_log … check`.

**Primeira corrida: 78/80.** As duas falhas (#4 "expired invite refused" e #8 "marked expired") vinham da **fixture**. O convite expirado estava endereçado ao founder B e era o founder A que o testava; a verificação nova respondeu, correctamente, `invite_email_mismatch`. Corrigi a fixture: o convite expirado passa a ser para o founder A, na incubadora B, porque na A já existe um convite pendente para ele e o índice único parcial não deixa haver dois.

**Segunda corrida: 80/80 PASS, 0 FAIL.** As verificações novas desta revisão:

| # | Verificação | Resultado |
|---|---|---|
| 100 | outro endereço com token válido → `invite_email_mismatch`, mascarado `zz…@example.com` | PASS |
| 101 | outro endereço também não recusa | PASS |
| 102 | nada escrito: convite continua `invited`, 0 relações | PASS |
| 103–104 | membro da org (não owner/admin), com o endereço certo → aceitar/recusar `not_allowed` | PASS |
| 105 | membro da org continua a **ler** a relação | PASS |
| 106–108 | membro da org não muda nível nem crachá e não termina | PASS |
| 109–110 | admin da org muda crachá e nível | PASS |
| 84 | o próprio endereço, sem org ainda, recusa o seu convite | PASS |
| 85 | `anon` não chama o recusar | PASS |
| 93 | o CHECK de `email_send_log.kind` aceita os três tipos novos | PASS |

As restantes (1–75, 80–83, 90–92) são as do I-01 e passam todas.

**Confirmado depois, em produção:**
- `to_regclass('public.incubators')` devolve null e há 0 funções `incubator%`.
- Não ficou nenhuma das fixtures.
- `email_send_log_kind_check` está igual ao original.
- 0 ligações "idle in transaction".

## E. Verificação

| Instrumento | Resultado |
|---|---|
| `tsc --noEmit` | EXIT=0 |
| `vitest run` | EXIT=1 — **4272/4273** depois do merge com o main (antes do merge: 4262/4263). A falha é `market-facts-view.test.ts > factSummaryLine > renders a market_size point fact with currency`, a falha de locale ICU que já existia, num ficheiro não tocado. Os 74 testes das incubadoras e de `decideRole` estão verdes |
| `eslint --no-eslintrc --config .eslintrc.json …` | EXIT=0 — `✖ 264 problems (0 errors, 264 warnings)`, a mesma contagem, 0 em ficheiros novos ou alterados |
| `npm run build` | EXIT=0 |
| Browser | ver secção F |

## F. Browser — NÃO correu, e o motivo foi apanhado pelo próprio `dev:verify`

1. O `origin/main` já trazia o fix do `dev:verify` (`7794868b`: porta livre a sério, identidade anunciada, `/api/me` com gate). Fiz merge dele na branch (`5ed290d4`).
   - Conflitos em `/api/me` e no `DECISIONS.md`, resolvidos.
   - Achado do merge: o `buildAuthenticatedMeResponse` novo do main só deixa passar uma lista fechada de campos, e ia **deixar cair `hats` em silêncio**, o que partia o selector de chapéu. Acrescentei `hats` ao tipo e ao builder, e actualizei o teste que lista as chaves.
2. Antes de arrancar confirmei, com `netstat`, que não havia nada a escutar nas portas 3000–3199.
3. O `preview_start` arrancou o `dev:verify`, e a identidade anunciada na consola foi `cwd …\connectB-737 · HEAD 537ddb14`. Era a pasta antiga desta sessão (branch do 897), **não esta worktree**.
   - A ferramenta de pré-visualização continua a ler o `.claude/launch.json` e a pasta de `connectB-737`, apesar de a sessão ter mudado de pasta.
   - Parei o servidor antes de qualquer clique.
   - Tentei uma configuração temporária no `launch.json` desta worktree: a ferramenta não a vê. Reverti o ficheiro.
   - Alterar o `launch.json` de `connectB-737` foi recusado na volta anterior, por isso não o fiz.
4. **Segunda tentativa** (continuação, com a sessão já nesta pasta, `HEAD 6530e04d`, árvore limpa, nada a escutar em 3000–3199 antes de arrancar). O `preview_start` voltou a lançar o `next dev` de `connectB-737`: o processo na :3000 (PID 21772) é `connectB-737
ode_modules
ext … dev`. A `/api/me` desse servidor não traz `verifyIdentity`, e o código desta worktree já o tem desde o merge. Abortei antes de qualquer clique e parei o servidor. O gate de identidade do Prompt 899 fez exactamente o que devia.
5. **Nenhum ecrã foi verificado no browser.** A pré-visualização só vai arrancar esta pasta a partir de uma sessão **nova** criada directamente nela; mudar a pasta de uma sessão existente não chega. O comportamento está provado pelo ensaio SQL (secção D) e pelos testes; a verificação visual fica por fazer.

## G. Para a sessão founder (acrescenta aos três já anotados no I-01)

4. **A falha de locale ICU em `market-facts-view.test.ts` faz o `vitest` sair com 1 em todas as sessões**, o que anula o gate "EXIT=0". Corrigir o teste ou fixar o locale no `vitest.config`, para o gate voltar a significar alguma coisa.

## H. Próximo passo

**"Sim" para aplicar a migração** (`apply_migration`, nome `20260930150000_incubators_foundation`). Depois: ledger, renomear o ficheiro para a versão gravada, grants em produção e o script de RLS sem a migração embutida. A seguir, **"sim" para o merge** e verificar o buildId antes e depois.
