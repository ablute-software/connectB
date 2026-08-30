# Fila de execução — Sherlock Deal

**Local canónico:** `docs/execution-queue.md` no repositório `connectB`.
**Atualizado:** 30/08/2026 (14:35 — 472 em `main`, D3 entregue, G2 passou)
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
| **D2** | `blueprint/reconcile` → `reconciliation/run` | `READY — especificado aqui` | `READY` | nada |
| **D3** | Consulta de alcance por capacidade | `READY — especificado aqui` | `DONE` — `docs/capability-reach.md` | — |
| 472 | Ponto D — dois eixos do `gap_disposition` | — | `DONE` — `1404513` em `main`, **provado em produção (7 → 3)** | — |
| 473 | Consolidar os dois vocabulários `FactStatus` | `NO_PROMPT — não executar` | — | prompt |
| 474 | Bloco 2 no ecrã (factos tipados visíveis) | `NO_PROMPT — não executar` | — | 471 + prompt |
| 475 | Invariável 6 — visibilidade que propaga | `NO_PROMPT — não executar` | — | prompt |
| 476 | Lock por organização (465 §F.3) | `NO_PROMPT — não executar` | — | decisão de desenho |
| — | Bloco 5 / milestone D — derivações | `NO_PROMPT — não executar` | — | prompt + migração |
| — | Bloco 4 — Capital Landscape | `NO_PROMPT — não executar` | — | **decisão de produto** (fontes) |
| G2 | Aceitação visual na app | — | `DONE` — 30/08 14:17, 3 hipóteses criadas | — |

**Ordem recomendada:** ~~merge do 472~~ → ~~D3~~ → **D1 → D2**.

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

## D2 — `/api/blueprint/reconcile` passa a chamar `/api/reconciliation/run`

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
