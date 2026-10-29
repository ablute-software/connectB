# Prompt 924 — Calls, Etapa 4: publicar os resultados, comunicar aos candidatos, contestações e fecho da call

Relatório vivo: cada incremento acrescenta a sua secção. Datas de 28/10/2026.

## Diferenças entre o prompt 924 e a spec (`SPEC_CALLS_V2.md`, §17–19, §23, §26) — vale o prompt

| Tema | Spec | Prompt 924 (o que foi feito) |
|---|---|---|
| Modalidades de publicação (§18) | documento/link **ou** resultado individual | **só resultado individual** pela plataforma |
| Partilhar a nota final (§18) | opção separada | **não existe**: a nota nunca vai ao candidato (princípio 3 do prompt) |
| Justificação (§18) | "justificação final" partilhável; **obrigatória** nas rejeições se houver contestação | **feedback opcional**, escrito pelo admin, desligado por omissão; nunca obrigatório |
| Contestação aceita ficheiros (§19) | "não aceitam documentos novos" | **pode juntar um ficheiro** (I3) |
| Contestação aceite (§19) | o resultado muda "segue a validação e a republicação" | **Upheld muda a decisão e avisa o candidato** com nova mensagem (I3) |
| Seriação, cotas e vagas (§11, §26 Etapa 4) | parte da Etapa 4 | **fora**: usa-se a decisão Advance/Reject/Waitlist da Etapa 3 |
| Painéis (§21, §26) | parte da Etapa 4 | **fora** desta etapa |
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
