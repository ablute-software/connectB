# Prompt 918 — I2 (regras de elegibilidade) e I3 (motor interno de elegibilidade) — relatório

27/10/2026 · branch `claude/918-i2` · migrações `20261027150000_calls_eligibility_rules.sql` e `20261027160000_calls_eligibility_engine.sql` (aplicadas, aditivas, com dry-run antes).

## O que foi feito

**I2 — o passo "Eligibility rules".** Regras ligadas a perguntas do formulário (número, opções, data, texto aberto) e a documentos (certidão válida, do tipo certo, autêntica). Cada regra mostra, enquanto se escreve, a frase em linguagem corrente e onde está o limite ("exatamente 500 000 € é elegível"). Para os documentos, a plataforma prepara a **receita** a partir do texto da entidade ("emitida há menos de 3 meses" → `max_age = 3 meses`), mostrada só para leitura em "How we check this document"; o administrador não a confirma nem a edita. As frases do regulamento que não dão regra aparecem como sugestões ("Create a rule from this" / "Discard"). Depois de a call abrir, as regras ficam congeladas: uma alteração pergunta (na página) quantas candidaturas submetidas serão reavaliadas e cria a versão seguinte; antes disso edita-se no sítio.

**I3 — o motor.** Cada candidatura submetida entra numa fila (`call_processing_tasks`) e é avaliada **sem fornecedor de IA externo**: regras objetivas (números, opções, datas) pelo motor determinístico; documentos pelo leitor interno (certo / válido / autêntico). O resultado é **Fit**, **Not a fit** (com a regra e o valor encontrado) ou **To validate** (a plataforma não consegue decidir: PDF digitalizado, documento ilegível, falha técnica). Uma falha técnica **nunca** é um incumprimento. Tentativas com recuo (1, 5, 15, 60, 240 min); a primeira corrida é limitada a 6 s depois de submeter; o cron diário é a rede de segurança. Em *Applications* há três sub-vistas (Fit / Not a fit / To validate), o painel da candidatura com o resultado por regra, a correção humana (fica guardada como exemplo) e os possíveis duplicados. No backoffice, a exatidão por tipo de regra e de documento. O candidato tem "Report a problem" (cria um ticket urgente).

## Diferenças e decisões (também em `DECISIONS.md`)

- Só se rejeita com certeza: documento digitalizado sem texto → To validate (não há OCR nesta etapa).
- Não há validação de assinatura digital nem de QR da certidão: a "autenticidade" é a coerência interna do documento (identificação, entidade emissora, datas).
- Os links do portal de certidões ficam **por confirmar** com o Nuno (a receita aceita-os, mas nenhum é consultado).
- Dois pares de migrações antigas continuam fora de ordem no `verify:migration-order` (já existiam antes; ver o fim deste relatório).

## Lista de cliques para testar

1. Setup → **Eligibility rules** → *Add a rule*: escolher uma pergunta numérica, "Number", valor 500000 → ver a frase e o limite → Save.
2. Editar a regra para "exactly"; remover (a confirmação é na página; "Keep" mantém).
3. Numa pergunta de ficheiro: "Document is valid" → abrir *How we check this document*.
4. Importar um regulamento com frases → "Create a rule from this" numa sugestão; "Discard" noutra.
5. Abrir a call; alterar uma regra → a pergunta menciona a versão 2 e o número de candidaturas reavaliadas.
6. Com contas de teste, submeter candidaturas (uma que cumpre, uma que não, uma com PDF digitalizado) → *Applications* → ver Fit / Not a fit / To validate.
7. Abrir uma candidatura → resultado por regra → *Correct* (Fit ↔ Not a fit) → ver que fica registado.
8. Como candidato: *Report a problem* → mensagem → aparece nos pedidos de suporte.
9. Backoffice → Calls → exatidão da elegibilidade.

## Para saber

- O ledger das migrações (`supabase/migrations-ledger.json`) gerou-se localmente e **não** foi commitado; o `verify:migration-order` completo termina com 2 inversões que já existiam antes do 918.
- Capturas: `docs/calls/screenshots-918-i2/` (regras a 1280/768/375) e `docs/calls/screenshots-918-i3/` (Applications, painel, "Report a problem").
- O logótipo morto da linha `matchdeal_profiles` `86a2a13d-a9ec-4b45-9b90-5c9a7f0bfda4` foi limpo (`logo_url = null`); o perfil mostra as iniciais.
