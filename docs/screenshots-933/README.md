# Prompt 933 — a página 404 (capturas de 06/11/2026)

Feitas num Chrome real (Playwright) contra uma **build de produção** (`next start`) com a autenticação ligada, para o middleware correr de verdade (o `dev:verify` é modo demo e salta-o). Um servidor Supabase de substituição local responde 401 a `/auth/v1/*` e `[]` a `/rest/v1/*`; para as capturas «com sessão» devolve um utilizador de teste `zz-test-…`. Nada disto foi feito contra produção.

| Ficheiro | O que mostra |
| --- | --- |
| `404-375-light-guest.png`, `404-768-light-guest.png`, `404-1280-light-guest.png` | `/qualquer-coisa-que-nao-existe`, visitante sem sessão, tema claro, 375 / 768 / 1280 px |
| `404-375-dark-guest.png`, `404-768-dark-guest.png`, `404-1280-dark-guest.png` | o mesmo com `prefers-color-scheme: dark`. **São idênticas às claras, byte a byte**: o site público não tem tema escuro, e o que se pede aqui é que não parta |
| `404-375-light-signed-in.png`, `404-768-light-signed-in.png`, `404-1280-light-signed-in.png` (e as `dark`) | com sessão: «Open workspace» (→ `/go`) no lugar de «Sign in» e «Create account» |
| `404-1280-light-guest-subpath-for-startups.png` | `/for-startups/qualquer-coisa` (antes: a página genérica do Next, sem marca) |
| `404-1280-light-signed-in-under-app-zone.png` | `/pipeline/nao-existe` com sessão: a mesma página, sem a barra lateral da aplicação |

## O que foi medido nessas páginas (12 combinações de tamanho × tema × sessão)

- Estado HTTP **404** em todas (nunca 200 nem 307); `<meta name="robots" content="noindex">` posto pelo Next; título «Page not found — Sherlock Deal».
- Cartão centrado (desvio 0 px), com 24 px de margem de cada lado a 375 px, sem barra de scroll horizontal, sem a barra lateral da aplicação e sem o botão flutuante «Tell us».
- Nenhum erro de hidratação nem erro de consola (o Chrome regista o 404 do próprio endereço, e só isso).
- «Back to Sherlock Deal» → `/`; «Report a problem» → `/contact` (com e sem sessão); «Open workspace» → `/go`.
- Navegação suave (sem recarregar) para um endereço desconhecido desenha a mesma página.
- Um ecrã da aplicação (`/pipeline`, com sessão) **não** carrega a folha de estilos da landing; o 404 e o `/faq` carregam-na.

## Alternativas de título (a decisão é do Nuno)

Ficou **«No leads here.»** (ponto dourado). Outras:

1. «This case is unsolved.» — a do próprio prompt; mais detetive, mas pode ler-se como «o problema continua».
2. «The trail goes cold here.» — detetive e clara: a pista acabou.
3. «Nothing filed under this address.» — a mais literal, na metáfora do dossiê.

Para trocar: o `<h1>` de `src/components/site/NotFoundCard.tsx` e a constante `TITLE` de `scripts/check-not-found.mjs` (um teste falha se não coincidirem).

## Repetir a verificação do estado HTTP

```bash
npm run verify:not-found -- http://127.0.0.1:3000          # contra um `next start` local com Supabase ligado
npm run verify:not-found -- https://www.sherlockdeal.com   # só GET/HEAD: seguro contra produção
```

Falha (saída 1) se `/qualquer-coisa` não der 404 com a página da marca, se `/api/isto-nao-existe` não der 404 em JSON, se `/dashboard` sem sessão não for para `/login?next=%2Fdashboard`, se uma variante disfarçada de uma rota protegida (`/Dashboard`, `/%64ashboard`, …) servir a página, ou se o sitemap anunciar uma página que não existe.
