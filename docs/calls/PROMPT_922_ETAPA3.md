# Prompt 922 — Calls, Etapa 3: grelha, distribuição, avaliação e consolidação — relatório final

28/10/2026 · quatro incrementos, cada um com o gate completo (tsc, lint, vitest, build, verificação de URLs assinados, todos com código 0), merge para `main` e deploy confirmado pelo `buildId` = SHA do merge.

| Incremento | O que é | Merge / build em produção |
|---|---|---|
| I1 | A grelha de avaliação | `37175740` |
| I2 | Distribuição, conflitos de interesse, lembretes | `13a98998` |
| I3 | O avaliador avalia (My evaluations, ecrã, avaliação cega) | `a8422c1d` |
| I4 | Consolidação, decisão, exportação, fechar avaliação | `c57ac3ac` |

Migrações (todas aditivas, com ensaio numa transação desfeita antes de aplicar, ledger actualizado): `20261027170000_calls_evaluation` (11 tabelas, todas com RLS e sem acesso para anon/authenticated), `20261028120000_calls_eval_score_nullable`.

## O que foi feito, por incremento

**I1 — a grelha.** Passo "Evaluation grid" no Setup: critérios com secções, nome, orientação, peso (soma em direto, ⚠ até 100 %; a call não se confirma sem isso), escala própria (1–5, 1–10, 0–10 ou personalizada, até 21 níveis), descrição de cada nível ou intervalo, comentário obrigatório e mínimo eliminatório (só assinala). "Como o avaliador vê" com o anel da nota. Importar de PDF, Word ou Excel **só com o leitor da plataforma** (nunca um fornecedor de IA; um teste falha se for chamado; texto no ecrã: «Read on our platform only. Evaluation grids are never sent to an AI provider.»), cada critério com a linha de onde foi lido e as correções guardadas por call. Modelos ao nível da entidade (cópia, nada partilhado). Congela na primeira avaliação submetida: uma alteração pergunta, diz quantas avaliações ficam na versão anterior e cria a versão seguinte. Prazos por fase no fuso da call. Duplicar a call copia a grelha, nunca as avaliações.

**I2 — distribuição.** Avaliadores = equipa com "Evaluate assigned applications". Só entram candidaturas submetidas e **Fit**. Distribuição de carga igual, N avaliadores por candidatura (sem máximo) ou "todos", com o aviso se N for maior que a equipa. Três modos: automático, misto, manual. Uma candidatura que passa a Fit distribui-se sozinha; uma que deixa de ser Fit perde o que ninguém começou. Conflitos automáticos (membro da startup, mesmo domínio de empresa — nunca de caixa genérica —, já candidato da mesma startup, empresa declarada à partida) e declarados ("I have a conflict", motivo opcional visível só ao administrador): nunca atribuídos, registados com quem e porquê, redistribui-se. Ecrã do administrador em Team: carga, candidaturas sem avaliadores suficientes, conflitos, "Redistribute…" **com pré-visualização que não grava nada**. Avisos ao avaliador (uma vez por movimento) e lembretes 3 dias e 1 dia antes do prazo.

**I3 — o avaliador.** Aba Evaluation da call e "My evaluations" no espaço da entidade. Ecrã: candidatura à esquerda e grelha à direita; em tablet e telemóvel, dois separadores. Grava sozinho (com revisão: duas janelas nunca se sobrepõem em silêncio), anel da nota, descrição do nível, comentário por critério, comentário geral e nota privada para o administrador. "Submit evaluation" pergunta na página e diz exatamente o que falta; depois fica só de leitura, e só um administrador reabre, com motivo registado. **Avaliação cega:** o servidor entrega a candidatura já mascarada (startup, pessoas, emails, endereços web, nomes de ficheiros que os contenham); os ficheiros continuam abertos. Os ficheiros passam pela plataforma (nenhum endereço do Storage chega ao browser). Permissões aplicadas contra a API (403 testados).

**I4 — consolidação.** Quadro com progresso, ranking pela média ponderada (empates partilham a posição), média de cada critério, desvio, divergência (≥ 40 % da escala num critério ou ≥ 20 pontos no total, configurável e desligável, só entre avaliações da mesma versão), abaixo do mínimo, versão da grelha. Por candidatura as avaliações individuais (com as notas privadas, para administradores). Decisão *Advance / Reject / Waitlist* com nota opcional (não envia nada ao candidato). Exportação CSV/Excel só com "Final decision", **sem nenhum comentário**. "Close evaluation".

## Diferenças entre o prompt e a spec, e decisões que tomei

Estão todas numeradas no `DECISIONS.md` (secção «Prompt 922», itens 1–38). As que mais importam:

- **Permissões "Publish results" e "Handle contestations"** continuam "para a fase seguinte": não há nenhuma funcionalidade que as use nesta etapa. As outras sete estão aplicadas no servidor.
- **Modos de distribuição** (a spec não definia a diferença): automático = a plataforma faz tudo; misto = o mesmo e o administrador também mexe à mão; manual = a plataforma não atribui nada.
- **Colegas:** só com a permissão **e** depois de submeter a sua; nunca a nota privada.
- **Exportação:** não leva **nenhum** comentário (o prompt só pedia as notas privadas); por ser o mais simples e o mais seguro.
- **Avaliação cega:** o que se esconde está listado no item 25; o limite assumido é um nome de pessoa escrito à mão num texto livre que não seja o de nenhuma conta da startup — a plataforma não o pode conhecer.
- **Lembretes** usam todos os prazos definidos na grelha (as candidaturas não têm fase própria nesta etapa) e saem no cron diário (plano Hobby: uma vez por dia).
- **Avisos ao avaliador:** o aviso não tem ligação profunda; o email aponta para o site.

## Capturas de ecrã

`docs/calls/screenshots-922-i1/` (grelha e "como o avaliador vê", 1280/768/375) · `screenshots-922-i2/` (distribuição, pré-visualização) · `screenshots-922-i3/` (avaliação nos três tamanhos, separadores Application/Score, submetida, My evaluations) · `screenshots-922-i4/` (quadro). Cada uma tem a verificação de que nada fica mais largo do que o ecrã.

## Lista de cliques para testares (por ordem)

1. **Grelha.** Setup → Evaluation grid → "Add a criterion" ×3 (pesos 50/30/20, uma escala 0–10) → a soma mostra ⚠ até 100 → "Save the grid". Separador "As the evaluator sees it": escolhe níveis e vê o anel. "Import from a document" com um Excel → corrige um peso → grava. "Save as template" e "Start from a template".
2. **Equipa.** Team → dá a duas pessoas a categoria Evaluator (permissão "Evaluate assigned applications"). Ainda em Team → "Distribution of applications": escolhe o modo; "Redistribute…" mostra o que mudaria sem gravar; "Apply".
3. **Conflito.** Numa candidatura, entra como um avaliador e carrega "I have a conflict" (com motivo); como administrador vê o motivo em Distribution e a candidatura passou para outro.
4. **Avaliar.** Como avaliador: Calls → "My evaluations" (ou aba Evaluation da call) → Start → escolhe notas, escreve um comentário, vê "All changes saved" → "Submit evaluation" com um critério por pontuar (diz o que falta) → completa → confirma na página → fica só de leitura. Abre um PDF da candidatura: abre dentro da plataforma.
5. **Cega.** Em Evaluation grid liga "Blind evaluation" (antes de haver avaliações) e abre uma candidatura como avaliador: nome da startup, pessoas, emails e nomes de ficheiros aparecem como `[hidden]`; os ficheiros abrem.
6. **Reabrir.** Como administrador: abre a candidatura → a avaliação submetida → "Reopen…" com motivo → o avaliador pode corrigir e submeter outra vez.
7. **Quadro.** Aba Evaluation → Board: progresso, ranking, sinais de divergência, "Show criteria", "Open evaluations". "Decide…" → Advance + nota → "Save decision" (o candidato não recebe nada). "Download CSV" e "Download Excel": confirma que não há comentários.
8. **Fechar.** "Close evaluation…" → confirma na página → o avaliador já não consegue gravar; "Reopen the evaluation" volta atrás.

## O que não pude verificar

- **Clicar em produção com contas reais:** as rotas foram testadas contra uma base de dados simulada com estado (a mesma que usam os outros testes das Calls) e os ecrãs num Chrome real contra servidores simulados; não fiz cliques em produção (a regra do projeto é nunca testar contra dados reais). A lista de cliques acima é para ti, ou para uma conta `zz-test-…`.
- **Emails:** o envio foi testado com o fornecedor simulado; não enviei nenhum a sério.
- **Estado do deploy pela Vercel:** o conector da Vercel desta sessão estava ligado a outra equipa, por isso confirmei cada deploy pelo `/api/version` do site, como manda o CLAUDE.md.

## Para saberes

- O `verify:migration-order` completo continua a terminar com 2 inversões que já existiam antes das Calls (`catalog_match_score` e `erase_gdpr_person`); nenhuma é desta etapa.
- O ledger (`supabase/migrations-ledger.json`) foi actualizado localmente e **não** foi commitado.
- A migração `20261027170000_calls_evaluation` só ficou aplicada depois de religares o conector ao connectB; até lá, todas as rotas da Etapa 3 respondiam «Evaluation is not available yet» em vez de um erro (e continuam a fazê-lo se algum ambiente ficar sem as tabelas).
