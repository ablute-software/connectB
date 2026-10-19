# Prompt 920 (adenda de 19/10) — contraste (WCAG AA): o que falha, a correcção proposta e a prova. O Nuno decide; o aspecto existente **não foi tocado**

A adenda diz que a correcção de tom é do Nuno. Esta página é o que ele precisa para decidir: o inventário **completo**, o que cada correcção faz ao aspecto,
uma imagem antes/depois de cada uma e a prova de que estas e só estas limpam a regra.

## 1. O Lighthouse mostra menos do que existe

O Lighthouse de 19/10 acusou **dois** pares na home. Mas a landing revela as secções ao fazer scroll (começam em `opacity: 0`) e o Lighthouse não avalia o que ainda está
invisível. Com o axe-core (o motor por baixo do score de acessibilidade) a correr nas páginas **inteiras**, com as secções visíveis, são **cinco** pares e **10–12 elementos
por página** na home e em `/investors` (`axe-contrast.txt`):

| # | Par (texto sobre fundo) | Razão | Onde | Proposta | Razão depois | O que se vê |
|---|---|---|---|---|---|---|
| 1 | **branco `#ffffff` sobre âmbar `#d9a441`** | **2,24** | botões principais: "Start free", "Create your account", "Claim your investor profile" | texto `--ink` `#0c272e` (**o que a folha de estilo já pede**, ver §2) | **6,94** | o botão fica âmbar com texto azul-petróleo escuro em vez de branco — a única que se nota logo. [imagem](contrast-proposal/1-cta-white-on-amber-vs-ink-on-amber.png) |
| 2 | **teal `#2a7f8e` sobre `--bg` `#f7fafa`** (os eyebrows) | **4,42** | "The case file", "Company facts", "Momentum", "What you get", "Access", "Priority", "Questions"… | cor do texto 2% mais escura, `#297c8b` | **4,60** | imperceptível. [imagem](contrast-proposal/2-eyebrow-vs-2pct-darker.png) |
| 3 | **âmbar `#d9a441` sobre branco** (as etiquetas) | **2,24** | "Open the case", "Follow the clues", "Close the case"; em `/investors` "Claim & verify", "Build your mandate", "Qualify and decide" | o âmbar escuro que a paleta já usa nos ícones (`#8a6414`) | **5,37** | as etiquetas passam de âmbar vivo a âmbar-castanho; continuam âmbar. [imagem](contrast-proposal/3-amber-label-vs-dark-amber.png) |
| 4 | **cinzento `#22343a` sobre teal `#2a7f8e`** | **2,79** | botão "Choose this plan" do plano em destaque; "Claim this profile" / "Claim your profile" em `/investors` | texto branco (**o que a folha de estilo já pede**, ver §2) | **4,64** | o texto do botão passa de cinzento-escuro a branco. [imagem](contrast-proposal/4-teal-button-grey-vs-white-text.png) |
| 5 | **`#9fb2b8` sobre branco** | **2,20** | linha de copyright do rodapé, em todas as páginas | o token que já existe, `--muted` `#5b7077` | **5,21** | uma linha pequena, de cinzento-azulado claro a cinzento-ardósia. [imagem](contrast-proposal/5-footer-copyright-vs-muted.png) |

(O rótulo inactivo do toggle Startups/Investors sobre a nav branca, `--muted` sobre `--teal-soft`, dava 4,47; está **já corrigido nas páginas novas** com 2% de escurecimento — é aparência nova, não alterei a existente. O mesmo para o eyebrow da secção nova de `/investors`.)

## 2. Os pares 1 e 4 não são uma escolha de design: são um bug de especificidade

`landing.module.css` diz, na linha 61, `.btnPrimary { background: var(--amber); color: var(--ink); }` e, na 65, `.btnTeal { background: var(--teal); color: #fff; }`.
Mas o que se desenha é branco sobre âmbar e cinzento sobre teal. Medido no browser (`CSS.getMatchedStylesForNode`, build de produção local):

```
"Start free"            computed color = rgb(255, 255, 255)
  .landing a   (0,1,1)  { color: inherit }      <- ganha
  .btnPrimary  (0,1,0)  { color: var(--ink) }   <- perde

"Choose this plan"      computed color = rgb(34, 52, 58)   (#22343a, o texto corrente herdado)
  .landing a   (0,1,1)  { color: inherit }      <- ganha
  .btnTeal     (0,1,0)  { color: #fff }         <- perde
```

`.landing a { color: inherit }` (uma classe e um elemento) vence sempre `.btnPrimary` / `.btnTeal` (só uma classe). É a mesma armadilha que o próprio ficheiro já documenta no `.nav .logo`
("qualified with .nav so this beats `.landing a { color: inherit }`"). Ou seja, **corrigir os pares 1 e 4 é fazer a folha de estilo dizer o que já diz**, não inventar um aspecto.
Se o branco sobre âmbar era um aspecto deliberado, a alternativa é um âmbar mais escuro com texto branco (`#8d6b2a`, 4,92:1) — muda a cor de marca dos botões; não recomendo.

## 3. Prova (axe-core 4.12, regra `color-contrast`, páginas inteiras, secções reveladas)

```
as built             /  10 · /investors 12 · /for-startups 2 · /about 1 · /faq 1
com as 5 correcções  /   0 · /investors  0 · /for-startups 0 · /about 0 · /faq 0
```

Com as cinco correcções (e o `--muted` do toggle, já nas páginas novas) o axe não encontra nenhum par abaixo de 4,5:1 em nenhuma das cinco páginas públicas.
(As correcções foram injectadas como CSS na página real; nenhum ficheiro da app foi alterado.)

## 4. Como se aplica, se disseres que sim (≈ 7 linhas em `src/app/landing.module.css`, mais o `--muted` do toggle)

```css
.landing .btnPrimary { color: var(--ink); }          /* 1  — o que .btnPrimary já pede, com a especificidade para o conseguir */
.landing .btnTeal    { color: #fff; }                /* 4  — idem */
.eyebrow             { color: #297c8b; }             /* 2  — 2% mais escuro; o .firstContact .eyebrow da secção nova fica redundante */
.landing .tagline    { color: #8a6414; }             /* 3  — o âmbar escuro da paleta */
.cp                  { color: var(--muted); }        /* 5  — token que já existe */
```

Efeito esperado no Lighthouse (que só vê a parte visível): a acessibilidade da home e de `/investors` passa de 96 para 100. Depois do deploy volto a medir em produção.

## 5. Se disseres que não

Nada se estraga: fica como hoje. A acessibilidade fica em 96 nas páginas públicas (os três sinais estruturais da adenda — `main`, ordem dos títulos, nome do `select` — já estão resolvidos), abaixo dos 98 que a adenda
pede, e o contraste real dos cinco pares acima continua por corrigir mesmo onde o Lighthouse não o vê.
