# Prompt 925 — a seriação (03/11/2026)

Decisões e diferenças com a spec em `DECISIONS.md` («Prompt 925»). Migração aditiva `20261103120000_calls_selection.sql`, aplicada antes do código.

## A ordem do cálculo
1. Só entram as candidaturas **Fit** com nota final. 2. Aplicam-se os **mínimos** (total e por critério) → falhar é Reject, com a razão. 3. Ordena-se pela **nota final** com o desempate configurado. 4. Preenchem-se os **lugares mínimos das cotas**. 5. Preenchem-se as **vagas restantes** respeitando os máximos das cotas e o orçamento (um projeto que não cabe é saltado, e o salto é assinalado). 6. Os seguintes vão para **Waitlist**. 7. Os restantes para **Reject**.

## O que há
- **Setup → «Selection rules»**: mínimo da nota (na unidade da call), mínimo por critério, vagas, lista de espera, orçamento (fixo ou o montante pedido), cotas (mínimo e/ou máximo), desempate; avisos de regras impossíveis; pré-visualização com dados inventados. Cada alteração é uma versão.
- **Quadro de avaliação → «Selection proposal»** (quem tem «Final decision»): «Propose selection», uma frase por candidatura, resumo (selecionados, espera, rejeitados, orçamento, cotas, empates), «Apply proposal», decisões manuais com justificação, «The proposal is out of date» e recalcular sem apagar o manual; fixa depois de publicar; exporta com a proposta.

## Capturas (`docs/calls/screenshots-925/`)
`rules-1280.png`, `rules-768.png`, `rules-375.png` (as regras e a pré-visualização), `board-tie-1280.png` (o empate), `board-applied-1280.png`, `board-768.png`, `board-375.png` (a proposta).

## Lista de cliques para o Nuno (call «Test», com candidaturas avaliadas)
1. **Setup → Selection rules**: mínimo **60 %**, **2 vagas**, uma cota **mínima de 1** para um setor (Add a quota) e, no desempate, um critério (+ Add a criterion). **Save selection rules**.
2. **Evaluation → quadro → «Selection proposal» → Show → «Propose selection».**
3. Lê a frase de cada candidatura (por exemplo «Selected: 3rd place, Health quota»).
4. Numa decisão, muda-a no quadro: pede uma justificação.
5. **Apply proposal** (se houver «Tie — decide», ordena os empatados e «Save this order» primeiro).
6. **Export** (CSV ou Excel): traz «Selection place», «Proposal», «Explanation of the proposal» e «Decision origin».

## Diferenças com a spec
Ver `DECISIONS.md`: passo próprio em vez da tab «Team & distribution»; cotas sobre vários tipos de resposta; orçamento; proposta com «Apply» em vez de blocos coloridos; um conjunto de regras por call (não por fase) nesta versão.
