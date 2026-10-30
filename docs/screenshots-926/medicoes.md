# Prompt 926 — o que se mediu, com que instrumento, e o que NÃO se pôde medir (30/10/2026)

**Faixa de logos da landing.** Código: ramo `feat/926-landing-logo-carousel`, a partir de `58e708fb` (o `main` do início do trabalho). Tudo local, sobre a build de produção
(`next build` + `next start`), Windows, Chrome 141+ (Playwright 1.61 e Lighthouse 13.5.0).

## Como se mediu

- **«Antes»** = `58e708fb` construído tal e qual num worktree à parte, servido na porta 3101 (o worktree já foi apagado). **«Depois»** = este ramo, com **8 logos de teste `zz-test-*`
  autorizados** (os PNG entregues, copiados com outro nome só para esta medição; nunca entram num commit), servido na porta 3100. Há duas razões para não usar os reais: não estão
  autorizados (a faixa não os mostra) e as capturas vão para um repositório público.
- **A autenticação está ligada** nas duas builds, com um Supabase de substituição em `127.0.0.1:54321` (401 em `/auth`, `[]` em `/rest`), para que `/` e `/investors` sejam páginas
  **dinâmicas** como em produção (a landing lê a sessão para reencaminhar quem já tem conta). Nenhuma chamada sai da máquina e nenhuma credencial é real.
- **Capturas:** Playwright, viewport **exactamente** LxA (a janela já sem barras do browser), a 1 ponto por píxel (no telemóvel, 2). As imagens dos logos são trocadas, **no browser**,
  por discos sintéticos `zz-test-*` do mesmo tamanho (512×512), para que nada do que fica no repositório mostre uma empresa real; as medidas de posição não dependem disso.
  `before-measurements.json` e `after-measurements.json` têm todas as medidas (posição do topo, da faixa, da barra de checks, altura das colunas, erros de consola: 0 em todas).
- **Lighthouse 13.5.0**, Performance, móvel simulado (o que o PageSpeed usa; e desktop), uma corrida de aquecimento deitada fora antes de cada série. Os registos de todas as corridas
  estão em `lighthouse/`.

## A faixa está inteira à vista, sem scroll

### For Startups (`/`)

| Janela | Antes: o topo acaba em | Depois: a faixa ocupa | A faixa está inteira sem scroll? | Depois: a barra escura dos checks ocupa |
| --- | --- | --- | --- | --- |
| 1280x720 | 865 px (fica 145 px abaixo) | 606–694 px | **sim** (cabe, sobram 26 px) | 694–753 px (fica 33 px abaixo) |
| 1366x768 | 865 px (fica 97 px abaixo) | 606–694 px | **sim** (cabe, sobram 74 px) | 694–753 px (cabe, sobram 15 px) |
| 1440x900 | 865 px (cabe, sobram 35 px) | 606–694 px | **sim** (cabe, sobram 206 px) | 694–753 px (cabe, sobram 147 px) |
| 1920x1080 | 865 px (cabe, sobram 215 px) | 606–694 px | **sim** (cabe, sobram 386 px) | 694–753 px (cabe, sobram 327 px) |
| 375x812 | 1545 px (fica 733 px abaixo) | 1155–1244 px | não é exigido no telemóvel; fica logo a seguir à imagem do pipeline (fica 432 px abaixo) | 1244–1484 px (fica 672 px abaixo) |

### For Investors (`/investors`)

| Janela | Antes: o topo acaba em | Depois: a faixa ocupa | A faixa está inteira sem scroll? | Depois: o topo acaba em |
| --- | --- | --- | --- | --- |
| 1280x720 | 777 px (fica 57 px abaixo) | 581–669 px | **sim** (cabe, sobram 51 px) | 669 px |
| 1366x768 | 777 px (fica 9 px abaixo) | 581–669 px | **sim** (cabe, sobram 99 px) | 669 px |
| 1440x900 | 777 px (cabe, sobram 123 px) | 581–669 px | **sim** (cabe, sobram 231 px) | 669 px |
| 1920x1080 | 777 px (cabe, sobram 303 px) | 581–669 px | **sim** (cabe, sobram 411 px) | 669 px |
| 375x812 | 1239 px (fica 427 px abaixo) | 1093–1182 px | não é exigido no telemóvel; fica logo a seguir à imagem do pipeline (fica 370 px abaixo) | 1182 px |

Ficheiros: `before-<página>-<LxA>.jpg` e `after-<página>-<LxA>.jpg` (`startups` = `/`), e `…-375x812-hero-full.jpg` com o topo inteiro do telemóvel.

- A faixa tem 88 px de altura (64 px de logo + 12 px acima e abaixo). **O que decide é a altura da janela do browser**: a faixa só fica inteira à vista com uma janela de pelo menos
  **694 px de altura em `/`** e **669 px em `/investors`**. Os números acima são viewports de LxA; num portátil de 1366×768 com as barras do browser e a barra de tarefas a janela útil
  anda pelos 640–650 px, e aí a faixa de `/` aparece cortada nuns 45 px em baixo (a de `/investors` cabe). Para caber também nesse caso teria de se mexer em tamanhos de letra ou em
  textos, o que o pedido proíbe; fica como decisão do Nuno.
- A página For Investors **não tem barra escura dos checks** (só a das startups tem), por isso a faixa é a última coisa do topo.
- No telemóvel a faixa vem **logo a seguir à imagem do pipeline** (que está por baixo dos botões) e antes da barra dos checks. O pedido diz «logo a seguir aos botões»; pô-la entre
  os botões e a imagem é possível, mas parte o topo escuro ao meio com uma faixa branca: pergunta no relatório.

## Lighthouse (móvel simulado): CLS e LCP, antes e depois

**Resumo.** **CLS: igual** (0,0006 em `/`, 0,0009 em `/investors`, antes e depois: não é zero porque os links da navegação se mexem quando chega o tipo de letra, e já acontecia;
a faixa não acrescenta nenhum deslocamento: as imagens têm largura e altura). **LCP: igual dentro do ruído**: o elemento do LCP é o mesmo parágrafo do topo antes e depois, o trabalho
da thread principal é igual, e nas medianas de corridas **intercaladas** a diferença é de +14 ms em `/` e +70 ms em `/investors`, com cada lado a oscilar entre 2870 e 4520 ms.

O que torna isto difícil de ler: **nesta máquina o Lighthouse móvel é bimodal.** O FCP simulado só toma dois valores, ≈1360 ms ou entre 1670 e 2290 ms, quase ao acaso (mais de uma
corrida em três cai no valor lento), e arrasta o LCP 0,3–1,2 s. Acontece nas duas versões e até com todos os pedidos dos logos bloqueados. Por isso a primeira série (não intercalada)
enganou: parecia que `/investors` piorava 1,1 s, e eram só as corridas lentas a caírem do lado do «depois». A série que conta é a intercalada (antes, depois, antes, depois… na mesma
máquina, no mesmo minuto).

### Série que conta: corridas intercaladas (`lighthouse/2-…` e `3-…`)

| Página | Lado | Corridas | Perf | FCP | LCP: mediana (mín–máx) | TBT | CLS | Corridas lentas (FCP > 1,5 s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | antes | 14 | 91,5 | 1670 ms | 3259 ms (2873–4362) | 24 ms | 0,0006 | 8 de 14 |
| `/` | depois | 14 | 92,5 | 1362 ms | **3273 ms** (2867–4523) | 20 ms | 0,0006 | 4 de 14 |
| `/investors` | antes | 8 | 93,5 | 1362 ms | 3173 ms (2945–4156) | 0 ms | 0,0009 | 3 de 8 |
| `/investors` | depois | 8 | 93 | 1359 ms | **3243 ms** (2937–4296) | 14 ms | 0,0009 | 2 de 8 |

(`/`: duas séries, de 8 e de 6 rondas, juntas; na segunda correu-se também um terceiro braço, «depois» com os pedidos dos logos bloqueados: LCP 3510 ms e 3 corridas lentas em 6, tão
ruidoso como os outros e sem ser melhor do que o «depois» com logos, o que mostra que o peso dos ficheiros não é a causa da oscilação.)

### Mesma coisa, o que está por baixo

- **O elemento do LCP** é o mesmo nas duas versões: o segundo parágrafo do topo (`p.lead`, 364×145 px no telemóvel). O atraso de desenho do elemento, observado, é de 127 ms (antes) e
  142 ms (depois); o FCP e o LCP observados (sem simulação) são 167 ms (antes) e 177 ms (depois).
- **Trabalho da thread principal** (Lighthouse, `mainthread-work-breakdown`): Style & Layout 552 → 570 ms, Script 268 → 260 ms, Rendering 249 → 225 ms; sem tarefas longas novas.
- **O que muda de facto**: 40 → 48 pedidos e 546 → 1019 KB transferidos, ou seja, os 8 PNG (468 KB). Têm prioridade «Low» (`fetchPriority="low"`).
- **Com a rede estrangulada a sério** (`--throttling-method=devtools`, 1,6 Mbit/s e 150 ms, FCP e LCP observados, `/investors`, 3 pares, `lighthouse/6-…`): **com** os 468 KB de logos
  FCP = LCP = 1732 ms (1732, 1719, 1785), **sem** eles (pedidos bloqueados) 1839 ms (1845, 1786, 1839). Os logos não atrasam nada: chegam depois do que é preciso para o texto.
- **O peso dos ficheiros** só contaria no simulador, e mesmo aí sem efeito que se veja: com os logos refeitos a 192×192 (145 KB; `lighthouse/5-…`) as medianas são FCP 1359 / LCP 3242 ms
  com logos contra 1738 / 3771 ms sem eles (ruído). Mesmo assim convém reexportá-los (ver abaixo).

### Primeira série (não intercalada, cinco corridas por página; `lighthouse/1-…`), para que conste

| | `/` antes | `/` depois | `/investors` antes | `/investors` depois |
| --- | --- | --- | --- | --- |
| Móvel: Perf / FCP / LCP / TBT | 95 / 1372 / 2894 / 31 | 92 / 1366 / 3399 / 19 | 92 / 1363 / 3264 / 22 | 82 / 2265 / 4375 / 24 |
| Desktop: Perf / FCP / LCP | 100 / 504 / 796 | 99 / 497 / 824 | 99 / 497 / 856 | 99 / 493 / 888 |
| Acessibilidade / Boas práticas / SEO (todas as corridas) | 96 / 100 / 100 | 96 / 100 / 100 | 96 / 100 / 100 | 96 / 100 / 100 |

## Os oito ficheiros entregues (sem nomes)

PNG 512×512, 8 bits RGBA, sem texto escondido nem dados depois do fim (estrutura verificada à mão, cada chunk com o CRC certo). **Todos iguais no formato**: um **disco branco opaco**
(255,255,255) com um fio cinzento no contorno e cantos transparentes; o desenho ocupa **78% da largura (72% num) mas só 14% a 48% da altura** do disco (proporção 1,5:1 a 5,4:1);
pesam **34 a 132 KB cada, 468 KB no total**, para umas dezenas de píxeis no ecrã. Medido: a 36 px o desenho de uma empresa ficaria com 5 a 17 px de altura; a 64 px (o disco inteiro) fica
com 9 a 31 px. Por isso a caixa de cada logo é o disco (64 px; 44 px no telemóvel; constantes em `src/content/site/logo-strip.ts`). Refeitos a 192×192 (uma cópia só para a experiência,
os ficheiros não foram tocados) pesariam 145 KB no total; recortados e em SVG/WebP, bastante menos.

## «Reduzir movimento»

`after-startups-1280x720-reduced-motion.jpg` e `…375x812-reduced-motion.jpg`: a faixa fica parada, numa linha de logos inteiros (os que não cabem ficam fora de vista, nenhum cortado) e sem
as cópias da volta. **Achado fora do âmbito, anterior a este prompt:** nessas capturas a janela do pipeline do topo aparece **vazia**. Não é da faixa: verificado na build de **antes**
(`58e708fb`), com «reduzir movimento» ligado, os 7 cartões de `/` e as 4 linhas de `/investors` ficam com opacidade 0 (0 visíveis). Nascem a opacidade 0 e só a animação `cardIn`
os mostra, e a regra global de «reduzir movimento» (`animation: none !important`) desliga-a. Uma linha de CSS (`.kcard, .dealRow { opacity: 1; transform: none; }` dentro desse
`@media`) corrige-o; não a fiz porque está fora do âmbito («não mexas no resto do design da landing»).

## O que NÃO foi feito, e porquê

- Lighthouse e capturas **em produção**: só depois de haver 6 autorizações e um deploy; nada disto foi enviado para o GitHub.
- Os logos reais não estão autorizados, por isso não aparecem em lado nenhum da página; as capturas com eles (para o Nuno ver) estão só no commit local dos logos.
- Não corri a faixa num leitor de ecrã real: a prova de «anunciada uma só vez» é o teste de estrutura (`logo-strip.test.tsx`): uma região com nome, uma só lista sem `aria-hidden`, as
  cópias com `aria-hidden` e texto alternativo vazio.
- O `next build` falhou duas vezes em seis, sem relação com o código, ao ir buscar as fontes ao Google (`TypeError … reading '1'` no `next/font`); repetir passou sempre.
