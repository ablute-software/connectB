# Prompt 927 — parte A: os candidatos na pipeline da entidade (03/11/2026)

Decisões em `DECISIONS.md` («Prompt 927, parte A»). Migração aditiva `20261103110000_calls_pipeline_applicants.sql`, aplicada antes do código.

## O que mudou
- Uma startup que **submete** uma candidatura a uma call de uma firma investidora aparece na **Pipeline** de quem **administra a call** e, **só das candidaturas que lhe foram atribuídas** e **nunca numa call às cegas**, dos **avaliadores**.
- Cada cartão traz a etiqueta curta «**From call · C1**» (clicável quando a pessoa pode abrir a candidatura); o estado da candidatura só aparece a quem pode vê-lo.
- Filtro novo ao lado do «Watching»: «**From calls**» → «Any call» ou uma call da organização.
- O formulário do candidato diz, antes de submeter: «Your startup's profile will be added to «Entity»'s deal flow on Sherlock Deal.» Nada vai para uma pipeline sem este aviso ter sido mostrado.
- As candidaturas **anteriores** (hoje 9, sem aviso) não entram sozinhas: o administrador usa **«Add applicants to my pipeline»** (tab Applications).
- Quem é de **outra organização** não vê a etiqueta nem fica a saber que a startup se candidatou.

## Lista de cliques para o Nuno (os passos 1–3 do prompt: o 6)
1. Como **candidata** (conta de teste), abre uma call de teste de uma firma investidora, preenche e chega à última página: lê o aviso «…added to «ablute_ — Internal QA»'s deal flow…» e submete.
2. Como **administradora da call**, abre a **Pipeline** (separador do investidor): a startup está em «Already in touch with you» com a etiqueta **From call · …**; escolhe o filtro **From calls → Any call** e depois a call: só ficam as startups dessa call.
3. Como **avaliadora** a quem a candidatura foi atribuída (call sem avaliação às cegas): vês a startup com a etiqueta; numa call **às cegas**, não.
4. Como **investidor de outra firma**: a startup não tem etiqueta nem sinal de que se candidatou.
5. Numa call com candidaturas antigas, em **Applications**, usa **Add applicants to my pipeline**.

## Limites
Não há captura da Pipeline: o painel não tem aparelho de testes no Chrome. A lógica, as rotas, o aviso no formulário real e a etiqueta estão testados.
