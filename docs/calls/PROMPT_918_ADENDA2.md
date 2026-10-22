# Prompt 918 — Adenda 2: imagens partidas, ecrã só de leitura, apagar calls

Decisões e razões completas em `DECISIONS.md` ("Prompt 918, Adenda 2 (A e B)" e "Prompt 918, Adenda 2 (C)") e na spec §8 e §13.1. Capturas em `docs/calls/screenshots-918-adenda2/`.

## A. A capa e o logo da INNOV-ID

- **Causa (provada):** a cache de dados do Next respondia pelo pedido ao Storage que cria o endereço de 60 segundos de cada imagem; passado um minuto, todos os pedidos recebiam o mesmo endereço já expirado (Storage: 400 `InvalidJWT`, "exp" claim) e a plataforma respondia 502. Ao início funcionava porque o primeiro pedido a seguir ao upload não tinha nada na cache.
- **Correção:** um único cliente de serviço para todo o código das Calls, que proíbe a cache; um teste que falha se uma rota o contornar; o log diz a razão real (`calls_media_unavailable`); uma imagem que falha mostra a faixa na cor da marca ou as iniciais da entidade, nunca uma imagem partida.
- **Em produção:** capa e logo da INNOV-ID, sem sessão, 4 rondas com 75 s entre elas: 200 `image/png` em todas (antes: 502 nas mesmas condições).

## B. O candidato preso em "só leitura"

- **Causa:** não é um papel só de leitura: é uma sessão de **Developer Viewer** (a conta `nunomarujo@ablute.pt` estava a ver a Mob2is desde as 08:58 UTC e abriu o link às 09:06). A regra está certa; o ecrã é que era um beco sem saída.
- **Agora:** diz quem és e o que estás a ver, e oferece "Leave Developer Viewer and continue as myself", "Sign out and use another account" e "Report a problem".

## C. Apagar calls

Em qualquer estado, com o nome escrito; "Deleted calls" 30 dias, com Restore; depois removida de vez (ficheiros incluídos) com um registo mínimo; os candidatos são avisados e, até lá, leem e descarregam o que submeteram.

## Lista de cliques para o Nuno

1. **Imagens (A):** abre o link da INNOV-ID numa janela privada: a capa e o logo aparecem; volta a abrir passado um minuto: continuam lá.
2. **Segundo tester (B):** se ele estiver dentro de um Developer Viewer, o link mostra agora o aviso com as três saídas; "Leave Developer Viewer…" leva-o ao fluxo normal.
3. **Apagar (C) — nunca a INNOV-ID:** cria uma call de teste (Calls → New call), dá-lhe um nome e uma pergunta e carrega em Delete call. Vê o resumo e a promessa dos 30 dias, escreve o nome (o botão só liga quando bate) e confirma.
4. Marca "Deleted calls (1)": a call está lá com "30 days left to restore". Carrega em **Restore**: volta à lista.
5. Apaga-a outra vez: o link dela diz "This call is no longer available".
6. Se a call de teste tiver uma candidatura (rascunho ou submetida) de uma conta de teste, essa conta recebe o email e o aviso, e em Calls → My applications vê a candidatura marcada **Cancelled**; a submetida abre numa página só de leitura com **Download** junto a cada ficheiro.

A purga ao fim dos 30 dias corre no tick diário; só a vi correr nos testes (ver os limites em DECISIONS).
