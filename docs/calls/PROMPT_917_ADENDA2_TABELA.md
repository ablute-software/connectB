# Prompt 917 — Adenda 2 B: o tipo "Table"

Decisões e razões completas em `DECISIONS.md` ("Prompt 917, Adenda 2 (B)") e na spec §6.1. Capturas em `docs/calls/screenshots-917-adenda2/` (`1280-table-form`, `1280-table-expanded`, `768-table-form`, `375-table-form`, `1280-table-readonly`, `1280-table-editor`, `375-table-editor`).

## O que há

- **Editor:** cabeçalhos das linhas (os critérios) e das colunas, um por linha; título do canto; tipo das células (e um tipo por linha, p. ex. "Market Share (%)" em percentagem); "Applicants can add columns / rows" com máximo e nome por omissão ("Competitor #"); obrigatório (nenhuma / todas as células das colunas da entidade / só a primeira coluna); pré-visualização no painel.
- **Candidato:** cabeçalhos da entidade fixos e sem ✕; "+ Add column" / "+ Add row" só se permitidos; o que ele acrescenta tem cabeçalho editável e ✕ (com confirmação na página se já tiver conteúdo); "Expand table" (ecrã inteiro, 1.ª coluna e cabeçalhos fixos, gravação automática); a 375 px são cartões.
- **Servidor:** guarda só o que o candidato pode escrever; os cabeçalhos da entidade não se alteram nem por um pedido manipulado; obrigatórios por modo, máximos e tipos (um item por célula).
- **Também:** a submissão é imutável, duplicar copia, a importação de uma tabela-modelo dá "Table", e "Convert to Table" converte o grupo da INNOV-ID (transposto).

## Lista de cliques para o Nuno

1. **Criar a tabela da concorrência** numa call de teste: Form → Add field → Table. Em "Row headers": Products & Services / Business Model / Target Market (size in €, identifying markets) / Market Share (%) / Competitive advantage. Em "Column headers": Your solution/company / Competitor #1 / Competitor #2. "Applicants can add columns" ligado (máximo 6, nome "Competitor #"). Em "A different type for some rows", põe "Market Share (%)" em Percentage.
2. **Converter a da INNOV-ID** (campo "Competitive Detailed Analysis", página 6): abre a pergunta; no painel vês "This is a comparison table" e o botão **Convert to Table**; a caixa na página diz o que vai acontecer e pede o teu "Yes, convert it". Esperado: a pergunta passa a Table, com as empresas em colunas e os critérios em linhas. (Não a converti por ti: é irreversível.)
3. **Preencher como candidato** (conta de teste): abre o link da call de teste, preenche algumas células, carrega em "+ Add column" → "Competitor #3"; renomeia-a; tenta apagar "Competitor #1" (não há ✕: não deixa); apaga o #3 (se tiver conteúdo, a caixa pergunta primeiro). Experimenta "Expand table" e, no telemóvel (ou janela estreita), os cartões.

## Limites

- A conversão da INNOV-ID não foi corrida em produção (irreversível; o conector de dados desta sessão deixou de apontar para o projeto da Sherlock): testada sobre cópias `zz-test`.
