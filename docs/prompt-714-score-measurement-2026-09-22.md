# Prompt 714 — Fase 0: medição da base de pontuação

Gerado em 2026-09-22T11:06:51.860Z por scripts/pipeline-score-measurement.ts. Leitura apenas — nenhuma escrita na base de dados.

## Universo real (verificado, não assumido)

A base tem hoje **5 firmas** com pelo menos um lugar (`matchdeal_investor_members.status='active'`) — não "5 reais + 1 QA" como o contexto do prompt sugeria. Das 5, **1 não é `is_test`** ("Invest green"); as outras 4 são todas `is_test=true` (a QA interna do ablute_ e três contas de teste antigas). Reportado tal como está — é o dado real, não o que o estudo presumia.

**Leitura dos números abaixo:** a base tem hoje 15 orgs no total, das quais só 6 não são `is_test` — e dessas 6, só 2 passam o gate completo de elegibilidade (`filterEligibleOrgs`: perfil de 9 campos completo, não suspensa, não fechada, não excluída de discovery, visível). Isso deixa 1-2 candidatas de discovery por firma, não um volume onde ties/histograma/simulação digam muito por si — é o tamanho real da base hoje, não um limite do método. A ausência de "dados em falta" no item 3 abaixo, para praticamente todas as firmas, é a mesma causa: as poucas candidatas que existem calham a ter os campos que estes investidores declararam. A correção do Pedido B está verificada por 8 novos testes unitários (16 no total no ficheiro) que cobrem exactamente os casos que a base real ainda não tem volume para exercitar; a fase 1/2 (mais startups reais) é o que vai tornar este relatório mais informativo.

## Firmas reais

### Invest green (`65bce581-b34e-4838-b5cf-cf40722c8af5`) — REAL

_Perfil incompleto (`is_complete=false`) — usado tal como está (getPipelineWaves não filtra por is_complete); campos por preencher contam como "sem preferência declarada", não como "em falta".._


Elegíveis (discovery): **1** (de 2 elegíveis no total; 1 já têm relação — grant/decisão/referral/portfolio, excluídas da leitura de discovery por pedido).

**1. Distribuição de score (por dezena):**

| Faixa | Candidatas |
|---|---|
| 100 | 1 |

Empatadas no valor máximo (100): **1** de 1.

**2. Admissão (tecto mensal do plano):**

Elegíveis de discovery: 1. Admitidas (histórico + o que o orçamento deste mês ainda cobre): **1**. Por admitir (bloqueadas pelo tecto): **0**. Tecto mensal do plano (`pro_scout`): 10/mês; admitidas este mês: 1.

**3. Dados da startup em falta, por critério (só quando o investidor declarou essa dimensão):**

| Critério | Candidatas com o dado em falta | Comportamento ANTES do Prompt 714 |
|---|---|---|
| _(nenhum — todas as candidatas têm dados completos nas dimensões que este investidor declarou)_ | | |

**4. Simulação — ajuste de ±5/±12/±20 na dimensão "fase" (não aplicado, só medido):**

| Ajuste | Top-8 — posições que mudam | Top-22 — posições que mudam |
|---|---|---|
| ±5 | 0 de 1 | 0 de 1 |
| ±12 | 0 de 1 | 0 de 1 |
| ±20 | 0 de 1 | 0 de 1 |

## Firmas is_test

### ablute_ — Internal QA (`f2a94a65-3489-4b50-827f-9d3b5b521322`) — is_test

_Nota: 2 perfis de investidor entre os membros desta firma; usado o mais completo/recente (`637f8c2a-b982-49be-9c42-b30b6b0e3121`)._


Elegíveis (discovery): **0** (de 2 elegíveis no total; 2 já têm relação — grant/decisão/referral/portfolio, excluídas da leitura de discovery por pedido).

_Sem candidatas de discovery — nada a medir para esta firma._

### nunomarujo@gmail.com — Individual investor (`af230215-aca9-40ac-bcd0-dc679e1825aa`) — is_test

Elegíveis (discovery): **1** (de 2 elegíveis no total; 1 já têm relação — grant/decisão/referral/portfolio, excluídas da leitura de discovery por pedido).

**1. Distribuição de score (por dezena):**

| Faixa | Candidatas |
|---|---|
| 90-99 | 1 |

Empatadas no valor máximo (90): **1** de 1.

**2. Admissão (tecto mensal do plano):**

Elegíveis de discovery: 1. Admitidas (histórico + o que o orçamento deste mês ainda cobre): **1**. Por admitir (bloqueadas pelo tecto): **0**. Tecto mensal do plano (`pro_scout`): 10/mês; admitidas este mês: 1.

**3. Dados da startup em falta, por critério (só quando o investidor declarou essa dimensão):**

| Critério | Candidatas com o dado em falta | Comportamento ANTES do Prompt 714 |
|---|---|---|
| _(nenhum — todas as candidatas têm dados completos nas dimensões que este investidor declarou)_ | | |

**4. Simulação — ajuste de ±5/±12/±20 na dimensão "fase" (não aplicado, só medido):**

| Ajuste | Top-8 — posições que mudam | Top-22 — posições que mudam |
|---|---|---|
| ±5 | 0 de 1 | 0 de 1 |
| ±12 | 0 de 1 | 0 de 1 |
| ±20 | 0 de 1 | 0 de 1 |

### Test idividual (`713278a8-295a-4d38-9642-fda7bbccbcad`) — is_test

_Perfil incompleto (`is_complete=false`) — usado tal como está (getPipelineWaves não filtra por is_complete); campos por preencher contam como "sem preferência declarada", não como "em falta".._


Elegíveis (discovery): **1** (de 2 elegíveis no total; 1 já têm relação — grant/decisão/referral/portfolio, excluídas da leitura de discovery por pedido).

**1. Distribuição de score (por dezena):**

| Faixa | Candidatas |
|---|---|
| 0-9 | 1 |

Empatadas no valor máximo (0): **1** de 1.

**2. Admissão (tecto mensal do plano):**

Elegíveis de discovery: 1. Admitidas (histórico + o que o orçamento deste mês ainda cobre): **1**. Por admitir (bloqueadas pelo tecto): **0**. Tecto mensal do plano (`pro_scout`): 10/mês; admitidas este mês: 1.

**3. Dados da startup em falta, por critério (só quando o investidor declarou essa dimensão):**

| Critério | Candidatas com o dado em falta | Comportamento ANTES do Prompt 714 |
|---|---|---|
| _(nenhum — todas as candidatas têm dados completos nas dimensões que este investidor declarou)_ | | |

**4. Simulação — ajuste de ±5/±12/±20 na dimensão "fase" (não aplicado, só medido):**

| Ajuste | Top-8 — posições que mudam | Top-22 — posições que mudam |
|---|---|---|
| ±5 | 0 de 1 | 0 de 1 |
| ±12 | 0 de 1 | 0 de 1 |
| ±20 | 0 de 1 | 0 de 1 |

### Test investor (`9e6f3426-d983-45e7-9c93-86f5d8eab195`) — is_test

_Perfil incompleto (`is_complete=false`) — usado tal como está (getPipelineWaves não filtra por is_complete); campos por preencher contam como "sem preferência declarada", não como "em falta".._


Elegíveis (discovery): **1** (de 2 elegíveis no total; 1 já têm relação — grant/decisão/referral/portfolio, excluídas da leitura de discovery por pedido).

**1. Distribuição de score (por dezena):**

| Faixa | Candidatas |
|---|---|
| 90-99 | 1 |

Empatadas no valor máximo (90): **1** de 1.

**2. Admissão (tecto mensal do plano):**

Elegíveis de discovery: 1. Admitidas (histórico + o que o orçamento deste mês ainda cobre): **1**. Por admitir (bloqueadas pelo tecto): **0**. Tecto mensal do plano (`pro_scout`): 10/mês; admitidas este mês: 2.

**3. Dados da startup em falta, por critério (só quando o investidor declarou essa dimensão):**

| Critério | Candidatas com o dado em falta | Comportamento ANTES do Prompt 714 |
|---|---|---|
| _(nenhum — todas as candidatas têm dados completos nas dimensões que este investidor declarou)_ | | |

**4. Simulação — ajuste de ±5/±12/±20 na dimensão "fase" (não aplicado, só medido):**

| Ajuste | Top-8 — posições que mudam | Top-22 — posições que mudam |
|---|---|---|
| ±5 | 0 de 1 | 0 de 1 |
| ±12 | 0 de 1 | 0 de 1 |
| ±20 | 0 de 1 | 0 de 1 |

