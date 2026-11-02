# Prompt 930, Parte B — o ecrã de elegibilidade mais claro (02/11/2026)

Resumo para o Nuno; as decisões estão em `DECISIONS.md` (entrada com o mesmo título). Sem migração.

## O que mudou (Applications)
- **Lista:** chips com contagens «All · Fit · Not a fit · To validate · Changed by a person»; o filtro fica no endereço.
- **Candidatura:** «Mark as Fit» / «Mark as Not a fit» à vista no topo (o atual marcado), «Flag possible ineligibility» ao lado; as regras em «Unmet / To validate / Met» com a frase, o motivo, a evidência e «Open document».
- **Documentos:** abrem no visualizador da plataforma (o do data room), também no ecrã do avaliador; o Excel oferece «Download». A rota passou a transmitir os bytes (antes redirecionava para o Storage).

## Capturas
`screenshots-930/list-filters-1280.png`, `application-unmet-1280.png`, `application-unmet-375.png`, `document-viewer-1280.png`, `document-unsupported-1280.png`.

## Lista de cliques (call «Test»)
1. Applications: ver os chips com as contagens; carregar em «Not a fit» e ver o endereço mudar para `?elig=not_fit`; recarregar a página e confirmar que o filtro fica.
2. Abrir uma candidatura Not a fit: ver «Unmet (n)» aberto, com a resposta ou a citação de cada regra.
3. Numa regra de documento, «Open document»: o PDF abre dentro da plataforma; Esc fecha; «›» passa ao documento seguinte.
4. «Mark as Fit» → escrever a razão → Save.
