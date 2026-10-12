# Prompt 908 — Calls visíveis já, e tab "Calls" no backoffice: relatório

**Branch:** `claude/908-calls-visible` (a partir de `main` `d19f342f`). **Não está em `main` nem em produção:** falta o OK do Nuno ao merge. Sem migrações.

## O que mudou

1. **Calls visíveis sem variável.** `CALLS_MODE` é só o travão: sem a variável está tudo ligado; `off` (escrito) desliga tudo com 404; `allowlist` é restrição opcional. As regras de papel do 905 não mudaram (um membro sem papel de gestão vê o separador mas não cria).
2. **`/backoffice/calls`** (menu: Accounts → Calls), só leitura, admins de plataforma. Colunas: organização (+ "Investor firm"/"Incubator", marca "Test"), call, estado, admin (nome e email), candidaturas (submetidas / em preenchimento, só números), link (Copy, Open) ou "Not published yet", datas (criada, abre, fecha, no fuso da call). Pesquisa por organização ou call, filtro por estado, ordenação (mais recente primeiro). A linha expande: fases, campos por página, quem confirmou e quando, quando foi publicada. O link vem do mesmo helper do separador da entidade.
3. **Correção de uma armadilha de build.** Quatro rotas `GET()` sem argumento (`/api/calls/access`, `/api/backoffice/calls`, `/api/portal/seats`, `/api/auth-code/status`) saíam do `next build` como estáticas; passam a `force-dynamic` (ver DECISIONS). A `/api/calls/access` é a que decide se o separador aparece.

## Verificações (por código de saída, na árvore commitada)

| Verificação | Resultado |
|---|---|
| `tsc --noEmit` | EXIT=0 |
| ESLint (config da raiz) | EXIT=0, 0 erros; nenhum aviso em ficheiros novos |
| `vitest run` (tudo) | EXIT=0, 322 ficheiros, 4981 testes |
| `npm run build` | EXIT=0; `/backoffice/calls` compila; as 4 rotas acima saem ƒ |

Testes novos/alterados: modo (default ligado, `off` desliga), rotas das Calls (sem `CALLS_MODE`: o owner/admin vê e cria, o membro vê mas não cria, o estranho é recusado, a call de outra firma dá 404, o travão vence), rota do backoffice (recusa não-admins; firma, admin, contagens, link; rascunhos só como número e **nenhum conteúdo de candidatura sai**; estado sem escrever), lista (pesquisa, filtro, ordenação) e componente (link completo, Copy/Open, nada editável, linha expandida).

## O que NÃO foi provado em produção, e porquê

Não tenho sessão da Alexandra nem de admin de plataforma em produção e não introduzo credenciais; e o código só estará lá depois do merge e do deploy (que dependem do OK do Nuno). Por isso os 3 passos em produção ficam por fazer. Na base (só leitura) confirmei: `alexandrameira@ablute.pt` é **owner ativa**, email confirmado, da firma "ablute_ — Internal QA" (firma de teste), com 1 só membership ativa; ainda não há calls.
**Também não** consegui ver o separador a aparecer num browser: o modo demo não tem sessão, por isso o separador não surge lá. O que prova a visibilidade são os testes de rota e o resumo do build.

## O que o Nuno pode clicar (depois do merge e do deploy)

Confirma primeiro que o deploy mudou (`buildId` em `https://www.sherlockdeal.com/`). Não precisas de definir variável nenhuma no Vercel; se já definiste `CALLS_MODE=allowlist`, **apaga-a** (ou põe-na a `on`), senão só a lista de emails vê as Calls.

1. Entra como `alexandrameira@ablute.pt` → workspace de investidor: o separador **Calls** aparece.
2. Cria uma call "zz-test call 908", preenche, confirma e publica; copia o link.
3. Abre `/backoffice/calls`: a call aparece com a firma "ablute_ — Internal QA" (com "Test"), a Alexandra como admin, 0 candidaturas (0 submitted · 0 in progress) e o link; carrega em **Copy** e compara com o que a entidade vê: tem de ser igual. **Open** abre o link (hoje mostra só o cabeçalho da call).
4. Clica na linha: fases, campos por página, quem confirmou e quando publicou.
5. Pesquisa por "Internal" e filtra por estado.
6. **Não apagues a call de teste** (deixei-a para a veres).
7. Travão: pôr `CALLS_MODE=off` e redeploy esconde o separador a todos; remover a variável volta a ligar.
