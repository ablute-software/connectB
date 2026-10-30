# Prompt 922 — Adenda 1, Parte C: distribuição por percentagem e por regras (30/10/2026)

Resumo para o Nuno; as decisões e os porquês estão em `DECISIONS.md` (entrada com o mesmo título). Branch local `claude/922-adenda1-b-linked-criteria`. Migração **por aplicar**: `20261030110000_calls_eval_distribution_rules.sql`.

## O que se vê (Team → Distribution of applications)
- **How the load is shared:** Equal · Weighted (percentagem por avaliador, ou máximo de candidaturas) · By rules (painéis, regras, várias condições, «first matching»/«all matching panels», reserva ou «Unassigned»).
- **Pré-visualização:** por avaliador (pedido → real), por painel, sem avaliadores suficientes, Unassigned. **Apply** com confirmação na página.
- **Capturas:** `screenshots-922-adenda1/distribution-weighted-1280.png`, `distribution-rules-1280.png`, `distribution-rules-375.png`.

## Lista de cliques (call «Test»)
1. Team → Distribution → escolher **By rules**; criar dois painéis (por exemplo «Health panel» e «Seed panel») e pôr avaliadores em cada um.
2. Criar uma regra «Sector é Saúde → Health panel» (e, se quiser, outra por montante).
3. **Redistribute…** → ver a pré-visualização → **Apply**.
