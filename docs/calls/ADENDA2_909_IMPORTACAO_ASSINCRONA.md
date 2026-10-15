# Prompt 909 — Adenda 2: a importação por IA lê em segundo plano

**Branch:** `claude/909-adenda2-import-async`. **Migração:** `20261014180000_calls_import_runs_async.sql` (aditiva: dois estados novos no
`status` e cinco colunas de diagnóstico em `call_import_runs`; o código antigo continua a funcionar). **Dependência nova:**
`@vercel/functions` (só `waitUntil`). **Variáveis novas:** nenhuma.

## A causa (confirmada)

O Nuno importou `Formulário_2edCall-INNOV-ID_PT_Final-2.pdf` (170 209 bytes, 6 páginas) numa call em rascunho e viu "We could not read the
documents." ao fim de ~62 s. O que a base de dados registou do **mesmo pedido**:

| Hora (UTC) | O quê |
|---|---|
| 17:10:04 | `ai_call_log`: `/api/calls/import-ai`, `claude-sonnet-4-5`, 13 886 tokens de entrada, **3 761 de saída** |
| 17:10:05 | o PDF guardado em "Source documents" da call |
| 17:10:05 | o run `proposed`: **52 campos, 0 fases, 3 avisos** |

O servidor **terminou** o trabalho mesmo no limite de 60 s e guardou a proposta; o browser recebeu um corte que não é JSON e o ecrã caiu
no fallback genérico. A importação "nunca funcionou" não era bem assim: funcionou a 14/10 às 17:10, só que o ecrã não o mostrou. A geração
é proporcional ao formulário (≈70 tokens por campo; ≈60–70 tokens/s ⇒ 52 campos ≈ 55–60 s), por isso um formulário um pouco maior falha sempre.

**O que não consegui ver:** o código HTTP exato. Os logs de runtime da Vercel só se leem ao vivo (`vercel logs`, 5 minutos) e a escuta
não apanhou o pedido. A causa assenta nos tempos da base de dados e nos 62 s que o Nuno mediu, não no registo da Vercel.

## O que mudou

1. **O POST responde logo (202)** com `{ run: { id, status: 'reading' } }` depois de validar os ficheiros como antes e de guardar os documentos.
2. **O modelo trabalha depois da resposta** (`src/lib/background.ts` → `waitUntil`), com **relógio próprio**: a chamada é abortada 30 s
   antes do limite da função e o run acaba `failed` com "took longer than we allow".
3. **`maxDuration = 300`** (antes 60). A build de um preview aceitou-o neste projeto; ver "Não provado".
4. **O ecrã** (`ImportFromDocuments`): "Reading your documents… this can take up to two minutes", consulta o run de 3 em 3 s,
   **retoma** ao reabrir (reading → espera; proposed → "Review it"; falha com o ecrã fechado → a frase), e fecha-se sem parar a leitura.
5. **Um run que fica em `reading` mais de 6 minutos** é fechado como `failed` ao olhar (a função morreu): nunca se espera para sempre.
6. **Proposta cortada:** se o modelo pára por `max_tokens`, é `failed` ("too long to fit… one document at a time"), nunca uma proposta
   incompleta. O limite de 6 000 tokens mantém-se.
7. **Erros honestos:** resposta que não é JSON → "Reading took too long or failed on our side. Please try again; if it keeps failing,
   contact us at sherlockdeal.com/contact." (com ligação) + o código HTTP em letra pequena.
8. **Toda a falha fica registada:** no run (`error_code`, `error_message`, `duration_ms`, `source_bytes`), na história da call
   (`import_failed`: código, duração, tamanho de cada ficheiro) e no log do servidor. Uma falha apaga os documentos que esse run guardou.
9. Uma leitura de cada vez por call (`busy` → devolve o run que está a esperar).

## Testes

`calls-909-i4-routes.test.ts` (25): o POST devolve logo o `runId` e o run passa a `proposed`; falha do fornecedor e falha inesperada deixam
`failed` com a frase certa e sem documentos; run `reading` antigo é fechado e o recente fica; reabrir devolve reading / pending / lastFailure;
um `reading` não se aplica; `maxDuration` igual à constante do job. `job.test.ts`: o relógio próprio aborta um modelo lento; classificação
das falhas; a resposta tardia não ressuscita um run fechado; `max_tokens` nunca é proposta; o sinal chega ao `fetch`; o limite de tokens é
o mesmo. `screen-state.test.ts`: resposta não-JSON → a frase nova com o código; reabrir retoma um `reading`; a espera mostra a proposta,
volta com a razão, desiste depois de falhas seguidas.

## Não provado (a dizer com franqueza)

- Que a Vercel **cumpra** 300 s em runtime neste plano: a build aceitou-o, mas só uma importação longa o prova. Se não cumprir, o
  run fica `failed` ao fim de 6 minutos com a frase de "took longer than we allow", em vez de ficar à espera.
- O ecrã de leitura e o retomar estão verificados na lógica (decisões puras testadas) mas **não os vi desenhados**: o painel do browser recusou a ligação ao servidor local nesta sessão. O fluxo real depende do teste em produção.
