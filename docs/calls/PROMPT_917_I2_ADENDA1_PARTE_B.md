# Prompt 917 — I2 + Adenda 1, Parte B: a plataforma lê primeiro, a IA só para o que falha

**Branch:** `claude/917-i2-import-internal-first`. **Migração:** `20261016100000_calls_import_internal_first.sql` (aditiva; teste seco feito antes). **Variáveis/dependências novas:** nenhuma.

## O que muda para quem importa

O motor interno (`src/lib/calls/ai-import/reader/`) lê o formulário **dentro da plataforma**, sem rede: numeração (1., 1.1, 2.10.1, a), b)), opções (`-`, `•`, `□`, `☐`, `a | b | c`, `; `), sim/não ("(Sim ou Não)", "Sim ou não. Quanto…?"), o tipo por palavras-chave em PT e EN, os "Se sim / Se não" como pergunta condicional, listas por pessoa como grupo repetível, tabelas-modelo como grupo em tabela, páginas pelas secções de topo, e o que pode estar desatualizado (anos, edições, escalões de idade).

Mede-se a si próprio e **decide** (`reader/decide.ts`, limiares numa constante `READER_THRESHOLDS`):

| Medida | Limiar | O que decide |
|---|---|---|
| Cobertura (itens numerados lidos / itens numerados) | ≥ 95% | abaixo → IA nas partes que falharam |
| Confiança nos tipos (perguntas com tipo por regra clara) | ≥ 80% | abaixo → IA nas perguntas "adivinhadas" |
| Estruturas por resolver (tabelas, quadros) | 0 | cada uma → IA só nessa parte |
| Cobertura < 60% | — | o texto **inteiro** vai à IA, como sempre foi |

- **`internal`** — tudo cumprido: **nenhuma chamada** ao fornecedor, nenhum custo de IA registado.
- **`internal+ai`** — a IA recebe **só** as partes que falharam (o texto do bloco ou as perguntas duvidosas com a leitura da plataforma), e responde com *additions*/*replacements*; o que ela faz entra no sítio certo e fica marcado como "completed by our AI provider".
- **`ai`** — o documento não tem uma estrutura que a plataforma entenda: a IA lê tudo, em partes paralelas, como antes.
- Um **regulamento** (não é formulário) continua a ir à IA para a visão geral, mas o formulário que vá junto **não** vai.
- **Sem chave de IA ou fornecedor em baixo:** o que a plataforma leu fica; o que faltou diz-se em "Needs your attention" ("Add its questions by hand"); o relógio da própria tarefa continua a parar tudo.

O ecrã de importação diz agora: *"We read your document on our platform. If a part is unclear, that part is sent to our AI provider to complete the proposal. Do not upload applicants' documents or confidential evaluation grids."*

## I2 — a IA (quando intervém) e o motor interno seguem as mesmas regras

1. **Uma pergunta de ficheiro por documento**, mantendo a numeração ("6.5 a) …"). 2. **Código de acesso é texto**, não ficheiro. 3. **"Outros documentos"** = um ficheiro com vários ficheiros. 4. **Vários ficheiros do mesmo tipo** = grupo ou ficheiro múltiplo, **nunca um ZIP** (os CVs: grupo "Team member" com um CV por entrada). 5. **Sim/não + valor** = duas perguntas, a segunda condicionada. 6. **Dados por pessoa/linha** = grupo repetível. 7. **Tabela-modelo** = grupo em tabela com linhas e colunas predefinidas. 8. **Links** = tipo Link.

**Sem repetições** (`dedupe.ts`): um aviso por número de pergunta (ordem: *not covered* > *outdated* > *done*), nenhuma pergunta duas vezes (mesmo número, ou "1.2 …" escrito só no rótulo, ou mesmo texto e tipo), e o que se fundiu fica registado no run (`import_meta.deduped`).

**Avisos que dizem o que se fez** (`kind: done`, mostrados à parte em "What the import did — please confirm"): "6.5 asked for 4 documents: split into 4 file questions", "6.4 asked for the CVs in a ZIP: became a 'Team member' group…". **"Not covered by the form"** só para o que a plataforma realmente não consegue. O aviso dos escalões de idade/datas desatualizadas mantém-se.

## Registo e revisão

- `call_import_runs` ganha `mode`, `quality` (cobertura, confiança, estruturas por resolver, perguntas fracas), `ai_sections` e `import_meta` (`calls`, motivos, duplicados fundidos, perguntas da plataforma/da IA, o que a IA não conseguiu).
- A revisão mostra, discretamente, "read by our platform" / "completed by our AI provider" em cada pergunta e uma linha no topo ("Read by our platform alone (100% of the numbered items read, 96% of the question types recognised). Nothing was sent to the AI provider.").
- **Correções:** ao aplicar, a diferença entre a proposta e o aceite (pergunta apagada, tipo/etiqueta/obrigatório/opções alterados) grava-se em `call_import_corrections`, com o número da pergunta e quem a fez. **Back office → Calls** tem um painel simples (`/api/backoffice/calls-import-corrections`): runs por modo, cobertura/confiança/duração médias, as correções mais frequentes e as mudanças de tipo mais comuns. Gravar nunca desfaz uma importação já aplicada.

## Medido no formulário real (`Formulário_2edCall-INNOV-ID_PT_Final-2.pdf`, 6 páginas)

Só o motor interno, sem IA, 58 ms:

- **55 perguntas** (12 texto curto, 2 email, 12 sim/não, 4 texto longo, 10 escolha, 2 link, 1 data, 3 número, 7 ficheiro, 2 grupos), secções 1 a 6.
- **Cobertura 100%** (69/69), **confiança nos tipos 96%** (53/55 por regra clara; as duas adivinhadas: 5.3 e 6.4.3), **0 estruturas por resolver** → modo **`internal`**, **0 chamadas** à IA.
- 10 perguntas condicionais ("Se sim": 1.5.1, 2.10.1, 3.1.1, 3.2.1, 4.4/2, 6.4.2/2 e os quatro documentos de 6.5, só para empresa já constituída); 2.2 com as 4 opções; 4.4 separada em sim/não + montante; 6.1 com os 9 tópicos como instrução do ficheiro; 6.3 link de vídeo; 6.4 grupo "Team member" (nome, idade, cargo, habilitações, experiência, email, CV); 6.5 → 3 ficheiros + 1 código de acesso em texto; 6.6 vários ficheiros; a tabela da concorrência → grupo em tabela com 3 linhas e 6 colunas.
- Avisos: 1 "possibly out of date" (2.10.2, escalões de idade) e 6 "done".

## O que se testou

- `reader/reader.test.ts` (24): formulários sintéticos PT/EN, o que resolve e diz, a tabela-modelo, as medidas e a decisão, formulário sem numeração, **e o PDF real** (secções 1–6, sim/não, 2.2, "Se sim", 4.4, 6.1, 6.4, 6.5, 6.6, tabela; falha em silêncio se o PDF não estiver nesta máquina; o resultado passa o sanitizador e a validação do editor).
- `propose-internal.test.ts`: interno puro → **zero chamadas**, `internal+ai` → só a parte que falhou (e só o seu texto), sem chave → o interno fica e diz o que faltou, pergunta de tipo adivinhado, regulamento + formulário, PDF sem texto, texto que não é formulário (modo `ai`), fundir repetições, relógio da tarefa.
- `proposal-kinds.test.ts`, `corrections.test.ts`, rota de back office, e na rota real (`calls-909-i4-routes.test.ts`) a proposta sem IA, a execução sem chave, e as correções gravadas ao aplicar.

## O que o Nuno vê no teste em produção

1. Descartar a proposta antiga; **importar de novo o mesmo PDF** como *Previous form*.
2. Deve aparecer a proposta em segundos (sem "AI"), com a linha no topo "Read by our platform alone…", ~55 perguntas, perguntas condicionais com "Shown only if question 1.5 is Yes", o grupo "Team member", a tabela da concorrência, o "Needs your attention" com só o aviso dos escalões de idade (2.10.2) e "What the import did — please confirm" com os seis avisos.
3. Eu leio depois `call_import_runs` (modo, cobertura, confiança, duração, `import_meta.calls`, secções enviadas) e digo-lhe os números reais.

## Limites ditos

- O leitor de tabelas é estreito (tabelas-modelo com colunas numeradas "Competitor #1…"); outras tabelas vão à IA e a qualidade das correções da IA só se vê com o modelo real.
- O desenho do ecrã de revisão está provado por testes de marcação e de lógica (e pela reprodução em Chrome sem interface da Parte A), não à vista no painel do browser.
