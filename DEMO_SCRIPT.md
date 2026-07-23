# Guião da demo — Sherlock Deal (10–15 min)

Lê isto com o café. Ordem sugerida, uma frase por ecrã sobre o que dizer, e no fim
uma lista do que NÃO clicar. Todos os exemplos abaixo são dados reais do pipeline
ablute_ — não precisas de preparar nada, já lá estão.

## Antes de começar

- Login com a tua conta normal (founder de ablute_).
- Se possível, já com o browser aberto no Pipeline antes do prospect chegar — poupa
  30 segundos de loading no início.

## 1. Pipeline (`/`)

O que dizer: "Isto não é um CRM genérico — é disciplina de outreach aplicada. Cada
linha é um investidor real, com o próximo passo já calculado."

- Mostra os filtros (wave, status, país) e ordena por uma coluna (clica no cabeçalho
  "Wave" ou "Status") — mostra que é uma tabela de trabalho, não uma lista estática.
- Aponta para a coluna "Ready" (bolinha verde/vermelha) — "isto diz-me, sem abrir
  nada, se já posso contactar esta pessoa hoje."

## 2. Entidade — Bynd VC (`/entities/ent-bynd` em demo; procura "Bynd VC" em produção)

O que dizer: "Este é o caso que mais explica o produto: a Bynd já nos disse não três
vezes por sermos hardware/medtech. Normalmente isso mata a relação para sempre."

- Mostra o status "passed" e o banner de reabertura (reopen_trigger) — lê a frase em
  voz alta: o reposicionamento wellness/biosfera remove exatamente a razão do não.
- Mostra o hard filter (se ainda aberto) — "isto é uma regra viva: enquanto não
  resolvida, o sistema não deixa avançar sem decisão consciente."
- Sobe até "People" e mostra a Lurdes Gramaxo — rank 1, ligação a Bynd.

## 3. Pessoa — Lurdes Gramaxo (`/people/p-gramaxo`)

O que dizer: "A Lurdes não é só uma pessoa na Bynd — é Presidente da Investors
Portugal e está no board da APBA. O sistema sabe que a abordagem certa é por aí, não
pela Bynd."

- Mostra "Other affiliations" — as duas afiliações reais, com a nota "Approach ONLY
  as President of Investors Portugal... never re-pitch as a Bynd cheque."
- Mostra o "Can I contact?" pre-flight — tudo verde — "seis regras verificadas antes
  de eu poder sequer escrever uma mensagem."

## 4. Log Interaction / Composer (`/log?entity=ent-bynd&person=p-gramaxo`)

O que dizer: "Aqui é onde a IA ajuda a escrever — mas nunca some sozinha; eu reviso
sempre antes de guardar."

- Seleciona a Lurdes, clica "✨ Draft with AI" — espera o rascunho aparecer (3-6s).
- Aponta para o aviso "Draft only — you review, edit, and confirm before saving.
  Never auto-sent." — a frase mais importante da demo.
- Mostra o linter em baixo (kill words, tamanho da mensagem, hook) a validar o texto.
- NÃO clica em "Save interaction" com este rascunho de teste — ver secção "não
  clicar" no fim.

## 5. MAZE — o segundo caso de reabertura (`/entities/...` procura "MAZE")

O que dizer: "Este é o oposto do timing perfeito: eles pediram-nos explicitamente
para voltar quando tivéssemos tração. Agora temos — piloto no Fórum Braga, grant
T-Prism, primeiros valores de endpoint."

- Mostra o reopen_trigger da MAZE — cita o "risks with traction" original e o que
  mudou.
- Se o hard filter ainda estiver aberto ("Fund I fechado, novo fundo em desenho") —
  ótimo, é o exemplo perfeito de "isto é sobre timing, não sobre fit" — usa-o.

## 6. Today (`/today`)

O que dizer: "Isto é o que eu vejo de manhã — não o pipeline inteiro, só o que
importa hoje."

- Overdue, Ready to contact, Research needed — cada um com o tipo de ação (pill
  colorida) já sugerido.

## 7. Agenda (`/agenda`)

O que dizer: "Compromissos com tipo e data — os mesmos tipos que vês no Today,
agora numa vista de calendário."

- Clica num cabeçalho de coluna nalgum lado só se quiseres mostrar sorting — não é
  central à história, passa rápido.

## 8. Dashboard (`/dashboard`)

O que dizer: "Visão de progresso da ronda — quanto está soft-circled, quantas
conversas ativas."

## 9. Data Room (`/documents`)

O que dizer: "Documentos view-only, nunca editáveis por defeito — e cada acesso
fica registado."

- Mostra um documento existente e o botão "Open" — não precisas de fazer upload ao
  vivo.

## 10. Import history (`/import`)

O que dizer, rápido: "Foi assim que trouxemos o histórico real de negociação para o
sistema — sem perder nada do que já tínhamos."
- Não precisas de correr nada aqui ao vivo — ver "não clicar".

## 11. Packs (`/packs`)

O que dizer: "Investidores curados, mas os nomes ficam desfocados até desbloqueares
— nunca cobra nem duplica quem já está no teu pipeline."

## 12. Outbox (`/outbox`)

O que dizer: "Tudo o que a automação prepara mas que ainda precisa da minha
aprovação cai aqui — full-auto só executa quando o pre-flight está verde."

## 13. Automations (`/automations`)

O que dizer: "Cada gatilho — sem resposta há 14 dias, contacto expirado — tem um
modo: rascunho para aprovação, ou totalmente automático dentro das regras."

## 14. Settings (`/settings`)

O que dizer: "Aqui vive a organização, os limites diários/semanais, e as
funcionalidades de IA — Review, Deck review, Market data — já ativas."

- Mostra rapidamente o AI Review a funcionar num rascunho qualquer, se houver tempo.

## 15. Back-office — as 5 tabs (`/backoffice`)

O que dizer: "Isto é o lado da equipa da plataforma — nunca vê o pipeline privado
de nenhum founder, só cura o catálogo partilhado e resolve pedidos GDPR/claims."

- Hoje → Fila (mostra as 4 tabs sem abrir nenhuma ação) → Catálogo → Startups →
  Métricas. Passagem rápida, 10-15s por tab chega.

## 16. Portal do investidor (`/portal`)

O que dizer: "É isto que um investidor vê quando lhe dás acesso — só o que foi
autorizado, nada mais."

- Usa um email de teste teu, não o de um investidor real, para o "Check access".

---

## NÃO CLICAR (durante a demo, com dados reais)

- **"Save interaction" / "Send from ... & log"** no composer com o rascunho de
  teste do passo 4 — isso cria uma interação real na conta da Lurdes. Mostra o
  rascunho, não guardes.
- **"Run engine tick now"** no Outbox — pode criar/executar automações reais contra
  entidades reais (emails, tarefas) sem controlo fino sobre qual.
- **"Grant access" / "Revoke"** no Data Room com uma pessoa real — dispara o email
  automático de acesso.
- **"Erase & resolve"** em qualquer pedido GDPR no back-office — irreversível,
  apaga PII real.
- **"Convert to person (angel)"** em qualquer entidade que não seja um teste
  explícito — é uma mudança estrutural real.
- **Upload de ficheiro / extração AI** em `/import` ou `/import/md` — cria batches
  reais e consome chamadas de IA reais; não é preciso para a história da demo.
