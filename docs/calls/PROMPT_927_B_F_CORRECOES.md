# Prompt 927 — partes B a F (03/11/2026)

Resumo para o Nuno; as decisões estão em `DECISIONS.md` (entrada «Prompt 927, partes B a F»). A parte A (os candidatos na pipeline) vem num merge à parte.

## O que mudou
- **B.** Na importação, «Já apresentou…? Se sim, qual?» passa a ser **uma pergunta Sim/Não e uma dependente**; a mãe fica com o número (6.4.2) e a dependente **não tem número próprio**. Reconhece também «Se não», «Caso afirmativo», «If so», «If not».
- **C.** A dependente aparece **com avanço, conector e «Shown if «Yes»»** no editor, na pré-visualização, no teste e no formulário do candidato; menor no telemóvel. **Apagar a mãe apaga as dependentes** (com confirmação na página) e **mover a mãe move-as juntas**.
- **D.** 26 moedas (CNY, JPY, KRW, INR, SGD, HKD, AUD, CAD e as da região MENA, além das que já havia), com as casas decimais certas (JPY e KRW 0; KWD, BHD, OMR, JOD e TND 3), formatadas no idioma da call, e um **seletor com pesquisa**.
- **E.** **Ficheiros até 12 MB**, em todos os caminhos, com a frase «This file is 18.4 MB. The maximum is 12 MB.».
- **F.** **Nomes de call únicos por organização**, com mensagem, link e três nomes livres.

## Números que o prompt pediu
- **Perguntas que passaram a 12 MB: 7**, todas na call INNOV-ID `225a4520-…` (a aberta): 6.1, 6.2, 6.5.1, 6.5.2, 6.5.4, 6.6 e 6.7, que estavam a 25 MB. Nenhuma estava sem limite; os ficheiros dentro de grupos estavam a 5 MB.
- **Nomes repetidos existentes** (organização «ablute_ — Internal QA»; **nada foi renomeado**): **«INNOV-ID» ×3** — `16eb4b2b-…` (arquivada e em «Deleted calls»), `225a4520-…` (aberta), `a09bbd76-…` (rascunho). Sugestões: «INNOV-ID 2026», «INNOV-ID — 2nd edition», «INNOV-ID 2». O «Untitled call» já não existe.
- **O índice único ficou por criar**, à espera de o Nuno resolver estes três.

## Capturas (`docs/calls/screenshots-927/`)
`follow-up-editor-1280.png`, `-768.png`, `-375.png` (o avanço e o conector), `follow-up-delete-1280.png` (a confirmação), `currency-select-1280.png`, `-768.png`, `-375.png` (o seletor).

## Lista de cliques para o Nuno
1. Numa call de teste, **reimporta** o formulário INNOV-ID: a **6.4.2** fica Sim/Não com «Se sim, qual?» por baixo (sem número repetido) e a revisão diz «6.4.2 split into a Yes/No question and a follow-up shown only if Yes.».
2. No editor, abre a pergunta mãe (a 6.4.2) e clica **Delete this field**: aparece «This also deletes 1 follow-up question: «Se sim, qual?».» — **Keep them** não apaga nada; **Yes, delete them all** apaga as duas.
3. No separador General, abre **Currency**, escreve «yen» e escolhe **JPY**; depois **KWD** (pesquisa «dinar»). Numa pergunta de montante, o valor aparece formatado (JPY sem casas, KWD até três).
4. Numa pergunta de ficheiro, tenta anexar um ficheiro de **13 MB**: diz «This file is 13.0 MB. The maximum is 12 MB.» antes de enviar.
5. Cria uma call chamada **«Test»**; depois cria outra com o mesmo nome (ou «test»): aparece a mensagem com «Open it» e três nomes livres.
