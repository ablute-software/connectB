# Prompt 570 — Queue, fundações: contas internas, quadro de triagem, listas paginadas, e os 751 candidatos que já estão no catálogo

**Data:** 2026-09-04
**Para:** sessão Claude Code
**De:** Nuno + sessão de verificação
**Contexto:** primeiro de quatro prompts saídos da revisão `revisao_backoffice_queue_profile_claims_20260904.md` (lê-a primeiro — tem os números por separador e os princípios; este prompt só executa a parte de fundações). Os separadores individuais (Contributions, Identity/Claims, GDPR/Trust) vêm nos 571–573 e **não** são para tocar aqui além do que está explícito abaixo.

## O que confirmei por SQL antes de escrever isto

- `entities` com `source='manual'`: 757 linhas, **todas da ablute_** (21/07–02/08). `catalog_review_status`: 751 `pending`, 4 `merged`, 2 `promoted`.
- Das 751 pendentes, **747 têm nome exactamente igual a uma `catalog_entities`** (lower-case) e **692 têm domínio igual** (website normalizado sem protocolo/www/path). A fila "Added by startups (751)" está a pedir revisão de coisas que já estão no catálogo.
- 12 utilizadores em `auth.users`, todos internos ou testers; só 4 usam `@ablute.pt`/`sherlockdeal.com@gmail.com`. Uma regra por domínio de e-mail não serve.
- 7 dos 12 separadores da Queue têm zero itens (`profile_claims`, `gdpr_requests`, `suspicious_account_flags`, `entity_fraud_flags`, `investor_verification_documents`, `investor_entity_claims`; `investor_submissions` tem 1, aprovada).

## §A — `is_internal`: a conta é nossa, o que ela produz não precisa da nossa revisão

1. Migração (próximo número livre — sweep de todas as branches remotas + ledger, como sempre):
   - `orgs.is_internal boolean not null default false`
   - `matchdeal_investor_members.is_internal boolean not null default false`
   - Comentário na coluna, em ambas — e diz o que ela **não** faz, que foi o que faltou às três irmãs (`is_test`, `discovery_excluded_reason`, `moderation_status`) e custou tempo em três prompts distintos: *"Internal team account. Read ONLY by back-office review queues (hide-by-default). Does NOT disable automations (that is is_test), does NOT hide from discovery (that is discovery_excluded_reason / moderation_status), does NOT block login. is_internal means: what this account produces does not need back-office review — we produced it."*
   - Backfill nesta migração: `is_internal=true` para **todas** as 14 orgs e os 6 `matchdeal_investor_members` existentes hoje. (Contas de testers externos — carladias96@gmail.com "Sherlock Deal_ test", daquinta.app@gmail.com "Test & trial" — ficam internas também por omissão; o Nuno desliga no back-office se quiser tratá-las como externas.)
2. Back-office: em Startups › linha de org e Investors › Accounts › linha, um toggle "Internal team account" (mesmo padrão visual do Suspend, com confirmação de uma linha), escrito no `admin_audit_log`.
3. **Não** ligar `is_internal` a nenhuma automação, gate, descoberta ou entrega. Só as filas de revisão o leem (§C). Diz no relatório, por grep, que nenhum caminho de `is_test` foi tocado.

## §B — A Queue abre num quadro de triagem

`backoffice/queue` deixa de abrir no primeiro separador. Abre numa grelha de cartões, um por fila, cada cartão com:
- nome da fila · **contagem por decidir** (não o total histórico) · "oldest: N days" (item pendente mais antigo) · quando aplicável, SLA ("1 due in 4 days", vermelho abaixo de 7 dias — só GDPR tem SLA por agora).
- Filas a zero: agrupadas num bloco colapsado "All clear (N)" no fundo. Filas com itens e SLA (GDPR, Fraud, Suspicious) ordenadas primeiro; as restantes por contagem.
- Clicar no cartão abre o separador (rota mantém-se — `?tab=candidates` etc., para links directos continuarem a funcionar).
- As contagens respeitam o toggle "Hide internal" de §C (estado guardado em `localStorage`, ligado por omissão), e mostram "4 · 751 hidden (internal)" quando há escondidos — nunca esconder em silêncio.

Um endpoint só, `/api/backoffice/queue/summary`, devolve as contagens de todas as filas numa chamada (não 12 pedidos). Cache curta (30s) é aceitável.

## §C — Componente partilhado de lista: paginação no servidor, ordenação, filtros, selecção entre páginas

Um componente `QueueTable` (ou o nome que encaixar no que já existe — verifica se há um `DataTable` reutilizável antes de criar) usado por **todas** as filas, com:
- Paginação no servidor: 25/50/100 por página, total real no rodapé ("Showing 1–25 of 4").
- Ordenação por clique no cabeçalho (asc/desc), com o parâmetro na URL.
- Filtros na URL (`?status=pending&grade=A&internal=hidden`), para um link partilhado abrir a mesma vista.
- Filtro por omissão: **por decidir**. Resolvidos atrás de "Show resolved" (nunca misturados).
- Toggle "Hide internal" (lê `is_internal` da org/membro que originou o item; ligado por omissão).
- Selecção persistente entre páginas; barra de acções em massa diz "12 selected across 2 pages"; "Clear selection".
- Cabeçalho fixo (`sticky`) ao fazer scroll.

Neste prompt, aplica o componente a **Catalog candidates** (§D) e, se for barato, a Contributions (só a lista — sem mudar cartões/agrupamento, isso é o 571). As outras filas migram nos prompts seguintes.

## §D — Catalog candidates: o que já está no catálogo não entra na fila

1. Novos valores em `entities.catalog_review_status`: `linked` e `probable_match` (confirma se é `text` livre ou `check`/enum; ajusta a constraint na mesma migração de §A).
2. Nova coluna `entities.catalog_id uuid null references catalog_entities(id)` **se ainda não existir** algo equivalente (verifica `catalog_deliveries` e o que o merge do 187 já escreve — não duplicar uma ligação que já exista; se existir, usa-a).
3. Job idempotente (rota `POST /api/backoffice/catalog/candidates/reconcile`, corrível à mão e no fim de cada entrega/import):
   - domínio normalizado igual (`lower`, sem `https?://`, sem `www.`, sem path/query) → `linked`, `catalog_id` preenchido, **sem clique de ninguém**;
   - nome normalizado igual (`lower`, sem pontuação, sem sufixos `ventures|capital|partners|vc|fund` no fim) mas domínio diferente ou vazio → `probable_match`, com o `catalog_id` provável guardado para mostrar lado a lado;
   - nada → fica `pending`.
   - Nunca escreve em `catalog_entities`. Nunca altera linhas já `merged`/`promoted`/`dismissed`.
   - Corre-o em produção no fim e reporta as contagens antes/depois por estado — espero ≈692 `linked`, ≈55 `probable_match`, ≈4 `pending`. Se os números divergirem muito, pára e diz.
4. A fila passa a listar só `pending` + `probable_match`. Colunas por omissão: Grade · Investor (nome + domínio, uma linha) · Added by (org **e utilizador**, se houver) · Added when · Match ("— " / "probable → {nome do catálogo}") · Contact (✓/—) · Actions. HQ/Geographies/Stage/Sectors saem da tabela para o painel de expandir — hoje partem o layout em 5 linhas por célula.
5. `probable_match` mostra, ao expandir, candidato vs. entrada do catálogo lado a lado (reutiliza o que o merge do 187 já tem) com "Link (fills empty fields only)" e "Not the same → keep as new".
6. Acções em massa: "Link all exact matches" (dispara §D.3 para a selecção), "Promote selected", "Dismiss selected" (razão obrigatória, persiste como `dismissed`).
7. "Dismiss" tem de persistir — confirma que hoje a fila não está a recalcular a lista sem olhar para `catalog_review_status` (é a suspeita para 751 continuarem a aparecer depois de merges).

## §E — Botão "← Back to ablute_ (founder)"

Fundo sólido claro (o mesmo branco do separador activo), texto escuro, seta; contraste AA ≥ 4.5:1. Só este elemento muda. Screenshot antes/depois.

## Não fazer

Não mexer em Contributions além da lista (§C), nem em Identity/Claims/GDPR/Trust/Key people/Competitor intel — são os 571–573. Não ligar `is_internal` a `is_test`, a automações, à descoberta ou às entregas. Não escrever em `catalog_entities` a partir do reconcile. Não apagar nenhuma das 751 linhas.

## Verificar

- SQL: contagens por `catalog_review_status` antes/depois do reconcile; `is_internal` nas 14 orgs e 6 membros; nenhuma linha de `catalog_entities` alterada (compara `count(*)` e `max(updated_at)` antes/depois).
- Ecrã (`dev:verify`, dados de fixture): quadro de triagem com "All clear (7)" colapsado; Catalog candidates a mostrar "0 · N hidden (internal)" com o toggle ligado e a lista real com ele desligado; paginação/ordenação/filtros a reflectir na URL; selecção entre páginas.
- `tsc`/`vitest`/`build`/`eslint` limpos, na SHA do `origin`.

## Reportar

Número da migração e o sweep; contagens do reconcile; que componente de tabela reutilizaste ou criaste e porquê; a lista de separadores que ficaram por migrar para o `QueueTable` (para os próximos prompts); screenshots do quadro, da fila de candidatos e do botão; branch/commit/buildId. DECISIONS.md: *"Internal team accounts (`is_internal`) never feed review queues by default; exact catalog matches are linked automatically and never queued"*, datado.
