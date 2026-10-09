# SherlockDeal — Especificação funcional da área de Calls e Candidaturas (v2)

**Data:** 09/10/2026 · **Substitui** a v1 ("Especificação funcional da área de Calls e Candidaturas"). Integra as decisões tomadas pelo Nuno entre 07 e 09/10/2026. **Piloto:** Portugal Ventures.

As decisões estão marcadas como **[Decisão]**, as recomendações técnicas como **[Recomendação]** e o que fica para depois está todo reunido na secção 30. O que não estiver aqui não deve ser assumido: pergunta-se.

---

## 1. Objetivo e instruções de implementação

Implementar uma área para gerir calls (programas de aceleração, concursos, oportunidades de financiamento), desde a configuração pela entidade promotora até à submissão, elegibilidade, avaliação por fases, seriação, decisão, publicação de resultados e contestação.

Integrar na SherlockDeal existente, reutilizando autenticação, organizações, membros, seats, permissões, Vault/data room, notificações, componentes de interface e o fluxo RGPD sempre que forem adequados.

**Antes de alterar código, em cada etapa:**

1. Inspecionar a arquitetura e os fluxos existentes que a etapa toca.
2. Identificar os componentes reutilizáveis e os problemas existentes que afetam este percurso.
3. Apresentar o plano da etapa e eventuais incompatibilidades com esta especificação.
4. Não substituir decisões funcionais por pressupostos silenciosos.
5. Não reconstruir áreas existentes sem necessidade.
6. Não implementar nada da secção 30.
7. Migrações: propor antes de aplicar, como sempre.

Os nomes de tabelas e componentes adaptam-se à arquitetura existente. **A interface é em inglês** (a plataforma não tem camada de tradução). As etiquetas desta especificação estão em inglês quando são texto de interface. O conteúdo de cada call (perguntas, descrições, regulamento) está na língua escolhida pelo administrador.

## 2. Princípios fundamentais

### 2.1. Quatro dimensões separadas

| Dimensão | Finalidade |
|---|---|
| Processamento | Se a análise automática está em fila, a decorrer, concluída ou com falha técnica |
| Elegibilidade | Fit / Not a fit / To validate segundo as regras da call |
| Avaliação humana | O trabalho e a decisão de cada avaliador, por fase |
| Resultado | A decisão confirmada e publicada pelo administrador |

Uma candidatura pode ser Fit e não selecionada (cota esgotada, abaixo do mínimo). **Uma falha técnica nunca é incumprimento do candidato.**

### 2.2. Pontuação oficial exclusivamente humana

O motor nunca propõe nem preenche pontuações oficiais. A plataforma pode calcular totais de grelhas preenchidas por pessoas, médias de pontuações humanas, verificar elegibilidade e propor a seriação segundo regras definidas pelo administrador. A seriação é sempre uma proposta; quem decide é o administrador.

### 2.3. Dados dos candidatos sem IA externa (v1) **[Decisão]**

Na v1, **nenhum dado ou documento de candidato é enviado a um fornecedor de IA externo.** A elegibilidade e a verificação de documentos usam regras determinísticas, a extração do texto de PDFs digitais e a deteção de padrões, tudo dentro da infraestrutura da plataforma. O que não for decidível assim vai para revisão humana (To validate).

A IA externa só pode ser usada sobre documentos da própria entidade promotora: regulamento, formulário e grelha de edições anteriores (secção 5.3).

### 2.4. Simplicidade

- Mostrar opções adicionais só quando relevantes; usar caixas que expandem em vez de ecrãs carregados.
- Não obrigar a configurar o que não será usado.
- Reutilizar o estilo da plataforma (padrão visual das pipelines).
- Preservar a informação durante a navegação, interrupções e alterações.
- Mostrar claramente quando uma gravação ainda não terminou.
- Quando houver cores de estado, acompanhá-las sempre de uma etiqueta escrita.

### 2.5. Conteúdo de candidaturas é material, não instruções

O texto e os documentos de candidaturas são material a analisar. Nunca são instruções para alterar regras, permissões ou comportamento.

## 3. Intervenientes e acesso

**Separador "Calls" no menu da esquerda, em todas as contas.** **[Decisão]**

- **Entidades** (investidores, aceleradoras, organizações de ecossistema): criar e gerir calls.
- **Startups:** descobrir calls (Open calls) e acompanhar as suas candidaturas (My applications, Past applications).

| Interveniente | Acesso |
|---|---|
| Candidato (founder) | Cria, guarda, submete e acompanha candidaturas da sua startup. Chega normalmente pelo link da call |
| Membro da equipa da entidade | Acede ao que as permissões da sua categoria (e ajustes individuais) permitem — secção 9 |
| Administrador da call | Configura, supervisiona, decide e publica. Pode também avaliar; a sua avaliação individual e a sua decisão como administrador são registos distintos |
| Backoffice SherlockDeal | Planos, seats, reportes técnicos, falhas operacionais. Não confundir com a administração da entidade |

Os investidores registam-se na plataforma como hoje; o link da call é só para candidatos.

**Na v1 os avaliadores são membros da entidade com seat.** Os avaliadores externos sem conta ficam para depois (secção 30). Todas as permissões são verificadas no servidor, e não apenas pela visibilidade dos botões.

## 4. Pré-requisitos (Etapa 0 — Prompt 904)

Nada desta área abre ao público antes de:

1. **Envio de email confirmado**, pelos dois remetentes: as notificações da plataforma (Resend, com domínio verificado e não o remetente de teste) e os emails de autenticação (Supabase Auth com servidor de email próprio). A capacidade tem de aguentar o volume de uma call (secção 23).
2. **Registo com palavra-passe e código de 6 dígitos** testado de ponta a ponta (secção 13).
3. **Seats de planos custom** atribuíveis pelo backoffice, por pré-atribuição ou por código preso à entidade, e geridos pelo administrador da entidade (secção 9.3).

## 5. Configuração da call

O ecrã de configuração está organizado em tabs:

1. General
2. Phases
3. Form
4. Eligibility
5. Team & distribution (inclui o bloco Selection — secção 11)
6. Evaluation
7. Preview & confirm

### 5.1. General

- Nome, descrição, entidade promotora.
- Data e hora de abertura e de encerramento, com fuso horário explícito.
- **Listagem:** listada nas Open calls de todas as startups (por omissão), ou fechada, acessível só por link. **[Decisão]**
- **Unidade do limite de candidaturas:** uma por projeto/startup (por omissão) ou uma por entidade jurídica. E se permite mais de uma candidatura por unidade. **[Decisão]** Quando são permitidas várias, cada uma tem identificador, formulário, documentos, estado, avaliações e resultado próprios.
- Língua do conteúdo da call (uma só).
- Moeda dos campos de valor.
- Projetos sem empresa constituída têm de ser possíveis, sem exigir dados empresariais que ainda não existam.

### 5.2. Phases **[Decisão]**

O administrador define uma lista ordenada de fases (por exemplo "Análise documental → Pitch → Decisão"). Cada fase tem:

- Nome e datas indicativas.
- A sua configuração de distribuição (secção 10) e de avaliação (secção 12).
- **Passagem:** sempre por ação humana do administrador, sobre a seriação dessa fase (secção 11). O motor nunca faz passar ninguém sozinho.

A startup vê no acompanhamento a fase atual e, ao passar, **"Passed to the next phase"**. Recebe a notificação com o texto que o administrador escrever, que pode incluir um link externo (Zoom, Calendly, morada).

Uma fase pode decorrer fora da plataforma (por exemplo o pitch). Nesse caso, dentro da plataforma só se registam as convocatórias e as avaliações dessa fase.

O resultado da última fase é o resultado final. Uma call simples tem uma só fase.

### 5.3. Formas de criar uma call

- Criar manualmente.
- Duplicar uma call anterior: copia a configuração, o formulário, as regras, as fases, a grelha e a equipa. Nunca copia candidaturas, avaliações nem decisões.
- **Importar** o regulamento, um formulário anterior e/ou uma grelha de avaliação (PDF, Word, Excel; os formatos efetivamente suportados têm de ser comunicados na interface). O motor propõe uma configuração **em rascunho**. Destaca o que pode estar desatualizado: datas, prazos, referências a edições anteriores, limites de idade da empresa.

  A importação usa IA sobre documentos da entidade, nunca de candidatos (secção 2.3).

## 6. Tab Form

### 6.1. Campos

Por campo, o administrador define:

- texto da pergunta ou nome do documento;
- tipo;
- opções, quando aplicável, com identificadores estáveis (servem a elegibilidade, os filtros, a distribuição e as cotas);
- obrigatoriedade;
- instrução opcional;
- validações;
- condição de apresentação.

Tipos de campo:

| Tipo | Notas |
|---|---|
| Short text | |
| Long text | Limite de caracteres ou palavras opcional |
| Number | **Só dígitos**: sem letras, vírgulas nem pontos. Mostra o valor formatado por baixo enquanto se escreve (por exemplo "500 000 €"). Sem negativos. **[Decisão]** |
| Date | |
| Yes/No | Sem valor por omissão |
| Single choice | Única forma que pode alimentar cotas (secção 11.2) |
| Multiple choice | |
| File | **Só PDF.** **[Decisão]** Tamanho máximo configurável |

### 6.2. Condições de apresentação

Exemplo: "Data de constituição" só aparece se "A empresa está constituída?" = Sim.

Um campo obrigatório oculto pela condição não bloqueia a submissão. As condições são verificadas também no servidor.

### 6.3. Obrigatoriedade não é elegibilidade

Uma pergunta obrigatória exige resposta; não exclui por si só. Só uma regra explícita na tab Eligibility exclui.

### 6.4. Pré-preenchimento

Todo o campo cujo equivalente a plataforma já conhece vem pré-preenchido e editável: nome da empresa, país, nome da pessoa, cargo, setor, estágio, website, entre outros.

No formulário, o administrador vê que campos estão ligados a dados da plataforma. O mapeamento é explícito por campo, e não inferido de cada vez.

Um campo editado pelo candidato nunca volta a ser sobreposto pelo perfil. O aviso de divergências entre a candidatura e o perfil fica para depois (secção 30).

### 6.5. Páginas

O motor pode propor a divisão em páginas curtas por assunto (cerca de 5 campos como referência, não como limite). O administrador revê na pré-visualização, e a estrutura é a mesma para todos os candidatos.

### 6.6. Documentos e Vault

O administrador indica, por documento: o nome, a descrição, a obrigatoriedade, o tipo esperado e a validade máxima (secção 7).

O candidato pode carregar o ficheiro ou escolher um documento do seu Vault. Ao escolher do Vault:

- a autorização de acesso fica registada **em nome da call**, nunca de avaliadores individuais;
- a submissão fixa a versão que existia nesse momento;
- uma atualização posterior no Vault não altera o material submetido;
- a autorização é revogada quando a call é arquivada.

Antes de submeter, uma nova versão no Vault pode atualizar o rascunho, com aviso e confirmação.

## 7. Tab Eligibility

### 7.1. Princípios

- Cada regra está **sempre ligada a uma pergunta ou a um documento** do formulário. **[Decisão]**
- Uma candidatura é Fit só se cumprir todas as regras.
- As regras objetivas usam validação determinística.
- **Tentar ao máximo evitar regras sobre respostas abertas.** **[Decisão]** Quando o administrador escreve um requisito aberto, a plataforma sugere convertê-lo numa pergunta fechada.

### 7.2. Tipos de regra

| Tipo | Exemplo | Verificação | Se falhar |
|---|---|---|---|
| Opções | Setores aceites, estágio, país | Correspondência com as opções escolhidas | Not a fit |
| Número | Montante levantado ≤ 500 000 € | Operador (≥, >, ≤, <, entre) e valor só em dígitos. A regra é mostrada numa frase que deixa explícita a fronteira: "Quem indicar exatamente 500 000 € é elegível" | Not a fit |
| Data | Constituída há menos de 5 anos | Comparação com a data de referência da call (explícita) | Not a fit |
| Yes/No | Sede em Portugal = Sim | Correspondência | Not a fit |
| Documento presente | Certidão permanente obrigatória | Presença | Not a fit |
| Documento certo | O ficheiro é uma certidão permanente, não uma fatura | Padrões no texto extraído (cabeçalho, estrutura, campos típicos) | Not a fit se claramente outro documento; To validate se houver dúvida |
| Documento válido | Emitido há menos de 3 meses; NIF e nome coincidem com os declarados | Extração e comparação | Not a fit se claramente fora; To validate se não for legível ou confirmável |
| Documento autêntico | Não foi alterado | Verificação da assinatura digital, quando existe; extração do código de verificação, quando existe | **Sempre To validate**, nunca Not a fit automático |
| Resposta aberta | "O projeto tem impacto social?" | Requisito confirmado pelo administrador | **Sempre To validate** |

### 7.3. Documentos: casos a distinguir

- **PDF só imagem** (digitalizado): To validate, com a explicação "Scanned file (image): text cannot be read automatically". Sem OCR na v1. **[Decisão]**
- **Assinatura digital inválida:** To validate, com o alerta "Document altered after signing".
- **Sem assinatura nem código:** To validate, com "Authenticity cannot be verified automatically".
- **Com código de verificação** (certidão permanente, declarações de não dívida e outros): extrair o código e mostrá-lo a quem valida, com o link para o portal oficial, para confirmar com um clique. A consulta automática ao portal não está na v1.
- Distinguir sempre três situações: documento incompatível com o pedido, validade não confirmável, e falha técnica.

### 7.4. Regras abertas

O administrador descreve o requisito, a plataforma apresenta a interpretação que vai aplicar, e o administrador confirma ou clarifica. Se as clarificações se contradizerem, pede-se resolução em vez de escolher uma. Na v1, todas as candidaturas sujeitas a regras abertas vão para To validate, para decisão humana.

### 7.5. Subtabs de elegibilidade

| Subtab | Conteúdo |
|---|---|
| Fit | Cumpre todas as regras |
| Not a fit | Incumprimento de regras objetivas |
| To validate | Regras abertas, documentos não confirmáveis ou ilegíveis, e candidaturas assinaladas por avaliadores. Ninguém sai daqui excluído sem uma decisão humana |

### 7.6. Correção humana **[Decisão]**

- Quem tem a permissão "Correct eligibility & document validity" pode reclassificar (Fit ↔ Not a fit, e resolver To validate), sempre com justificação. A correção muda a classificação global.
- Quem não tem essa permissão dispõe de **"Flag possible ineligibility"**, que envia a candidatura para To validate com o motivo. Não a exclui nem a retira aos colegas.
- Corrigir um documento recalcula a elegibilidade com as restantes regras: a candidatura não passa automaticamente a Fit se houver outros incumprimentos.
- **Cada correção é guardada como exemplo de avaliação do motor:** a regra, o resultado do motor com o motivo e a evidência, a decisão humana, o autor, a justificação e a data. Distinguir os erros de reconhecimento das exceções próprias daquela call. Estes dados servem para medir a performance do motor no backoffice; o ecrã de análise fica para depois, mas **os dados guardam-se desde já**.

## 8. Preview, confirmação e ciclo da call

**Estados:** Draft → Validated → Scheduled/Open → Closed → (fases de avaliação) → Results published → Archived.

**Antes de confirmar, a pré-visualização mostra:**

- o formulário;
- o percurso de quem é novo e de quem já tem conta;
- as condições de apresentação;
- os documentos pedidos;
- o resumo das regras de elegibilidade em frases;
- as fases;
- a distribuição;
- a grelha com a fórmula (secção 12.3);
- as cotas.

**Antes da abertura:** "Edit configuration" invalida a confirmação anterior. Uma call agendada não abre sem estar confirmada.

**Depois da abertura:**

| Bloqueado | Permitido |
|---|---|
| Perguntas e opções | Prolongar o prazo para todos (secção 14.4) |
| Regras de elegibilidade | Encerrar antecipadamente |
| Grelha e regras oficiais de pontuação | Gerir a equipa |
| | Alterar a distribuição (secção 10.4) |
| | Definir cotas e vagas até à seriação da fase |

O encerramento impede novas submissões, mas não interrompe a análise, a avaliação nem a revisão do que já entrou.

## 9. Equipa: categorias, permissões e seats

### 9.1. Categorias **[Decisão]**

- As categorias existem **ao nível da entidade**, reutilizadas em todas as calls. Podem ser criadas, renomeadas e apagadas; apagar uma categoria com pessoas obriga a reatribuí-las primeiro.
- A entidade cria as suas ("Manager", "Finance specialist"…), escolhidas de uma lista para nunca as escrever duas vezes.
- Cada categoria tem um conjunto de permissões, ligadas e desligadas para a categoria inteira.
- Cada categoria é uma **caixa que expande** e lista as suas pessoas. Por pessoa é possível mudar a categoria e, por um toggle discreto, ajustar uma permissão só para ela. Os ajustes individuais ficam escondidos até se abrir a caixa.
- Em cada call, o administrador escolhe que membros participam.

### 9.2. Permissões (v1)

| Permissão |
|---|
| Configure call |
| Manage team & permissions |
| View all applications / only assigned |
| Evaluate assigned applications |
| Correct eligibility & document validity |
| View colleagues' evaluations after completing own |
| Final decision & selection overrides |
| Publish results |
| Handle contestations |

### 9.3. Seats **[Decisão]** (Etapa 0)

- **Os avaliadores consomem seats.** O plano custom ("Private Detective") tem um número de seats definido pelo backoffice. Para o piloto, a PV tem 10 seats.
- **Duas formas de ativação:**
  - **Pré-atribuição:** o backoffice atribui o plano ao perfil da entidade antes do claim. Usa-se para entidades com acordo, como a PV.
  - **Código promocional preso à entidade:** só funciona naquele perfil, só para quem tem um claim aprovado nele, é de uso único, tem validade e pode ser revogado pelo backoffice.
- O administrador da entidade atribui e retira seats aos membros, dentro do número disponível. Ao tentar exceder, a plataforma bloqueia e explica porquê.
- **Membro que perde o seat:** a conta pessoal mantém-se; os dados da firma ficam com a firma. Na entrada seguinte, se não estiver associado a nenhuma firma com seat nem tiver plano próprio, vê "You're no longer part of X" e o ecrã de planos.
- **Backoffice:** número de seats por firma, quem ocupa cada seat e desde quando, histórico, lugares livres, libertar e reatribuir.
- O claim de um segundo membro de uma firma com plano ativo não pode cair em pendente por falta de seat, enquanto houver lugares livres.

### 9.4. Conflito de interesses **[Decisão]**

- Botão **"Declare conflict"** em cada linha de candidatura. A candidatura deixa de estar visível para esse avaliador, é reatribuída segundo a distribuição, e o administrador é notificado.
- O administrador tem uma secção dedicada com os conflitos declarados, e pode marcar conflitos à partida (por exemplo, uma empresa do portefólio de um avaliador).

## 10. Team & distribution — distribuição das candidaturas

### 10.1. Momento

A elegibilidade é verificada pelo motor e as candidaturas são distribuídas **à medida que entram**. **[Decisão]**

O avaliador vê o estado de processamento e de elegibilidade das candidaturas que lhe são atribuídas. Podem existir Fit errados, que se corrigem como descrito na secção 7.6.

O administrador escolhe se as candidaturas Not a fit também são distribuídas (por omissão, não são) e se as To validate são distribuídas antes de resolvidas (por omissão, são, marcadas como tal).

### 10.2. Modalidades

| Modalidade | Regra |
|---|---|
| Quantity | Limite total por avaliador naquela call/fase ("cota por pessoa") |
| Percentage | Quota por membro, somando 100% |
| Category | Correspondência com as opções de uma pergunta fechada |
| Joint | Todos os membros selecionados recebem a candidatura |

O administrador pode entrar na distribuição como avaliador. As combinações de modalidades por grupos ficam para depois.

### 10.3. Regras de distribuição

**Percentagens:**

- podem ser diferentes entre membros e têm de somar 100%;
- uma candidatura inteira de cada vez;
- rotação ponderada com continuidade entre lotes e interrupções;
- desempate estável;
- nenhuma candidatura fica por atribuir por causa de arredondamentos.

Exemplos: 37 candidaturas por quatro membros a 25% dá 10/9/9/9, e a seguinte vai para o membro seguinte. Com 50/25/25, A recebe cerca de duas por cada uma de B e de C. Submissões simultâneas não podem corromper os contadores.

**Categoria:** só perguntas fechadas. Com vários membros correspondentes, a call define se a candidatura vai para todos, ou para um só, equilibrando a carga.

**Sem destino:** as candidaturas sem correspondência, ou com as quantidades esgotadas, ficam **Unassigned**, com aviso ao administrador. Nunca desaparecem das contagens.

### 10.4. Alterações

Ao alterar as regras, o administrador escolhe uma de duas opções: aplicar só às próximas candidaturas, ou também às que não têm trabalho iniciado.

- Abrir uma candidatura não conta como trabalho iniciado; guardar uma nota, uma resposta da grelha, uma justificação ou uma decisão já conta.
- Reatribuir trabalho iniciado exige uma ação explícita, preserva a autoria e nunca apresenta o trabalho anterior como sendo do novo avaliador.
- Ao retirar um avaliador, a plataforma lista o trabalho pendente e pede ao administrador que resolva as atribuições.

### 10.5. Prazos dos avaliadores **[Decisão]**

O administrador define o prazo por fase e os lembretes. Ao ultrapassar o prazo, o administrador é notificado de quem está em atraso e com quantas candidaturas, para poder contactar a pessoa ou reatribuir.

## 11. Selection — seriação por mínimos, cotas e vagas **[Decisão]**

### 11.1. Onde e quando

O bloco **Selection** fica na tab Team & distribution, separado visualmente do bloco de distribuição:

- **"Who evaluates"** (distribuição, secção 10): a cota por pessoa é o número de candidaturas que cada avaliador recebe.
- **"Who is selected"** (seleção, esta secção): as cotas por categoria são o número de lugares.

São conceitos diferentes e não podem partilhar nomes nem controlos.

As categorias disponíveis para cotas vêm das perguntas **de escolha única** do formulário. Só ficam disponíveis depois de o formulário estar validado. Enquanto não estiver, aparece o aviso "Quotas can be set once the form is validated".

Os mínimos de nota vêm da grelha (secção 12.2). Se a grelha ainda não estiver aprovada, aparece um aviso equivalente.

### 11.2. Configuração

- Checkbox **"Rank with quotas"**. Ao marcar, expande.
- Escolha de **uma** pergunta de escolha única como categoria (por exemplo "Main sector").
- Por cada opção da categoria, valores próprios (podem ser diferentes entre opções, por exemplo mais lugares para Health do que para Energy):
  - **máximo** de lugares (opcional);
  - **mínimo reservado** (opcional).
- **Vagas totais** (opcional).
- **Lugares por preencher:** quando uma categoria não tem candidatos suficientes acima do mínimo, o administrador escolhe entre "pass to the general list" e "leave empty".
- **Validações:**
  - a soma dos mínimos reservados não pode exceder as vagas totais;
  - o mínimo reservado de uma opção não pode exceder o seu máximo.

### 11.3. Algoritmo

1. Ordenar as candidaturas Fit com nota final pela nota, da mais alta para a mais baixa, aplicando o desempate da grelha.
2. Marcar como **Below minimum** quem falha um mínimo, seja por critério ou global.
3. **Mínimos reservados:** para cada categoria, atribuir os lugares reservados aos melhores dessa categoria acima do mínimo, dentro das vagas totais.
4. **Restantes lugares:** percorrer a lista por nota; cada candidatura acima do mínimo ocupa um lugar se o máximo da sua categoria e as vagas totais o permitirem.
5. Lugares reservados não preenchidos seguem a escolha do administrador (11.2).

### 11.4. Apresentação

A lista aparece em blocos, por esta ordem, e cada bloco ordenado por nota:

| Bloco | Cor | Etiqueta |
|---|---|---|
| Selecionáveis | Verde | "Within quota" (ou "Selected" quando não há cotas nem vagas) |
| Acima do mínimo, sem lugar | Âmbar | "Above minimum — quota/slots full" |
| Abaixo do mínimo | Cinzento | "Below minimum" |
| Sem nota completa | Neutro | "Evaluation incomplete" (fora da seriação) |

- Cada linha mostra também a posição pela nota pura, por exemplo "#2 overall", para se perceber porque é que uma nota mais alta está abaixo de outra.
- Funciona com ou sem mínimos, e com ou sem cotas e vagas. Sem mínimos não há bloco cinzento; sem cotas nem vagas, a lista é a ordem pura por nota.
- Há filtros por setor, estágio e qualquer outra pergunta fechada. Ao filtrar, cada linha mantém a posição na seriação geral (por exemplo "8th of 42").
- A seriação fica marcada como **provisória** enquanto faltarem avaliações.
- O administrador pode mover candidaturas entre blocos, sempre com justificação registada.
- A seriação de uma fase intermédia serve para decidir quem passa à fase seguinte; a da última fase serve para a decisão final.

## 12. Evaluation — grelha e avaliação humana

### 12.1. Modalidades (por fase)

- **No score:** decisão e justificação.
- **Overall score:** uma nota numa escala definida.
- **Grid:** secção 12.2.

### 12.2. Construtor de grelha **[Decisão]**

Cria-se por importação (o motor extrai as contas) ou manualmente. Peças combináveis:

| Peça | Opções |
|---|---|
| Escala por critério | Mínimo e máximo definidos pelo administrador (0–5, 1–5, 0–10…). **Nunca convertida** |
| Descrições por nível | Opcionais, em qualquer nível (por exemplo, só no 1, no 3 e no 5) |
| Peso | Slider ou número; soma visível em tempo real; não grava sem 100% (na média ponderada) |
| Grupos | Subcritérios agrupados, cada grupo com o seu peso |
| Agregação | Média ponderada, média simples ou soma de pontos, por grupo e no total |
| Mínimo por critério | Opcional, eliminatório |
| Mínimo global | Opcional, nota final mínima de aprovação |
| Arredondamento | Casas decimais; arredondar em cada passo ou só no fim |
| Desempate | Ordem dos critérios a usar; por fim, a data de submissão |
| Critérios Sim/Não | Resposta valorizada recebe o peso, a outra zero; sem valor por omissão |

O total é expresso **na escala da grelha** (por exemplo 3,45 / 5).

Se um documento importado descrever algo que estas peças não cobrem, a plataforma diz exatamente o quê, em vez de aproximar em silêncio.

### 12.3. Pré-visualização da grelha

- **A fórmula por extenso.** Exemplo da PV: "Final score = weighted average on a 1–5 scale = Team × 25% + Technology & IP × 10% + …".
- **Verificação dos pesos:** "Sum of weights: 100% ✓", ou alerta.
- **Mínimos e regras de arredondamento e desempate**, em frases.
- **Dois ou três exemplos calculados.** Na PV: todos a 3 dá **3,00**; Team a 5 e o resto a 3 dá **3,50**.

### 12.4. Interface do avaliador

- Escolha do nível por **botões lado a lado**, nunca escrevendo números.
- A descrição do nível aparece ao passar o cursor ou ao selecionar, quando existe.
- O peso fica visível junto ao nome do critério.
- Comentário por critério opcional, escondido atrás de "Add comment".
- **Nota final num anel circular em destaque**, preenchido à medida que a grelha avança. Mostra **"N/A"** até todos os critérios estarem preenchidos, e depois o valor na escala da grelha.
- Gravação automática a cada seleção. Pode-se navegar entre candidaturas sem perder nada e, quando possível, mantendo a mesma secção.
- **Estados:** Not started / In progress / Completed.
- **"Complete evaluation"** verifica a decisão, a justificação exigida e a grelha completa. Uma grelha iniciada e incompleta não gera total.

### 12.5. Por avaliador

Guarda-se, por avaliador e por fase:

- estado;
- Accepted/Rejected (na fase intermédia: "Advance"/"Do not advance");
- nota;
- respostas da grelha;
- justificação;
- autor;
- datas;
- histórico de versões.

### 12.6. Médias

- Média só das notas concluídas e preenchidas, na escala comum.
- Vazio não é zero. Sem notas não há média.
- Mostrar sempre o número de contribuições, por exemplo "3 of 3 evaluations completed · 2 with score".
- Rascunhos não entram na média.
- **Trabalho em falta:** o administrador pode reatribuir, aguardar, ou avançar sem todas as avaliações, por ação explícita e com motivo registado. Ausência de avaliação nunca vale zero.

### 12.7. Privacidade entre avaliadores

- **Avaliação cega:** cada membro só vê o seu trabalho até concluir a avaliação.
- O administrador acompanha tudo, exceto nas candidaturas que ele próprio avalia: aí só vê as dos colegas depois de concluir a sua.
- Depois de tudo concluído, a partilha entre avaliadores é configurável: não partilhar (por omissão), partilhar sem identificação, ou partilhar com identificação. Ocultar a identidade abrange tudo o que a interface mostra.

### 12.8. Reabertura de avaliações

| Momento | Regra |
|---|---|
| Antes da validação final | O avaliador reabre a sua avaliação |
| Depois da validação final | Exige autorização do administrador, e a candidatura volta a precisar de validação |
| Depois da publicação | Nada substitui o resultado em silêncio; exige confirmação e nova publicação |

Preservar sempre as versões anteriores, e registar se o avaliador já tinha visto as avaliações dos colegas.

## 13. Entrada do candidato: link, registo e código

### 13.1. O link da call

- Gerado quando o administrador publica a call.
- Abre um ecrã com o **cabeçalho da call** (entidade, título, prazo, resumo, elegibilidade em frases, regulamento) e, por baixo, a caixa de registo.
- **"Already have an account? Sign in"** está sempre visível. **[Decisão]**
- O link mantém a memória: depois de entrar, a pessoa vai sempre para esta call. Se já tiver começado a candidatura, abre onde ficou.

### 13.2. Registo (primeira página)

- Campos:
  - email;
  - nome da startup ou projeto;
  - país;
  - nome da pessoa;
  - cargo;
  - **palavra-passe**, com a política existente e o olho de mostrar e esconder do Prompt 903;
  - telefone, quando a call o exigir.
- Explica que é criada uma conta gratuita na SherlockDeal para guardar e acompanhar candidaturas, e que há planos adicionais para outras ferramentas.
- Apresenta as autorizações aplicáveis, com as comunicações opcionais separadas.
- Botão **"Create account & continue"**.

### 13.3. Código de confirmação **[Decisão]**

1. Ao continuar, a conta é criada e é enviado um **código de 6 dígitos**.
2. O candidato escreve o código **na mesma página**, sem sair do formulário.
3. O código confirma a conta, e o candidato segue para o formulário.

Garantias obrigatórias:

- o código é aleatório, gerado no servidor, de uso único;
- expira (proposta: 30 minutos);
- um código errado nunca confirma;
- pedir um novo código invalida o anterior;
- ao fim de 5 tentativas erradas, é preciso pedir outro (limite aplicado no servidor);
- o reenvio fica disponível ao fim de 60 a 90 segundos, com contagem visível e limite também no servidor;
- o template do email de registo contém o código;
- o que foi escrito no formulário mantém-se enquanto se espera pelo código;
- se a janela fechar, a conta já existe: a pessoa entra e continua.

### 13.4. Contas existentes e privacidade

- O ecrã **nunca revela se um email já tem conta.** Tentar registar um email existente mostra a mesma resposta que um registo novo ("We sent a code to X"). O email que essa pessoa recebe diz que já tem conta, com um link para entrar e voltar à call.
- Quem entra com uma conta existente volta à call com o formulário pré-preenchido.
- **Conta sem startup associada** (por exemplo, só de investidor): a primeira página pede o nome e o país da startup e cria-a antes de continuar.
- Um email não pode criar uma segunda conta nem dar acesso sem autenticação.

### 13.5. Transferência de informação

| Destino | Comportamento |
|---|---|
| Conta/perfil | Recebe os dados da pessoa |
| Tab About [empresa] | Recebe os dados da startup, segundo o modelo da plataforma (é uma tab da plataforma, não uma página do formulário) |
| Formulário | Pré-preenche os campos equivalentes, editáveis |
| Candidatura submetida | Guarda os valores confirmados no formulário |

- Editar o contacto da candidatura não altera a conta nem o About.
- A palavra-passe serve só para autenticar: nunca vai para o About, a candidatura, o motor ou a avaliação.
- Esta transferência tem de ser testada explicitamente, porque há falhas semelhantes noutros percursos.

## 14. Formulário: gravação, navegação, submissão

### 14.1. Gravação e navegação

- **Gravação:**
  - automática durante o preenchimento;
  - em "Next" e em "Back";
  - recuperação do rascunho ao regressar.
- **Estados de gravação:** "Saving…", "Saved", "Unsaved changes / save error". Nunca indicar sucesso antes de o servidor confirmar. Uma falha de rede preserva o que está no ecrã e permite tentar outra vez.
- **Navegação:**
  - "Back" não apaga páginas posteriores;
  - a barra de progresso mostra a página atual;
  - depois de criada a conta, não há "Back" para a página de registo.
- **Última página:** "Save" (mantém em rascunho) e "Save & submit".

### 14.2. Verificação final ao submeter

- A call aceita submissões (pela hora do servidor).
- A conta está confirmada.
- Os obrigatórios aplicáveis estão preenchidos.
- Os uploads estão concluídos.
- O limite por unidade é respeitado.

Se faltar algo, aparece um popup com o nome de cada campo e a página onde está.

### 14.3. Submissão

- Regista a data e a hora.
- Guarda uma **versão estável e imutável** das respostas e dos documentos.
- É **idempotente**: um duplo clique ou um pedido repetido não cria duplicados.
- Confirma claramente a receção, com notificação.
- Arranca o processamento e a distribuição.

**Depois de submeter, nada muda:** não se substituem nem acrescentam documentos, nem se editam respostas. As correções pedidas pela entidade ficam para depois (secção 30).

### 14.4. Prazo **[Decisão]**

- Conta a hora a que o pedido chega ao servidor.
- **O administrador nunca vê rascunhos.** Só vê o que foi submetido.
- O administrador pode **prolongar o prazo para todos**, sem criar uma nova call. O prolongamento fica visível na página da call e no histórico, e a plataforma notifica automaticamente quem tem rascunhos por submeter, sem o administrador saber quem é.

### 14.5. Reportar problema

O botão "Report a problem" está em todas as páginas do percurso, incluindo a do código. O reporte inclui:

- a call;
- a candidatura, se existir;
- o utilizador;
- a página;
- o prazo;
- a descrição;
- dados técnicos úteis, nunca palavras-passe nem segredos.

Vai para o backoffice com prioridade urgente e o utilizador recebe confirmação. Não submete nada nem altera prazos. Reutilizar o mecanismo de suporte existente.

## 15. Duplicados **[Decisão]**

Nunca bloquear por suspeita. A plataforma assinala ao administrador **"Possible duplicate"** quando há sinais em comum:

- o mesmo nome normalizado;
- o mesmo website;
- o mesmo domínio de email (excluindo os genéricos: Gmail, Hotmail e semelhantes);
- a mesma pessoa em duas organizações;
- o mesmo NIF, quando a call o pede.

A decisão é do administrador, à luz da unidade definida na secção 5.1. Exemplo real: duas marcas da mesma entidade jurídica são a mesma entidade, mas projetos diferentes.

## 16. Processamento automático (fiabilidade)

- Gravar a candidatura e o pedido de processamento de forma consistente: nunca pode existir uma candidatura sem tarefa.
- **Fila:**
  - persistente e por ordem de entrada;
  - com concorrência controlada;
  - isolada por candidatura e versão;
  - com repetição de falhas temporárias;
  - com operações idempotentes;
  - com deteção de tarefas presas;
  - com recuperação, alertas e reconciliação.
- **Estados:** Queued / Processing / Done / Technical failure.
- Uma análise incompleta não é aceite como resultado.
- Exemplos de falha técnica:
  - serviço indisponível;
  - timeout;
  - erro ao ler um ficheiro guardado;
  - erro ao gravar o resultado;
  - resultado estruturalmente incompleto.

  Repetir quando for recuperável, sinalizar quando exigir intervenção, e **nunca converter uma falha em incumprimento**.

## 17. Revisão final e decisão

- Listas de candidaturas aprovadas e rejeitadas pelos avaliadores. **"Divergent decisions"** quando discordam, com acesso a todas as avaliações e sem decisão automática.
- **Ações do administrador:**
  - confirmar ou alterar decisões;
  - mover candidaturas entre blocos da seriação;
  - "Agree with evaluator" (identifica a avaliação adotada);
  - ajustar a nota final;
  - ações em bulk.
- **Nota final:** guardam-se separadamente as notas originais, a média original, a nota validada e o ajuste, com o autor, a data e um motivo interno curto (obrigatório quando substitui o valor calculado). Rejeitar por falta de lugar não obriga a mudar a nota.
- **Bulk:**
  - mostra quantas candidaturas abrange e se inclui páginas não visíveis;
  - permite selecionar todos os resultados de um filtro;
  - permite uma justificação comum, só onde fizer sentido para todas.

## 18. Publicação de resultados

**Modalidades:** documento/link, ou resultado individual pela plataforma.

**Opções separadas:**

- partilhar a nota final;
- partilhar a justificação final;
- permitir contestações. Ligar esta opção torna a justificação obrigatória nas rejeições, impede desligar essa partilha enquanto a contestação estiver ativa, e exige um prazo posterior à publicação.

**O candidato vê apenas:** o resultado ou o documento/link, a nota se autorizada, e a justificação destinada ao candidato.

**Nunca vê:** notas internas, decisões intermédias, autores das avaliações nem histórico de ajustes.

O administrador revê as notas partilhadas e os documentos de publicação antes de publicar.

## 19. Contestações

- Só existem depois da publicação, se a call o permitir, e dentro do prazo.
- Contêm a call e a candidatura identificadas automaticamente, e a razão escrita pelo candidato.
- Não aceitam documentos novos nem alteram respostas.
- O administrador tem a tab **Contestations**: aceita ou rejeita, regista e comunica a justificação. Se o resultado mudar, segue a validação e a republicação, preservando o histórico.

## 20. Área do candidato

**Open calls:**

- cards e filtros: abertas, em preenchimento, submetidas, arquivo;
- ao abrir uma call, informação e requisitos no padrão das pipelines;
- ações conforme o contexto: Apply / Continue application / View application;
- quando são permitidas várias candidaturas, distinguir as existentes e permitir iniciar outra.

**My applications:**

- estados automáticos: In progress, Submitted, Under review, Phase X (com "Passed to the next phase"), Result available, Contestation under review;
- ordem: em preenchimento por prazo mais próximo; depois submetida ou resultado disponível; depois contestação; depois em análise;
- filtros por estado;
- uma submetida abre só para consulta.

**Past applications:** o processo termina após o prazo de contestação, ou após resolvidas as contestações pendentes, ou após o resultado publicado quando não há contestação. Calls encerradas sem submissão e rascunhos não terminados vão para o arquivo.

## 21. Painéis

**Administrador:**

- submetidas;
- em fila, em análise e com falha técnica;
- Fit, Not a fit, To validate;
- possíveis duplicados;
- unassigned;
- avaliações por estado e por fase;
- avaliadores em atraso;
- conflitos declarados;
- decisões divergentes;
- seriação provisória ou final;
- por publicar;
- contestações pendentes.

As contagens não sugerem somas erradas. Rascunhos não contam (e o administrador não os vê).

**Avaliador:**

- por avaliar, em curso e concluídas;
- To validate pendentes, quando tem a permissão;
- novas atribuições;
- prazo da fase.

Uma call aberta pode receber novas candidaturas depois de o avaliador ter concluído todas as existentes.

## 22. Histórico

Preservar:

- configurações confirmadas;
- regras e interpretações;
- fases e passagens;
- versões submetidas;
- resultados automáticos;
- correções humanas (dataset da secção 7.6);
- atribuições e reatribuições;
- conflitos;
- avaliações e revisões;
- ajustes de nota;
- seriações e alterações manuais;
- decisões;
- publicações;
- contestações;
- prolongamentos de prazo.

Isolamento total entre entidades, calls, candidatos e avaliadores.

## 23. Notificações **[Decisão]**

Cada notificação sai **por email e dentro da plataforma**, reutilizando o mecanismo de notificações in-app existente (identificar qual na etapa 1).

| Destinatário | Evento |
|---|---|
| Candidato | Código de confirmação · submissão recebida · lembrete de rascunho por submeter 48 h antes do fecho · prolongamento de prazo · "Passed to the next phase" (com o texto do administrador) · resultado disponível · resposta à contestação |
| Membro da equipa | Novas atribuições · lembrete de prazo · candidatura assinalada para To validate (a quem tem a permissão) |
| Administrador | Avaliadores em atraso · conflitos declarados · falhas técnicas por resolver · reportes de problema · contestações novas |

**Volume:** numa call com 200 candidatos, contar pelo menos 4 emails por candidato, mais os da equipa. Os limites do fornecedor de email têm de o comportar, sobretudo perto do prazo (Etapa 0).

## 24. Proteção de dados

- **Papéis** (a formalizar contratualmente):
  - a entidade promotora é responsável pelo tratamento dos dados da candidatura (finalidades, base legal, informação aos candidatos, conservação, acessos);
  - a operadora da SherlockDeal é subcontratante, segundo um acordo com a entidade;
  - os dados da conta SherlockDeal são tratamentos próprios da operadora, separados.
- **Subcontratantes declarados com o país:**
  - Supabase: base de dados e ficheiros, Londres (eu-west-2);
  - Vercel: aplicação, hoje EUA;
  - Resend: email.

  Na v1 não há fornecedor de IA sobre dados de candidatos (secção 2.3).
- **Conservação** definida por call. O acesso dos membros termina quando deixa de ser necessário, mesmo que os dados fiquem em arquivo restrito.
- **Eliminação e devolução** pelo fluxo RGPD existente, alargado às candidaturas.
- **Texto de consentimento e informação** na submissão.
- **Revisão jurídica pendente:** esta especificação não substitui parecer jurídico.

## 25. Verificações de aceitação

1. O registo preenche corretamente a conta, o About e os campos equivalentes do formulário.
2. Código: um código errado não confirma; um código expirado não confirma; o reenvio invalida o anterior; 5 tentativas erradas bloqueiam até haver um código novo; o reenvio respeita o tempo de espera no servidor; a entrada noutro dispositivo funciona.
3. Registar um email existente não revela a conta, e o titular consegue entrar e continuar a candidatura.
4. Uma conta sem startup cria a startup antes do formulário.
5. Alterar o contacto da candidatura não altera a conta.
6. As palavras-passe nunca aparecem na candidatura, no motor nem na avaliação.
7. Navegar para trás e para a frente preserva tudo; uma interrupção recupera o que estava guardado.
8. Os campos em falta aparecem com a página certa.
9. Um pedido de submissão repetido não cria duplicados.
10. A versão submetida de um documento do Vault não muda depois de uma atualização no Vault; a autorização fica em nome da call.
11. Um PDF só imagem vai para To validate com a explicação; uma assinatura inválida vai para To validate com o alerta.
12. Uma regra aberta nunca gera Not a fit automático.
13. As correções de elegibilidade ficam guardadas com o resultado do motor, a decisão humana, o autor e a justificação.
14. "Flag possible ineligibility" envia para To validate sem retirar a candidatura aos colegas.
15. 200 submissões com interrupções simuladas terminam em resultados ou falhas identificadas e recuperáveis, sem perdas nem misturas.
16. A distribuição percentual não perde candidaturas por arredondamento e mantém a continuidade; alterar a distribuição não move trabalho iniciado.
17. Uma avaliação parcial retoma noutra sessão; notas vazias ou em rascunho não contam como zero.
18. A grelha da PV calcula todos a 3 como 3,00 e Team a 5 com o resto a 3 como 3,50; a fórmula da pré-visualização corresponde ao cálculo.
19. A escala nunca é convertida; o "N/A" aparece até a grelha estar completa.
20. Seriação: um caso com cotas máximas diferentes por categoria, um mínimo reservado, vagas totais e um mínimo global produz os blocos esperados (verde, âmbar, cinzento) e a posição "#n overall" correta; os filtros mantêm a posição geral.
21. A passagem de fase só acontece por ação humana; o candidato vê "Passed to the next phase" e recebe a notificação.
22. Um avaliador não vê avaliações de colegas antes de concluir a sua.
23. Declarar um conflito retira a candidatura ao avaliador e reatribui-a.
24. Ajustar a nota final preserva as originais e exige motivo.
25. Publicar não expõe informação interna; a contestação não aceita documentos; republicar preserva o histórico.
26. O administrador nunca vê rascunhos; prolongar o prazo notifica quem tem rascunho, sem o administrador saber quem é.
27. Seats: o 11.º membro é bloqueado com 10 seats; um membro retirado vê o ecrã de planos; o código promocional só funciona no perfil e para o claimant certos.

## 26. Etapas de entrega **[Decisão]**

| Etapa | Conteúdo |
|---|---|
| 0 | Envio de email (Resend e Supabase Auth), registo com palavra-passe e código, seats de planos custom e código promocional preso à entidade. **Prompt 904** |
| 1 | Separador Calls; General; Phases (estrutura); Form; link e ecrã da call; registo e entrada; pré-preenchimento; gravação; submissão; área do candidato; notificações base |
| 2 | Eligibility (regras, documentos, subtabs, correções e dataset); fila de processamento; duplicados; reportar problema |
| 3 | Categorias e permissões; distribuição; construtor de grelha (manual); avaliação; conflitos; prazos dos avaliadores |
| 4 | Seriação (mínimos, cotas, vagas); passagem de fase; decisão final; publicação; contestações; painéis |
| 5 | Importação por IA de regulamento, formulário e grelha (documentos da entidade) |

Cada etapa é entregue funcional e verificada antes da seguinte, e fica escondida atrás de um interruptor até estar pronta. Depois da etapa 5, revêem-se os detalhes que tenham ficado de fora.

## 27. Entrega de cada etapa

Indicar:

- o que foi implementado;
- os componentes reutilizados;
- as alterações de dados (propostas antes de aplicar);
- como foi verificado o comportamento (incluindo em produção, quando aplicável);
- as limitações ou decisões técnicas que ficam em aberto.

**Não declarar a etapa concluída só porque as páginas existem.** Os fluxos têm de funcionar de ponta a ponta.

## 28. Piloto: Portugal Ventures

- **10 seats** (plano custom, pré-atribuído).
- Grelha de referência para testar o construtor (média ponderada, escala 1–5):

| # | Critério | Peso | Descrições por nível |
|---|---|---|---|
| 1 | Adequação das competências da equipa de gestão ao projeto | 25% | 1 Equipa incompleta · 2 Equipa apenas tecnológica · 5 Competências técnicas e de negócio |
| 2 | Tecnologia e IP | 10% | 1 Sem tecnologia apropriável · 5 Com patentes concedidas |
| 3 | Escalabilidade | 5% | 1 Não escalável · 5 Altamente escalável |
| 4 | Vantagem competitiva | 10% | 1 Sem vantagens competitivas · 3 Vantagens pouco fundamentadas · 5 Vantagens claras e identificáveis |
| 5 | Potencial de mercado | 10% | 1 Pequeno (até $100M) · 3 Grande (cerca de $1B) · 5 Muito grande (mais de $10B) |
| 6 | Desenvolvimento tecnológico / TRL | 10% | 1 TRL 1–2 · 2 TRL 3–4 · 3 TRL 5–6 · 4 TRL 7–8 · 5 TRL 9 |
| 7 | Time-to-market | 10% | 1 Longo, mais de 3 anos · 5 Curto, até 12 meses |
| 8 | Unit economics | 5% | 1 Sem unit economics justificáveis · 3 Carecendo validação · 5 Competitivos e validados |
| 9 | Business model | 5% | 1 Sem modelo de negócio · 3 Pouco fundamentado · 5 Fundamentado e implementável |
| 10 | Financiamento do projeto | 10% | 1 Fortemente inadequado · 5 Fortemente adequado em função dos objetivos |
| | **Média** | 100% | "N/A" até estar completa |

## 29. Riscos conhecidos

- Os emails do Supabase Auth e do Resend são remetentes independentes; um funcionar não prova o outro.
- Hoje as funções do Vercel correm nos EUA. Mover para a UE está apontado, mas não agora.
- A plataforma já envia documentos de startups à Anthropic noutras funcionalidades (revisões, readiness). Isto tem de estar declarado na política de privacidade (fora do âmbito desta área, mas a verificar).

## 30. Fora do âmbito da v1 (decidido adiar)

- Avaliadores externos sem conta (link e código por email), e a revisão do modelo de seats que implicam.
- Correções pedidas pela entidade depois da submissão (reabrir aquela candidatura).
- Aviso de divergências entre candidatura e perfil, com atualização do perfil.
- Ordenação por preferências do avaliador.
- Ecrã de backoffice para medir a performance do motor (os dados guardam-se já, secção 7.6).
- OCR.
- IA sobre dados de candidatos.
- Consulta automática de códigos de verificação em portais oficiais.
- Seleção por dotação financeira comum.
- Combinações de modalidades de distribuição por grupos.
- Funções do Vercel na UE.
- Tradução da interface.
- Transferência de owner da startup.
- Aprendizagem automática imediata a partir de uma correção humana.
