# Adenda 1 ao Prompt 904 (v2) — Backoffice dos seats: relatório

**Branch:** `claude/904-adenda1` (a partir de `main` `d19f342f`). **Não está em `main` nem em produção:** falta o OK do Nuno ao merge.
**Migração:** `20261009170000_seat_plans_archive_notices_lookup.sql` — **já aplicada em produção** (aditiva, autorizada, depois de teste seco revertido). O código ainda não está lá, por isso nada mudou para os utilizadores: a migração só acrescenta tabelas e funções, e a única função existente que substitui (`redeem_investor_seat_code`) só difere ao reativar uma firma cujo plano já tinha terminado.

## O que mudou

### 0. A página em 4 sub-tabs (`/backoffice/seat-plans`, estado em `?tab=` e `?firm=`)

| Sub-tab | O que mostra |
|---|---|
| **Create plan** (por omissão) | "Pick a firm"; para uma firma **sem** plano, o formulário (seats, nome, administrador, "Assign plan"); para uma firma **com** plano ativo, "This firm already has a custom plan" + botão "Open in Firms with a custom plan". Em ambos: quem tem cada seat, "Add a person by email", pedidos à espera, códigos. **Já não tem** a lista de firmas nem o History. |
| **Firms with a custom plan** | Lista (firma · plano · seats · em uso · reservados · livres · administrador · criado · última alteração), pesquisa por nome, ordenação (criação, última alteração, nome). Clicar numa firma abre-a por baixo da linha: editar plano, quem tem cada seat (Make admin, Reassign, Release), reservas, Add a person, pedidos, códigos, **End plan**. |
| **History** | Todas as firmas numa lista (quando · firma · evento · quem · detalhe), filtros por firma, tipo de evento e datas, pesquisa por firma ou email. |
| **Ended plans** | Cada plano terminado (nome, seats, administrador, como começou, criado, terminado, quem terminou); pesquisa e ordenação por data de fim; clicar abre "Who held each seat" no momento em que terminou (papel e desde quando). Uma firma pode aparecer várias vezes. Os "reconstructed from history" têm etiqueta (**em produção eram 0**). |

"End plan" não remove ninguém: a firma volta ao escalão 1/2/5 e o plano passa para "Ended plans". **Não há eliminação definitiva de planos.**

### 1. Add a person by email
Conta existente → membro ativo já, dentro dos seats, `verification_method='manual'`, claim aprovado em nome do admin do backoffice, evento no histórico. Sem conta → reserva. Nos dois casos email + aviso na plataforma ("You've been added to X", mostrado uma vez a quem entra com esse email confirmado). Sem lugar livre: a mesma frase do painel ("Your firm is on … which includes N seats, and N are already in use or reserved. Remove a member or cancel an invite…"). Mais os **pedidos à espera** da firma com Approve/Decline pelo backoffice.

### 2. Código curto
`PD-XXXX-XXXX` (8 caracteres, sem 0/O/1/I), aceite com ou sem hífens, em qualquer caixa e até sem o "PD". Só o hash é guardado. Botão **Copy** no código mostrado uma vez. Os códigos longos já emitidos continuam válidos.

### 3. Apagar e arrumar
"Delete" (com confirmação) nos nunca usados; regista quem e quando. Usados: "Used on [data] by [email]", sem Delete. A lista mostra só os ativos; "Show used, revoked and expired (N hidden)" mostra o resto.

## Verificações (todas por código de saída, na árvore que foi publicada)

Corridas na árvore que é exatamente a do commit (nada por commitar):

| Verificação | Resultado |
|---|---|
| `tsc --noEmit` | EXIT=0 |
| ESLint (config da raiz, sobre `src`) | EXIT=0, 0 erros, 252 avisos (eram 254: corrigi 2 meus de `autoComplete`); nenhum aviso em ficheiros desta adenda |
| `vitest run` (tudo) | EXIT=0, 324 ficheiros, 5020 testes |
| `npm run build` (`--max-old-space-size=6144`) | EXIT=0; `/backoffice/seat-plans` compila |
| Testes desta adenda | 64 em 5 ficheiros novos + 2 testes antigos ajustados (formato do código; o CHECK dos eventos agora lê as duas migrações) |

## Em produção — o que foi provado e o que NÃO foi

**Provado (SQL real, contra a base de produção):**
- Teste seco da migração numa transação sempre revertida: 7 verificações (reconstrução de um plano terminado antes do arquivo, "End plan" com retrato dos membros e 2 membros intactos, dois planos terminados na mesma firma, o CHECK aceita `code_deleted` e continua a recusar lixo, procura por email, o resgate já não herda os seats de um plano terminado, avisos). Nada ficou gravado.
- Depois de aplicada: "End plan" duas vezes numa firma `zz-test-adenda1-endplan` criada e apagada por mim: 2 linhas no arquivo (planos "Plan one", 3 seats, e "Plan two", 7 seats, ambos mantidos), 2 eventos `plan_ended`, e terminar sem plano ativo devolve `ok:false`. Limpeza feita: 0 firmas `zz-test-adenda1*`, 0 linhas no arquivo, 1 plano, 5 eventos — como estava.
- Advisors de segurança: nenhum ERROR; as duas tabelas novas aparecem só com o INFO `rls_enabled_no_policy`, que é intencional (RLS ligada sem políticas = só o service role, como as outras tabelas de seats). As funções novas não aparecem como executáveis por `anon`/`authenticated`.

**NÃO provado em produção, e porquê:** as rotas e o ecrã não correm em produção enquanto não houver merge e deploy (precisa do OK do Nuno), e mesmo depois **eu não tenho sessão de platform admin lá** nem devo introduzir credenciais. Por isso os cinco passos da firma "ablute_ — Internal QA" **ficam para o Nuno clicar** (lista abaixo). O que corri em vez disso:
- 64 testes novos ao nível da lib, das rotas e dos componentes (ver abaixo), sobre uma base de dados simulada com estado que modela o trigger e as funções SQL;
- o ecrã verificado no browser em modo demo (`dev:verify`, nunca produção) com um servidor simulado dentro da página: as 8 capturas em `docs/calls/screenshots-904-adenda1/`. **Isso prova o ecrã e a navegação, não a rota nem o Supabase.**
- O botão **Copy**: com um clique real mostra "Copied" e o código fica selecionado; **não consegui ler o conteúdo da área de transferência** (o browser de verificação bloqueia a leitura), por isso esse último passo é para confirmares colando.

## O que o Nuno deve clicar (depois do merge e do deploy), em "ablute_ — Internal QA"

1. Abre `/backoffice/seat-plans`: abre em **Create plan**, sem lista nem History. Escolhe "ablute_ — Internal QA": aparece "This firm already has a custom plan" e o botão. Carrega nele.
2. Em **Firms with a custom plan**: a firma abre por baixo da linha. Pesquisa pelo nome, altera os seats (+1 e volta), grava.
3. **Add a person by email** com `sherlockdeal.com+membro1@gmail.com` (sem conta): aparece "reserved" em quem tem cada seat e chega o email "You've been added to…". Cancela a reserva no fim.
4. **Create code**, carrega em **Copy**, cola num sítio qualquer (deve ser `PD-XXXX-XXXX`), e **Delete** com confirmação. Sai da lista.
5. Em **History**, filtra por esta firma: vês `code_created`, `code_deleted` (com as 4 últimas letras), `invite_created`/`invite_cancelled`.
6. **Não termines o plano desta firma.** O "End plan" e a sub-tab 4 estão provados em SQL e no ecrã demo; se quiseres vê-los a sério, faz-o numa firma `zz-test-…` e apaga-a depois.

## Para decidir / vigiar
- **Resgate de código sem limite de tentativas.** Com 8 caracteres (40 bits) o espaço é menor. Só serve quem já tem um claim aprovado e um seat ativo naquela firma (já está atrás de um login), mas é tentável sem limite. Se quiseres, pomos as mesmas "5 tentativas" do código de registo — não o fiz porque não estava pedido.
- Os claims de **outro domínio** continuam só em "Investor claims" (decisão minha, explicada no DECISIONS).
- O aviso "You've been added" fica por email; uma reserva para quem ainda não tem conta só aparece à pessoa depois de criar conta com esse email e ficar na firma.
