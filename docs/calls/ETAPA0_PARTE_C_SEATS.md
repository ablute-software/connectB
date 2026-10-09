# Calls, Etapa 0 — Parte C: seats de planos custom (09/10/2026)

Prompt 904, Parte C (spec §9.3). **A migração está escrita e NÃO foi aplicada**
(`supabase/migrations/20261009130000_investor_firm_seat_plans.sql`). Sem ela, todo o código novo
degrada para "esta firma não tem plano custom" e tudo se comporta como antes (verificado por teste).
O perfil real da Portugal Ventures não foi tocado: a pré-atribuição da PV é do Nuno.

## C1 — Como funcionavam os seats, e o que faltava

| Peça | Estado antes |
| --- | --- |
| `investor-seats.ts` (`resolveFirmPlanTier`, `checkSeatAvailable`) | O limite sai de **um de três tiers** (`tier_a/b/c` = 1/2/5), lido do `plan_tier` do **primeiro membro ativo**. |
| `plans.ts` (`MATCHDEAL_TIER_TO_INVESTOR_PLAN`, `investorSeatLimit`) | Os números 1/2/5, e o texto do bloqueio ("upgrade to…"). Sem noção de número à medida. |
| Trigger `enforce_matchdeal_seat_limit` (0285) | Repete os mesmos números 1/2/5 em SQL; só dispara na transição **para** um seat ativo. |
| `/api/backoffice/set-investor-plan` | Aplica um tier a **todos os seats ativos**; **falha com 404 "No active seats" numa firma sem ninguém** — logo, **não é possível pré-atribuir um plano antes do claim**. |
| "Private Detective" (`PRIVATE_DETECTIVE_PLAN`) | Só um cartão de preço (`/api/plan/private-detective`); não liga a nada. |
| `/api/portal/claims` | Auto-aprova se o domínio bate e **não há "disputa"**. Uma firma que já tem um claim aprovado trata qualquer 2.º claimant como **disputa → pendente, mesmo com seats livres**. Só depois verifica seats. |
| `matchdeal_investor_members.role` (`owner/admin/manager/member`) | Existe, **não governa nada**: qualquer membro pode retirar qualquer outro (`/api/portal/colleagues/revoke`, Prompt 421). Quem pede "Partner" no claim fica `member`. |
| `/api/portal/investor-profile/link` | Qualquer investor com sessão se liga a **qualquer** firma (domínio errado também liga); só o limite o trava. |
| `promo.ts` | Só planos de **founder** (`percent_off`/`free_trial`), por organização. |
| Convidar um colega | **Não existe**: o colega regista-se e faz claim (nota do Prompt 421). |
| Membro retirado | `status='revoked'`, mas o claim continua `approved` → o papel resolve `investor` e vai para `/portal` com um formulário "encontra a tua firma", sem dizer nada. |

**O que faltava para um plano custom com N seats:** (1) um sítio para guardar o N **por firma, antes
de haver membros**; (2) o limite do TypeScript **e** o do trigger a lerem esse N (hoje são duas
tabelas de números); (3) quem ocupa cada seat e desde quando; (4) um administrador da entidade com
poder real; (5) uma forma de reservar lugares para pessoas que ainda não têm conta; (6) o código
preso à entidade; (7) o 2.º..N-ésimo claim não cair em "disputa"; (8) o ecrã do membro retirado.

## C2 — N seats por firma, e o limite num só sítio

- **Tabela `investor_firm_seat_plans`** (uma linha por firma: nome do plano, `seats`, tier de
  funcionalidades, administrador, `activated_via` backoffice/código). Existe **antes do primeiro claim**.
- **Um só limite em SQL:** `matchdeal_firm_seat_limit(entity)` = o `seats` do plano ativo, senão o
  número do tier (`matchdeal_seat_limit`, já existente). O trigger passou a ler **esta** função.
- **O TypeScript lê a mesma tabela** (`getPlan` → `checkSeatAvailable`, `judgeSeats`). O trigger e o
  código não podem divergir porque não há segunda cópia do N. Os números 1/2/5 continuam duplicados
  (SQL e `plans.ts`) como já estavam; **um teste agora fixa-os** lendo a 0285 e comparando com `plans.ts`.
- O trigger continua a ser a rede de segurança: mesmo uma escrita que salte a verificação da app é recusada.
- Baixar o N abaixo do que já está ocupado é recusado (não se revoga ninguém em silêncio, como no Prompt 497).

## C3 — Ativação

**Pré-atribuição (backoffice):** `/backoffice/seat-plans` → escolher o perfil do catálogo → "Assign
plan" com N, nome e, opcionalmente, o email do administrador. Quando o primeiro claim é aprovado o
plano já está ativo. O administrador nomeado entra como `admin`.

**2.º..N-ésimo claim:** numa firma com plano **não há "disputa"**; um claim com o domínio da firma
(ou com lugar reservado) é aprovado automaticamente **enquanto houver lugares livres**; só cai em
pendente quando acabam (com o motivo "no free seat"). Uma firma **sem** plano mantém exatamente a
regra de antes (testado).

**Código preso à entidade:** estrutura **própria** (`investor_seat_codes`), não extensão de `promo_codes`:
aquele preço-cobra organizações de founder (`percent_off`/`free_trial`, resgatado por `org_id`); este
é sobre um `catalog_entity_id`, dá lugares (não desconto) e só vale para quem já tem claim aprovado
e seat ativo **nesse** perfil. Estender o outro obrigava a pôr a meio de uma tabela de preços um
sujeito, um efeito e uma regra de elegibilidade que não partilham nada. Propriedades:

| Exigência | Como |
| --- | --- |
| Só naquele perfil | O código guarda o `catalog_entity_id`; a função SQL só aceita quem tem claim **aprovado** e membership **ativa** nele. |
| Uso único | `select … for update` + `status='redeemed'` na mesma função: dois pedidos em corrida não ativam duas vezes. |
| Validade | `expires_at` (30 dias por omissão, 1–365). |
| Revogável | Backoffice → "Revoke" (só enquanto ativo). |
| Reencaminhado não ativa nada | Outra conta, conta noutro perfil, claim pendente, membro retirado: **a mesma recusa** que um código errado ("This code can't be used with your account."), por isso um código não se sonda. |
| Segredo | 100 bits, `PD-XXXXX-XXXXX-XXXXX-XXXXX`; **só o hash é guardado**; a página mostra-o **uma vez**; nunca vai para o log de auditoria (testado). |

Quem ativa o plano por código passa a administrador da firma se ela ainda não tiver nenhum.

## C4 — O administrador da entidade

**Escolha: um membro ativo cujo papel de seat é `owner` ou `admin`.** Porquê: a coluna `role`
já existe com estes valores, hoje não governa nada, e por isso usá-la **não muda o comportamento
de nenhuma firma sem plano**. Não se escolheu "quem fez o claim primeiro": isso daria o poder ao
primeiro a chegar, não a quem a firma decidiu. Quem é administrador é explícito: o email que o
backoffice nomeia no plano, quem ativa o código, ou quem o backoffice promover ("Make admin").

O que o administrador faz (`App access` → painel **Seats**): vê `N de M em uso · R reservados · F livres`,
quem ocupa cada seat e **desde quando**, **reserva** um lugar para um email, cancela uma reserva, remove um
membro. Passado o número, a plataforma **bloqueia e explica**: *"Your firm is on Private Detective, which
includes 10 seats, and 10 are already in use or reserved. Remove a member or cancel an invite to free a
seat, or ask Sherlock Deal to add more seats."*

**Reservar por email (em vez de "convidar um utilizador"):** funciona para quem ainda não tem conta e não
revela se o email já tem uma (mesmo princípio do Prompt 564; testado). A reserva conta contra o limite
desde que é criada e é consumida quando a pessoa faz o claim com esse email (aprovação automática, mesmo
sem o domínio da firma — o caso do avaliador externo). Ninguém mais lhe pode tirar o lugar. Vai um email
a avisar (best-effort).

Numa firma **com** plano, `/api/portal/colleagues/revoke` passa a exigir administrador (antes qualquer
membro removia qualquer outro, incluindo o chefe da firma); **sem** plano fica como estava.
Um administrador não pode remover o próprio lugar nem o último administrador.
O `link` (auto-ligação) numa firma com plano só aceita quem tem lugar reservado ou o domínio da firma,
e **nunca quem foi removido**.

> **Decisão para o Nuno (seats do administrador).** O administrador **ocupa um dos N seats** (é um
> membro com seat, e pode avaliar — spec §3). Com 10 seats, o administrador + **9** convidados enchem
> a firma, e o 10.º convite é bloqueado. O prompt descreve "convida 10 membros, o 11.º é bloqueado";
> isso só acontece se o backoffice definir **11** seats para a PV (10 avaliadores + o administrador).
> Se a PV deve ter 10 avaliadores **mais** o administrador, definir 11.

## C5 — Membro retirado

- A membership fica `revoked` (a linha mantém-se: histórico e ecrã); **a conta pessoal não se toca**;
  **os dados da firma ficam com a firma** (nada neles está ligado ao membro).
- Na entrada seguinte, `/api/portal/investor-profile` devolve `removedFrom` (a firma pelo nome) e a
  workspace abre em **Plans & billing** com *"You're no longer part of <firma>"* e as plans, sem
  "plano atual" (antes: "Loading…" para sempre, ou o formulário "encontra a tua firma").
- Não volta por si: o auto-claim e o `link` recusam quem foi removido; só uma nova reserva o traz de volta.
- **Acesso grátis por omissão (Prompt 559) — o que verifiquei:** o Prompt 559 no DECISIONS é sobre o
  *cookie de visualização não assinado* (não é sobre isto) e continua intacto; o que importa aqui é que
  sem seat ativo `resolveActiveInvestorMember` devolve `null` para todas as rotas do portal (50 sítios,
  Prompt 506), por isso **nada da firma resolve para o retirado**. O que **não** mudei: um investor
  sem firma pode declarar-se investidor individual (`self-declare`) e ficar com o tier por omissão
  (`tier_a`) sem pagar — **é o comportamento de hoje para qualquer investor novo**, não algo que a
  remoção abra; fica anotado em aberto.

## C6 — Backoffice

`/backoffice/seat-plans` (menu Accounts → "Custom plan seats"): lista de firmas com plano; por firma o plano,
seats totais / em uso / reservados / livres, **quem ocupa cada seat e desde quando** (o evento `seat_granted`
mais recente), **histórico** (todas as transições de seat, qualquer que seja o caminho: um trigger regista
`seat_granted/seat_released`; as rotas acrescentam o ator), e ações: **libertar**, **reatribuir** (liberta e
reserva para outro email), promover a administrador, reservar, cancelar reserva, criar/revogar códigos,
terminar o plano. Auditado no log de auditoria de admin (o código nunca).

## C7 — Teste de ponta a ponta

**Feito (automático, numa firma `zz-test-firm`, nunca na PV):** `src/lib/investor-firm-seats.e2e.test.ts`
(29 testes), `…/portal/seats/seats-routes.test.ts` (16), `…/backoffice/investor-seats/route.test.ts` (7).
Correm o código real (store, auto-aprovação de claims, `applyClaimApproval`, `checkSeatAvailable`, rotas e
guarda) sobre uma base **em memória que aplica as escritas** e que **modela em TypeScript o trigger e a função
de resgate**. Cobrem: plano antes do claim; claims 2..N aprovados enquanto há lugares e o seguinte pendente
com motivo; administrador convida até ao número e o seguinte é bloqueado; reserva guardada para o email;
remoção (conta intacta, histórico, "no longer part of", não volta sozinho); reatribuição; trigger como rede
de segurança; código — certo funciona, **outra conta / outro perfil / reencaminhado / depois de usado /
revogado / expirado falham**; firma sem plano inalterada. Um teste de mutação confirmou que desligar a regra
do membro removido faz falhar o cenário.

**Não verificado — depende de aplicar a migração:** o **SQL em si** (as funções, o trigger novo, as permissões)
nunca correu num Postgres; os testes provam a lógica da aplicação, e o modelo do trigger é uma segunda
implementação das mesmas regras. **Só o OK do Nuno desbloqueia** o passo seguinte, que é repetir o cenário em
produção numa firma `zz-test-…`: (1) aplicar a migração; (2) backoffice define 10 seats por pré-atribuição;
(3) claim aprovado; (4) o administrador reserva e a plataforma bloqueia o excedente; (5) remover um membro
e ver o ecrã de planos; (6) reatribuir; (7) repetir com o código (certo / outra conta / outro perfil /
usado / revogado). Apago a firma de teste no fim com a autorização dele.

## O que depende do Nuno

1. **Aplicar a migração** `20261009130000_investor_firm_seat_plans.sql` (e a da Parte B, ver relatório B).
2. Decidir os seats do administrador (10 ou 11 para a PV).
3. **Pré-atribuir a PV** quando decidir, em `/backoffice/seat-plans` (eu não toquei no perfil real).
4. Dizer-me para correr o C7 em produção na firma de teste depois da migração.
