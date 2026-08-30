# Fila de execução — Sherlock Deal

**Local canónico:** `docs/execution-queue.md` no repositório `connectB`.
**Atualizado:** 30/08/2026 (15:20 — 473 em `main`, migração `0281` aplicada)
**Lê-se com:** `AUTONOMOUS_EXECUTION_MODE_v2` (o §0 desse documento aponta
para este ficheiro).

---

## REGRA ZERO — o que te é permitido executar

Cada entrada desta fila tem uma etiqueta de elegibilidade. **Só duas são
executáveis:**

| Etiqueta | Significa |
|---|---|
| `READY — prompt entregue` | existe um prompt escrito; executa-o |
| `READY — especificado aqui` | não há ficheiro de prompt, mas **esta entrada contém os critérios completos**; executa-a a partir daqui |
| `NO_PROMPT — não executar` | contexto apenas. **Não implementes.** A especificação ainda não existe |
| `WAITING_HUMAN` / `WAITING_VERIFIER` | ver o estado |

**Uma entrada `NO_PROMPT` nunca é executável, por mais claro que te pareça
o que é preciso fazer.** Essas entradas existem para saberes para onde o
projeto vai — não para as construíres a partir de uma linha de tabela.
Inventar a especificação a partir do título é o modo de falha exato que
este ficheiro existe para prevenir.

Se esgotares as entradas executáveis: **para**, com o relatório. Isso é uma
condição de STOP legítima (§18-A), não um fracasso.

---

## Estado atual

| # | Trabalho | Elegibilidade | Estado | Depende de |
|---|---|---|---|---|
| 467+v3 | `market_facts` tipados | — | `DONE` — `79e5e2c` em `main` | — |
| G1 | Migração `0279` | — | `DONE` — aplicada e verificada por SQL 30/08 | — |
| 468 | Passagem que cobra e diz que falhou | — | `DONE` — `c26e61d` | — |
| 469 | `ai_call_log` durável | — | `DONE` — `feaad58` | — |
| 470 | Merge do 467 + §C do 468 | — | `DONE` — `49b1595` | — |
| 471 | Destravar as hipóteses | — | `DONE` — `5e99175`. **G2 PASSOU**: 3 hipóteses em produção | — |
| **D1** | `no-floating-promises` no lint | `READY — especificado aqui` | `DONE` — 1 violação real corrigida | — |
| **D2** | `blueprint/reconcile` → `reconciliation/run` | `READY — especificado aqui` | `DONE` — delega; sem caminho próprio | — |
| **D3** | Consulta de alcance por capacidade | `READY — especificado aqui` | `DONE` — `docs/capability-reach.md` | — |
| 472 | Ponto D — dois eixos do `gap_disposition` | — | `DONE` — `1404513` em `main`, **provado em produção (7 → 3)** | — |
| **473** | *Suggest from your documents* dispara sozinho | `READY — prompt entregue` | `DONE` — `c72a6ad` em `main`; migração `0281` **aplicada e verificada** | — |
| **478** | Classificador de concorrência chega aos documentos | `READY — prompt entregue` | `DONE` — `a1bfa4c` em `main`; sem migração | — |
| ~~473~~ **477** | Consolidar os dois vocabulários `FactStatus` | `NO_PROMPT — não executar` | — | prompt |
| 474 | Bloco 2 no ecrã (factos tipados visíveis) | `NO_PROMPT — não executar` | — | 471 + prompt |
| 475 | Invariável 6 — visibilidade que propaga | `NO_PROMPT — não executar` | — | prompt |
| 476 | Lock por organização (465 §F.3) | `NO_PROMPT — não executar` | — | decisão de desenho |
| — | Bloco 5 / milestone D — derivações | `NO_PROMPT — não executar` | — | prompt + migração |
| — | Bloco 4 — Capital Landscape | `NO_PROMPT — não executar` | — | **decisão de produto** (fontes) |
| G2 | Aceitação visual na app | — | `DONE` — 30/08 14:17, 3 hipóteses criadas | — |

**Ordem recomendada:** ~~merge do 472 → D3 → D1 → D2~~ — **tudo feito**, e o
473 entregue depois disso também. Não resta nenhuma entrada executável: as
restantes são `NO_PROMPT` (contexto, não trabalho) e precisam de um prompt
ou de uma decisão de produto. Isso é a condição de STOP §18-A, não um
fracasso.

**Colisão de numeração, registada em vez de resolvida em silêncio:** esta
fila já tinha o número **473** reservado para a consolidação dos dois
vocabulários `FactStatus`, e o prompt que o Nuno entregou a 30/08 como 473
é outro (o disparo automático das sugestões por documento). O prompt
entregue fica com o 473 (é o que está no commit e no ficheiro do prompt); a
consolidação do `FactStatus` passa a **477**. Nada foi executado ao abrigo
do número errado — a entrada do `FactStatus` continua `NO_PROMPT`.

**Alcance real do 473, medido por SQL a 30/08 depois da `0281`** — e é o
achado que mais interessa desta tarefa: **a ablute_ não vai disparar**. A
tese da ablute_ ficou **completa** (os 7 campos preenchidos, `version` 5),
e "tese completa → não dispara" é o comportamento especificado. Das 11
orgs, **exatamente 2 podem disparar hoje** — `Caramel Biscuit` (2
documentos candidatos) e `Estojo` (1). As outras 8 não têm nenhum documento
que passe a heurística de nome/pasta. Consequência prática: **abrir a
ablute_ e não ver nada é o comportamento correto, não uma avaria** — para
ver o disparo é preciso uma org com tese incompleta e documentos.

**Próxima ação recomendada** (por ordem de retorno, e nenhuma delas é
executável sem prompt):
1. **Uma passagem de "Read my documents"** na app — 30 segundos, e é o que
   distingue "o 467 está inerte porque ninguém clicou" de "o desvio para
   `market_facts` não acontece". Ver `docs/capability-reach.md` §2.
2. **477** (era 473 nesta fila — ver a colisão de numeração acima) —
   consolidar os dois vocabulários de `FactStatus`. Bloqueia ligar
   a pesquisa web aos factos tipados, que é o que faria o §2 sair do
   estado do meio por uso real e não por um clique de teste.
3. **474** — pôr os factos tipados no ecrã. Existem na base de dados desde
   a `0279` e o founder nunca os vê.

**A migração `0280` está aplicada e verificada em produção** (colunas
nullable, sem default, zero backfill, 99 claims intactas, `gap_disposition`
inalterado). ~~O gate do 472 caiu: faz merge de `23aefa8` para `main` e
push~~ — **feito**: `1404513` em `main`, tsc/vitest 2463/build limpos no
estado merged.

**A fronteira de autonomia foi alargada** (decisão do Nuno, 30/08): `add
column` nullable, sem default e sem not-null passa a contar como
estritamente aditivo. Ver `AUTONOMOUS_EXECUTION_MODE_v2` §12 — está lá o
teste mecânico atualizado.

---

### O que a D3 mediu, no dia em que foi escrita (30/08 14:30)

`docs/capability-reach.md` tem as oito consultas. Duas capacidades saíram
com o verdicto do meio — **existem, estão em `main`, e ninguém lá chega**:

- **467 — factos tipados:** `market_facts = 0`, `market_evidence = 0`, com
  60 itens legacy de documentos. A `0279` está aplicada e o código em `main`
  desde hoje. **Uma única passagem de "Read my documents" depois do deploy
  de hoje** distingue "ninguém clicou ainda" de "o desvio não acontece". É a
  verificação mais barata que falta.
- **449/450 — competition engine:** 13 concorrentes, **todos** `added_by =
  'ai'`, e **zero** com `competitor_type`. Confirmar com
  `select min(created_at), max(created_at) from org_competitors` contra a
  data da `0275`: se as 13 linhas forem anteriores, não há bug nenhum.

As outras seis estão `A FUNCIONAR`, incluindo as duas mais recentes: o 471
(botão carregado às 14:17 → `core_problem` preenchido → **3 hipóteses**, o
primeiro valor não-zero de sempre) e o 472 (`pending_sem_evidencia` **7 →
3** às 14:23, com 5 promessas resolvidas com documentos reais).

**Achado sobre a cadeia toda:** 471 e 472 provaram-se em produção com 6
minutos de intervalo, e um destravou o outro. A reconciliação das 14:23 só
encontrou as cinco promessas porque o 472 as devolveu ao conjunto elegível
— e só correu porque o founder abriu o Blueprint depois do G2 do 471.

---

## 471 — Destravar as hipóteses — `DONE`, e **provado em produção**

`5e99175` em `main`, verificado de forma independente (tsc, vitest 2457,
build, diff contra o prompt). ~~Falta só o gate humano G2 de trinta
segundos.~~ **O G2 passou a 30/08 às 14:17.**

**Consulta de alcance (§21):**
```sql
select count(*) from org_market_hypotheses;
```
Esperado depois do G2: **> 0**. Valor a 30/08 14:30: **3** — o primeiro
valor não-zero desde que a cadeia 444→457 existe.

**Achado menor, para um prompt futuro:** a resposta da rota traz `skipped`,
mas o ecrã não o mostra. Com 3 de 5 documentos ilegíveis, o founder lê
"Read 2 documents" e "Not found in your documents" sem saber que três nem
foram lidos — a mesma classe de legenda desonesta que o 463 §B corrigiu na
passagem de mercado.

---

## 472 — Ponto D: "prometido" ≠ "documentado" — `DONE`

`READY — prompt entregue`. Ficheiro:
`prompt_472_prometido_nao_e_documentado_20260830.md`.

~~**TEM MIGRAÇÃO.** Commit no ramo, `WAITING_VERIFIER — migration ready`,
**não faças merge**~~ — a `0280` foi aplicada e verificada, o gate caiu, e
está em `main` como **`1404513`** (o commit do ramo era `23aefa8`; o
conteúdo é o mesmo, a mensagem perdeu a etiqueta `WAITING_VERIFIER` que já
não era verdade).

**Consulta de alcance (§21):**
```sql
select count(*) from company_claims
 where org_id = 'bca54499-03c8-469b-a48d-b9f442e44f69'
   and status = 'accepted' and gap_disposition = 'document_pending'
   and (document_refs is null or jsonb_array_length(document_refs) = 0);
```
Antes: **7**. A 30/08 14:30, depois da reconciliação das 14:23: **3**, com
5 promessas resolvidas com documentos reais. **Desceu — o mecanismo
funciona.** A versão completa da consulta (que também cobre o eixo novo
`founder_prompt_state`, não só o legacy) está em
`docs/capability-reach.md` §8.

---

## D1 — `@typescript-eslint/no-floating-promises` — `DONE`

Regra ligada em `.eslintrc.json` para `src/lib/**/*.ts` e
`src/app/api/**/*.ts`, com `parserOptions.project` (é uma regra que precisa
de tipos). **Uma única violação em todo o código de servidor**, corrigida —
não silenciada, e não foi acrescentado nenhum `eslint-disable` (os 4 que
existem em `src/lib` são todos `react-hooks/exhaustive-deps`, anteriores e
sem relação).

`src/lib/bars-evidence.ts:72` — `Promise.all([...]).then(...)` sem `.catch`.
Não era falso positivo: o `safeJson` engole a falha de cada `fetch`
individual, mas o agregador dentro do `.then` pode rebentar sozinho (uma
rota a responder 200 sem a chave esperada torna `access.sections` undefined,
e o `for...of` logo a seguir lança). O `.finally` **não** apanha rejeições —
re-lança — por isso ficava uma unhandled rejection **e** os candidatos da
org ANTERIOR no ecrã, porque o `setCandidates` nunca chegava a correr.

**Provado, não assumido:** um ficheiro-sonda temporário com uma promise a
flutuar fez o `npx next lint` simples (o mesmo que o `npm run lint` e o
`next build` correm) sair com erro. A regra está mesmo a ser aplicada, não
só quando se passa `--dir` à mão.

**Desvio, declarado:** o critério diz "código de servidor (`src/lib`,
`src/app/api`)". A regra ficou em `.ts`, **não** em `.tsx`. Medido antes de
decidir: incluir `.tsx` acrescenta **14 violações em exatamente dois
ficheiros** — `src/lib/onboarding/OnboardingProvider.tsx` (5) e
`src/lib/store-supabase.tsx` (9). Ambos são componentes React de cliente que
só por acaso vivem em `src/lib`; não são código de servidor, e uma aba do
browser não congela como uma resposta serverless (é o mesmo raciocínio pelo
qual o guarda do 465 §E nunca varre `src/components/`). Corrigir os 14 seria
um refactor da gestão de estado do cliente — exatamente o que o critério 4
manda não fazer sob a etiqueta de dívida técnica. **Ficam medidos e nomeados
aqui em vez de desaparecerem em silêncio**; se se quiser fechá-los, é um
prompt próprio, com âmbito de cliente.

`READY — especificado aqui`. Sem migração → merge e push próprios.

### Porquê
O guarda do 465 §E apanha `void <fn>(` por expressão regular sobre o texto
do ficheiro. Não apanha um `promise` deixado a flutuar sem `void` — por
exemplo `fn()` numa linha sozinha, ou um `.then()` sem `await` a montante.
A regra do compilador apanha a classe inteira; o guarda por regex apanha só
a forma que já vimos. **Os dois coexistem**: a regra é a rede larga, o
guarda é a rede fina com a mensagem de erro que explica porquê.

### Critérios, nas palavras deste ficheiro
1. `@typescript-eslint/no-floating-promises` **ligada** na configuração de
   lint, para código de servidor (`src/lib`, `src/app/api`).
2. **O guarda do 465 §E e o do 469 §C mantêm-se intactos.** A regra não os
   substitui. Se te apeteceu apagá-los porque "a regra já cobre", pára: as
   mensagens deles é que explicam a razão de produto, e a do 469 é
   deliberadamente inisentável.
3. Toda a violação que a regra encontrar é **corrigida**, não silenciada.
   Um `// eslint-disable` só é aceitável com razão escrita na linha
   anterior, e cada um desses casos vai listado no relatório.
4. Se o número de violações for grande ao ponto de tornar a tarefa um
   refactor em vez de uma correção: **para, marca `WAITING_HUMAN`**, e
   escreve quantas são e onde. Não faças um refactor de âmbito aberto sob
   a etiqueta de dívida técnica.

### Verificação
tsc + vitest + build + lint limpos. Os testes dos guardas do 465 e 469
continuam a passar.

**Consulta de alcance (§21):** a própria regra. Corre o lint, e o valor
esperado é zero violações não justificadas.

---

## D2 — `/api/blueprint/reconcile` passa a chamar `/api/reconciliation/run` — `DONE`

### Critério 1 — o que a `blueprint/reconcile` fazia que a outra não faz

Lido antes de mudar seja o que for. **Nada que se perca.** As diferenças,
lado a lado:

| | `blueprint/reconcile` (antes) | `reconciliation/run` |
|---|---|---|
| `assertNotViewer` | **não** | sim |
| `maxDuration` | por omissão | 60 |
| `try/catch` à volta do motor | não | sim |
| log do resultado | não | sempre |
| resposta | `{ok, ...ReconcileOutcome}` — inclui `costEur` | `{ok, ran, autoLinked, suggested, uncovered, reason}` |

A única coisa que a `blueprint/reconcile` fazia e a outra não é **devolver
`costEur` no corpo**. Não é uma diferença real de comportamento: o **único**
chamador é
`fetch('/api/blueprint/reconcile', {method:'POST'}).catch(() => {})`
(`store-supabase.tsx:1270`, no `renameDocument`) e **nunca lê o corpo**.
Tudo o resto são coisas que a `reconciliation/run` faz **a mais**, não a
menos — por isso não é caso de `WAITING_HUMAN`: não há nada a decidir entre
duas alternativas, há uma que é estritamente mais protegida.

**Uma mudança de comportamento, declarada:** um developer-viewer deixa de
poder disparar uma reconciliação paga ao renomear um documento
(`assertNotViewer` passa a aplicar-se aqui). Fecha uma falha, não remove uma
capacidade, e o caminho do founder fica igual — critério 3 cumprido.

### O que foi feito

A rota mantém o URL (nada de 404 para o chamador existente) e **delega**:
importa o handler da `reconciliation/run` e chama-o. Zero lógica duplicada.
`maxDuration` teve de ser re-declarado — config de rota do Next não viaja
com um handler importado, e sem isso esta rota ficaria com o orçamento curto
para o trabalho que reencaminha.

**Teste que prova que já não tem caminho próprio** (critério de verificação):
`reconciliation.test.ts` → `describe('reconciliation has exactly one
implementation (task D2)')`, 4 asserções ao nível do ficheiro — não chama
`runReconciliationForOrg`, delega mesmo, re-declara `maxDuration`, e a
`reconciliation/run` continua a ser a dona do mecanismo com
`assertNotViewer` e o probe de capacidade. Os comentários são despidos antes
de verificar a ausência: o teste apanhou o próprio cabeçalho da rota (que
explica em prosa o que ela **deixou** de fazer) — a mesma falsa positiva que
o `no-fire-and-forget.test.ts` já documenta.

**Por verificar, e porquê:** um POST real contra a rota já deployada não foi
exercitado — o build lista as duas rotas e os testes provam a delegação ao
nível do código, mas importar um handler entre rotas é um padrão que só o
runtime confirma a 100%. `TECHNICAL PASS — PRODUCTION GATE PENDING` nesse
ponto específico: renomear um documento na app e confirmar que
`gap_reconciliations` continua a crescer (a consulta de alcance abaixo).

**Achado adjacente, NÃO corrigido (fora do âmbito da D2):**
`reconciliation.ts:190` grava sempre `route: '/api/blueprint/reconcile'` no
`ai_call_log`, seja qual for a rota que despoletou — o cron e a
`reconciliation/run` incluídos. Já era enganador antes desta tarefa; agora
que o mecanismo vive na `reconciliation/run`, é claramente a etiqueta
errada, e o 469 elevou esta tabela a critério de aceitação. Correção
proposta, de uma linha: passar a rota real como parâmetro a
`callReconciliationModel` em vez da constante. Fica registado em vez de
corrigido em silêncio.

`READY — especificado aqui`. Sem migração → merge e push próprios.

### Porquê
O Prompt 465 substituiu o `void runReconciliationForOrg(...)` por um
mecanismo único e esperado: a rota `/api/reconciliation/run`, chamada pelo
cliente. Ficou registado no backlog que `/api/blueprint/reconcile` não foi
convertida na altura — continua a ser um segundo caminho para a mesma
operação.

**Dois caminhos para o mesmo trabalho é como o 465 nasceu.** Um deles
acaba sempre por divergir, e o que diverge é o que ninguém está a olhar.

### Critérios, nas palavras deste ficheiro
1. **Antes de mudar seja o que for**, lê `/api/blueprint/reconcile` e
   escreve no relatório o que ela faz hoje **que a `/api/reconciliation/run`
   não faz**. Se houver alguma coisa, isso é uma diferença real e a
   conversão não é uma substituição direta — nesse caso, `WAITING_HUMAN`
   com as duas listas lado a lado.
2. Se não houver diferença: a `blueprint/reconcile` passa a delegar no
   mecanismo único. **Não dupliques a lógica; chama-a.**
3. O comportamento visível ao founder **não muda**. Esta é uma consolidação
   interna, não uma alteração de produto.
4. O guarda do 465 §E continua a passar.

### Verificação
tsc + vitest + build limpos. Um teste que prove que a `blueprint/reconcile`
já não tem um caminho de reconciliação próprio.

**Consulta de alcance (§21):**
```sql
select count(*), max(created_at) from gap_reconciliations;
```
Esperado: continua a crescer depois da alteração — a consolidação não pode
ter desligado a reconciliação, que é exatamente o risco desta tarefa.

---

## D3 — Consulta de alcance por capacidade — `DONE`

Entregue em `docs/capability-reach.md`: oito capacidades (as seis pedidas +
471 e 472), cada uma com a consulta e um `verdicto` de exatamente três
valores. Ver "O que a D3 mediu" no topo deste ficheiro para os resultados e
os dois achados.

**Desvio, declarado:** o critério 4 diz *"não corras estas consultas contra
produção — não tens acesso"*. A premissa deixou de ser verdadeira (esta
sessão tem SQL de leitura via MCP), por isso as consultas foram corridas
**uma vez, em leitura**, para garantir que são SQL válido (o próprio
critério de verificação: *"uma consulta com uma coluna inventada é pior do
que nenhuma"*) e para registar o valor à data. O verificador continua a ser
quem as corre para efeitos de verificação independente.

`READY — especificado aqui`. Sem migração → merge e push próprios.

### Porquê
`select count(*) from org_market_hypotheses` devolvia **0 em todas as orgs**
com a cadeia 444→445→446→456→457 inteira em `main`, verificada, e inerte.
Duas semanas de trabalho a zero, e nada assinalou. Não havia como perguntar
*"isto está a ser usado?"* sem alguém se lembrar de escrever a consulta à
mão.

### Critérios, nas palavras deste ficheiro
1. Cria `docs/capability-reach.md` — uma tabela com uma linha por
   capacidade não trivial já entregue: **capacidade · consulta SQL ·
   valor esperado se estiver a funcionar**.
2. Cobre, no mínimo, as capacidades destes prompts: 444/445 (hipóteses),
   446/467 (factos tipados), 449/450 (competition engine), 462 (link
   snapshots), 464/465 (reconciliação), 469 (`ai_call_log`).
3. **Cada consulta tem de distinguir três coisas**, e diz qual é qual:
   *a funcionar* · *existe mas ninguém lá chega* · *ainda não aplicável*.
   Uma consulta que devolve 0 sem dizer qual dos três é não serve.
4. **Não corras estas consultas contra produção** — não tens acesso, e não
   é preciso. Escreve-as; o verificador corre-as.
5. É documentação, não código. **Zero alterações a `src/`.**

### Verificação
O ficheiro existe, tem as seis capacidades, e cada consulta é SQL válido
contra o esquema real (confirma os nomes de tabela e coluna no repositório
antes de escrever — uma consulta com uma coluna inventada é pior do que
nenhuma).

---

## Entradas `NO_PROMPT` — contexto, não trabalho

Estão aqui para saberes para onde isto vai. **Nenhuma é executável.**

- **473 — dois vocabulários de confiança:** o `FactStatus` do pipeline web
  e os dois eixos do pipeline de documentos coexistem. Consolidar **antes**
  de ligar a pesquisa web aos `market_facts`.
- **474 — Bloco 2 no ecrã:** os factos tipados existem na base de dados
  desde a `0279`; ainda não aparecem ao founder. Restrição do North Star:
  no primeiro corte, **só bottom-up**.
- **475 — invariável 6:** `evidence.visibility → fact.publishability →
  derivation.publishability → artifact.eligibility`. O North Star diz que
  tem de nascer agora — trivial hoje, brutal depois de dezenas de
  derivações dependerem dela.
- **476 — lock por organização:** a lacuna de concorrência do 465 §F.3.
  Tem escolhas de desenho reais.
- **Bloco 5 / milestone D:** derivações CONFIRMED/CHALLENGED/DISCOVERED/
  UNRESOLVED. O maior salto que falta.
- **Bloco 4 — Capital Landscape:** não existe; o 460 removeu
  players/rounds do menu. **Precisa de decisão de produto sobre fontes
  antes de qualquer prompt.**

---

## 473 — "Suggest from your documents" dispara sozinho — `DONE`

`c72a6ad` em `main`. Migração `0281` (duas colunas nullable, sem default,
sem backfill) **aplicada e verificada por SQL** a 30/08: as duas colunas
existem, `is_nullable = YES`, `column_default = null`, e a única tese
existente ficou intacta (conteúdo e `version` 5 inalterados).

**Consulta de alcance (§21):**
```sql
select
  count(*) filter (where document_suggest_auto_attempted_at is not null) as auto_tentadas,
  count(*) as theses_total
from org_market_thesis;
```
Valor atual: `auto_tentadas = 0`, `theses_total = 1`. Esperado depois de uma
org **com tese incompleta e documentos** abrir a página: `auto_tentadas > 0`.

**A ablute_ não serve para esse teste** (tese completa → não dispara, por
desenho). As duas orgs que disparam são `Caramel Biscuit` e `Estojo`.
Distinguir os três estados do §21:
- *a funcionar* → `auto_tentadas > 0`;
- *existe mas ninguém lá chega* → `auto_tentadas = 0` **e** existe pelo
  menos uma org com tese incompleta e documentos candidatos (hoje: 2);
- *ainda não aplicável* → nenhuma org com tese incompleta e documentos.

**Buraco residual, conhecido e deliberado:** um erro do fornecedor (502) não
grava a marca — o critério do prompt diz "sucesso ou *not found* honesto", e
gravar num 502 desligaria o disparo automático para sempre por causa de uma
falha transitória. O custo é que, durante uma indisponibilidade do
fornecedor, cada recarga da página volta a descarregar e a analisar os
documentos. Limitado pelo número de recargas; nenhuma chamada ao modelo é
paga.

**Achado para um prompt futuro (mesma família do que ficou registado no
471):** quando a passagem automática falha, o founder não vê nada — por
desenho, porque não foi ele que a pediu. Mas o caso "todos os documentos
ilegíveis" também fica silencioso, e aí havia mesmo algo útil a dizer. É a
mesma classe de legenda ausente que o 463 §B corrigiu e que o 471 deixou em
aberto com o `skipped`.

---

## 478 — o classificador de concorrência chega aos documentos — `DONE`

`a1bfa4c` em `main`. Sem migração (só o shape de `structured`, jsonb).

**Nasceu de um erro deste próprio repositório:** a D3 escreveu, em
`capability-reach.md` §3, uma hipótese benigna ("talvez sejam anteriores à
`0275`") e **não a verificou**. Era falsa para 10 dos 13. A regra que fica
está escrita lá: uma consulta de alcance no estado do meio ou traz a
hipótese verificada, ou diz que não foi verificada — nunca oferece um álibi
por verificar.

**Consulta de alcance (§21)** — a do prompt não corre como estava escrita
(`org_competitors` não tem `source_quality` nem chave para
`market_research_items`); mede-se onde a alteração cai:

```sql
select source_kind, count(*) as items,
       count(*) filter (where structured ? 'sherlockClassification') as classificados
from market_research_items where section = 'players' group by source_kind;
```

Estado a 30/08 17:20, antes de qualquer passagem nova: `document` **18 / 0**;
`web` 26 / 0. Esperado depois de um "Read my documents" novo: `document`
com `classificados > 0`, e daí `competitor_type` preenchido ao aceitar.

**Distinguir os três estados:** *a funcionar* → `classificados > 0` no
`document`; *existe mas ninguém lá chega* → itens `document` > 0 e
`classificados = 0` **depois** de uma passagem posterior a `a1bfa4c`;
*ainda não aplicável* → nenhum item `players` de documento.

**Os 26 itens `web` não são um segundo defeito:** são de 25/08 18:56,
anteriores ao 449/450. O caminho web nunca voltou a correr a secção
`players` desde então — o que correu hoje às 14:27 foram 10 itens
estruturados de outras secções. Ou seja, o caminho web também não tem prova
positiva em produção, e isso não é um bug: é falta de uma execução.

**Alteração de comportamento, declarada:** o portão de aceitação em
`research/respond/route.ts` recusa `NOT_COMPETITOR`/`UNRESOLVED`/
`STATUS_QUO`, e o comentário dele afirmava ser "a no-op" para itens de
documento. Deixou de ser. Um candidato de documento que o modelo descreva
bem o suficiente para ser classificado pode agora ser recusado, onde antes
era aceite com `competitor_type` nulo — que é o contrato do 449/450, não uma
regressão. Um documento sem facetos utilizáveis continua sem classificação e
continua a ser aceite exactamente como hoje (§5 do prompt). Comentário
corrigido no mesmo commit.
