# Prompt 909 — Adenda 2b: grelhas fora da IA, avisos, e a leitura em partes

**Branch:** `claude/909-adenda2b-grid-notify-speed`. **Migração:** `20261015100000_calls_import_notices.sql` (aditiva: dois tipos
novos em `call_notices.kind`). **Dependência nova:** `unpdf`. **Variáveis novas:** nenhuma.

## 1. Grelhas

- `grid` deixa de ser um tipo de documento da importação (`SOURCE_KINDS` = regulation, form, other). O servidor recusa um pedido com
  `grid` (qualquer maiúscula) com 400 `grid_not_supported` **antes de ler, guardar ou enviar** nada.
- Aviso do ecrã: "The document is read by our AI provider to propose a configuration. Do not upload applicants' documents or confidential evaluation grids."
- O prompt do modelo deixou de falar em grelha. Os critérios de avaliação que o **regulamento** descreve continuam a ser copiados como texto
  (para a Etapa 3), porque o regulamento é público.
- Não há importador de grelhas: fica para o editor de grelhas da Etapa 3, dentro da plataforma, sem IA externa. Spec atualizada (§2.3, §5.3, quadro 1C).

## 2. Não ficar preso ao ecrã

- Texto: "Reading your documents. This can take a minute or two. You can keep using the platform; we'll let you know when the proposal is ready."
  e o botão **Continue working** (fecha o ecrã; a leitura continua).
- Quando o run acaba (`proposed` ou `failed`) o job cria uma notificação in-app para quem a iniciou (uma por run).
- Onde se vê: no topo da lista de Calls ("Review" abre a call no diálogo, que mostra a proposta pronta); num **emblema** no separador Calls das duas
  áreas de trabalho (investidor e ecossistema); e **"Proposal ready to review"** junto aos botões de importar da call (Form e General). Se
  ficar no ecrã, ele consulta o run e abre a revisão sozinho (Adenda 2).
- **Nota honesta:** não existe campainha global na plataforma. O mecanismo in-app que existia (`call_notices`) era só o do candidato; reaproveitei-o
  com dois tipos novos. Quem está noutro separador do mesmo espaço de trabalho vê o emblema no separador Calls (atualiza de 30 em 30 s e ao instante
  quando se vê uma notificação).

## 3. Mais rápido

| | Antes | Depois (desenho) |
|---|---|---|
| O que vai ao modelo | o PDF em base64 | o texto extraído na plataforma |
| Tokens de entrada (este ficheiro) | 13 886 | ~2 500 (estimado: 6 798 caracteres) |
| Chamadas | 1 | 1 geral + 3 de perguntas (páginas 1–2, 3–4, 5–6), em paralelo |
| Saída por chamada | 3 761 tokens | ≤ ~1 300 (a maior das partes) |
| Tempo | ≈ 62 s (medido) | o da parte mais longa: **≈ 20–25 s previstos** |

- A extração do texto (`unpdf`, o pdf.js em versão serverless) demora **0,8 s** neste ficheiro e funciona **no bundle de produção** (verificado com
  `next start` e este PDF: 6 páginas, 6 798 caracteres). Se falhar ou o texto for escasso (< 60 caracteres por página), o PDF vai inteiro, como antes.
- O que domina o tempo é a **saída**; por isso as perguntas são lidas em partes lado a lado. Cada parte é uma ou mais páginas inteiras (PDF) ou
  linhas inteiras (Word/Excel), ~3 500 caracteres, no máximo 6 partes.
- A saída é compacta (sem `instruction` salvo regra, sem `required: false`, sem listas vazias).
- Se uma parte falha, falha tudo e as outras param (nunca um formulário parcial). Cortado por `max_tokens` é `failed` (o limite de 6 000 mantém-se).
- Cada run regista `duration_ms`, `tokens_in`, `tokens_out`; o evento `import_proposed` regista `inputMode` (`text`/`pdf`), `calls` e `parts`.

### Não provado
- **Os tempos "depois" são uma previsão**, não uma medição: não tenho a chave do fornecedor nesta máquina nem sessão para importar em
  produção. A primeira importação do Nuno é a medição (lê-se no run).
- A qualidade da proposta em partes (a mesma pergunta a cair em duas partes, a numeração das páginas do formulário) só se vê com um modelo real;
  as partes cortam-se nas quebras de página para o evitar, e as páginas de cada parte mantêm a ordem do documento.

## Testes
`propose-split.test.ts` (cortes, paralelismo real, ordem, falha de uma parte, relógio, fallback), `pdf-text.test.ts`, `chunks` e as rotas
(`calls-909-i4-routes.test.ts`: grelha recusada, texto em vez de PDF, fallback do PDF, notificações por run, só as do próprio, sem misturar com as do
candidato, a falha de uma notificação não desfaz a proposta), `screen-state.test.ts` (estado junto ao botão, textos, emblemas).
