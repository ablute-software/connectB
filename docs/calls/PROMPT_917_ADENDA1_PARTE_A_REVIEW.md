# Prompt 917 — Adenda 1, Parte A: o "Review" que não mostrava a proposta

**Branch:** `claude/917-adenda1-review-bug`. **Migração:** nenhuma. **A Parte B (motor interno primeiro, IA só para o que falhar) faz-se junto com o I2.**

## O caso (verificado na base a 15/10)
Run `2192434d-d9ba-421f-8cb4-1ea62755fd18` da call `df1ee027…`: `proposed`, 52 campos, criado às 12:30:14 UTC (22 s de leitura). Notificação `import_ready` criada às 12:30:37, marcada como vista às 15:14:50 quando o Nuno carregou em "Review". Há duas "Untitled call" em rascunho (`16eb4b2b…`, criada às 12:25, e `df1ee027…`, às 12:29).

## A causa (reproduzida)
Reprodução em Chrome sem interface contra o servidor de desenvolvimento, com os componentes reais e as respostas reais dos handlers para os mesmos dados. Captura **antes**: [`01-BEFORE`](screenshots-917-adenda1/01-BEFORE-review-lands-on-the-upload-form.png).

1. "Review" abria o diálogo no passo **upload**: título "Import from documents", o aviso, os formatos e o seletor de ficheiros.
2. A única ligação à proposta era uma faixa verde pequena por baixo do seletor ("A proposal from an earlier reading is waiting… Review it").
3. O clique em "Review" marcava a notificação como vista, e abrir o diálogo marcava-a outra vez (3 pedidos `POST` no total): a notificação desaparecia logo.
4. Fechar o diálogo não deixava caminho de volta a partir da lista (o indicador "Proposal ready to review" só existia no editor).
5. O ✕ do passo de revisão **descartava a proposta** sem avisar.

O servidor estava certo. O Nuno caiu num ecrã que parece um novo upload, com a proposta escondida a um clique, e a notificação já consumida.

## O que mudou
- **"Review" abre a revisão daquela proposta** (a notificação leva o `runId`), sem passar pelo upload. Um run ainda a ler retoma a espera; um falhado, aplicado ou descartado diz porquê.
- **A notificação só desaparece quando a proposta é aceite ou descartada** (o servidor fecha-a nessas duas ações). Abrir não basta. "Dismiss" continua. Uma nova leitura fecha as notificações de "could not read" antigas da call.
- **O cartão de cada call na lista mostra "Proposal ready to review"** (ou "Reading the documents…"), clicável, e abre a revisão. O indicador do editor também abre a revisão.
- **Calls sem nome:** "Untitled call · created 15 Oct, 13:29", na notificação e no cartão (no fuso da call).
- **O ✕ da revisão fecha sem descartar** ("Closing this window keeps the proposal…"). Descartar é o botão "Discard proposal".

## Depois da correção (mesma reprodução)
Lista com as duas calls distintas ("created 15 Oct, 13:25" e "13:29") e o indicador no cartão certo → notificação → "Review" → **revisão com os 52 campos** (sem upload) → fechar → a notificação continua e o cartão mostra o indicador → o indicador abre a revisão outra vez. Nenhum pedido que consuma a notificação. Capturas: [`02-AFTER`](screenshots-917-adenda1/02-AFTER-review-opens-the-proposal-52-fields.png), [`03-AFTER`](screenshots-917-adenda1/03-AFTER-list-with-notice-and-card-pill.png).

## Em produção
O Nuno carrega em "Review" na proposta que já existe (o run `2192434d…`; a notificação foi marcada como vista, mas o cartão da call mostra o indicador e abre a revisão). Não é preciso importar outra vez.

## Limites ditos
Reproduzi o caminho do código com dados iguais, não a sessão do Nuno. A ergonomia fina (ecrã estreito) só se vê no teu teste.
