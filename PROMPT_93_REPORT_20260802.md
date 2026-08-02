# Prompt 93 — o reset do baralho cíclico, causa raiz encontrada e corrigida

## 1. Baralho não reinicia — SQL provada correta, causa era o cliente nunca voltar a chamá-la

**Achado decisivo, por teste direto, não por leitura de código**: chamei `matchdeal_eligible_deck()`
diretamente para `fc9974e7...` (o mesmo efeito secundário já aprovado para esta conta de teste) — e o
reset **disparou exatamente como desenhado**: as 7 linhas de `matchdeal_swipes` (intactas desde 31/07,
como o Nuno reportou) foram apagadas na hora, e a chamada devolveu os 7 investidores de volta, frescos.
Confirmado depois por SQL: `matchdeal_swipes` para este actor está agora a **0 linhas**. **A lógica SQL
não tinha nenhum bug — a hipótese 1 do Nuno estava certa.**

**Causa raiz real, confirmada**: `MatchDealDeck.tsx` só chamava `matchdeal_eligible_deck` **uma vez por
verdadeiro mount do componente React** (`useEffect(..., [viewerProfileId])` — `viewerProfileId` nunca
muda dentro de uma sessão). Numa PWA instalada que fica em segundo plano em vez de ser fechada (o
comportamento normal do iOS/Android para poupar bateria), o componente nunca desmonta de verdade — por
isso a chamada de 31/07 nunca se repetiu, e a condição de reset (verdadeira há três dias) nunca teve
oportunidade de ser reavaliada, apesar de o Nuno ter reaberto a app várias vezes hoje.

O padrão nos dados bate com isto: os 4 "shown" de hoje (`matchdeal_exposures`, 10:58/10:59/11:01/13:43)
mostram só **2 perfis distintos repetidos** (`Northbound Ventures` 3×, `Lisbon Family Office` 1×) — não
os 7 espalhados aleatoriamente que uma chamada nova e correta produziria. Isto é o padrão de um `deck`
preso em memória desde 31/07 a ser reexibido, não de chamadas novas à função.

**Fix aplicado**: `MatchDealDeck.tsx` ganhou o mesmo padrão que `/pair/page.tsx` já usa para o seu
próprio self-check (Prompt 84) — um listener de `visibilitychange` que volta a chamar
`matchdeal_eligible_deck` sempre que a aba/PWA volta a ficar visível, não só na primeira vez. Isto fecha
exatamente o intervalo que o Nuno descreveu ("a condição fica verdadeira, mas o código nunca corre") —
sem tocar em nada dentro de `matchdeal_eligible_deck()` em si, como pedido. `fetchDeck` foi extraído
para uma função reutilizável (`useCallback`), chamada no mount e no `visibilitychange`; cada chamada
nova reinicia `index` a 0 também, para não misturar um baralho novo com uma posição antiga.

**Desbloqueio imediato para o Nuno**: como já tinha corrido a função diretamente para confirmar o
diagnóstico, a conta dele já está destravada agora mesmo — os 7 investidores demo estão outra vez
disponíveis para swipe, sem precisar de esperar pelo deploy do fix.

**As três hipóteses do Nuno, respondidas com evidência**:
1. **Fluxo mobile não chama a função** — parcialmente certo: chama-a, mas só uma vez por sessão longa,
   nunca mais. Corrigido acima.
2. **Logging na branch de reset** — não foi preciso; o teste direto já provou definitivamente que a
   branch corre e funciona quando alcançada.
3. **`is_visible=false` do próprio perfil a interferir** — descartado por leitura: o perfil do Nuno é o
   `p_viewer_profile_id` (o "actor"), nunca entra do lado `p.is_visible` da query (que só filtra os
   perfis MOSTRADOS, não quem está a ver); confirmado que não interfere.

`tsc --noEmit`, `vitest` (330/330) e `npm run build`, todos limpos.

---

## 2. Rodapé sem separadores — sem novidade, pergunta é para o Nuno

Confirmado como no Prompt 91/NIGHT_LOG: sem bloqueio de schema/feature-flag, só por construir (Bloco 5
do Prompt 81, Matches/Messages/Profile nunca tiveram ecrã). A pergunta de prioridade é do Nuno, não
minha — fica registada, sem ação de código.

---

## Disciplina seguida

`matchdeal_eligible_deck()` **não foi alterada** — o fix ficou inteiramente do lado do cliente
(`MatchDealDeck.tsx`), exatamente como o próprio Prompt 93 pediu ("isto é especificamente sobre... não
sobre o motor de filtros em si"). `access_grants` intocado. Nenhum schema novo foi necessário.
