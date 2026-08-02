# Prompt 92 — gate de lançamento + startups fictícias, construído; instalação da PWA, proposta

## 1. Gate de lançamento (Setembro 2026) — CONSTRUÍDO e enviado

**Todos os pontos de entrada verificados e cobertos**, como pedido — só há dois no código real (o
terceiro, `/matchdeal/pair`, é apenas um redirect legado para `/pair`, confirmado por leitura):

- **`/pair`** — o deck em si. O gate corre logo a seguir a confirmar a sessão (`user` existe), **antes**
  de consumir qualquer token de QR ou de resolver o perfil próprio — uma conta não-`@ablute.pt` nunca
  chega a ver o baralho, mesmo que tenha um link/token válido.
- **`MatchDealPairingModal.tsx`** (botão "Connect MatchDeal" no founder e no investor workspace) — o
  gate corre antes de gerar QR ou mostrar emparelhamentos existentes.

**Mecanismo**: rota nova `GET /api/matchdeal/launch-gate`, servidor, devolve `{ allowed: boolean }` a
partir da sessão Supabase real (`isAbluteTeamEmail()`, já existente em `supabase-server.ts`, mesma regra
usada noutros sítios da app — não inventei uma segunda forma de verificar `@ablute.pt`). Deliberadamente
não é uma verificação só no cliente (`user.email` lido diretamente no browser) — é o único mecanismo a
impedir uma conta real de ver o baralho fictício antes de Setembro, por isso passa pela mesma sessão de
confiança que o resto da app usa, não por um valor que o cliente já tem à mão.

**Copy usada** (proposta, seguindo o sentido que pediram — "não decidam sozinhos a wording final" já
ficou registado, isto é texto de trabalho, não definitivo):
> 🚀 **MatchDeal launches in September 2026**
> Check back soon — we're not quite ready for you yet.

**Pergunta que deixaram em aberto — não decidi sozinho**: se o gate se aplica só ao MatchDeal ou também
a outras partes da app. **Apliquei só ao MatchDeal**, como o próprio texto do Prompt 92 presumia — não
toquei em nenhuma outra rota. Confirmem se é para alargar.

## Startups fictícias — CRIADAS, visíveis hoje só a `@ablute.pt` (efeito do gate, não de um filtro novo)

Criei 5 perfis `kind='startup'` fictícios, mesmo estilo dos 7 investidores `(demo)` já existentes —
nomes com sufixo "(demo)", descrição explícita "Demo profile for the MatchDeal presentation — not a
real startup.", setores/estágios variados para dar alguma diversidade real ao baralho:

| Nome | Setores | Estágio | País |
|---|---|---|---|
| Nordholm Robotics (demo) | hardware, robotics, deep tech | seed | Portugal |
| Verdant Health (demo) | digital health, health, wellness | pre_seed | Portugal |
| Fluxo Pay (demo) | fintech, saas | series_a | Portugal |
| Terraluz Climate (demo) | climate, hardware | seed | Spain |
| Aurea Marketplace (demo) | consumer, marketplace, wellness | pre_seed | Portugal |

Confirmado por SQL: `select count(*) filter (where is_visible) from matchdeal_profiles where
kind='startup'` → **5** (antes: 0). O perfil startup real do Nuno (`fc9974e7...`, ablute_) continua
`is_visible=false` — não toquei nele, fica à parte para a decisão que já lhe tinha deixado em aberto
(preencher os campos em falta vs. manter só como conta de teste).

**Decisão de desenho, registada com transparência**: **não** acrescentei nenhuma coluna/filtro novo a
`matchdeal_eligible_deck()` para marcar estes perfis como "só visíveis a @ablute.pt" — não foi preciso,
porque o **gate de lançamento já impede qualquer conta não-`@ablute.pt` de chegar ao baralho de todo**.
Isto significa que, tal como está, estes 5 perfis são tecnicamente visíveis a qualquer conta que
consiga passar o gate — hoje, só `@ablute.pt`. **Quando o gate for levantado em Setembro (ou antes, se
decidirem abrir a fasar)**, aí sim vai ser preciso o filtro dedicado que Nuno pediu originalmente
("à medida que startups reais forem criando conta... substituindo gradualmente os fictícios") — não
construí esse filtro agora porque seria schema+motor de matching sem necessidade imediata, exatamente o
tipo de mudança que a doutrina pede para propor primeiro. Fica registado como trabalho futuro, não
esquecido.

`membership_id` destes 5 perfis é um UUID sintético, **sem linha correspondente em `orgs`** (ao
contrário dos investidores demo, que têm uma cadeia falsa completa em `matchdeal_investor_members`) —
decisão deliberada: `orgs` é a tabela real de produção usada em todo o CRM/backoffice/métricas, e criar
linhas fictícias lá tem um risco de contaminação muito maior do que nas tabelas mais isoladas do
MatchDeal. Não há FK a aplicar (confirmado, `matchdeal_profiles.membership_id` não tem constraint de
chave estrangeira), por isso isto não parte nada — só significa que, se algum dia um destes perfis
fictícios produzisse um match real (não deveria, mas por rigor), o passo de ligar isso a uma entrada de
Pipeline simplesmente não encontraria nenhum org e não faria nada, não rebentaria.

`tsc`/`vitest` (325/325)/`build`, todos limpos.

---

## 2. Instalação forçada da PWA — investigado, PROPOSTA escrita, nada construído (como pedido)

Confirmado por grep: não existe hoje nenhum código de `beforeinstallprompt` nem deteção de
`display-mode: standalone` em lado nenhum do repositório — isto é trabalho genuinamente novo.

**O que é tecnicamente possível** (resumindo o que o próprio Prompt 92 já sabia e eu confirmei):
Android/Chrome expõe `beforeinstallprompt`, que permite guardar o evento e mostrar um botão "Instalar"
nativo a qualquer momento à nossa escolha; iOS/Safari não tem esse evento — a única forma é uma
instrução visual ("toca Partilhar → Adicionar ao ecrã principal"), sempre manual.

**Proposta de desenho** (para aprovação, não construída):
1. **Deteção de plataforma + estado de instalação**: no `/pair/page.tsx` (depois do gate de
   lançamento, só para contas `@ablute.pt` já elegíveis), verificar `window.matchMedia('(display-mode:
   standalone)').matches` (ou `navigator.standalone` em iOS) para saber se já está instalado — se sim,
   nunca mostrar nada disto.
2. **Android**: capturar `beforeinstallprompt` num listener global (fora do React, num efeito ao nível
   da app), guardar o evento, e mostrar um ecrã cheio "Add MatchDeal to your Home Screen" com um botão
   que chama `event.prompt()` — um toque, sem instruções, porque a API já trata disso.
3. **iOS**: sem evento equivalente, o ecrã mostra instruções passo-a-passo ilustradas (ícone de
   Partilhar → "Adicionar ao ecrã principal"), já que não há forma de automatizar mais do que isto.
4. **Recorrência**: mostrar isto na primeira visita e, se recusado/fechado, voltar a mostrar depois de N
   dias ou de M sessões (não instalado) — não a cada visita, isso seria fricção a mais. Proponho 3 dias
   ou 3 sessões, o que vier primeiro, mas não é definitivo.
5. **Ligação ao 2.3 (sessão curta)**: como o próprio Nuno já suspeitava, uma PWA instalada em modo
   standalone tende a manter sessão mais tempo no iOS do que uma aba normal do Safari (é um
   comportamento conhecido da plataforma, não corrigível dentro da app) — isto pode aliviar o sintoma
   sem nunca precisarmos de confirmar a causa exata. Continua a não ser prova de que é a causa — só uma
   mitigação plausível que vale a pena tentar de qualquer forma.

**Não construí nada disto** — é uma peça de UX nova, exatamente como pedido ("proponham antes de
construir"). À espera de OK para arrancar.

---

## Disciplina seguida

`access_grants` e o motor de matching intocados (a decisão de não filtrar os fictícios por email dentro
de `matchdeal_eligible_deck()` foi deliberada, ver acima). Nenhum schema novo foi necessário para o
gate nem para os perfis fictícios — reutilizei `isAbluteTeamEmail()` já existente e um padrão de dados
já estabelecido pelos investidores demo. `orgs` (tabela de produção real) não foi tocada. `tsc`/
`vitest`/`build` limpos.
