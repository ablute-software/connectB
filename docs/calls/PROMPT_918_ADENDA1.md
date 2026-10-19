# Prompt 918 — Adenda 1 (com o I1): apagar, reabrir, capa e logo, descrição formatada

**Branch:** `claude/918-adenda1`. **Migração:** `20261019100000_calls_cover_logo.sql` (aditiva, aplicada). **Variáveis/dependências novas:** nenhuma.
**O I2 só começa depois do teu teste.**

## Lista de cliques — tudo de uma vez (I1 + Adenda 1), na conta que gere a INNOV-ID

**Primeiro, uma coisa que descobri:** a INNOV-ID está **arquivada** (fechou pelo prazo a 19/10 às 11:34 e foi arquivada a 19/10 às 13:29), não só fechada. O "Reopen and extend" reabre-a e tira-a do arquivo.

1. **Reabrir a INNOV-ID.** Calls → "Show archived" → abre a INNOV-ID → **Setup → Review & publish**. Vês o bloco **Reopen and extend** ("This call is archived (it had closed)… This call closed at its deadline."). Escolhe uma data nova (+7 dias, às 10:00): aparece a frase "Applicants who had not submitted will be able to submit until «…». Submitted applications are not affected." Confirma. A call passa a **Open**, já não está arquivada, e o histórico tem `call_reopened`.
2. **O email.** Na conta `sherlockdeal.com+codigo7@gmail.com` (tem o rascunho) chega o email "New deadline — INNOV-ID…" (e a notificação na área Calls). Eu confirmo na base de dados: `call_notices` com `kind = deadline_extended` para esse rascunho e **nenhum** para quem submeteu.
3. **Capa, logo e descrição (Setup → General).** Em **First page of the call**: "Upload cover" (PNG/JPG/WebP até 5 MB; vês o corte 16:9); "Upload a logo" (se o perfil da firma não tiver logo, pergunta se também o guarda no perfil — responde como quiseres). Tenta um `.svg` ou um `.gif`: recusa-os logo, com a razão. Na **Description** escreve um título, um parágrafo, uma lista com pontos, uma com números, uma palavra a negrito e outra com uma cor da paleta, e um link. Tudo isto funciona **com a call aberta** (a descrição, a capa e o logo mudam-se a qualquer altura; o resto do General fica bloqueado).
4. **A página de entrada.** Abre o link da call numa **janela privada**: capa (ou faixa), logo em destaque com o nome por baixo, título, datas, a descrição formatada, o regulamento e **"Start application"**. No telemóvel o botão fica sempre visível no fundo. Experimenta sem capa e sem logo.
5. **Continuar e submeter.** Em "Start application" entra com `codigo7` (o link de entrada já te trata): abre a candidatura onde ficou ("Continue your application" no botão quando já estás autenticado). Tem agora o logo e o título pequenos no topo e "About this call" para voltar. Completa o que falta — **a verificação final lista tudo de uma vez**, e a tabela opcional já mostra as 3 linhas — e submete.
6. **Apagar (a mensagem).** Numa call de teste em rascunho com a conta `codigo7` a ter começado uma candidatura (ou na própria INNOV-ID): Setup → General → "Delete or archive". A frase diz o motivo verdadeiro ("This call has opened…" / "1 applicant has started an application (not submitted yet)…" / "This call has N submitted applications…"). Tenta apagar: o servidor devolve a mesma frase.
7. **I1 (os separadores).** Os 4 separadores, os 7 passos com estados, "What is missing" a levar ao campo, Previous/Next e, no telemóvel, "Step 3 of 7: Form ▾" e o painel da pergunta em ecrã inteiro — como na lista de cliques do I1.

## O que mudou

- **A.** `deleteProblem(status, counts)` com as três frases; o ecrã mostra a frase do servidor (`availableActions.deleteProblem`).
- **B.** `reopenCall` (+ `evaluationStarted`, `hadClosed`), ação `reopen`, evento `call_reopened`, o mesmo aviso do prazo prolongado, bloco "Reopen and extend" no Review & publish.
- **C.** `calls.cover_path/logo_path`; rota `/api/calls/[id]/media` (GET/POST/DELETE) e rotas públicas `/api/calls/public/<token>/cover|logo`; `branding.ts` (formatos, logo do perfil, URLs), `CallMediaFields` no General; a página `/call/<token>` com `CallIntro`/`CallMiniHeader`; logo nas listas do candidato e nos emails; duplicar copia a capa.
- **D.** `src/lib/rich-text.ts` (sanitizador sem dependências), `RichTextEditor`, `RichText`; a descrição editável depois de validada.

## Verificação (Chrome sem interface, API simulada)

| Página de entrada | 375 px | 768 px | 1280 px |
|---|---|---|---|
| Scroll horizontal | 0 | 0 | 0 |
| Capa (altura) | 144 px | 240 px | 240 px |
| Botão "Start application" | 48 px, à vista | 48 px, à vista | 48 px, à vista |
| Com capa / sem capa / sem logo | as três variantes | as três | as três |
| Lista, números, título, negrito, link da descrição | desenhados | desenhados | desenhados |

Mais: o editor da descrição produz `h2`/`p`/`ul`/`strong` (o que o servidor guardaria); um `.svg` é recusado no browser antes de enviar; o "Reopen and extend" fica desativado até haver uma data no futuro, mostra a frase, exige a caixa quando a call foi fechada cedo e envia `{action: 'reopen', closesAt, confirmEarly}`; a mensagem de apagar aparece no General. Capturas em `docs/calls/screenshots-918-adenda1/`.

## Testes

`rich-text.test.ts` (61: o que se escreve passa; 40+ ataques; tempo e tamanho; fuzz de 4 000 entradas com gramática estrita; a cor em negrito), `delete-message.test.ts` + 5 cenários de rota (ecrã = servidor), 9 testes de rota do "Reopen and extend" (prazo, passado recusado, rascunhos avisados, submetidas iguais, fechada cedo, arquivada, sem permissão), `calls-918-adenda1-routes.test.ts` (20: formatos, SVG/GIF/executável renomeado/vazio/5 MB recusados, hash malicioso, permissões, qualquer estado, logo do perfil, guardar no perfil sem sobrepor, rotas públicas, duplicar, descrição pós-validação), `calls-918-adenda1-components.test.ts` (16: a página de entrada, os campos, o editor, o bloco de reabrir), `notices-brand.test.ts` (o logo nos emails), `client-imports-guard.test.ts` (um componente de cliente não importa código só de servidor).

## Limites ditos

- Vi a página de entrada com a API simulada, não com a INNOV-ID real; faço a leitura na base depois do teu teste.
- O servidor não confere as dimensões da imagem; a pré-visualização mostra o corte 16:9, sem recorte interativo.
- O logo do perfil de uma firma é o do perfil de um dos seus membros ativos (não há um logo "da firma" separado).
- Não há "desarquivar" à parte: reabre-se com "Reopen and extend".
- Importar o formulário de outra call não copia a capa; duplicar a call copia-a.
