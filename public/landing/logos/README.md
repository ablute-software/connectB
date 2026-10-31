# Logos da landing (Prompt 926, 30/10/2026; carrossel de volta a 31/10/2026)

Os logos abrem a zona clara da landing, logo por baixo do hero (por baixo da barra escura dos quatro cheques, na página das **startups**): um título ao centro e **um carrossel de uma só linha** que anda sozinho para a esquerda, sobre a cor da própria página, sem faixa, sem cartões, sem círculos e sem grelha em nenhuma resolução (uma grelha fixa dá a ideia de que são todas as organizações da plataforma, e o título diz que são exemplos). Na página das **startups** o título é «Some of the startups already on Sherlock Deal» e os logos são os das startups; na página dos **investidores** é «A selection from 500+ investor profiles in our database» (são perfis do catálogo, nenhum deles reclamou o seu perfil: o título dá a dimensão da base de dados e não diz que usam a plataforma). Cada página tem os seus logos (campo `pages` da lista: `"startups"` ou `"investors"`; `"both"` mostraria o mesmo nas duas, o que a página dos investidores já não quer).
**Mostrar o logo de uma empresa diz publicamente que ela está na Sherlock Deal**, por isso esta pasta tem uma regra que não se contorna:

> **Um logo só aparece com a autorização REGISTADA** — a data e a forma (um email da empresa, os termos que aceitou, ou a decisão do dono da plataforma, registada como tal). Sem esse registo o logo não é mostrado
> e o `npm run build` avisa. A secção só aparece quando uma página tem **6 ou mais** logos autorizados; com menos desaparece (e a página passa do hero direto à secção seguinte).

A autorização é tratada pelo Nuno, fora do código. Quem mexe aqui não a inventa: se ainda não foi dada, a linha fica `"pending"`.

(Este ficheiro está em `public/`, logo é servido em `/landing/logos/README.md`: não escrever aqui nomes de empresas nem dados pessoais. O repositório também é público.)

## Onde está cada coisa

| O quê | Onde |
| --- | --- |
| Os ficheiros dos logos | esta pasta, `public/landing/logos/` |
| A lista (uma linha por logo, com a autorização) | `src/content/site/landing-logos.json` |
| O título por cima do carrossel, a velocidade, o tamanho que cada logo ocupa, o espaço entre eles e o comprimento do desvanecimento (`LOGO_STRIP_FADE`) | `src/content/site/logo-strip.ts` |
| A regra «só com autorização, mínimo de 6», o tamanho de cada logo (`logoBoxes`), a largura da janela (`noRepeatWindow`), as cópias do loop e a duração de cada volta | `src/lib/landing-logos.ts` |
| O aviso do build | `scripts/check-landing-logos.mjs` (`npm run verify:landing-logos` corre-o sozinho) |

## Juntar um logo

1. **O ficheiro.** SVG, ou PNG/WebP com fundo transparente, **recortado sem margens** (o desenho encosta aos bordos do ficheiro), nome em minúsculas sem espaços
   (`nome-da-empresa.svg`). Sem disco branco, sem círculo, sem cartão e sem contorno à volta (Nuno, 31/10/2026): um teste em Chrome abre cada ficheiro e recusa um com mais de 5% de branco opaco
   ou com mais de 6 px de margem. O tamanho que cada logo ocupa não se escreve à mão: sai da forma do ficheiro (`logoBoxes`: todos com a mesma área, dentro de uma largura e de uma altura máximas),
   por isso um nome comprido fica largo e baixo e uma marca mais quadrada fica mais alta. Convém que pese pouco (um SVG simples ou um PNG de uns 10 KB; a faixa carrega com a página).
2. **A linha em `src/content/site/landing-logos.json`:**

   ```json
   {
     "name": "Nome da empresa",
     "file": "nome-da-empresa.svg",
     "width": 200,
     "height": 48,
     "pages": "both",
     "order": 10,
     "weight": 1,
     "authorization": { "date": "2026-11-05", "form": "email", "note": "pasta «Autorizações logos», conversa de 05/11" }
   }
   ```

   (`weight` é opcional; ver a tabela.)

   | Campo | O que é |
   | --- | --- |
   | `name` | o nome da empresa; é o texto alternativo da imagem (o que um leitor de ecrã lê) |
   | `file` | o nome do ficheiro nesta pasta (só letras, algarismos, `.`, `_` e `-`; termina em `.svg`, `.png` ou `.webp`) |
   | `width`, `height` | o tamanho do próprio ficheiro, em píxeis (num SVG, o `viewBox`); reserva o espaço antes de a imagem chegar, para a página não saltar. Um teste confere-os com o ficheiro |
   | `pages` | `"startups"`, `"investors"` ou `"both"`: em que página aparece |
   | `order` | a posição entre os logos, do menor para o maior; empate desfaz-se pelo nome |
   | `weight` | opcional, de 0,5 a 1,6 (1 se faltar): o ajuste ótico, um multiplicador da **área** em que o logo é desenhado (Nuno, 31/10/2026). Um bloco cheio ou uma marca escura e compacta pesa mais ao olho do que um nome fino da mesma área, por isso leva menos de 1 (0,85, 0,62…) e o fino leva mais (1,1, 1,2…). É um empurrão, nunca outro tamanho: o logo mantém a forma do ficheiro e continua limitado pela largura e pela altura máximas (um marco já na altura máxima só encolhe com um valor mais baixo). Vê-se numa folha de contactos antes de se fixar |
   | `authorization` | `"pending"` enquanto a empresa não autorizou; depois `{ "date": "aaaa-mm-dd", "form": "email", "terms" ou "owner", "note": "..." }` |

   `form` é `"email"` (a empresa autorizou por email), `"terms"` (aceitou uns termos) ou `"owner"` (decisão do dono da plataforma, sem prova da empresa em arquivo: o build escreve uma
   linha por cada logo mostrado assim, para não ser esquecido, e um email ou uns termos aceites substituem-na quando existirem). `note` é opcional e diz **onde está a prova** (uma etiqueta da caixa de correio,
   o assunto da conversa); nunca um endereço de email nem dados pessoais. A `date` não pode ser futura nem inexistente.
3. `npm run verify:landing-logos` diz o que ficou de fora e porquê; `npm test` e `npm run build` têm de passar.

## Os logos dos investidores (31/10/2026)

São ficheiros `vc-*.png`: o logótipo de cada firma tal como está no site da própria firma, **recortado e com o fundo branco passado a transparência** (nada de disco: o fundo é o da página). Tiram-se com o mesmo tratamento dos das startups; dois ficheiros (um mosaico azul-escuro de cada) ficaram de fora porque, sem disco, pareciam cartões. A firma é do catálogo (verificada, ativa, ainda sem *claim*): o título diz «exemplos de perfis de investidores na base de dados da Sherlock Deal», não que tenham pedido para aparecer; a `authorization` de cada uma é `"owner"` (pedido do Nuno, sem prova da firma em arquivo) até haver um email ou uns termos. Para trocar um logo: refazer o recorte (sem margens, fundo transparente) e atualizar `width` e `height` na lista.

## Como se move

Uma só linha, sempre, em qualquer resolução: os logos entram e saem pelas pontas, que se desvanecem na cor da página.

**A largura da janela** (Nuno, 31/10/2026) é a do ecrã até ao máximo que os logos reais permitem, e centrada a partir daí; o que fica fora dela não se vê. O máximo é **uma volta da lista menos o logo mais largo** (`noRepeatWindow`): numa janela maior, uma marca apareceria ao mesmo tempo nas duas pontas (com 8 startups, uma volta tem ~1370 px, e a janela fica em ~1230 px; com 17 investidores a volta tem ~2900 px e a janela é o ecrã inteiro). Não é um número para manter: **com mais logos a janela alarga-se sozinha**, com menos estreita-se. Não se aumenta o espaço entre logos nem a velocidade para esconder repetições, e não se inventa nenhuma marca: cada startup a mais acrescenta ~170 px à janela, e com 11 startups a janela já chega aos 1600 px sem repetição. Um teste em Chrome percorre 360 pontos de uma volta, em 12 combinações de ecrã e página, e falha se uma marca aparecer duas vezes ao mesmo tempo (e outro prova que o teste vê a falha, forçando uma janela de 1600 px).

A velocidade é a mesma em CSS px por segundo em todos os ecrãs (`LOGO_STRIP_SPEED`, 32 px/s): o portátil e o telemóvel têm cada um a sua duração de volta, calculada a partir da largura da sua própria lista, porque no telemóvel os logos são mais pequenos e a lista é mais curta. O rato em cima (ou um dedo) pára-o; com «reduzir movimento» no sistema fica parado, numa só linha de logos inteiros. As cópias da lista que o loop usa para não ter saltos são os mesmos logos outra vez, escondidas dos leitores de ecrã (cada empresa é lida uma vez) e sem texto alternativo; não se inventa nenhuma marca.

## Retirar um logo

**Apagar a linha desse logo em `src/content/site/landing-logos.json` e fazer deploy.** É tudo: sem a linha, o logo não é mostrado em lado nenhum. Se for para sempre,
apagar também o ficheiro desta pasta (o build avisa de um ficheiro que nenhuma linha lista). Se a empresa retirar a autorização mas o logo tiver de ficar fora já, trocar
a `authorization` dessa linha por `"pending"` tem o mesmo efeito imediato, e a linha fica para um eventual regresso.

Se, depois de retirar, a página ficar com menos de 6 logos autorizados, **a secção inteira desaparece** (e a página passa do hero direto à secção seguinte): é por desenho.

## O que o build diz

`npm run build` corre primeiro `scripts/check-landing-logos.mjs`:

- **Aviso** (o build continua): um logo sem autorização completa, e porquê («authorization pending», data inexistente, data no futuro, forma desconhecida); um
  ficheiro nesta pasta que nenhuma linha lista; quantos logos autorizados tem cada página e se a secção está **SHOWN** ou *hidden*.
- **Erro** (o build pára): uma linha que a página não consegue ler (nome, ficheiro, tamanho ou página inválidos; o mesmo ficheiro duas vezes) ou um logo **com**
  autorização cuja imagem não está nesta pasta (a página mostraria uma imagem partida).
