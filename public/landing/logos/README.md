# Logos da faixa da landing (Prompt 926, 30/10/2026)

A faixa branca entre o topo da landing e o resto da página (a das startups e a dos investidores) mostra, a correr sozinhos, os logos de empresas que já estão na
Sherlock Deal. **Mostrar o logo de uma empresa diz publicamente que ela usa a Sherlock Deal**, por isso esta pasta tem uma regra que não se contorna:

> **Um logo só aparece com a autorização da empresa REGISTADA** — a data e a forma (um email dela, ou os termos que aceitou). Sem esse registo o logo não é mostrado
> e o `npm run build` avisa. A faixa só aparece quando uma página tem **6 ou mais** logos autorizados; com menos desaparece (e o topo da página fica como estava).

A autorização é tratada pelo Nuno, fora do código. Quem mexe aqui não a inventa: se ainda não foi dada, a linha fica `"pending"`.

(Este ficheiro está em `public/`, logo é servido em `/landing/logos/README.md`: não escrever aqui nomes de empresas nem dados pessoais. O repositório também é público.)

## Onde está cada coisa

| O quê | Onde |
| --- | --- |
| Os ficheiros dos logos | esta pasta, `public/landing/logos/` |
| A lista (uma linha por logo, com a autorização) | `src/content/site/landing-logos.json` |
| O texto por cima da faixa, a velocidade, os tamanhos | `src/content/site/logo-strip.ts` |
| A regra «só com autorização, mínimo de 6» | `src/lib/landing-logos.ts` |
| O aviso do build | `scripts/check-landing-logos.mjs` (`npm run verify:landing-logos` corre-o sozinho) |

## Juntar um logo

1. **O ficheiro.** SVG, ou PNG/WebP com fundo transparente, **recortado sem margens** (o desenho encosta aos bordos do ficheiro), nome em minúsculas sem espaços
   (`nome-da-empresa.svg`). Um logo com fundo branco opaco, um círculo à volta ou margens grandes ocupa a mesma altura na faixa mas o desenho fica pequeno:
   não o alterar sem perguntar ao Nuno. Convém que pese pouco (um SVG simples ou um PNG de uns 10 KB; a faixa carrega com a página).
2. **A linha em `src/content/site/landing-logos.json`:**

   ```json
   {
     "name": "Nome da empresa",
     "file": "nome-da-empresa.svg",
     "width": 200,
     "height": 48,
     "pages": "both",
     "order": 10,
     "authorization": { "date": "2026-11-05", "form": "email", "note": "pasta «Autorizações logos», conversa de 05/11" }
   }
   ```

   | Campo | O que é |
   | --- | --- |
   | `name` | o nome da empresa; é o texto alternativo da imagem (o que um leitor de ecrã lê) |
   | `file` | o nome do ficheiro nesta pasta (só letras, algarismos, `.`, `_` e `-`; termina em `.svg`, `.png` ou `.webp`) |
   | `width`, `height` | o tamanho do próprio ficheiro, em píxeis (num SVG, o `viewBox`); reserva o espaço antes de a imagem chegar, para a página não saltar. Um teste confere-os com o ficheiro |
   | `pages` | `"startups"`, `"investors"` ou `"both"`: em que página aparece |
   | `order` | a posição na faixa, do menor para o maior; empate desfaz-se pelo nome |
   | `authorization` | `"pending"` enquanto a empresa não autorizou; depois `{ "date": "aaaa-mm-dd", "form": "email" ou "terms", "note": "..." }` |

   `form` é `"email"` (a empresa autorizou por email) ou `"terms"` (aceitou uns termos). `note` é opcional e diz **onde está a prova** (uma etiqueta da caixa de correio,
   o assunto da conversa); nunca um endereço de email nem dados pessoais. A `date` não pode ser futura nem inexistente.
3. `npm run verify:landing-logos` diz o que ficou de fora e porquê; `npm test` e `npm run build` têm de passar.

## Retirar um logo

**Apagar a linha desse logo em `src/content/site/landing-logos.json` e fazer deploy.** É tudo: sem a linha, o logo não é mostrado em lado nenhum. Se for para sempre,
apagar também o ficheiro desta pasta (o build avisa de um ficheiro que nenhuma linha lista). Se a empresa retirar a autorização mas o logo tiver de ficar fora já, trocar
a `authorization` dessa linha por `"pending"` tem o mesmo efeito imediato, e a linha fica para um eventual regresso.

Se, depois de retirar, a página ficar com menos de 6 logos autorizados, **a faixa inteira desaparece** (e o topo da página volta ao espaçamento antigo): é por desenho.

## O que o build diz

`npm run build` corre primeiro `scripts/check-landing-logos.mjs`:

- **Aviso** (o build continua): um logo sem autorização completa, e porquê («authorization pending», data inexistente, data no futuro, forma desconhecida); um
  ficheiro nesta pasta que nenhuma linha lista; quantos logos autorizados tem cada página e se a faixa está **SHOWN** ou *hidden*.
- **Erro** (o build pára): uma linha que a página não consegue ler (nome, ficheiro, tamanho ou página inválidos; o mesmo ficheiro duas vezes) ou um logo **com**
  autorização cuja imagem não está nesta pasta (a página mostraria uma imagem partida).
