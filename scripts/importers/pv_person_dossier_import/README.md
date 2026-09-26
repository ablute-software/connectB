# Importador de dossiê de pessoa (evidência + research_log) por entidade

Este importador lê um Excel de enriquecimento + um JSON "showcase" para uma
entidade (fundo/investidor) do `catalog_entities`, aplica regras
determinísticas de deduplicação, classificação e reconciliação, e produz SQL
de `INSERT` para `catalog_evidence` e `catalog_person_research_log`. Foi
construído e verificado com dados reais da Portugal Ventures (42 pessoas,
`entity_id = 7cddf0fb-2ee6-49f0-9379-ba6cd8777e22`), já importados em
produção em 2026-09-26 — ver `DECISIONS.md`.

**Verificação de fidelidade**: os 301 `content_hash` que este pipeline
gera a partir dos dados reais da PV coincidem, byte a byte, com os 301
`content_hash` hoje em produção. Não é uma reescrita especulativa — é o
mesmo comportamento do script original desta sessão, apenas separado em
funções puras testáveis + CLI.

## Dependências

Python 3.10+, `pandas`, `openpyxl` (leitura de `.xlsx`). Instalar com:

    pip install pandas openpyxl --break-system-packages   # ou num virtualenv

**Nota para quem integra no repositório**: o resto deste codebase é
TypeScript/Node (`scripts/*.mjs`). Este importador ficou em Python porque foi
assim que foi construído e verificado com dados reais; nenhuma
reescrita/porte para Node foi feita. Se a convenção do repositório exigir
Node, portar é trabalho novo — as funções em `lib.py` são pequenas e
puras, o porte é mecânico, mas alguém tem de o fazer e testar de novo antes
de confiar nele para o próximo fundo. Até lá, sugiro manter como utilitário
Python autónomo em `scripts/importers/pv_person_dossier_import/`, correndo
localmente (nunca em produção/CI automatizado sem revisão humana).

## Ficheiros

- `lib.py` — todas as regras puras (sem I/O): mapeamento `source_type` ->
  `evidence_kind`, classificador de `role_type`, parsing de datas
  (nunca adivinha), deduplicação, reconciliação de `research_log`,
  `relation_kind`, desambiguação de excerpt para o `content_hash`.
- `test_lib.py` — 39 testes `pytest` cobrindo as regras críticas (ver
  secção "Testes" abaixo). Correm em <1s, sem precisar de Excel/JSON reais
  nem de acesso à base de dados.
- `build_candidates.py` — Passo 1 (dry-run): lê Excel + showcase JSON +
  dump de evidência já existente em produção, produz `candidates.json`,
  `research_log_rows.json`, `person_id_map.json`, `dry_run_report.md`.
  **Nunca escreve na base de dados.**
- `generate_sql.py` — Passo 2: lê os JSON do passo 1, produz
  `import_evidence.sql` e `import_research_log.sql` (INSERTs em chunks).
  **Também não escreve na base de dados** — só gera texto SQL.

## Inputs esperados

- **Excel** (`--excel`): workbook com as folhas `EQUIPA_COMPLETA`,
  `DOSSIER_PESSOAS`, `CONTEUDO_PESSOAS`, `RELACOES_PESSOA_PORTFOLIO`,
  `FONTES` — mesmo layout do ficheiro usado para a PV
  (`enriquecimento_portugal_ventures_showcase_v2.xlsx`).
- **Showcase JSON** (`--showcase-json`): `{"people": [{"display_name",
  "catalog_person_id", "official_title", "career": [{"org","role","from",
  "to","source"}], "boards": [{"company","role","source"}], "education":
  [...], "statements": [{"text","source","date"}], "topics": [...],
  "not_found": ["texto livre descrevendo o que foi pesquisado e não
  encontrado"], "portfolio_tags_on_pv_site": [...], "member_page",
  "member_page_is_placeholder"}]}`.
- **Evidência já existente em produção** (`--existing-evidence-json`): dump
  de `select person_id, entity_id, kind, url from catalog_evidence where
  entity_id = '<entity-id>' and origin = 'import'` — usado só para
  deduplicação, nunca para decidir o que importar.

## Regras Excel vs. showcase

Quando o showcase tem a lista estruturada (`career`/`boards`/`education`),
essa é a fonte de verdade e o bloco de texto livre correspondente no Excel
(`DOSSIER_PESSOAS.carreira_resumo` / `.formacao`) é ignorado. Só quando o
showcase NÃO tem a lista estruturada é que o bloco de texto livre do Excel
entra — e nesse caso entra sempre como `kind='other'` (nunca
`role_history`/`education` com estrutura assumida), porque um bloco de texto
livre não decomposto não permite atribuir período nem `role_type` com
confiança.

## Dicionário `source_type` -> `evidence_kind`

Ver `DIRECT_MAP` em `lib.py` para o mapeamento directo (ex.: `interview` ->
`interview`, `podcast` -> `podcast`, `bio`/`professional_profile`/
`speaker_profile` -> `bio`). Casos condicionais em `resolve_evidence_kind()`:

- `board_role` -> sempre `role_history` + `role_type='board_advisory'`.
- `leadership_announcement` -> `press_release` se `source_first_party` for
  verdadeiro, senão `article_about`.
- `portfolio_pitch` / `founder_testimonial` -> `portfolio_relationship` se
  houver `companies_mentioned` preenchido, senão `talk_event`/`article_about`.
- `role_conflict` -> **nunca importado como facto**, fica só como nota de
  auditoria/curadoria (`audit_only`).
- qualquer `source_type` sem entrada -> excluído com razão explícita, nunca
  adivinhado.

## `role_history` / `role_type`

Classificador conservador (`classify_role_type()` em `lib.py`), aplicado
uniformemente a candidatos de carreira e de boards:

- sinais executivos/operacionais (CEO, diretor, gestor, "executivo(a)") ->
  `employment`.
- "não executivo", conselho fiscal/consultivo/supervisão -> `board_advisory`.
- título vazio, ou "conselho de administração"/"vogal" sem qualificador, ou
  um campo composto que mistura vários cargos num só texto -> `ambiguous`.
  **Nunca é forçado a `role_history`** — o candidato entra como
  `kind='other'`, `role_type=NULL`, com a razão da ambiguidade no `excerpt`.

## `portfolio_relationship`

Fonte primária: `RELACOES_PESSOA_PORTFOLIO` (curada), com `relation_kind`
(`professional_experience` vs. `indirect_responsibility`, por palavras-chave
— ver `classify_relation_kind()`) e `period_is_current` a partir de
`estado_relacao` (`CURRENT`/`HISTORICAL`/desconhecido -> `None`, nunca
adivinhado). Sinais brutos de portfolio do showcase
(`portfolio_tags_on_pv_site`) **não são importados** — ficam listados como
pendentes para reconciliação numa fase posterior.

## `catalog_person_research_log`

Regra central (bug 1 do importador original, corrigido — ver
`reconcile_research_log_for_person()` em `lib.py`):

1. Se há evidência actual (candidato novo OU já em produção) nesse scope ->
   `found`. **Evidência actual vence sempre** uma declaração antiga de
   ausência no mesmo scope.
2. Senão, se o material fonte prova explicitamente que este scope foi
   pesquisado e nada foi encontrado (`not_found` declarado no showcase,
   casado por palavras-chave contra o scope) -> `not_found`.
3. Senão (sem evidência E sem prova explícita de pesquisa) -> **nenhuma
   linha é criada**. Nunca se inventa `not_found` por omissão.

`not_public` não é atribuído automaticamente por nenhuma regra deste
importador — só deveria ser usado quando uma fonte pública real e citável
afirma explicitamente a não divulgação de um facto específico nesse scope; a
regra 3 acima nunca sobe para `not_public` por conta própria.

## Exclusões obrigatórias

- `relevance_to_sherlock_demo` (em `lib.NEVER_IMPORT_FIELDS`) — nunca
  importado como facto de evidência, seja qual for o `source_type` da linha.
- `role_conflict` — nunca importado como facto (ver acima); preservado só
  como nota de curadoria/auditoria, fora de `catalog_evidence`.
- Nenhuma informação privada/não citável: o importador só processa colunas
  do dicionário `source_type` acima; qualquer coluna ou `source_type` fora
  desse dicionário é excluída com razão explícita (nunca importada por
  omissão/adivinhação) — ver `test_unmapped_source_type_is_excluded_not_guessed`.

## Deduplicação

Duas camadas, ambas por chave determinística (nunca por semelhança
difusa/fuzzy):

1. **Candidato <-> candidato** (Excel vs. showcase): `(pessoa,
   url_normalizado)` quando há URL, senão `(pessoa, kind, texto normalizado
   dos primeiros 60 caracteres de title+excerpt)`. URL normalizado = sem
   esquema/`www.`/barra final.
2. **Candidato <-> produção**: `(person_id, url_normalizado)` contra a
   evidência já existente para essa pessoa em `catalog_evidence`
   (`origin='import'`). Um candidato que partilhe essa chave com uma linha
   já existente é descartado, não recriado.

## `content_hash` (identidade de produção)

`catalog_evidence.content_hash` é uma coluna gerada:
`md5(person_id || '|' || entity_id || '|' || url || '|' || md5(excerpt))` —
**não inclui `title` nem `kind`**. Candidatos sem `excerpt` próprio (só
`title`), ou com `excerpt` partilhado/boilerplate entre vários candidatos da
mesma pessoa, colidiriam nesta coluna apesar de serem factos distintos.
`generate_sql.py` corrige isto via `disambiguate_excerpt()` (nunca inventa
conteúdo — só reusa o `title` real dessa própria linha) antes de gerar o
INSERT.

## Datas — nunca adivinhadas

`parse_period()` e `normalize_published_at()` só produzem uma data exacta
quando a string de origem é inequívoca (`YYYY-MM-DD`, `YYYY-MM`, `YYYY`).
Qualquer range (`"2024/current"`), texto relativo (`"present"`, `"atual"`,
`"historical"`, `"undated"`) ou string não reconhecida nunca vira uma data
adivinhada — fica `None`, com o texto bruto preservado em
`provenance.raw_publication_date` / `date_parse_status`. As constraints de
BD `catalog_evidence_period_from_precision_pair` / `_to_precision_pair`
exigem `(data IS NULL) == (precisão IS NULL)`; `drop_orphaned_precision()`
larga uma etiqueta de precisão órfã (ex.: `"approximate"` sem data) em vez
de violar a constraint ou inventar uma data para a justificar.

## Como executar — dry-run (passo 1)

    python3 build_candidates.py \
      --excel /caminho/enriquecimento_<fundo>_showcase.xlsx \
      --showcase-json /caminho/showcase_dados.json \
      --existing-evidence-json /caminho/existing_evidence.json \
      --entity-id <uuid-da-entidade> \
      --out-dir ./saida_dry_run \
      --preview-people "Nome 1,Nome 2,Nome 3"

Produz `./saida_dry_run/{candidates.json, research_log_rows.json,
person_id_map.json, dry_run_report.md}`. **Ler `dry_run_report.md` e
confirmar `conflicting_research_log` vazio** antes de prosseguir — se não
estiver vazio, há um bug real de reconciliação e o passo 2 não deve correr.

## Como gerar o SQL (passo 2)

    python3 generate_sql.py \
      --in-dir ./saida_dry_run \
      --entity-id <uuid-da-entidade> \
      --out-dir ./saida_sql \
      --chunk-size 40 \
      --showcase-json /caminho/showcase_dados.json \
      --import-label "importacao_<fundo>_YYYYMMDD"

Produz `./saida_sql/{import_evidence.sql, import_research_log.sql}`.

## Como executar a importação real

Estes scripts **não têm credenciais de base de dados e não escrevem em lado
nenhum** — geram só ficheiros `.sql`. A execução real é feita por quem tem
acesso autorizado à produção, correndo os ficheiros gerados via
`mcp__Supabase__execute_sql` (um `INSERT` de cada vez, na ordem em que
aparecem no ficheiro — cada `INSERT` é atómico: se falhar, zero linhas dessa
instrução ficam gravadas, mas instruções anteriores já commitadas
permanecem) ou `psql`/`supabase db execute` equivalente. **Antes de correr
contra produção**: confirmar que `entity_id` já existe em `catalog_entities`
e que a checklist de verificação abaixo passou.

## Checklist de verificação antes de qualquer importação real

1. `dry_run_report.md` — `conflicting_research_log` vazio (nenhum
   `found`+`not_found` simultâneo para o mesmo par pessoa/scope).
2. Nenhuma linha de `research_log` sem rasto explícito de pesquisa
   (nenhuma `not_found` fabricada por omissão).
3. QA de `role_type`: rever a lista de títulos classificados como
   `board_advisory` e a lista de títulos ambíguos (`kind='other'`) no
   relatório — nenhum título claramente executivo deveria estar em nenhuma
   das duas listas.
4. Contagens de deduplicação plausíveis (nem zero suspeito, nem a totalidade
   dos candidatos marcada como duplicada).
5. Spot-check de 2-3 pessoas reais contra o `dry_run_report.md` antes de
   gerar SQL.
6. Depois de gerar o SQL: confirmar que o número de `INSERT` linhas bate
   certo com `len(candidates.json)` / `len(research_log_rows.json)`.
7. **Antes de correr em produção**: correr
   `select content_hash from catalog_evidence where entity_id = '<uuid>'
   and origin = 'import'` e confirmar que nenhum dos hashes do SQL gerado já
   lá está (evita erro de unicidade / execução dupla). Se a entidade já tiver
   sido parcialmente importada antes (aconteceu com a PV nesta sessão — ver
   `DECISIONS.md` de 2026-09-26), gerar o diff explicitamente por
   `content_hash`, nunca assumir por índice/posição de chunk.

## Testes

    cd scripts/importers/pv_person_dossier_import   # ou onde este importador ficar no repo
    python3 -m pytest -v test_lib.py

39 testes, cobrindo explicitamente (nomes de teste correspondem 1:1 aos
pedidos do Nuno):

- `test_no_evidence_and_no_explicit_search_produces_no_row` — ausência ≠
  `not_found`.
- `test_found_prevails_over_old_not_found_declaration` — `found` prevalece
  sobre uma declaração antiga de ausência.
- `test_executive_title_classifies_as_employment`,
  `test_non_executive_classifies_as_board_advisory`,
  `test_ambiguous_board_title_is_never_forced`,
  `test_compound_multi_role_field_is_ambiguous_not_forced` — `role_type`
  conservador, nunca forçado.
- `test_date_range_is_never_guessed`,
  `test_relative_or_undated_text_is_never_guessed`,
  `test_period_from_to_never_guesses_unparseable_string` — datas ambíguas
  nunca adivinhadas.
- `test_dedup_key_same_person_same_url_collides`,
  `test_dedup_vs_production_by_person_and_normalized_url` — deduplicação.
- `test_relevance_to_sherlock_demo_is_in_never_import_fields` —
  `relevance_to_sherlock_demo` nunca importado.
- `test_role_conflict_is_never_importable_as_fact` — `role_conflict` nunca
  importado como facto.
- `test_unmapped_source_type_is_excluded_not_guessed` — nenhuma informação
  fora do dicionário aprovado é importada por adivinhação.

Correr `pytest -v` antes de reutilizar este importador para qualquer novo
fundo/entidade, e antes de o alterar.
