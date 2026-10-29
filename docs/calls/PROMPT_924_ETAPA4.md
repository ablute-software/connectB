# Prompt 924 — Calls, Etapa 4: publicar os resultados, comunicar aos candidatos, contestações e fecho da call

Relatório vivo: cada incremento acrescenta a sua secção. Datas de 28/10/2026.

## Diferenças entre o prompt 924 e a spec (`SPEC_CALLS_V2.md`, §17–19, §23, §26) — vale o prompt

| Tema | Spec | Prompt 924 (o que foi feito) |
|---|---|---|
| Modalidades de publicação (§18) | documento/link **ou** resultado individual | **só resultado individual** pela plataforma; documento/link **adiado** (Nuno, 28/10/2026) |
| Partilhar a nota final (§18) | opção separada | **opção por call, desligada por omissão** (Nuno, 28/10/2026): só vai a nota **validada pelo administrador**, nunca a média nem as notas dos avaliadores |
| Justificação (§18) | "justificação final" partilhável; **obrigatória** nas rejeições se houver contestação | **feedback opcional**, escrito pelo admin, desligado por omissão; nunca obrigatório |
| Contestação aceita ficheiros (§19) | "não aceitam documentos novos" | **pode juntar um ficheiro** (I3) |
| Contestação aceite (§19) | o resultado muda "segue a validação e a republicação" | **Upheld muda a decisão e avisa o candidato** com nova mensagem (I3), com duas salvaguardas (Nuno, 28/10/2026): só quem tem "Handle contestations" aceita, e o novo resultado é uma **nova publicação** com o anterior guardado |
| Seriação, cotas e vagas (§11, §26 Etapa 4) | parte da Etapa 4 | **fora** do 924: será o **Prompt 925** (que o Nuno escreve); entretanto usa-se a decisão Advance/Reject/Waitlist da Etapa 3 |
| Painéis (§21, §26) | parte da Etapa 4 | **fora**, para depois (não se abre o 926 ainda) |
| Estado "Completed" | não existe (Archived) | **novo** estado `completed` (I3), tudo só de leitura |
| Conservação (§24) | "definida por call" | **24 meses depois de Completed** por omissão (Nuno, 28/10/2026), configurável por call |
| Prazo da contestação (§18) | "um prazo posterior à publicação" | **10 dias de calendário** depois da publicação por omissão (Nuno, 28/10/2026), configurável |
| Avisos ao administrador (§23: "contestações novas") | email + app | I3 (ver a secção) |

## I1 — Preparar os resultados

### O que foi feito
- **Migração** `20261028180000_calls_results_prepare.sql` (aplicada, ledger `20261028181120`, depois de teste seco `DRYRUN_OK`): `call_result_settings` (nomes e mensagens por resultado, motivo da elegibilidade, feedback, contestações e dias, conservação, próximos passos), `call_result_feedback` (escrito pelo admin, por candidatura e fase) e `call_applications.current_phase_id`.
- **Regras puras** (`src/lib/calls/results.ts`): Advance → "Selected" (ou "Moves to the next phase" se há mais fases), Reject → "Not selected", Waitlist → "Waiting list"; a entidade pode mudar cada nome. Uma "Not a fit" sem decisão conta como "Not selected" (com o motivo só se a entidade o quiser). Sem decisão nem elegibilidade, a candidatura está **pendente** e nada se publica.
- **Mensagens:** uma por resultado, texto formatado (o mesmo editor da descrição, HTML reconstruído de uma lista fechada de etiquetas), com `{applicant_name}`, `{startup_name}`, `{call_title}`, `{entity_name}`, `{next_steps}` e `{reference}`; um campo que não existe é recusado ao escrever. Texto de partida em inglês, português, espanhol, francês, alemão e italiano (a língua da call; outra qualquer, inglês). Os valores são escapados.
- **Feedback individual:** campo por candidatura, só se a call o ligar, só entra na mensagem se estiver preenchido. **Nunca** vem dos avaliadores: um teste falha se o código que constrói, guarda ou mostra um resultado mencionar avaliações, notas, comentários ou a decisão interna.
- **Próximos passos:** texto e data, só numa call com mais fases, e só chegam a quem avança.
- **Servidor:** a permissão **"Publish results" passa a ser aplicada em todos os pedidos** (`authCall(…, { need: 'publish_results' })`): 403 para quem não a tem, qualquer que seja o resto. O separador **Results** só aparece a quem tem "Publish results" ou "Handle contestations".
- **Ecrã** (Results → Prepare): contagens por resultado, aviso com o botão para o quadro de avaliação enquanto houver candidaturas sem decisão, nomes e mensagens com autosave, as opções, os próximos passos, o feedback e a **pré-visualização com uma candidatura real**.

### Testes
`results.test.ts` (24, regras puras), `calls-924-i1-routes.test.ts` (17: permissões, contagens, pendentes, definições, feedback, pré-visualização, isolamento dos comentários dos avaliadores), `prepare-results.browser.test.ts` (9, Chrome real a 375/768/1280, sem diálogos do browser).

## I2 — Publicar

### O que foi feito
- **Migração** `20261029100000_calls_results_publish.sql` (aplicada, ledger `20261029121553`, depois de teste seco `DRYRUN_OK`): `call_result_batches` (um lote por call e fase: `scheduled`/`publishing`/`published`/`cancelled`, com as definições com que saiu), `call_results` (o resultado publicado, com histórico: `is_current` e `supersedes_id`), `call_result_sends` (o email de cada resultado), `call_result_grades` (a nota validada), `call_result_settings.share_grade` e três tipos novos em `call_notices.kind`.
- **Publish** (`PublishResults.tsx`, `results-publish.ts`): resumo, bloqueios, mensagens, "Send me a test", publicar agora ou agendar (data e hora no fuso da call), confirmação escrita na página (o nome da call), e depois o estado de cada email (Waiting / Sent / Bounced / Failed) com "Send again" e "Send the N waiting emails now".
- **Ao publicar:** um resultado por candidatura e fase; aviso na app e email a cada candidato; os que avançam passam à fase seguinte; evento `results_published` (quem, quando, contagens); **as decisões da fase ficam fixas** (409 no quadro, também enquanto há uma publicação agendada).
- **Lado do candidato:** "My applications" mostra a etiqueta ("Selected"…) e o estado "Result available"; a candidatura submetida mostra o resultado e a mensagem por cima.
- **Nota validada** (opção por call): `grade` por candidatura avaliada, validada pelo administrador; bloqueia a publicação enquanto faltar; vai na mensagem como "Score: 91.5%".

### Testes
`results.test.ts` (35, regras puras), `calls-924-i2-routes.test.ts` (27: permissões, nada antes de publicar, bloqueios, publicar, idempotência e retoma, decisões fixas, agendar/cancelar/executar uma só vez, fases, fila de emails com repetição/bounce/falha/reenvio, teste só ao administrador, nota validada, "My applications"), `publish-results.browser.test.ts` (7, Chrome real a 375/768/1280, sem diálogos do browser).

### Limites a conhecer
- **Agendamento com a Hobby:** ver `docs/ops/CONFIG_REGISTRY.md`. Uma publicação agendada sai na primeira abertura da app depois da hora, ou no tick seguinte.
- **Fases seguintes:** quem avança passa à fase seguinte e o administrador pode decidi-lo e publicá-lo de novo. **Não existe ainda** a avaliação por fase (grelha, distribuição e prazo próprios de cada fase, spec §5.2/§10/§12): a grelha e a distribuição são as da call inteira. O fluxo de entrevista e de agendamento não foi inventado (prompt 924).
