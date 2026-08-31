# Fila de execução — Sherlock Deal

**Local canónico:** `docs/execution-queue.md` no repositório `connectB`.
**Atualizado:** 31/08/2026 (488; sem migração)
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
| ~~473~~ **477** | Consolidar os dois vocabulários `FactStatus` | — | **`CLOSED` — decisão: não unificar (30/08)**, `479` | — |
| **479** | Fechar o 477 com a decisão escrita no código | `READY — prompt entregue` | `DONE` — só comentários | — |
| 474 | Bloco 2 no ecrã (factos tipados visíveis) | `NO_PROMPT — não executar` | — | 471 + prompt |
| 475 | Invariável 6 — visibilidade que propaga | `NO_PROMPT — não executar` | — | prompt |
| ~~476~~ **480** | Lock por organização (465 §F.3) | `READY — prompt entregue` | `DONE` — `14c54f6`; migração `0282` **aplicada** | — |
| **481** | Bloco 4 — Capital Landscape | `READY — prompt entregue` | `DONE` — `40bebdc`; migração `0283` **aplicada** | — |
| **482** | Colisão de título engolia a classificação do 478 | `READY — prompt entregue` | `DONE` — `4c81be9`; sem migração | — |
| **483** | Concorrente já aceite recebe a classificação em falta | `READY — prompt entregue` | `DONE` — `d1339f0`; sem migração | — |
| **484** | "Read my documents" falhava antes de chegar ao modelo | `READY — prompt entregue` | `DONE` — `619d329`; sem migração | — |
| **485** | O tempo é da resposta, não da leitura do PDF | `READY — prompt entregue` | `DONE` — `7d9c083`; sem migração | — |
| **486** | Duas leituras pagas, zero efeito — instrumentação | `READY — prompt entregue` | `DONE` — `563b7a3`; sem migração; **espera medição** | — |
| **487** | Bloco 2 — Market Size lido dos factos que já existem | `READY — prompt entregue` | `DONE` — `cacb09c`; sem migração | — |
| **488** | Gama partida em dois + cartões zombie do pré-467 | `READY — prompt entregue` | `DONE` — `cea6d7c`; sem migração | — |
| — | Bloco 5 / milestone D — derivações | `NO_PROMPT — não executar` | — | prompt + migração |
| ~~—~~ | ~~Bloco 4 — Capital Landscape~~ | — | **decisão de produto tomada (30/08) → executado como 481** | — |
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
do número errado — a entrada do `FactStatus` **foi entretanto fechada pelo
479** (decisão de não unificar), sem nunca ter sido executada.

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
2. ~~**477** — consolidar os dois vocabulários de `FactStatus`.~~
   **`CLOSED` a 30/08 pelo 479: decisão de NÃO unificar.** Já não bloqueia
   nada — ligar a pesquisa web aos factos tipados deixou de depender de uma
   consolidação prévia, e se e quando isso se fizer, é aí que a decisão se
   revisita, com o caso concreto à frente.
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
  'ai'`, e **zero** com `competitor_type`. ~~Confirmar com `select
  min(created_at), max(created_at) from org_competitors` contra a data da
  `0275`: se as 13 linhas forem anteriores, não há bug nenhum.~~
  **Confirmado a 30/08, e havia bug:** só 3 das 13 são anteriores à `0275`;
  as outras 10 vieram de documentos, depois do classificador estar em
  produção. Causa e correção no **478** (`a1bfa4c`) e em
  `capability-reach.md` §3.

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

## 477 / 479 — os dois vocabulários de confiança — `CLOSED`

**Decisão do Nuno, 30/08: não unificar.** O `FactStatus`
(`VALIDATED_FACT`/`PARTIAL_FACT`/`CONFLICTING_FACT`/`INSUFFICIENT_FACT`, em
`market_research_items`, caminho web, lido pelo `computeVerdict` do
`market-assessment-engine.ts`) e o par `validation_status` /
`verification_status` do `market_facts` (caminho de documentos tipado, 467,
lido pelo `MarketFactsCard`) **coexistem de propósito**.

Razão, na frase do prompt: são consumidores diferentes já em produção;
unificar obrigaria a tocar no motor de veredictos do Bloco 5, que já
funciona, por um ganho hoje só estético.

**Isto é uma decisão, não um adiamento por falta de tempo** — e é essa a
diferença que faz o 477 fechar em vez de ficar `NO_PROMPT` para sempre a
tentar quem passar.

`479` (`main`) escreveu-a nos dois sítios onde alguém a vai encontrar
naturalmente: junto ao `FactStatus` e junto ao `VerificationStatus`. Zero
alteração de comportamento, zero alteração de tipos — só comentários.

**A decisão não é normativa** para código futuro que precise mesmo de
ligar os dois caminhos (o caso óbvio: pesquisa web a escrever directamente
em `market_facts`). Nesse dia revisita-se com o caso concreto à frente,
nunca em abstracto. Fechar o 477 assim serve para a pergunta não ser
reaberta em silêncio — não para proibir que um dia seja respondida de outra
maneira.

---

## Entradas `NO_PROMPT` — contexto, não trabalho

Estão aqui para saberes para onde isto vai. **Nenhuma é executável.**

- ~~**473/477 — dois vocabulários de confiança:** consolidar **antes** de
  ligar a pesquisa web aos `market_facts`.~~ **`CLOSED` a 30/08 (Prompt
  479): decisão de NÃO unificar.** Coexistem de propósito — consumidores
  diferentes, ambos já em produção, e consolidar arriscaria o motor de
  veredictos do Bloco 5 por um ganho hoje só estético. A decisão está
  escrita nos dois sítios do código (`market-intelligence-types.ts` junto
  ao `FactStatus`, `market-facts-db.ts` junto ao
  `VerificationStatus`) e **não é normativa** para o dia em que a pesquisa
  web precise mesmo de escrever em `market_facts`: aí revisita-se com o
  caso concreto à frente. **Nenhuma corrida autónoma deve reabrir isto por
  iniciativa própria.**
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
- ~~**Bloco 4 — Capital Landscape:** não existe; o 460 removeu
  players/rounds do menu.~~ **Executado como 481 (`40bebdc`).** E as duas
  premissas desta linha estavam erradas, o que só se soube ao verificar:
  o 460 **não** removeu por dados não fiáveis (removeu entradas de menu que
  apontavam para um painel estático — o commit dele diz que os cartões reais
  vivem no separador Market analysis), e o Bloco 4 **já existia** ali:
  `ComparableRoundsCard`, viva, com proveniência por item e duas fontes já
  fundidas no servidor. O 481 acrescentou a terceira (entrada manual) e os
  avisos obrigatórios, em vez de reconstruir.

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

---

## 480 — lock por organização na reconciliação — `DONE`

`14c54f6` em `main`. Migração `0282` (`reconciliation_locks`) **aplicada e
verificada**: tabela presente, RLS ligada, **zero políticas de propósito**
(só o service-role lhe toca), 0 locks órfãos.

**Consulta de alcance (§21):**
```sql
select count(*) as locks_orfaos_agora
from reconciliation_locks where locked_at < now() - interval '90 seconds';
```
Valor a 30/08: **0**. Deve andar sempre perto de zero; um valor
persistentemente alto significa reconciliações a rebentar sem libertar o
lock antes do auto-recovery de 90s entrar, e merece investigação própria.

**Dois desvios ao prompt, ambos por a realidade do deploy não bater certo
com o texto:**

1. **A `/api/blueprint` espera 2,5s, não 15s.** Essa rota **não declara
   `maxDuration`**, por isso corre no default da plataforma (10s no plano
   Hobby). Uma espera literal de 15s não degradaria com elegância — passava
   o orçamento da própria função e matava o carregamento do painel, e
   ainda por cima no chamador que o próprio prompt identifica como o mais
   provável de colidir (dois separadores abertos). O prompt diz "orçamento
   curto (ex.: até ~15s)" — exemplo, não mínimo. O resultado visível ao
   founder é idêntico: a resposta chega, com `reconciliationSkipped`.
2. **A `MarketDataPanel` não chama a `/api/blueprint`.** O prompt diz que
   os quatro painéis chamam; três chamam. A quarta chega à reconciliação
   pela `/api/reconciliation/run`. Os quatro têm o aviso, como o prompt
   quer — a rota por onde a bandeira chega é que difere num deles.

**Achado da passagem adversarial:** dois caminhos de retry no ciclo de
aquisição (a linha desapareceu entre o insert e a leitura; tomámos conta de
um lock obsoleto) saltam de propósito o orçamento de espera — o que também
significava que nenhum deles era limitado pelo prazo. Não é um spin quente
(cada passagem custa duas idas à base de dados), e é por isso que podia
ter passado despercebido. Limitado agora por um tecto de tentativas, com
teste próprio.

**Nota de risco, registada e não corrigida:** o cron varre as orgs em
série. Com o orçamento por omissão, 11 orgs × 15s dá 165s no pior caso, e a
`/api/automations` também não declara `maxDuration`. Na prática o cron corre
às 9h com a app parada, por isso os locks estão livres e a espera é zero —
mas se um dia o sweep começar a ficar incompleto, é aqui que se olha.

---

## 481 — Bloco 4: Capital Landscape — `DONE`

`40bebdc` em `main`. Migração `0283` (`org_capital_landscape_rounds`)
**aplicada e verificada**: tabela presente, RLS ligada, política
`is_org_member`.

**A verificação "o que existe hoje" que o prompt exigia contradisse as
premissas do próprio prompt** — e é o achado que mais interessa:
- o **460 não removeu por dados não fiáveis**; removeu entradas de menu que
  apontavam para um painel estático;
- o **Bloco 4 já existia**: `ComparableRoundsCard`, viva e renderizada, com
  duas fontes já fundidas no servidor (`market-rounds-merge.ts`) e
  proveniência por item;
- logo, a metade "pesquisa pública" do §1 é um mecanismo **que já corre**.
  O que faltava mesmo era a entrada manual e os avisos.

**Consulta de alcance (§21)** — adaptada ao esquema real (as três fontes
vivem em tabelas diferentes, por reutilização e não por duplicação):
```sql
select
  (select count(*) from org_capital_landscape_rounds where source='manual') as inseridos_a_mao,
  (select count(*) from market_research_items
     where section='rounds' and status='accepted')                          as de_fonte_publica,
  (select count(*) from investor_investments)                               as de_competidores_seguidos;
```
Valores a 30/08: **0 / 0 / 0** — `AINDA NAO APLICAVEL`, exactamente como o
prompt previu. Nota lateral: `investor_investments` a zero significa que
esta carta **sempre** mostrou o estado vazio; nunca houve rondas para ver.

**§6 verificado mecanicamente, não afirmado:** a tabela nova é lida por
exactamente duas rotas founder-only, nenhuma superfície de investidor lhes
chega, e o grupo `rounds` do `dossier-fetch` lê só `investor_investments`,
já atrás do portão de publicação `visibleGroups`.

---

## 482 — a colisão de título que engolia o 478 — `DONE`

`4c81be9` em `main`. **Sem migração** — é lógica de upsert.

**Como apareceu:** a verificação humana do 478 (Nuno, 30/08). Três leituras
de `Competitive_Landscape_and_Moat.docx.pdf`, três passagens reais pagas
(€0,141, €0,091, €0,091), **zero** linhas escritas, e a mensagem no ecrã a
dizer "Already read — nothing new". O modelo corria com o schema novo do
478 e todas as propostas colidiam com linhas deixadas por **outro**
documento (`"ablute_ investor deck"`, lido a 29/08, antes de o classificador
existir) — descartadas em silêncio pelo `ignoreDuplicates`.

**Três guardas, e cada uma foi medida antes de ser escrita:**

1. **A proposta tem de trazer classificação, verificado ANTES da leitura.**
   Nada a jusante pode agir sem ela, por isso uma proposta não classificada
   (ou de outra secção) custa exactamente o que custava antes: um upsert e
   mais nada. O teste assenta na **contagem de queries**, não num comentário.
2. **A linha existente tem de ser `source_kind='document'`.** Uma linha web
   carrega um veredicto inteiro derivado do seu **próprio** `structured` pelo
   `computeVerdict` — `fact_status`, `change_class`, `delta_type`,
   `comparison_baseline`, `implication_code/scope/direction`,
   `insight_confidence`, `promoted_to_insight` — mais `confidence`,
   `source_url`, `source_accessed_at` e `hypothesis_id`. Trocar o
   `structured` por baixo disso deixava **nove colunas a descrever dados que
   a linha já não tem**: uma mentira mais silenciosa e maior do que a que se
   está a corrigir. Medido em produção: as 10 linhas `players` de documento
   usam todas o template `Competitor: {nome}` deste caminho, e **0 das 26 de
   web** o usam — a colisão web/documento nunca aconteceu.
3. **A linha tem de estar `pending`**, na leitura e outra vez no `.eq` do
   próprio update (o founder pode aceitar entre as duas). Uma linha aceite já
   produziu o seu `org_competitors`; reescrever-lhe a evidência não muda nada
   visível, não actualiza o `competitor_type` (o §4 mantém o fluxo de
   aceitação intacto) e deixaria o item a citar um documento enquanto a linha
   de concorrente que ele criou cita outro.

**Nunca "a mais recente ganha":** ambas classificadas, ou nenhuma, e a linha
existente fica exactamente como estava. Uma leitura pior a substituir uma
melhor é o mesmo bug pelo outro lado (§2).

**Consulta de alcance (§21)** — a do prompt **não corre como está escrita**
(junta `org_competitors` a `market_research_items` só por `org_id`, e o
`org_competitors` não tem nenhuma coluna de proveniência). Versão corrigida e
valores em `docs/capability-reach.md` §3. Estado **antes** da correção:
`10 items de documento / 0 classificados / 13 concorrentes / 0 classificados`.
**Só muda com uma leitura nova** — o 482 não re-processa nada em massa, como
o próprio prompt exclui.

**DESVIOS AO PROMPT — três, todos declarados:**

1. **A guarda `source_kind='document'`** não está no prompt. O §1 diz "a
   linha existente" sem qualificar. Motivo acima; e nenhuma colisão
   web/documento existe em produção, medido.
2. **A guarda `status='pending'`** também não está no prompt, pelo §4: uma
   linha aceite não pode propagar a classificação para o `competitor_type`
   sem mexer no fluxo de aceitação, que o prompt proíbe.
3. **`run_signature` e `itemsEnriched` são acrescentos.** O prompt não os
   pede. O `run_signature` passa a acompanhar o enriquecimento porque a cache
   de extracção indexa por `(org, documento, run_signature)` e uma passagem
   cujo resultado foi só enriquecimento não deixava lá rastro nenhum — que é
   exactamente porque a mesma passagem foi cobrada três vezes. O
   `itemsEnriched` existe porque "Already read — nothing new" era a frase que
   o Nuno leu **enquanto pagava**; agora essa frase só aparece quando de
   facto nada mudou.

**Lacuna residual, registada e não corrigida:** uma linha `players`
**aceite** com `competitor_type` a null continua sem caminho para receber a
classificação — o §4 proíbe mexer na aceitação e o prompt exclui
re-processamento em massa. São 3 linhas em produção. Precisa de um prompt
próprio.

---

## 483 — o concorrente já aceite que nunca recebia a classificação — `DONE`

`d1339f0` em `main`. **Sem migração.**

Fecha a lacuna residual que o próprio relatório do 482 registou. A guarda 3
do 482 pára o enriquecimento em `status='pending'`, por isso um
`org_competitors` criado a partir de um item aceite **antes** de o
classificador existir ficava com `competitor_type` a null para sempre.
Produção a 31/08: **13 concorrentes, 13 com `competitor_type` a null** — 10
`pending` (que o 482 já sabe enriquecer, à espera de uma leitura nova) mais
**3 `accepted`** sem caminho nenhum.

**O §3 exigia confirmar a chave antes de desenhar a consulta — e a chave não
existe.** Verificado contra a migração `0246` e o `addOrUpdateCompetitor`: o
`org_competitors` tem `market_company_id` e **nada** que aponte de volta para
um `market_research_items`. A única ligação é a que o próprio caminho de
aceitação percorre:

```
structured.name (ou .company)
  -> findMatchingMarketCompany (domínio primeiro, depois lower(name))
    -> market_companies.id
      -> org_competitors.market_company_id      [único por org]
```

O `backfillCompetitorTypeFromClassification` volta a juntá-las percorrendo
**esse mesmo caminho com esse mesmo comparador** — nunca uma comparação de
nomes própria. Uma segunda noção de "a mesma empresa" é exactamente o bug
que o 384 §E colapsou num único caminho de escrita. A leitura é limitada aos
concorrentes **da org**, nunca uma varredura da biblioteca partilhada.

**Só muda o ramo `accepted` da guarda 3.** `rejected` continua a ser uma
decisão do founder e fica intacta, e a **linha de item aceite continua a não
ser reescrita** — está arquivada, não é servida a ninguém, e o `status` não
se mexe. A única coisa que muda é uma coluna a null num concorrente.

**Deliberadamente não tocados:**
- **`relation`.** É editável pelo founder (`competitors/route.ts`, acção
  `edit`, aceita `body.relation`), por isso voltar a derivá-la da nova
  classificação podia apagar em silêncio uma correcção feita à mão. O "nunca
  ao contrário" do §2 aplica-se-lhe com mais força do que ao
  `competitor_type`, que não tem caminho de edição nenhum.
- **Qualquer `competitor_type` já preenchido** (§2), garantido duas vezes:
  leitura primeiro, e `.is('competitor_type', null)` no próprio update.
- **`STATUS_QUO`, `NOT_COMPETITOR` e `UNRESOLVED`** nunca se tornam
  `competitor_type`: o primeiro é valor válido da coluna mas é um dos três
  que o portão de aceitação recusa; os outros dois nem sequer são valores
  válidos. O `isScoredClassification` reutiliza essa regra que já existia.

**Dois factos confirmados antes de escrever o código, e qualquer um deles
tornaria isto silenciosamente errado:** o join encaixado `market_companies`
devolve um **objecto** (é assim que o `research/route.ts` e o
`dossier-fetch` já o lêem, não uma lista); e o `competitor_type` **não é
seleccionado** pela rota de concorrentes que o founder vê, por isso
preenchê-lo não pode contradizer o `relation` mostrado ao lado.

**DESVIOS AO PROMPT — um, declarado:** o §2 diz que o preenchimento se faz
"a partir da linha `market_research_items` que o originou", o que se pode ler
como "a linha aceite ganha primeiro a classificação, e o concorrente é
preenchido a partir dela". Não é o que ficou: a linha aceite **não** é
reescrita (a guarda do 482 mantém-se) e a classificação vem da proposta que
a reclassifica, que é o que o §4 descreve mecanicamente. Consequência
registada: a linha arquivada continua com o `structured` antigo enquanto o
concorrente passa a ter a classificação. A operação é idempotente — na
passagem seguinte o `competitor_type` já não é null e nada acontece.

**Achado que interessa mais do que a própria tarefa:** o `competitor_type`
**não tem hoje um único leitor**. Nenhuma rota o selecciona para mostrar,
nenhum componente o renderiza — as únicas leituras no código são a sonda de
capacidade e este backfill. O 483 preenche uma coluna que ninguém vê. Isto
não invalida a tarefa (o prompt pede que seja preenchível, e a consulta de
alcance mede exactamente isso), mas é um `EXISTE MAS NINGUEM LA CHEGA` novo,
e fica escrito em vez de passar por sucesso. **Contraste com o 482:** o
caminho `pending` desse **aparece mesmo** — o `CompetitorsCard` lê
`structured.sherlockClassification` e agrupa por ela. O caminho `accepted`
deste não. Mostrar a classificação de um concorrente já aceite precisa de um
prompt próprio.

**Consulta de alcance (§21):**
```sql
select count(*) filter (where competitor_type is not null) as classificados,
       count(*) as total
from org_competitors;
```
Estado a 31/08, antes: **0 / 13**. Esperado depois do deploy **e de uma
leitura nova** do `Competitive_Landscape_and_Moat.docx.pdf`: os 3 `accepted`
passam a ter `competitor_type`. Os 10 `pending` só contam depois de o founder
os aceitar — já classificados, pelo 482.

| verdicto | significa |
|---|---|
| `A FUNCIONAR` | `classificados > 0` depois de uma leitura nova |
| `EXISTE MAS NINGUEM LA CHEGA` | `classificados > 0` **e** nenhuma superfície os mostra — **é o estado de hoje por construção**, ver o achado acima |
| `AINDA NAO APLICAVEL` | `total = 0` — a org não segue concorrentes nenhuns |

---

## 484 — a leitura que falhava antes de chegar ao modelo — `DONE`

`619d329` em `main`. **Sem migração.**

**O que a evidência mostra** (logs edge do Supabase + `ai_call_log`), e o
prompt pedia expressamente para não assumir:

- **A rota correu, das duas vezes.** O PDF descarregou **200 OK** às
  `05:09:30.323Z` e `05:14:16.275Z`; a sonda de capacidade `market_facts`
  (`05:14:16.493Z`) e a consulta de assinatura a `market_research_items`
  (`05:14:16.627Z`) correram logo a seguir. Isto **exclui** autenticação,
  a org, o documento em falta, o scan-gate e o download — e não há **um
  único** não-2xx em toda a janela.
- **Depois, nada.** Nenhum tráfego Supabase adicional para esse pedido,
  nenhuma linha em `ai_call_log`. A chamada ao modelo nunca voltou.
- O documento tem **189 KB**. O tamanho não é o problema.

**Porquê:** a chamada está no limite do orçamento e não tinha prazo
nenhum. Medido na última passagem **bem-sucedida** deste mesmo documento —
download `22:18:06.882Z` → linha em `ai_call_log` `22:18:47.348Z` —
**40,5 s de um tecto de 60 s**. Numa passagem de dois documentos, 43,7 s. O
`maxDuration=60` **é** o tecto do plano Hobby e não sobe sem mudar de plano,
por isso a rota corria a dois terços do limite sem margem nenhuma, e a
variação normal de latência do modelo mata-a. Quando morre não há corpo
JSON: o `res.json()` do painel rebenta e cai no `catch` exterior — que
mostra a mesma frase genérica que um `{ok:false, error}` estruturado. Duas
falhas diferentes, uma só mensagem, e nada na consola que as distinga.

**E porque piorou agora: o comprimento da resposta.** Antes do 478 uma
passagem devolvia **1634 / 1846 / 2647** tokens de saída. Todas as
passagens desde então devolveram **exactamente 4000** — o tecto do
`max_tokens`, atingido sempre. O 478 acrescentou cinco facetos por
concorrente, cada um com prosa livre, e este documento é precisamente um
*competitive landscape*. Bater no tecto significa também que **todas** essas
passagens ditas bem-sucedidas foram cortadas a meio do JSON sem o dizer em
lado nenhum.

**O que mudou:**

1. **A chamada passa a ter um prazo derivado do relógio da própria função**
   (`MAX_DURATION_MS - POST_MODEL_RESERVE_MS -` tempo já gasto). O primeiro
   rascunho usava 45 s fixos medidos no `fetch` e a **minha própria
   passagem adversarial** mostrou que isso não limita nada: o download e as
   sondas já gastaram parte dos 60 s. Se sobrar menos do que
   `MIN_MODEL_WAIT_MS`, a rota devolve já em vez de pagar por uma resposta
   que não pode chegar.
2. **Todas as saídas da chamada devolvem JSON real com mensagem real**, e
   registam qual falha foi — timeout e falha de rede separadamente, porque
   pedem respostas diferentes a quem lê o log.
3. **`stop_reason === 'max_tokens'` é registado** e viaja na resposta, para
   a próxima passagem dizer se a instrução de notas curtas trouxe mesmo a
   saída para baixo do tecto.
4. **Notas dos facetos limitadas a ~uma dúzia de palavras**, no schema e no
   system prompt. É correcção de latência, não de estilo.
5. **O painel lê o corpo como texto e faz `JSON.parse` defensivo**: os três
   casos — não é JSON, falha estruturada, e o pedido rebentar — passam cada
   um a ter o seu `console.error`. **O texto mostrado ao founder não muda**,
   como o §5 pede.

**DESVIOS AO PROMPT — um, e é uma coisa que NÃO consegui fazer:** o §1 pede
os **logs reais do Vercel**. O CLI do Vercel não existe neste ambiente
(`which vercel` → nada, sem `~/.vercel`, sem `VERCEL_TOKEN`), por isso
**não tenho uma linha de log do Vercel a nomear o timeout**. O que está
acima é o que o Supabase e o código conseguem provar, e exclui todos os
outros candidatos que o próprio prompt listou. A correcção torna a próxima
ocorrência auto-explicativa de qualquer maneira.

**Consulta de alcance (§21):**
```sql
select created_at, tokens_in, tokens_out, cost_eur
from ai_call_log
where route = '/api/market-data/document-extract'
order by created_at desc limit 5;
```
| verdicto | significa |
|---|---|
| `A FUNCIONAR` | há linha nova **e** `tokens_out < 4000` — a passagem completou-se sem ser cortada |
| `EXISTE MAS NINGUEM LA CHEGA` | há linha nova mas `tokens_out = 4000` — voltou a ser cortada; a instrução de notas curtas não chegou e é preciso outra medida (menos secções por chamada) |
| `AINDA NAO APLICAVEL` | continua sem linha nova — então **não era** o timeout, e o `console.error` novo do painel diz agora qual dos três casos é |

**Verificação humana que fica pendente:** correr "Read my documents" com o
`Competitive_Landscape_and_Moat.docx.pdf` sozinho. Passe ou falhe, desta vez
há sempre rasto: ou uma linha em `ai_call_log`, ou uma mensagem específica
no ecrã, ou uma linha na consola do browser a dizer qual dos três casos foi.

---

## 485 — o tempo é da resposta, não da leitura do documento — `DONE`

`7d9c083` em `main`. **Sem migração.**

**A hipótese do prompt estava ao contrário, e são duas medições que o
mostram.** O §2 supunha que o tempo se ia a **ler** o PDF e propunha baixar
o `MAX_EXTRACTION_PAGES`. Duas linhas do `ai_call_log` de 30/08:

```
21:52:47.871  document-extract    31 725 in / 4 000 out
21:52:48.590  document-extract   157 444 in / 4 000 out
```

Duas chamadas concorrentes, **cinco vezes** de diferença no input, a
terminar **a 0,72 s uma da outra**. Se fosse a leitura a mandar no relógio,
a segunda teria acabado muitos segundos depois. E na direcção contrária, na
mesma noite e com o mesmo tecto de 60 s:

```
21:51:53.074  market-thesis/suggest-from-documents  155 915 in / 652 out
```

**4,75× o input** da chamada que estoura, e volta à vontade — porque gera
652 tokens em vez de 4 000.

**Logo o relógio é da saída.** Baixar as páginas encolhia a variável que não
está a limitar. O que limita é o `max_tokens`, que esta rota bate
**exactamente** — 4000/4000/4000/4000 em todas as passagens desde o 478 —
o que também quer dizer que todas elas foram cortadas a meio do JSON sem o
dizer.

**O ritmo**, da única cronometragem limpa: download `22:18:06.882Z` → linha
`ai_call_log` `22:18:47.348Z` = 40,5 s para 4 000 tokens ⇒ ~100 tokens/s
**no melhor caso**. Pedir 4 000 tokens dentro de um orçamento de ~45 s é
pedir ~40 s de geração ao melhor ritmo alguma vez observado — e não há
melhor caso todos os dias. Foi por isso que o prazo real do 484 disparou em
vez de a chamada voltar.

**O que mudou:** o `max_tokens` passa a ser **derivado do que sobra do
orçamento**, a um ritmo deliberadamente mais lento do que qualquer um
medido (`0,07 tok/ms` contra `~0,099` observado), preso a `[1500, 4000]` e
**nunca acima** do que a rota já pedia — um pedido maior é uma chamada mais
lenta. O `MIN_MODEL_WAIT_MS` deixou de ser um número redondo e passou a
estar amarrado à mesma aritmética: abaixo do orçamento em que o piso de
saída se torna pagável, a rota recusa começar em vez de construir um pedido
que não pode cumprir o próprio prazo. E o system prompt passa a pedir os
achados mais importantes primeiro, para que o corte, quando bater, perca a
cauda menos importante em vez do que calhar.

**Tudo o que o 484 garantiu fica intacto** (§4): JSON real em qualquer
saída, reserva pós-modelo, e `stop_reason === 'max_tokens'` registado —
agora com `maxTokens` e `tokensOut` ao lado, para a próxima passagem dizer
se o tecto novo ainda bate.

**A troca, dita e não enterrada:** uma passagem passa a reportar **menos
achados** em troca de **voltar mesmo**. É exactamente o critério de
aceitação do §5 ("uma chamada que **voltou** dentro do prazo").

**DESVIOS AO PROMPT — dois:**
1. **Não baixei o `MAX_EXTRACTION_PAGES`** nem dividi a chamada em duas — as
   duas opções que o §2 oferecia. A evidência do §1 diz que nenhuma delas
   ataca a variável que limita. Dividir em duas chamadas sequenciais também
   não cabe: o tempo total é o mesmo e paga-se o input duas vezes.
2. **Não consegui medir o PDF em si** (páginas depois do `truncatePdfToPages`,
   bytes do base64), como o §1 também pedia: não há chave de serviço neste
   ambiente e o bucket `data-room` é privado, e nem a tabela `documents` nem
   a `document_extractions` guardam número de páginas. As duas medições do
   `ai_call_log` acima respondem à mesma pergunta por outro caminho, e
   respondem-na melhor: comparam input contra tempo directamente.

**LACUNA NOVA, criada por esta correcção e registada em vez de escondida:**
se a passagem truncar, as linhas inseridas levam na mesma o `run_signature`,
por isso **uma nova leitura da mesma selecção faz curto-circuito** e a cauda
perdida não é recuperável. Isto já era verdade antes; o tecto mais baixo
torna-o mais provável. Corrigir isto (não gravar assinatura numa passagem
truncada, ou dizê-lo ao founder) é **decisão de produto** e precisa de
prompt próprio — envolve re-cobrar uma leitura.

**Consulta de alcance (§21):**
```sql
select created_at, tokens_in, tokens_out, cost_eur
from ai_call_log
where route = '/api/market-data/document-extract'
order by created_at desc limit 3;
```
| verdicto | significa |
|---|---|
| `A FUNCIONAR` | **há linha nova** — a chamada voltou dentro do prazo (é o critério do §5, independentemente de `tokens_out`) |
| `EXISTE MAS NINGUEM LA CHEGA` | há linha nova mas `tokens_out` igual ao `maxTokens` do log — voltou, mas ainda trunca; o passo seguinte é reduzir secções por chamada |
| `AINDA NAO APLICAVEL` | continua sem linha nova → o gargalo não é o comprimento da resposta, e o `console.error` novo traz `spentMs`/`modelBudgetMs`/`maxTokens` para o dizer |

**Nota sobre o `maxDuration`** (§3): continua em 60 e não subiu. Vale a pena
saberes que o plano Pro do Vercel leva funções até 300 s — resolveria isto
de vez e sem cortar achados nenhuns. **É decisão de custo tua**, não uma
correcção de código, e está aqui só como informação.

---

## 486 — duas leituras pagas, zero efeito — `DONE` (à espera de UMA medição)

`563b7a3` em `main`. **Sem migração.** **Nada foi corrigido de propósito** —
qual das três explicações é decide qual é a correcção, e adivinhar aqui é o
que o próprio prompt exclui.

**As três explicações que davam exactamente o mesmo do lado de fora:**
- **(a)** o modelo não reportou nada de extraível;
- **(b)** reportou itens e o parser descartou-os — um `document_index` que
  não resolve descarta o item antes de alguma vez ser guardado;
- **(c)** reportou concorrentes **sem os facetos**, logo nenhum ficou
  classificado, logo cada um colidiu com uma linha deixada por **outro**
  documento e voltou `unchanged`.

**Um facto estrutural que já se pode afirmar sem medir**, e que torna a (c)
mais do que especulação: o schema dos concorrentes exige apenas
`['name', 'document_index']` — `candidateKind`, `candidateStage` e
`relation` são **opcionais por desenho**. Um concorrente pode ser
perfeitamente válido, ser guardado, e não levar classificação nenhuma. Em
produção há **10** linhas `players` de documento e **0** com facetos.

**A instrumentação** (`market-extraction-telemetry.ts`, pura) conta: itens
crus por secção na tool call; uma auditoria por concorrente (nome,
`document_index`, **quais** índices foram citados, e cada um dos três campos
de faceto); itens que sobreviveram ao parse, por secção; e o **tally dos
outcomes** do upsert. É o tally que separa as hipóteses — a (a) e a (c)
deixam ambas `itemsProposed` a zero, e só uma delas tem `unchanged` ≠ 0.

**Vai na RESPOSTA, não só no log do servidor.** O 484 estabeleceu que os
logs do Vercel não são alcançáveis a partir do teu setup, e um contador que
ninguém lê não é uma medição; os dois últimos diagnósticos saíram da consola
do browser, por isso é para lá que isto vai também. É `null` quando a
passagem veio da cache de assinatura — assim "sem telemetria" e "não
encontrou nada" continuam distinguíveis.

**Achado da passagem adversarial, sobre a minha própria função:** o tally só
conta as propostas **legacy**. Um documento que só desse `growth`/`sizing`
teria sido descrito como *"none changed anything — 0 collided with rows that
already exist"* — errado duas vezes, e exactamente a espécie de frase
enganadora que este prompt existe para deixar de produzir. O `factsWritten`
passou a fazer parte da entrada, com ramo e testes próprios.

**§5 verificado:** o botão é `disabled={extracting || ...}` e o
`setExtracting(false)` está num `finally` — a protecção contra duplo-submit
**já existe**. As duas chamadas a 77 s de distância foram **duas corridas
deliberadas**. E a segunda voltou a cobrar porque a primeira não escreveu
linha nenhuma, logo nada levava a assinatura para fazer curto-circuito:
**uma passagem que produz zero linhas volta sempre a cobrar na tentativa
seguinte**.

**O que falta, e é uma coisa só:** uma leitura deste documento em produção
depois do deploy, com a consola do browser aberta. A linha
`[document-extract] telemetry` traz `rawSections`, `competitorAudit`
(incluindo `citedDocumentIndexes` contra `documentIndexesOffered`),
`parsedBySection`, `outcomes` e um `summary` em texto que já diz qual das
três é.

**Consulta de alcance (§21):** a mesma dos 482/483/485 — mas o critério
desta tarefa não é SQL, é a linha de telemetria:

| verdicto | significa |
|---|---|
| `A FUNCIONAR` | a linha de telemetria aparece e o `summary` nomeia uma das três — a partir daí há causa raiz para corrigir |
| `EXISTE MAS NINGUEM LA CHEGA` | a leitura corre e não aparece linha nenhuma → a passagem veio da cache de assinatura (`telemetry: null`) e é preciso mudar a selecção para forçar uma corrida real |
| `AINDA NAO APLICAVEL` | não há leitura nova nenhuma desde o deploy |

---

## 487 — Bloco 2: Market Size, e hoje a resposta honesta é "ainda não" — `DONE`

`cacb09c` em `main`. **Sem migração.**

**A medição decidiu a forma da resposta**, por isso vem primeiro. Contado a
31/08 antes de desenhar seja o que for:

```
market_size  valid       12   bottom_up 0   external_estimate 10   (nenhuma) 2
market_size  incomplete  51   bottom_up 0   external_estimate 42   other 2  (nenhuma) 7
growth       incomplete   4   bottom_up 0                          (nenhuma) 4
```

**ZERO factos bottom-up**, nas 67 linhas, todas `founder_reported`. O §2 é
explícito: a manchete só pode vir de um facto bottom-up — e igualmente
explícito que *"ainda não há bottom-up suficiente"* é **uma resposta
legítima**. Por isso o cartão **não mostra número nenhum** hoje: diz o que
falta, e mantém as estimativas externas à vista, rotuladas, nunca
promovidas.

**Três premissas do prompt estavam erradas**, e foi a verificação do §1 que
as apanhou:
1. **O `org_market_data` NÃO está vazio nem morto**: tem **1 linha**, com
   `market_size_value_eur = 16 200 000 000` (TAM 2025), origem *"From
   Sherlock research (Europe Remote Patient Monitoring Devices Market)"*,
   actualizada a 30/08. É uma **estimativa externa**, por isso também não
   podia ser a manchete — mas existe e é servida pela
   `/api/market-data/rings`.
2. A coluna dos rings é **`ring`**, não `ring_key`.
3. Os três rings **não estão todos aceites**: `beachhead` está `accepted`,
   os outros dois ainda `proposed`.

**Decisões, com o porquê (§3/§4):**
- **Cartão novo, montado PRIMEIRO** no separador Market analysis, acima dos
  Market rings e ao mesmo nível de Competitors e Comparable rounds. Não é
  extensão do `MarketRingsCard`, nem reescrita do `MarketFactsCard` — esse
  fica exactamente onde está: é o **registo de auditoria** de onde esta
  leitura sai, não a leitura.
- **Nenhum mapeamento de factos para rings.** Os factos têm
  `marketDefinition`/`geography` em texto livre, os rings têm chave fixa, e
  com zero bottom-up não há nada defensável para lá pôr. É a própria regra
  do §3, e a invariável 14: sem merge sem prova positiva.
- **Sem rota nova, sem caminho de escrita novo, sem migração**: lê a mesma
  `/api/market-data/facts` e os mesmos helpers do `market-facts-view.ts`
  (`factSummaryLine`, `retrievalMethodLabel`, o padrão "Why do we know
  this?").

**Duas regras que a síntese impõe mecanicamente**, não por intenção: vários
factos bottom-up são mostrados **como foram lidos e nunca fundidos** numa
gama inventada; e a confiança é o `verification_status` **mais fraco** dos
factos por trás da manchete, nunca o mais forte — com uma etiqueta que não
consegue dizer "confident" nem "verified" sobre evidência só do founder.

**Verificado mecanicamente, não afirmado:** o `MarketDataPanel` só é montado
pelo `ReadinessPanel` (lado do founder), o `dossier-fetch` lê `market_facts`
**zero** vezes, e o portal não importa nenhum dos dois cartões. Nada disto
chega a um investidor.

**Consulta de alcance (§21):**
```sql
select fact_type, validation_status, count(*) as n,
       count(*) filter (where payload->>'methodology' = 'bottom_up') as bottom_up
from market_facts group by 1,2 order by 1,2;
```
| verdicto | significa |
|---|---|
| `A FUNCIONAR` | `bottom_up > 0` em linhas `valid` → o cartão mostra um número com método e confiança |
| `EXISTE MAS NINGUEM LA CHEGA` | `bottom_up > 0` mas o cartão continua sem manchete → o filtro está errado, não os dados |
| `AINDA NAO APLICAVEL` | `bottom_up = 0` — **é o estado de hoje**, e o cartão diz isso em palavras em vez de ficar vazio |

**O que a ablute_ vê hoje, dado o estado real:** *"No bottom-up market size
yet…"*, seguido de *"Sherlock does have 12 complete figures from other
methods and 51 more still missing a detail."*, a frase do porquê importa, e
as estimativas externas listadas por baixo com a etiqueta do método. Sem
scroll até ao fundo.

---

## 488 — as duas metades da mesma gama, e os cartões que o 467 substituiu sem reformar — `DONE`

`cea6d7c` em `main`. **Sem migração.**

**Medido primeiro (§1):** **16 linhas zombie, numa só org** (ablute_) — 8
`growth` + 8 `sizing`, todas `source_kind='document'`, `status='pending'`,
criadas a 29/08 entre 15:36 e 18:55, ou seja **horas antes** de o 467 entrar
(`5f577f5`, 29/08 21:59). As linhas de origem **web** (5 `growth` + 17
`sizing` pendentes) **não são isto**: o caminho web continua a produzi-las
legitimamente e ficam intactas.

**§1 — não há estado novo, e a razão também é medida.** O
`market_research_items_status_check` admite exactamente
`('pending','accepted','rejected')`. Não há estado adequado, e marcá-las
`rejected` registaria uma decisão que o founder nunca tomou. Um estado a
sério obrigava a alargar um CHECK e a fazer `UPDATE` a 16 linhas de
produção — e um `UPDATE` dentro de uma migração está fora da fronteira
aditiva. Por isso: **as linhas ficam exactamente como estão** — nada
apagado, nada rotulado de outra maneira, continuam legíveis por SQL e pelo
caminho de auditoria — e apenas deixam de ser oferecidas ao founder como
decisões. O predicado é uma função pura testada, e a combinação é
auto-descritiva: desde o 467, um número de growth/sizing vindo de documento
vive em `market_facts`, logo uma linha legacy com um deles **por construção**
já não é a forma como esse dado se guarda.

**A passagem adversarial encontrou uma SEGUNDA superfície:** a
`/api/market-data` não era a única — a resposta da própria
`document-extract` traz a sua cópia da lista de pendentes, por isso filtrar
só uma deixaria os mesmos cartões no ecrã **logo a seguir a uma leitura**.
Ambas filtradas.

**Verificado mecanicamente:** o `dossier-fetch` só lê as secções
`trends`/`regulatory`/`definition` e só `status='accepted'` — nada disto
podia alguma vez ter chegado a um investidor.

**§2 — o emparelhamento min/max, mais estreito do que o prompt propunha**, e
por duas razões encontradas a ler o código, não assumidas:
1. **Exige exactamente um `bound:'lower'` e um `bound:'upper'`.** Fundir
   candidatos `point` — a leitura literal de "ambos os contextos ausentes" —
   cairia no último ramo do `buildEstimate`, que fica com `pointTagged[0]` e
   **descarta os restantes em silêncio**: um caminho de perda de dados novo,
   introduzido por uma correcção de fragmentação.
2. **O grupo fundido mantém `hasPositiveIdentity: FALSE`.** Essa bandeira diz
   ao `computeFactFingerprint` (467 v3 §2) se a mesma proposição vinda de
   **outro** documento pode colapsar na mesma linha. Um par de bounds dentro
   de **uma** extracção prova que aquelas duas leituras são uma gama; não
   prova nada sobre o "8–9,6% sem contexto" de outro documento — que é
   exactamente a ambiguidade que o 467 v3 §2 existe para manter separada.

É uma **segunda passagem** sobre o que o `groupKeyFor` deixou singleton, não
um afrouxamento do `groupKeyFor`. A ausência de contexto tem de ser
**consistente**: um com geografia nunca emparelha com um sem; duas
geografias diferentes nunca emparelham; dois `lower` e um `upper` ficam por
fundir; e um candidato sem `marketDefinition` nunca emparelha — a **Fixture
A do 466 fica intacta** e continua a passar.

**A outra pergunta do §2, respondida por construção:** o
`normalizeMarketCandidates` tem **exactamente um** call site
(`document-extract/route.ts:570`), alimentado pelos candidatos de **uma**
resposta do modelo — o agrupamento **não pode** atravessar chamadas de
extracção.

**§4** — a fusão junta as metades e **não inventa nada**: o facto resultante
fica com `geography` null, período null e validação `incomplete`, que é o
estado honesto quando a fonte não diz nem uma coisa nem outra.

**§3** — os 4 factos `growth` que já existem ficam exactamente como estão.

**Consulta de alcance (§21):**
```sql
select fact_type, payload->>'marketDefinition' as mercado,
       payload->>'estimateShape' as forma,
       payload->>'lowerBound' as min, payload->>'upperBound' as max
from market_facts where fact_type='growth' order by 2,3;
```
| verdicto | significa |
|---|---|
| `A FUNCIONAR` | depois de uma leitura nova do deck: **2** factos `growth` (Urinalysis, Biosensors) com `estimateShape='interval'`, não 4 |
| `EXISTE MAS NINGUEM LA CHEGA` | continuam 4 linhas soltas depois de uma leitura nova → o modelo não está a marcar `bound`, e o problema é do lado da extracção, não do agrupamento |
| `AINDA NAO APLICAVEL` | não houve leitura nova desde o deploy — os 4 antigos ficam como estão, por decisão do §3 |

E no ecrã: os 8+8 cartões `growth`/`sizing` do pré-467 deixam de aparecer na
lista activa, sem que nenhuma linha tenha sido tocada.

---

## 490 — o par lower/upper fundia-se sem confirmar moeda nem método — `DONE`

**Estado:** `DONE` — commit `5129188`, em `main`. Sem migração.

A `contextlessBoundPairKey` (488) decidia que um `bound:'lower'` e um
`bound:'upper'` eram as duas metades da mesma gama comparando
`kind` + `marketDefinition` + `metric`, com geografia e período exigidos
ausentes nos dois. Para `market_size` ficavam **dois campos por comparar** —
`currency` e `methodology` — e o `buildMarketSizeFact` lê **ambos** de
`members[0]`, que é **sempre o `lower`** por construção do array
`[lower, upper]`. Um bottom-up em USD podia, portanto, emparelhar com um
external_estimate em EUR, e o facto resultante herdava em silêncio
"bottom_up USD".

Importa para lá da arrumação porque o **487 usa
`payload.methodology === 'bottom_up'` como o ÚNICO portão da manchete do
Bloco 2**: meia gama carregaria uma manchete que a outra metade nunca
mereceu.

**A disciplina, por construção e não por verificação à parte.** Os dois
campos entram na chave da mesma maneira que o `metric` já entrava — como
valor, com `null` a ser um dos valores. Dois nulos dão a mesma chave e
emparelham; um preenchido contra um nulo dá chaves diferentes e não
emparelha; dois valores diferentes dão chaves diferentes e não emparelham.
A `currency` é normalizada com `normalizeText` (`'USD'` e `'usd'` são a
mesma moeda — isso é um facto sobre notação; `'$'` e `'USD'` ficam
diferentes, porque afirmar ESSA equivalência seria invenção). A
`methodology` é um enum fechado e entra em cru. **As chaves de `growth`
ficam byte a byte iguais** — nenhum dos dois campos existe num candidato de
crescimento, e o `buildGrowthFact` não tira de `members[0]` mais nada que a
chave já não cubra.

**A premissa do prompt estava errada, e o erro é a favor.** O prompt esperava
uma correcção só defensiva ("todos têm os dois campos iguais ou ambos
nulos"). Medido nos `market_facts` a 31/08: numa **única** passagem de
extracção (30/08, 21:52:51 → 21:52:53) o modelo produziu **três** leituras
"Biosensors Market" sem geografia nem `asOfYear`:

| leitura | valor | moeda | `methodology` |
|---|---|---|---|
| `lower` | 30 000 000 000 | USD | `null` |
| `upper` | 34 000 000 000 | USD | `null` |
| `lower` | 30 000 000 000 | USD | `'other'` |

Com a chave do 488 as três caem no mesmo balde, `lower.length === 2`, e a
`pairContextlessBounds` **recusa o grupo inteiro**: três factos, e a gama
que o slide de facto afirma nunca se forma. Separar por `methodology` é o
que deixa as duas metades que concordam encontrarem-se; a leitura ímpar
fica facto próprio, por fundir e por descartar. **Confirmado a reverter a
fonte e a ver o teste novo falhar com 3.**

Oito testes, incluindo esse caso de produção tal e qual.

**ACHADO, registado e não corrigido** (fora do âmbito deste prompt, e com
zero instâncias em produção hoje): o `computeFactFingerprint`
(`market-facts-db.ts`) não leva `methodology` nem nos `identityParts` nem
nos `estimateParts`, por isso dois factos **com identidade positiva** que
difiram só na metodologia colapsariam na mesma linha na persistência — a
mesma classe de falha, uma camada abaixo. Os dois pares reais que diferem só
na metodologia têm `geography` null, logo `hasPositiveIdentity` é false e
são impressos pela evidência; nenhum colide hoje. Precisa de prompt próprio.

**DESVIOS AO PROMPT:** nenhum.

**Consulta de alcance (§21):**
```sql
select payload->>'marketDefinition' as mercado,
       payload->>'estimateShape' as forma,
       payload->>'currency' as moeda, payload->>'methodology' as metodo,
       payload->>'lowerBound' as min, payload->>'upperBound' as max
from market_facts
where fact_type='market_size'
  and payload->>'geography' is null and payload->>'asOfYear' is null
order by 1, 2;
```
| verdicto | significa |
|---|---|
| `A FUNCIONAR` | depois de uma leitura nova do deck: "Biosensors Market" aparece como **um** `interval` 30–34B com `metodo` null **mais** um `lower_bound` 30B com `metodo='other'` — duas linhas, não três |
| `EXISTE MAS NINGUEM LA CHEGA` | continuam três `lower_bound`/`upper_bound` soltos → o modelo deixou de marcar `bound`, ou passou a preencher `geography`, e o problema está na extracção, não no emparelhamento |
| `AINDA NAO APLICAVEL` | não houve leitura nova desde o deploy — as linhas de 30/08 ficam como estão, porque nada nesta alteração reescreve o passado |
