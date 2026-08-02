# Prompt 91 — os três achados, um a um

## 2.1 — gestos trocados — CORRIGIDO

Confirmado exatamente como descrito: os dois blocos (`y < 0` / `y > 0`) estavam trocados face ao
combinado. Troquei os dois blocos de lugar em `MatchDealDeck.tsx` — agora **swipe para cima avança o
mini-pitch** (`subIndex` sobe), **swipe para baixo volta um sub-card ou, no primeiro, abre a folha de
Boost**. Atualizei também o `aria-label` do gesto e a legenda em texto no rodapé do deck para bater com
a nova direção. `matchdeal_eligible_deck` e a ordenação do baralho não foram tocados.

## 2.2 — "baralho quase esgotado" — investigado a fundo, 3 achados, só 1 precisa de ação vossa/minha

**Achado 1 (confirmado, real) — não há nenhuma startup demo visível.** `select count(*) from
matchdeal_profiles where kind='startup' and is_visible=true` → **0**. Existe uma única linha
`kind='startup'` em toda a base — a do próprio Nuno (`fc9974e7...`) — e está `is_visible=false`
(consequência direta de `is_complete=false`: falta `company_phase`, entre outros campos obrigatórios).
Quando alguém testa a partir do **lado investidor**, não há literalmente nenhuma startup para mostrar,
com ou sem `deck_replay_mode`. **Isto não se corrige em lógica — precisa de dados.** Duas opções, à
vossa escolha: (a) preencher os campos em falta no próprio perfil do Nuno para ele passar a
`is_visible=true` (uma startup real, não fictícia), ou (b) criar perfis `kind='startup'` fictícios de
demonstração, ao estilo dos 7 investidores `(demo)` que já existem. Não escolhi por vocês — digam qual,
e eu ou aplico os campos em falta (opção a, imediato) ou preparo os dados de demo (opção b).

**Achado 2 (confirmado, mas não é bug — é o desenho a funcionar como escrito).** Chamei
`matchdeal_eligible_deck('fc9974e7...', 20)` diretamente (seguro para esta conta especificamente — é
precisamente o efeito colateral de reset que o `deck_replay_mode` foi desenhado para ter, aprovado por
escrito a 01/08; não fiz isto a nenhuma conta real). **Resultado ao vivo, agora: devolve exatamente 1
perfil** — "Northbound Ventures (demo)", o único dos 7 investidores visíveis que o perfil do Nuno tinha
**passado** (não gostado). Isto bate ponto por ponto com o texto do próprio addenda: sob
`deck_replay_mode`, só perfis com `direction='like'` são excluídos — um `pass` nunca exclui
permanentemente, reaparece sempre. E o reset completo ("recomeça do zero") só dispara quando **todos**
os perfis do pool tiverem sido, nalgum momento, marcados como `like` — com 6 likes + 1 pass num pool de
7, falta precisamente gostar desse último para o ciclo completo reiniciar. **Não é bug, é a regra
escrita a funcionar** — só parece "quase esgotado" porque o pool real tem só 7 perfis investidor no
total, não porque a lógica esteja errada.

**Achado 3 (hipótese testada e REFUTADA por dados, não aplico o fix proposto).** Verifiquei
`phases_accepted` dos 9 perfis investidor (os 7 visíveis e os 2 ocultos): **todos têm
`phases_accepted = '{}'` (array vazio)**, nenhum populado. Em Postgres, `array_length('{}', 1)` devolve
`NULL`, e a condição do filtro é `array_length(p.phases_accepted,1) is null or ...` — como está sempre a
dar `NULL` (nunca há um array com elementos), o ramo `is null` é sempre verdadeiro e o filtro nunca
exclui ninguém por fase hoje. `company_phase` estar `null` no perfil do Nuno não está, neste momento, a
esconder nenhum investidor. **Não apliquei nenhuma alteração a `matchdeal_eligible_deck()`** — seria
mexer no motor de matching para corrigir algo que os dados mostram não estar a acontecer. Fica
registado como um ponto de fragilidade teórica (o dia em que alguém preencher `phases_accepted` nalgum
perfil, o comportamento de `null` do lado do viewer passa a importar) — não urgente, sem impacto hoje.

## 2.3 — sessão do MatchDeal a expirar em minutos — investigado, causa NÃO localizada no código

Path completo revisto: `src/lib/supabase.ts` (`browserClient()` usa `createBrowserClient` do
`@supabase/ssr` sem nenhuma configuração de expiração customizada — só o `cookieOptions.domain`
partilhado entre `sherlockdeal.com` e `app.sherlockdeal.com`), `matchdeal-pairing.ts` (confirmado, como
já suspeitavam: `PAIRING_TOKEN_TTL_MS` de 5 min é só o token do handshake do QR, nunca reutilizado como
TTL de sessão — grep confirma zero outras referências), `middleware.ts` (sem lógica de sessão
específica de MatchDeal). **Não encontrei nenhum código neste repositório que force uma sessão curta.**

A pista mais provável, dado que isto é especificamente uma **PWA instalada** (`manifest.json`,
"Adicionar ao ecrã principal"): o Safari/WebKit em iOS trata o armazenamento (cookies/localStorage) de
uma PWA em modo standalone de forma diferente do Safari normal — é um problema conhecido da plataforma,
não deste código, e mitigá-lo (se for mesmo isto) precisa de confirmação de qual é o caso real. **Preciso
de uma resposta vossa para avançar**: isto acontece no ícone instalado no ecrã principal, ou no
Safari/Chrome normal do telemóvel? E em que aparelho/browser exatamente? Sem isso, continuar a procurar
seria adivinhar em código que já confirmei estar limpo.

## 2.4 — rodapé sem separadores

Sem novidade, como o próprio Prompt 91 já assinalava — continua registado, sem ação aqui.

---

## §0 — respostas recebidas, registadas, sem ação de código ainda

Preçário pós-login (copy "tudo do plano anterior +"), gate de Boost no tier grátis, packs avulsos
(expiração 120 dias, ordem de consumo, preço 3x do lado investidor — a confirmar a leitura do "3x"),
Google Drive Tipo B (fica com o Nuno), imagens do redesign do About (confirmadas, descrição registada)
— nenhum destes estava na "Prioridade sugerida" deste prompt (só 2.1/2.2/2.3), por isso não avancei
código para nenhum ainda. Ficam prontos para entrar na fila quando for a vez deles.

---

## Deploy confirmado

Commit `ef9df5a` — GitHub Deployments API, deployment `5713382594`, `state: success`.

## Disciplina seguida

Evidência sempre — os três achados do §2 vêm de SQL/código lidos agora, incluindo uma chamada direta e
deliberada a `matchdeal_eligible_deck()` (justificada e limitada à conta de teste que já tem este
efeito colateral aprovado). Nenhuma alteração ao motor de matching foi aplicada — Achado 3 confirma que
não era preciso. `access_grants` intocado. `tsc`/`vitest` (325/325)/`build` limpos depois do fix de
2.1.
