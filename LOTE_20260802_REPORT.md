# Lote (2-3 itens) — Prompt 80 §1 + Prompt 81 Bloco 2

Prompt 65 fica de fora deste lote — é um clique real em produção, mais rápido feito pelo Nuno do que
por mim (como o próprio pediu); confirmo por SQL assim que houver uma linha nova em `interactions`.

---

## Prompt 80 §1 — slider de ticket do investidor — CONSTRUÍDO

**Onde**: `InvestorProfilePanel.tsx`, o campo "Ticket range (EUR)" do formulário de thesis do
investidor (`draft.ticket_min`/`draft.ticket_max`, `matchdeal_profiles`). É o único sítio no código
onde este par de campos é editável (confirmado por grep — `MatchDealDeck.tsx` só o lê).

**O problema real, confirmado**: a tabela de incrementos pedida (10.000 → 15.000 → 25.000, depois
25.000 em 25.000 até 50.000.000) tem **2000 posições válidas**. Já tinham autorização escrita para
propor uma alternativa de UX em vez de decidir sozinhos fugir ao pedido — é o que fiz.

**Proposta aplicada — mapeamento de posição em escala logarítmica**:
- Os **valores alcançáveis continuam a ser exatamente a tabela pedida** — nada foi simplificado ou
  arredondado de forma diferente. `src/lib/ticket-range.ts` constrói a lista real (`ticketStops()`,
  2000 entradas, testado que é estritamente crescente e com passo de 25k a partir do terceiro degrau).
- O que muda é **quanto arrasto corresponde a cada valor**: em vez de cada pixel valer sempre +25k
  (o que tornaria os primeiros milhões dificílimos de acertar com precisão num ecrã de telemóvel), o
  arrasto usa escala logarítmica — de 10k a 1M ocupa proporcionalmente mais curso do que de 1M a 50M,
  apesar de este segundo troço ser numericamente maior. Testado (`ticket-range.test.ts`) que o troço
  baixo ocupa mais posições do que o alto, que os extremos batem exatamente (posição 0 = 10k, posição
  1000 = 50M) e que **toda a gama de posições só devolve valores da tabela real**, nunca um número
  arbitrário.
- Componente novo `TicketAmountSlider.tsx` (um handle = um valor), usado duas vezes (Min/Max) no
  formulário existente — mantém a estrutura de dois campos já lá, não inventei um slider de gama dupla
  (handle único a cobrir min-e-max ao mesmo tempo), que seria uma mudança maior de UX sem pedido
  explícito para isso. Min não pode passar acima do Max escolhido e vice-versa (clamp simples, sem
  bloquear o arrasto).
- Sem alteração de schema — `ticket_min`/`ticket_max` continuam os mesmos campos `numeric` de sempre.

`tsc --noEmit`, `vitest` (325/325, 9 testes novos em `ticket-range.test.ts` cobrindo a tabela, o
snapping ao stop mais próximo, a bijeção posição↔valor nos extremos e a monotonicidade, e o viés
logarítmico) e `npm run build`, todos limpos. **Por confirmar visualmente** — ainda não testado por
clique numa sessão de investidor real.

---

## Prompt 81 Bloco 2 (Hype List v2) — investigado a fundo, schema PROPOSTO, não aplicado

Com a fórmula completa recebida, fui verificar, sinal a sinal, o que já existe em código/BD para os
calcular — sem isto, escrever o cron seria inventar dados que não existem.

| # | Sinal | Dado existe hoje? | Fonte |
|---|---|---|---|
| 1 | Likes na semana | ✅ Sim | `matchdeal_swipes` (`target_profile_id`, `direction='like'`, `created_at` esta semana) |
| 2 | Ritmo de crescimento de likes | ✅ Sim (derivável) | mesma tabela, semana atual vs. anterior |
| 3 | Aberturas de "mais informação" (swipe-down) | ❌ **Não** | Construído esta noite (Bloco 1) como gesto **só de UI** (`subIndex` em `MatchDealDeck.tsx`) — nunca escreve nada na BD. Não há nenhuma tabela/coluna a registar isto. |
| 4 | Pedidos de reunião recebidos | ✅ Sim (derivável) | `matchdeal_meeting_proposals` (`proposed_by_profile_id` ≠ o próprio perfil) |
| 5 | Super likes / Boosts recebidos | ❌ **Não** | `matchdeal_swipes_direction_check` só permite `'like'`/`'pass'` — **não existe `super_like` como direção possível na BD**. `matchdeal_boosts` continua com 0 linhas e 0 código ligado (confirmado ontem à noite, Bloco 0). |
| 6 | Completude do perfil ≥90% | ⚠️ **Parcial, incompatível como está** | `matchdeal_profiles.is_complete` existe, mas é **booleano**, calculado por `matchdeal_recompute_profile_completeness()` a partir de 7 campos obrigatórios — e **`is_visible = is_complete`** (doc do próprio trigger: "v1 visibilidade = completude"). Como o recálculo diário do Hype só corre sobre perfis `is_visible=true`, **todo o pool elegível já teria is_complete=true por definição** — o sinal "≥90%" seria sempre verdadeiro para todos, sem nenhum poder de diferenciação. Precisa de uma completude granular (percentagem, mais campos do que só os 7 obrigatórios) separada do gate binário de visibilidade. |
| 7 | Assiduidade de resposta (mín. 3 conversas) | ✅ Sim (derivável) | `matchdeal_messages` (`match_id`, `sender_profile_id`, `created_at`) — dá para calcular taxa/latência de resposta por match, agregado por perfil, com o mínimo de 3 conversas como está escrito |

**Resultado**: 3 dos 7 sinais (3, 5, 6) não têm dados utilizáveis tal como pedidos, sem mexer em schema
ou construir tracking novo primeiro. Escrever a fórmula com só 4 sinais disponíveis seria exatamente o
"fugir ao pedido em silêncio" que a doutrina proíbe — o badge pareceria "Hype v2" mas seria outra coisa.
**Não construí o cron nem o cálculo do score.**

### Proposta de schema (não aplicada, à espera de OK)

1. **Tracking de "mais informação"** — reaproveitar o padrão já existente de `matchdeal_record_exposure`
   (RPC chamada do cliente), nova RPC `matchdeal_record_detail_view(p_viewer_profile_id, p_shown_profile_id)`
   a escrever numa tabela nova `matchdeal_detail_views` (mesma forma de `matchdeal_exposures`) — chamada
   pelo `MatchDealDeck.tsx` de hoje quando o `subIndex` avança pela primeira vez para 1 (não a cada
   swipe down repetido no mesmo perfil, só a primeira abertura).
2. **Super like / Boost recebido** — depende diretamente de o Bloco 3 (Boost) ser desenhado e aplicado
   primeiro; sem isso este sinal fica a zero para todos (o que é honesto, não um erro, mas convém que
   saibam que está condicionado).
3. **Completude granular** — nova coluna `matchdeal_profiles.completeness_pct integer`, calculada a
   partir de um conjunto mais lato de campos (ex.: os 7 atuais + `pitch_deck_url`, `gallery_urls`,
   `revenue`, `team_summary`, `intellectual_property`) — proposto, não desenhado ao pormenor até haver
   OK de que é este o caminho certo (podem preferir manter só um `is_complete` binário e substituir o
   sinal 6 por outra coisa).
4. **Cache do score/badge** — tabela nova `matchdeal_hype_scores` (`profile_id`, `computed_at date`,
   `score numeric`, `is_hype boolean`) — um snapshot por dia, não sobrescrito, para o badge "sair e
   entrar consoante o dia" ser auditável e não exigir recomputar em tempo real a cada carregamento do
   deck.
5. **Cron** — recálculo diário: o `vercel.json` já só permite 1 cron/dia (`/api/automations` às 9h,
   limite do plano Hobby, já documentado). A forma correta é o Hype recalcular-se **dentro** desse
   mesmo cron existente, não um segundo cron — consistente com a mesma resposta já dada para o Prompt
   87 Bloco 3.3.

**Guarda respeitada em toda esta investigação**: nada do que fiz toca `matchdeal_eligible_deck()` — só
li schema e código, não mudei ordenação nem elegibilidade do baralho.

---

## Deploy confirmado

Commit `1af1b08` — GitHub Deployments API, deployment `5713047399`, `state: success`. (Nota técnica:
o primeiro script de verificação usava `python3` para parsear o JSON, que não existe neste ambiente —
20 tentativas silenciosamente vazias, não um deploy demorado. Repetido com `grep`, confirmado à
primeira.)

## Disciplina seguida

Schema novo: só proposto (Hype List), nunca aplicado sem OK — exatamente como o próprio lote pediu.
`access_grants` e o motor de matching intocados. `tsc`/`vitest`/`build` limpos para o código que
efetivamente foi escrito (slider). Nada inventado nos sinais que faltam — documentado exatamente o que
existe e o que não existe, não uma aproximação silenciosa.
