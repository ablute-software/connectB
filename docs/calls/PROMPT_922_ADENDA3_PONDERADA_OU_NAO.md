# Prompt 922 — Adenda 3: ponderada ou não, e média ou soma de pontos (02/11/2026)

Resumo para o Nuno; as decisões estão em `DECISIONS.md` (entrada com o mesmo título). **Migração aditiva** `20261102100000_calls_eval_scoring_mode.sql`, já aplicada ao projeto `wkjcaoqdvhykrfacsylr` antes do código.

## O que mudou
- Em **«How the evaluation runs»** há agora **«How are the criteria combined?»**: **Weighted** (como sempre) ou **Equal weight**. Com *Equal weight*: **Sum of points** (por omissão) ou **Average**.
- Com *Equal weight* **não há pesos** em lado nenhum nem exigência de 100 %; a barra diz «6 criteria · max 30 points» ou «6 criteria · average».
- A **nota final** do avaliador, do ensaio, do quadro de avaliação e das exportações respeita o modo: «12 / 15 points», «4.0 / 5» ou «65.3 %» (média sobre escalas diferentes, com a nota que o explica).
- **Mudar depois de haver avaliações submetidas** pergunta na página, **recalcula todas as notas finais e a classificação**, e fica no registo (quem, quando, de → para). **Depois de publicados os resultados, fica bloqueado.**
- Calls que já existem ficam **ponderadas**, sem qualquer diferença.

## Capturas (`docs/calls/screenshots-922-adenda3/`)
- `how-it-runs-weighted-1280.png` e `how-it-runs-equal-sum-1280.png`, `how-it-runs-equal-average-1280.png` — «How the evaluation runs» nos modos.
- `equal-weight-bar-and-card-1280.png` — a barra («3 criteria · max 20 points») e um cartão sem peso.
- `preview-equal-sum-1280.png` — o ensaio com a nota em pontos.
- `evaluator-final-score-sum-1280.png` («12 / 15 points») e `evaluator-final-score-average-1280.png` («4.0 / 5») — o ecrã do avaliador.
- `board-sum-1280.png` — a classificação em pontos.
- `confirm-recalculate-1280.png` — a pergunta ao mudar com avaliações submetidas.

## Lista de cliques para testar
1. Abre uma call (rascunho) → **Evaluation grid** → «How the evaluation runs». Está em **Weighted**. Escolhe **Equal weight**: aparece «Sum of points / Average».
2. Cria 3 critérios (1–5): **não há campo de peso**; a barra diz «3 criteria · max 15 points». Passa a **Average**: «3 criteria · average».
3. Separador **«As the evaluator sees it»**: clica 4, 3 e 5 → o anel mostra «12 / 15 points» (soma) ou «4.0 / 5» (média).
4. Volta a **Weighted**: os pesos que tinhas estão lá e voltam a pedir 100 %.
5. Com uma avaliação já submetida, muda o modo e grava: aparece a pergunta «Final scores will be recalculated for all applications». Confirma e vê a classificação mudar. (Depois de publicar os resultados, os cartões ficam desativados.)
