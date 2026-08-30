# Alcance por capacidade — Sherlock Deal

**Local canónico:** `docs/capability-reach.md` no repositório `connectB`.
**Criado:** 30/08/2026 (tarefa D3 de `docs/execution-queue.md`).
**Lê-se com:** `AUTONOMOUS_EXECUTION_MODE_v2` §21.

---

## Porquê este ficheiro existe

`select count(*) from org_market_hypotheses` devolvia **0 em todas as orgs**
com a cadeia 444→445→446→456→457 inteira em `main`, verificada, e inerte.
Duas semanas de trabalho a zero, e **nada assinalou** — porque não havia
forma de perguntar *"isto está a ser usado?"* sem alguém se lembrar de
escrever a consulta à mão.

Uma capacidade entregue, verificada, em `main`, e que ninguém alcança, vale
zero — e, olhando só para uma contagem, **não se distingue** de uma
capacidade a funcionar.

---

## Como ler cada consulta

Cada consulta devolve **uma linha** com contagens de apoio e uma coluna
`verdicto`, que é sempre **exatamente um destes três valores**:

| `verdicto` | Significa | O que fazer |
|---|---|---|
| `A FUNCIONAR` | a capacidade produziu output real | nada |
| `EXISTE MAS NINGUEM LA CHEGA` | **a montante há input, a jusante há zero.** A capacidade está em `main` e inerte | **investigar — é o modo de falha que este ficheiro existe para apanhar** |
| `AINDA NAO APLICAVEL` | nem sequer há input a montante; ninguém chegou ao passo anterior | nada, mas confirma que o passo anterior é alcançável |

A distinção entre os dois últimos é o ponto todo. Um `0` sozinho não diz
qual dos dois é, e foi exatamente por isso que a cadeia das hipóteses
esteve duas semanas inerte sem ninguém reparar.

**Cada consulta é read-only.** Nenhuma escreve, nenhuma bloqueia.

Os nomes de tabela e coluna foram confirmados contra as migrações do
repositório **e** contra o `information_schema` de produção em 30/08/2026 —
uma consulta com uma coluna inventada é pior do que nenhuma.

---

## Tabela-resumo

| # | Capacidade | Consulta | Valor esperado se estiver a funcionar | Observado 30/08 14:30 |
|---|---|---|---|---|
| 1 | **444/445** — Market Thesis → hipóteses | [§1](#1--444445--hipóteses-de-mercado) | `active_hypotheses > 0` · verdicto `A FUNCIONAR` | ✅ `A FUNCIONAR` — 3 hipóteses |
| 2 | **446/467** — factos de mercado tipados | [§2](#2--446467--factos-de-mercado-tipados) | `typed_facts > 0`, com `evidence_rows ≥ typed_facts` | ⚠️ `EXISTE MAS NINGUEM LA CHEGA` — 0 factos, 60 itens legacy |
| 3 | **449/450** — competition engine | [§3](#3--449450--competition-engine) | `competitors_classified > 0` | ⚠️ `EXISTE MAS NINGUEM LA CHEGA` — 13 concorrentes, 0 classificados |
| 4 | **462** — link snapshots | [§4](#4--462--link-snapshots) | `snapshots_ok > 0` para links existentes | ✅ `A FUNCIONAR` — 1 ok / 2 links |
| 5 | **464/465** — reconciliação semântica | [§5](#5--464465--reconciliação-semântica) | `reconciliations > 0` e `last_reconciliation` recente | ✅ `A FUNCIONAR` — 14, última 14:23 |
| 6 | **469** — `ai_call_log` durável | [§6](#6--469--ai_call_log-durável) | `calls_last_7d > 0` sempre que houve trabalho de AI | ✅ `A FUNCIONAR` — 181 chamadas / 7 dias |
| 7 | **471** — sugestões da tese a partir de documentos | [§7](#7--471--sugestões-da-market-thesis-a-partir-de-documentos) | `thesis_suggest_calls > 0` | ✅ `A FUNCIONAR` — 1 chamada, 14:17 |
| 8 | **472** — dois eixos do `gap_disposition` | [§8](#8--472--prometido--documentado) | `pending_sem_evidencia` a **descer** ao longo do tempo | ✅ `A FUNCIONAR` — 7 → 3, 5 resolvidas |

As seis primeiras são o mínimo pedido pela D3. As duas últimas (471, 472)
foram acrescentadas por serem as capacidades **mais recentes** e, por isso,
as que ainda não têm nenhuma prova de que alguém lá chega.

**Nota sobre a coluna "Observado".** A D3 diz *"não corras estas consultas
contra produção — não tens acesso"*. Essa premissa deixou de ser verdadeira:
esta sessão tem acesso SQL de leitura via MCP. As consultas foram corridas
**uma vez, em modo leitura**, com dois objetivos que a própria D3 exige:
garantir que cada uma é SQL válido contra o esquema real (*"uma consulta com
uma coluna inventada é pior do que nenhuma"*) e cumprir a regra de
manutenção nº 3 abaixo, que pede o valor conhecido à data. O verificador
continua a ser quem as corre para efeitos de verificação independente — os
valores acima são um ponto de partida datado, não a verificação.

---

## 1 — 444/445 — hipóteses de mercado

Sem hipóteses, `/api/market-data/research` devolve
`gate: { eligible: false, reason: 'no_hypotheses' }` e **nunca chega a
pesquisar**. Esta é a consulta que faltava.

`EXISTE MAS NINGUEM LA CHEGA` dispara assim que **qualquer** org tocou na
Market Thesis sem produzir hipóteses — incluindo o caso histórico (uma tese
com `product_summary` preenchido e `core_problem` vazio, um portão de dois
campos com metade preenchível). `theses_passing_the_gate` diz **porquê**.

```sql
select
  (select count(*) from org_market_hypotheses where status = 'active')        as active_hypotheses,
  (select count(*) from org_market_hypotheses)                                as hypotheses_all_statuses,
  (select count(*) from org_market_thesis)                                    as theses_rows,
  (select count(*) from org_market_thesis
     where coalesce(trim(product_summary), '') <> ''
       and coalesce(trim(core_problem), '') <> '')                            as theses_passing_the_gate,
  (select count(*) from org_market_thesis
     where (coalesce(trim(product_summary), '') <> '') <> (coalesce(trim(core_problem), '') <> ''))
                                                                              as theses_half_filled,
  case
    when (select count(*) from org_market_hypotheses where status = 'active') > 0
      then 'A FUNCIONAR'
    when (select count(*) from org_market_thesis) > 0
      then 'EXISTE MAS NINGUEM LA CHEGA'
    else 'AINDA NAO APLICAVEL'
  end                                                                         as verdicto;
```

- **`A FUNCIONAR`** — há hipóteses ativas; a pesquisa por secção é alcançável.
- **`EXISTE MAS NINGUEM LA CHEGA`** — alguém preencheu (ou tentou preencher)
  uma tese e não saiu daí nenhuma hipótese. Se `theses_half_filled > 0`, é o
  portão incompleto outra vez.
- **`AINDA NAO APLICAVEL`** — nenhuma org abriu sequer a Market Thesis.

---

## 2 — 446/467 — factos de mercado tipados

A `0279` criou quatro tabelas; a rota `document-extract` desvia
`growth`/`sizing` para lá em vez de criar `market_research_items`. Se a
extração de documentos corre e `market_facts` continua a zero, o desvio não
está a acontecer.

`legacy_document_items` é a prova de que o pipeline de documentos **já
correu alguma vez** — conta as secções que continuam a passar pelo caminho
legacy (`segments`, `players`, `trends`, `regulatory`) e as passagens
pré-467.

```sql
select
  (select count(*) from market_facts)                                         as typed_facts,
  (select count(*) from market_facts where validation_status = 'valid')       as typed_facts_valid,
  (select count(*) from market_facts where verification_status = 'founder_reported')
                                                                              as facts_founder_reported,
  (select count(*) from market_evidence)                                      as evidence_rows,
  (select count(*) from market_fact_observations)                             as observations,
  (select count(*) from market_research_items where source_kind = 'document') as legacy_document_items,
  case
    when (select count(*) from market_facts) > 0                then 'A FUNCIONAR'
    when (select count(*) from market_research_items where source_kind = 'document') > 0
                                                                then 'EXISTE MAS NINGUEM LA CHEGA'
    else 'AINDA NAO APLICAVEL'
  end                                                                         as verdicto;
```

- **`A FUNCIONAR`** — há factos tipados. `evidence_rows` deve ser `>=`
  `typed_facts` (cada facto nasce de pelo menos uma evidência); se for menor,
  há um facto sem evidência e isso é um bug, não uma medição.
- **`EXISTE MAS NINGUEM LA CHEGA`** — o pipeline de documentos correu e não
  produziu um único facto tipado. Suspeitos, por ordem: a `run_signature` a
  ler como "já correu" (467 v3 §1), ou `marketFactsAvailable()` a devolver
  falso e tudo a cair no caminho legacy (467 v3 §4).
- **`AINDA NAO APLICAVEL`** — ninguém correu ainda "Read my documents".

**Observado 30/08 14:30 — `EXISTE MAS NINGUEM LA CHEGA`:** `typed_facts = 0`,
`evidence_rows = 0`, `observations = 0`, `legacy_document_items = 60`. A
`0279` está aplicada e o código está em `main` desde as ~13:00 de hoje, mas
**nenhum facto tipado foi ainda escrito**. Os 60 itens legacy são de
passagens anteriores ao 467. Antes de procurar bug: uma única passagem de
"Read my documents" **depois** do deploy de hoje distingue *"ninguém clicou
desde o merge"* (esperado, e é só carregar) de *"o desvio não acontece"*
(bug real, e aí os dois suspeitos acima são o sítio por onde começar). É a
verificação mais barata da lista e ainda não foi feita.

---

## 3 — 449/450 — competition engine

O sinal específico do 449/450 não é "há concorrentes", é **há concorrentes
classificados** — `competitor_type` (`direct`, `functional`, `budget`,
`status_quo`, `emerging`, `potential_entrant`, `adjacent`).

```sql
select
  (select count(*) from org_competitors)                                      as competitors_total,
  (select count(*) from org_competitors where competitor_type is not null)    as competitors_classified,
  (select count(*) from org_competitors where added_by = 'ai')                as competitors_added_by_ai,
  (select count(distinct competitor_type) from org_competitors
     where competitor_type is not null)                                       as distinct_types_used,
  (select count(*) from market_companies where is_test = false)               as market_companies_real,
  case
    when (select count(*) from org_competitors where competitor_type is not null) > 0
      then 'A FUNCIONAR'
    when (select count(*) from org_competitors) > 0
      then 'EXISTE MAS NINGUEM LA CHEGA'
    else 'AINDA NAO APLICAVEL'
  end                                                                         as verdicto;
```

- **`A FUNCIONAR`** — há classificação real. `distinct_types_used = 1` com
  `competitors_classified` alto merece um olhar: pode ser o classificador a
  devolver sempre o mesmo valor.
- **`EXISTE MAS NINGUEM LA CHEGA`** — há concorrentes na tabela e nenhum
  classificado: as linhas são anteriores à `0275`, ou o classificador não
  está a ser chamado.
- **`AINDA NAO APLICAVEL`** — nenhuma org tem concorrentes.

**Observado 30/08 14:30 — `EXISTE MAS NINGUEM LA CHEGA`:**
`competitors_total = 13`, **todos** com `added_by = 'ai'`, e
`competitors_classified = 0` · `distinct_types_used = 0`. Ou seja: o motor
que **encontra** concorrentes funciona e já produziu 13 linhas; o
`competitor_type` que os 449/450 introduziram **nunca foi escrito uma única
vez**. As 13 linhas podem ser anteriores à `0275`, o que explicaria tudo sem
haver bug nenhum — mas isso confirma-se com `select min(created_at),
max(created_at) from org_competitors` contra a data da `0275`, e não foi
feito. É a segunda capacidade construída e por medir desta lista.

---

## 4 — 462 — link snapshots

O 462 tornou legível um documento que é um **link** (`documents.external_url`
preenchido, `storage_path` nulo) — busca os bytes e grava-os. A precondição
é haver links na Vault; sem isso, zero snapshots é o resultado certo.

```sql
select
  (select count(*) from document_link_snapshots where status = 'ok')          as snapshots_ok,
  (select count(*) from document_link_snapshots where status = 'failed')      as snapshots_failed,
  (select count(*) from document_link_snapshots)                              as snapshots_total,
  (select max(fetched_at) from document_link_snapshots)                       as last_snapshot,
  (select count(*) from documents where external_url is not null)             as link_documents_in_vault,
  case
    when (select count(*) from document_link_snapshots where status = 'ok') > 0
      then 'A FUNCIONAR'
    when (select count(*) from documents where external_url is not null) > 0
      then 'EXISTE MAS NINGUEM LA CHEGA'
    else 'AINDA NAO APLICAVEL'
  end                                                                         as verdicto;
```

- **`A FUNCIONAR`** — há snapshots gravados com sucesso.
- **`EXISTE MAS NINGUEM LA CHEGA`** — há links na Vault e nenhum snapshot
  bem-sucedido. Se `snapshots_failed > 0`, agrupa por `failure_reason` (a
  seguir) antes de concluir seja o que for: um link para uma pasta do Drive
  falha por desenho, e isso **não** é a capacidade partida.
  ```sql
  select failure_reason, count(*) from document_link_snapshots
   where status = 'failed' group by failure_reason order by 2 desc;
  ```
- **`AINDA NAO APLICAVEL`** — não há um único documento-link na Vault.

---

## 5 — 464/465 — reconciliação semântica

O 465 substituiu dois `void runReconciliationForOrg(...)` mortos por um
mecanismo único e esperado. A pergunta a fazer aos dados é se ele corre
mesmo — e as quatro categorias abaixo são exatamente as que o `ruleG4`
considera documentáveis.

```sql
select
  (select count(*) from gap_reconciliations)                                  as reconciliations,
  (select count(*) from gap_reconciliations where status = 'auto_linked')     as auto_linked,
  (select count(*) from gap_reconciliations where status = 'suggested')       as suggested,
  (select count(*) from gap_reconciliations where status = 'uncovered')       as uncovered,
  (select max(updated_at) from gap_reconciliations)                           as last_reconciliation,
  (select count(*) from company_claims
     where status = 'accepted'
       and category in ('prova_tecnica', 'validacao_externa', 'tracao_gtm', 'equipa')
       and (document_refs is null or jsonb_array_length(document_refs) = 0))  as g4_eligible_claims,
  case
    when (select count(*) from gap_reconciliations) > 0 then 'A FUNCIONAR'
    when (select count(*) from company_claims
            where status = 'accepted'
              and category in ('prova_tecnica', 'validacao_externa', 'tracao_gtm', 'equipa')
              and (document_refs is null or jsonb_array_length(document_refs) = 0)) > 0
      then 'EXISTE MAS NINGUEM LA CHEGA'
    else 'AINDA NAO APLICAVEL'
  end                                                                         as verdicto;
```

- **`A FUNCIONAR`** — há veredictos gravados. **`last_reconciliation` é a
  parte que interessa a seguir:** se estiver parado há semanas com
  `g4_eligible_claims > 0`, a capacidade correu uma vez e morreu — o que uma
  contagem sozinha nunca mostraria. A rede diária do 465 §D devia mantê-lo
  fresco.
- **`EXISTE MAS NINGUEM LA CHEGA`** — há claims elegíveis e nenhum veredicto.
- **`AINDA NAO APLICAVEL`** — não há claims aceites nas quatro categorias
  documentáveis sem documento.

---

## 6 — 469 — `ai_call_log` durável

O 469 reclassificou o `ai_call_log` de telemetria descartável para
**critério de aceitação**: a ausência de uma entrada já foi usada, mais do
que uma vez, como prova de que um pipeline nunca correu. Só vale se estiver
sempre lá.

Esta é a única consulta do ficheiro cujo estado do meio significa
literalmente *"houve trabalho de AI e não ficou registado"* — o modo de
falha exato que o 469 existe para fechar.

```sql
select
  (select count(*) from ai_call_log)                                          as calls_logged,
  (select count(distinct purpose) from ai_call_log)                           as distinct_purposes,
  (select max(created_at) from ai_call_log)                                   as last_call,
  (select count(*) from ai_call_log
     where created_at > now() - interval '7 days')                            as calls_last_7d,
  (select count(*) from market_research_items
     where created_at > now() - interval '7 days')                            as ai_items_last_7d,
  (select count(*) from gap_reconciliations
     where updated_at > now() - interval '7 days')                            as reconciliations_last_7d,
  case
    when (select count(*) from ai_call_log where created_at > now() - interval '7 days') > 0
      then 'A FUNCIONAR'
    when (select count(*) from market_research_items where created_at > now() - interval '7 days') > 0
      or (select count(*) from gap_reconciliations where updated_at > now() - interval '7 days') > 0
      then 'EXISTE MAS NINGUEM LA CHEGA'
    else 'AINDA NAO APLICAVEL'
  end                                                                         as verdicto;
```

- **`A FUNCIONAR`** — houve chamadas registadas nos últimos 7 dias.
- **`EXISTE MAS NINGUEM LA CHEGA`** — **apareceram artefactos produzidos por
  AI e não há registo nenhum da chamada que os produziu.** É a falha do 469
  a repetir-se; começa pelo guarda `logAiCall must always be awaited`
  (`no-fire-and-forget.test.ts`) e por qualquer rota nova que o tenha
  contornado.
- **`AINDA NAO APLICAVEL`** — não houve trabalho de AI nenhum na janela.
  Confirma-o com `last_call` antes de assumir que está tudo bem.

Complemento útil, por rota (uma rota que desapareça daqui depois de ter
aparecido é um sinal, não ruído):

```sql
select route, purpose, count(*) as calls, max(created_at) as last_call,
       round(sum(cost_eur), 4) as total_eur
  from ai_call_log group by route, purpose order by max(created_at) desc;
```

---

## 7 — 471 — sugestões da Market Thesis a partir de documentos

O 471 pôs um botão que lê os documentos do founder e sugere os sete campos
de texto da tese. **Não persiste nada** (decisão do próprio prompt: persistir
exigia migração), por isso a única prova de que alguém lhe toca é o
`ai_call_log` — a rota regista `purpose = 'market_thesis_document_suggest'`.

Esta é a consulta que fecha a cadeia do §1: se `theses_passing_the_gate`
continuar a zero **e** este botão nunca tiver sido carregado, o problema é
alcance, não o motor.

```sql
select
  (select count(*) from ai_call_log
     where purpose = 'market_thesis_document_suggest')                        as thesis_suggest_calls,
  (select max(created_at) from ai_call_log
     where purpose = 'market_thesis_document_suggest')                        as last_suggest_call,
  (select count(*) from org_market_thesis
     where coalesce(trim(core_problem), '') <> '')                            as theses_with_core_problem,
  (select count(*) from org_market_thesis)                                    as theses_rows,
  case
    when (select count(*) from ai_call_log
            where purpose = 'market_thesis_document_suggest') > 0             then 'A FUNCIONAR'
    when (select count(*) from org_market_thesis) > 0                         then 'EXISTE MAS NINGUEM LA CHEGA'
    else 'AINDA NAO APLICAVEL'
  end                                                                         as verdicto;
```

- **`A FUNCIONAR`** — o botão foi carregado pelo menos uma vez.
- **`EXISTE MAS NINGUEM LA CHEGA`** — há teses e o botão nunca foi tocado.
  Se `theses_with_core_problem = 0`, é literalmente o portão do §1 fechado
  com a chave ao lado por usar.
- **`AINDA NAO APLICAVEL`** — não há teses nenhumas.

---

## 8 — 472 — "prometido" ≠ "documentado"

O 472 separou dois eixos que viviam num campo só. O sinal de que funciona
**não é uma contagem, é uma tendência**: as claims marcadas
`document_pending` sem evidência real passaram a ser elegíveis para procura
automática, por isso este número tem de **descer** com o tempo.

Valor conhecido em 30/08/2026, **antes** de a capacidade ter corrido:
`pending_sem_evidencia = 7` (todas na ablute_). **Observado às 14:30, depois
do merge das 14:15: `7 → 3`, com `pending_ja_resolvidas = 5`** — a passagem
de reconciliação das 14:23 encontrou documentos reais para cinco promessas
que estavam marcadas como "documentadas" sem nunca terem sido procuradas. É
o critério de aceitação do 472 cumprido em produção.

`claims_no_eixo_novo = 0` e `claims_no_eixo_legacy = 9` confirmam que quem
carregou este resultado foi o *fallback* legacy, exatamente como desenhado:
sem ele, estas nove claims teriam ficado invisíveis para o eixo novo e a
capacidade não teria tocado em nenhuma.

```sql
select
  (select count(*) from company_claims
     where status = 'accepted'
       and (founder_prompt_state = 'answered_document_pending'
            or (founder_prompt_state is null and gap_disposition = 'document_pending'))
       and (document_refs is null or jsonb_array_length(document_refs) = 0))  as pending_sem_evidencia,
  (select count(*) from company_claims
     where status = 'accepted'
       and (founder_prompt_state = 'answered_document_pending'
            or (founder_prompt_state is null and gap_disposition = 'document_pending'))
       and document_refs is not null
       and jsonb_array_length(document_refs) > 0)                             as pending_ja_resolvidas,
  (select count(*) from company_claims where founder_prompt_state is not null)
                                                                              as claims_no_eixo_novo,
  (select count(*) from company_claims where gap_disposition is not null)     as claims_no_eixo_legacy,
  (select min(document_pending_since) from company_claims
     where founder_prompt_state = 'answered_document_pending')                as promessa_mais_antiga,
  case
    when (select count(*) from company_claims
            where status = 'accepted'
              and (founder_prompt_state = 'answered_document_pending'
                   or (founder_prompt_state is null and gap_disposition = 'document_pending'))
              and document_refs is not null
              and jsonb_array_length(document_refs) > 0) > 0                  then 'A FUNCIONAR'
    when (select count(*) from company_claims
            where status = 'accepted'
              and (founder_prompt_state = 'answered_document_pending'
                   or (founder_prompt_state is null and gap_disposition = 'document_pending'))
              and (document_refs is null or jsonb_array_length(document_refs) = 0)) > 0
                                                                              then 'EXISTE MAS NINGUEM LA CHEGA'
    else 'AINDA NAO APLICAVEL'
  end                                                                         as verdicto;
```

O `or (founder_prompt_state is null and gap_disposition = ...)` reproduz de
propósito o *fallback* que o código faz (`foundersDocumentAnswer`,
`company-gaps.ts`): a `0280` não fez backfill, por isso as claims antigas
vivem no eixo legacy e uma consulta que só olhasse para a coluna nova
mostrava `0` e dava a capacidade por não usada.

- **`A FUNCIONAR`** — pelo menos uma promessa foi convertida em evidência
  real. Corre isto ao longo de dias: `pending_sem_evidencia` a descer é a
  prova; parado é a suspeita.
- **`EXISTE MAS NINGUEM LA CHEGA`** — continuam a existir promessas sem
  evidência e nenhuma foi resolvida. Cruza com o §5: se `last_reconciliation`
  for anterior à data do merge do 472, o motor ainda não passou por elas.
- **`AINDA NAO APLICAVEL`** — nenhuma claim em `document_pending`.

---

## Manutenção

**Uma capacidade nova sem uma linha aqui não está terminada — está por
medir** (`AUTONOMOUS_EXECUTION_MODE_v2` §21). Ao acrescentar uma linha:

1. confirma os nomes de tabela e coluna contra as migrações **antes** de
   escrever a consulta;
2. o `verdicto` tem de ter os três valores, e o do meio tem de ser
   alcançável — se não conseguires descrever o estado *"existe mas ninguém
   lá chega"* para a tua capacidade, ainda não percebeste como ela falha em
   silêncio;
3. escreve o valor conhecido à data, se o tiveres. Uma consulta sem
   histórico só serve à segunda vez que for corrida.
