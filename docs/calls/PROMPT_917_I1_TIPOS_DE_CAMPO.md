# Prompt 917 — I1: tipos de campo novos

**Branch:** `claude/917-i1-field-types`. **Migração:** `20261015120000_calls_field_types.sql` (aditiva). **Variáveis/dependências novas:** nenhuma.
**O I2 (importação) só começa depois do teste do Nuno.**

## O que o Nuno pode clicar (depois do merge e do deploy)

Numa call em rascunho da "ablute_ — Internal QA" → **Form**:

1. **Link:** "+ Add field" → *Link (URL)* → "Expected link": *Video*. No separador **Preview**, escreve `www.youtube.com` (sem https): o teste (*Test the form*) recusa; com `https://youtu.be/abc` passa.
2. **Email:** *Email* → o teste recusa `ana@` e aceita `ana@acme.pt`.
3. **Ficheiro melhorado:** *File* → marca **Word** e **Excel** além de PDF; marca **Allow several files** (máx. 5). Na pré-visualização o campo oferece os formatos e diz "PDF, Word or Excel only, up to 10 MB each · up to 5 files".
4. **Grupo repetível:** *Repeatable group* → "What is one entry called?" = *Team member*; mínimo 1, máximo 6; sub-campos: Name (obrigatório), Role (escolha), Age (número), Email, CV (ficheiro PDF). No teste: "+ Add another team member", reordenar, remover; sem entradas o "Next" fica bloqueado e diz "Add at least one team member."
5. **Tabela da concorrência:** outro grupo, *Shown as: Table*, **I set the rows**: `Your company`, `Competitor 1`, `Competitor 2` (uma por linha), sub-campos *Company* e *Strengths*. No teste vês a tabela com a primeira coluna fixa e sem "Add another".
6. **Valida e publica** (a call de teste da 907 pode ser esta) e, **como candidato** (janela privada, `sherlockdeal.com+codigo1@gmail.com`): cola um link a meio; adiciona dois membros, com um CV PDF em cada (o segundo não substitui o primeiro); tenta carregar um `.zip` (recusado, diz porquê) e um Word onde só se aceita PDF (recusado); submete.
7. **Na entidade → Submissions:** o link abre num separador novo; os ficheiros são descarregáveis; o grupo aparece em cartões e a tabela com as suas linhas.

Eu verifico na base depois: `call_form_fields` (a configuração), `call_applications`, `call_application_files` (cada CV com o seu `entry_id`), a submissão e os ficheiros congelados com a extensão certa.

## O que mudou

- **Tipos:** `url`, `email`, `group`; o *File* ganhou formatos (PDF, Word, Excel, PowerPoint, imagens), "Allow several files" (até 10) e tamanho por ficheiro.
- **Grupo:** sub-campos simples (incluindo ficheiro e email), mínimo/máximo (até 50), cartões ou tabela, linhas fixas opcionais, sem grupo dentro de grupo nem condições sobre ele.
- **Validação (partilhada pelo editor, o modo de teste, o candidato e o servidor):** URL `http(s)`, email, formato/tamanho/número de ficheiros, entradas mínimas e máximas, obrigatórios por entrada.
- **Servidor:** o formato vê-se pelos bytes (Office só se tiver a sua parte principal; ZIP nunca); os ficheiros de cada entrada têm o seu `entry_id`; um grupo guarda-se como lista de entradas com cada pergunta tratada como as do formulário; as linhas fixas repõem-se sempre.
- **Submissão:** imutável; os ficheiros congelam com a extensão do original; o retrato do formulário leva a configuração do grupo.
- **Submissions:** link em novo separador (`rel="noopener noreferrer"`, sem incorporar), vários ficheiros, grupos em cartões ou tabela, tudo só de leitura.
- **Duplicar uma call / importar o formulário de outra:** copiam os tipos novos e as suas definições.
- **A importação por IA** continua com os oito tipos antigos até ao I2.

## Testes
`calls-917-logic.test.ts` (32: regras puras), `calls-917-i1-routes.test.ts` (10: o candidato e as Submissions, pelos handlers reais), `calls-917-i1-entity.test.ts` (8: editor, duplicar, importar, readiness, pré-visualização e teste), `calls-917-components.test.ts` (16: os ecrãs, em marcação).

## Não provado
- **Não vi o ecrã desenhado** (o painel do browser recusou ligar-se ao servidor local): cartões, tabela e repetidor estão provados em marcação e em lógica; a ergonomia (arrastar, ecrãs estreitos) só se vê no teste do Nuno.
- Os ficheiros reais não passaram pelo scan de malware externo (simulado nos testes, como nos outros uploads).
- O Vault só oferece PDFs.
