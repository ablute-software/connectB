# Prompt 918 — I1: a call com 4 separadores e a Setup em passos

**Branch:** `claude/918-i1-setup-steps`. **Migração:** nenhuma. **Variáveis/dependências novas:** nenhuma.
**O I2 só começa depois do teste do Nuno.**

## O que o Nuno pode clicar (depois do merge e do deploy)

Na call **INNOV-ID** (publicada) e numa call em rascunho (cria uma de teste na "ablute_ — Internal QA"):

1. **Abrir:** a INNOV-ID (aberta) abre em **Applications**; a de rascunho abre na **Setup**. Vês quatro separadores: Setup · Applications · Evaluation · Results.
2. **Setup, no computador:** a lista de 7 passos à esquerda, cada um com o estado (✓ Complete · ⚠ "1 to fix" · Not started · Coming next). Faz scroll: a lista fica fixa.
3. **Passos:** clica em Form, Team & distribution… Os estados mudam à medida que preenches (uma call nova: tudo "Not started"; a "Phase 1" vazia não conta).
4. **Previous / Next** no fim de cada passo.
5. **Review & publish → "What is missing":** cada linha tem "Go to General/Phases/Form"; ao clicar vais ao passo, o ecrã desce ao campo e o cursor fica lá. Experimenta com a call sem data de fecho.
6. **General:** a secção das candidaturas tem agora "Count applications by" (Project / startup · Legal entity) e "Each one can submit" (Only one · More than one). O que já estava guardado mantém-se.
7. **Validar a call:** a Setup fica só de leitura, com "Edit configuration" no Review enquanto ela não abriu.
8. **No telemóvel** (ou a janela estreita): os 4 separadores deslizam; na Setup o botão "Step 3 of 7: Form ▾" abre a lista; no Form, tocar numa pergunta abre-a **em ecrã inteiro** ("← Questions", "Done"); em Applications cada candidatura é um cartão. **Num tablet na vertical** a lista chama-se "Steps".
9. **Links antigos:** com o `call=<id>` da tua call no endereço, `…&tab=form`, `…&tab=submissions`, `…&tab=preview` abrem o passo/separador certo (o endereço passa a `…&section=setup&step=form`).

Eu confirmo depois na base de dados: nada mudou nos dados guardados (`limit_unit`, `allow_multiple`, campos, fases).

## O que mudou

- **`src/lib/calls/editor-nav.ts`** (puro, testado): os separadores e os passos, o que abre primeiro, o que um link antigo significa, o estado de cada passo, o passo de cada problema.
- **`SetupShell`** (lista de passos responsiva, Previous/Next), **`CallEditor`** (separadores, passos, endereço que acompanha, salto para o campo), **`PreviewTab`** ("What is missing" → passo e campo), **`GeneralTab`** (as duas escolhas), **`FormTab`** (painel em ecrã inteiro abaixo de 1024 px, e a coluna que estourava), **`SubmissionsTab`** (Applications, cartões no telemóvel), **`globals.css`** (a regra dos 44 px).
- `ReadinessIssue.target` e `CallState.teamMembers` (servidor).
- Os dois hosts (Investor workspace, Incubator workspace) abrem a área Calls quando o endereço nomeia uma call.

## Verificação nas três larguras (Chrome sem interface, API simulada, 55 perguntas reais)

| Medição | 375 px | 768 px | 1280 px |
|---|---|---|---|
| Scroll horizontal da página (General, Form, painel, Review, Applications, Team) | 0 | 0 | 0 |
| Alvos de toque < 44 px (os mesmos ecrãs) | 0 | 0 | compacto (rato) |
| Lista de passos | botão "Step 1 of 7: General" | botão "Steps" | à esquerda |
| Painel da pergunta | ecrã inteiro | ecrã inteiro | ao lado |
| Applications | cartões | tabela | tabela |
| Links antigos (`form`, `preview`, `submissions`, `eligibility`, `team`, `step=phases`) | — | — | todos certos |
| "Go to…" focou o campo (`call-closes`) | sim | sim | sim |

Capturas em `docs/calls/screenshots-918-i1/` (`<largura>-1-setup-general`, `-2-steps-open`, `-3-form`, `-4-question-panel`, `-5-review`, `-6-jumped-to-field`, `-7-applications`, `-8-team`).

## Testes

`editor-nav.test.ts` (13: estrutura, o que abre primeiro, links antigos, estados, "What is missing"), `calls-918-i1-components.test.ts` (15: os passos e os estados, a lista lateral/botão, Previous/Next, 44 px, as duas escolhas do General incluindo só de leitura, o botão "Go to", a regra de toque, os cartões), e na rota real a contagem da equipa e os alvos dos problemas.

## Limites ditos

- O Evaluation e o Results são placeholders ("Coming in the next stage"); a Eligibility e o Evaluation grid também.
- Medi as três larguras num harness com o shell de demonstração, cujo cabeçalho tem 59 px de excesso a 375 px (é do shell, não do editor); neutralizei-o só na medição. O editor real vive dentro do Investor/Incubator workspace, que não vi à mão a 375 px.
- Os 44 px a 1280 px só se aplicam com ecrã táctil; com rato os controlos ficam compactos.
