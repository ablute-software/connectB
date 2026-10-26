# Prompt 918 — Adenda 3: reabrir que não gravava, estados e datas verdadeiros, equipa que não se candidata

Decisões e razões completas em `DECISIONS.md` ("Prompt 918, Adenda 3") e na spec §13.1 e §14.4. Capturas em `docs/calls/screenshots-918-adenda3/`.

## 1. Porque o "Reopen and extend" não gravava

Não consegui reproduzi-lo em produção (e não toquei na INNOV-ID). Encontrei **três** caminhos que dão exatamente o sintoma "carrego e não acontece nada", todos fechados e testados:

- uma bandeira de "gravação falhou" que sobrevivia a um recarregamento e **recusava qualquer ação**, com a mensagem num sítio fora do ecrã;
- a confirmação era um diálogo do browser, que, se o browser foi mandado calar os diálogos, responde "não" em silêncio;
- o botão ficava desligado sem dizer porquê.

Agora: a confirmação está na página, o erro aparece ao lado do botão (visível sem rolar, testado a 1280/768/375), o botão desligado diz o que falta, e o sucesso diz "The call is open again until …". Uma call restaurada reabre-se. **Só tu a clicar na INNOV-ID confirmas que era isto.**

## 2–4. Razão, datas e "Manage"

- A caixa diz a razão verdadeira: fechada no prazo / fechada cedo / apagada e restaurada (lida do histórico, num só sítio).
- Fechada antes do prazo: "Closed on 22 Oct 2026 (early)" na lista, no Summary e na página de entrada.
- O botão do cartão é "Manage".

## 5. Restauro

Quem foi avisado do cancelamento recebe "«Entidade» restored the call «Título». Your application is available again." (app e email); "Cancelled" desaparece de My applications. Migração aditiva `20261022120000_calls_restored_notice.sql`, **já aplicada** (teste seco antes).

## 6. Equipa

Quem está na equipa de uma call não se candidata a ela: servidor (403 `on_call_team` ao começar, gravar, submeter) e ecrã ("You are on this call's team, so you cannot apply to it."), com a call aberta ou fechada e mesmo com conta de founder. A startup não fica bloqueada: outro membro candidata-se.

## 7. Onde ficou o logo guardado a 20/10 às 08:57

No perfil da entidade de **teste** "ablute_ — Internal QA" (`is_test = true`), membro `alexandrameira@ablute.pt`. **Não está em nenhum perfil real da Portugal Ventures**; nada foi apagado. O endereço guardado já estava morto (o ficheiro saiu da pasta da call). Daqui para a frente o perfil guarda uma cópia própria em `entity-logos/…`.

## Lista de cliques para o Nuno

1. **INNOV-ID:** abre a call → Setup → Review & publish → "Reopen and extend". Escolhe **31/12/2026 14:34** (Europe/Lisbon), carrega no botão, confirma em "Yes, reopen the call". Esperado: a mensagem "The call is open again until 31 Dec 2026, 14:34 (Europe/Lisbon)…" e o estado passa a Open. Se aparecer um erro, aparece dentro da caixa; **diz-me o texto**. (Não a reabri por mim: espero o teu OK ou fá-lo tu.)
2. **Equipa:** abre o link da call com `alexandrameira@ablute.pt` → vês "You are on this call's team, so you cannot apply to it.", sem botão de começar.
3. **Datas e "Manage":** em Calls, os cartões têm "Manage"; uma call fechada cedo mostra "Closed on … (early)" (não o prazo futuro); o mesmo no Summary e no link.
4. **Restauro (call de teste, nunca a INNOV-ID):** apaga uma call de teste que tenha uma candidatura de uma conta de teste, restaura-a: essa conta recebe "restored the call …" e em My applications já não aparece "Cancelled".

## Limites

- A causa do ponto 1 está **evidenciada, não reproduzida**.
- "Close early" ainda usa o diálogo do browser (fora do pedido).
- Trabalhei esta Adenda **antes** da tabela da 917 Adenda 2 porque o ponto 1 te bloqueava; a tabela está na sua branch, por acabar.
