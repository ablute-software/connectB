# Prompt 922 — Adenda 1, Parte B: critérios ligados às perguntas do formulário e pontuação automática (30/10/2026)

Resumo para o Nuno; as decisões e os porquês estão em `DECISIONS.md` (entrada com o mesmo título). Branch local `claude/922-adenda1-b-linked-criteria` (a partir da Parte A). Migração **por aplicar**: `20261030100000_calls_eval_linked_criteria.sql`.

## O que se vê
- **Grelha → «Based on these answers»** em cada critério (lista por página, com número) e o painel **«Form questions»** ao lado (separador no telemóvel). Capturas: `screenshots-922-adenda1/grid-form-panel-1280.png`, `grid-form-tab-375.png`.
- **Pontuação automática** («Score automatically from answers»): tabela de pontos por pergunta fechada; intervalos para números.
- **Avaliador:** as respostas ligadas junto a cada critério (às cegas, como o servidor as mandou), «Open the full answer», «Automatic» / «Needs manual score», override com comentário. Capturas: `screenshots-922-i3/linked-answers-1280.png`, `linked-answers-375.png`.
- **Quadro:** «Automatic» por critério; os overrides ficam visíveis; a divergência ignora os automáticos.

## Regras que o servidor impõe (não o browser)
Uma ligação tem de ser uma pergunta desta call; a tabela tem de dar pontos a todas as respostas antes de a call ser validada; um critério automático não se altera sem a permissão da entidade e, com ela, só com comentário; o ponto segue a candidatura até se submeter e fica fixo depois.

## Lista de cliques (call «Test»)
1. Setup → Evaluation grid → criar 3 critérios; em cada um «Choose the questions…» e escolher perguntas.
2. Num deles, ligar «Score automatically from answers» a uma pergunta de escolha única e dar pontos a todas as opções.
3. Abrir «Form questions» (à direita; no telemóvel, o separador) e ver quais perguntas ficam «not linked».
