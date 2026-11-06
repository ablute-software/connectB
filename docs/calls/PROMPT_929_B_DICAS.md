# Prompt 929 — parte B: dicas da Sherlock Deal a quem não foi selecionado (06/11/2026)

Decisões em `DECISIONS.md` («Prompt 929, parte B»). Migração aditiva `20261106100000_calls_tips.sql` (coluna `call_result_settings.tips_enabled`, tabela `call_tips`), aplicada antes do código.

## O que há
- **Results → Options:** nova opção, **desligada por omissão**: «Let Sherlock Deal send unsuccessful applicants up to 3 general improvement tips based on the evaluation (no scores or comments are shared)». Com um link **«See an example»** que mostra o email com frases-modelo (nunca de uma candidatura real). Só quem tem «Publish results» a vê ou muda.
- **Quem recebe:** só quem foi avaliado e **não selecionado** (resultado publicado «Reject» vindo da avaliação; nunca *Advance*, *Waitlist*, nem *Not a fit* da elegibilidade) e só se a candidatura tem **pelo menos 2 avaliações submetidas** e há selecionados com que comparar.
- **Quando:** passo diário novo e independente em `/api/automations` (`callTips`): 24 h depois de publicado (a resposta da entidade já lá está) e, se a entidade oferece contestação, só depois do prazo (+1 dia). Cada condição é **lida outra vez no momento de enviar** (interruptor da entidade, recusa do candidato, avaliações).
- **O motor** (`src/lib/calls/tips.ts`, **sem IA, sem chamadas externas**): compara a candidatura com a média dos selecionados em cada critério (ponderado quando a call é ponderada), escolhe as **áreas mais fracas** (máx. 3, diferença mínima), liga cada critério a uma categoria geral pelas palavras do nome/orientação (PT e EN) e usa a **frase-modelo** dessa categoria (a mesma candidatura recebe sempre a mesma). O que faltou no formulário (documentos opcionais vazios, respostas longas muito curtas) só ocupa um lugar livre. Se não há ponto claro, o email leva **só o convite** a completar o perfil da startup.
- **O email** é da Sherlock Deal (não da entidade), separado da resposta da entidade, na língua da call, com o link assinado **«Stop receiving tips from Sherlock Deal»**. Não leva nota, posição, média, número de critérios, nome de critério, avaliador, comentário nem dados de outras candidaturas.
- **Do lado do candidato:** na área Calls há **«Tips from Sherlock Deal»** com a caixa «I don't want to receive feedback from Sherlock Deal about my evaluations» (na conta, vale para todas as calls; lida de novo ao enviar). A recusa também se faz pelo link do email.
- **Registo:** `call_tips` guarda por candidatura o que se fez (enviado / só convite / saltado e porquê / falhou), as categorias e as frases. Nunca notas nem comentários.

## Frases-modelo (para o Nuno rever; editar em `src/lib/calls/tips-templates.ts`)

### team

**EN**

- Show more clearly who is in the team, what each person has already done, and which skills are still missing and how you plan to cover them.
- Make the experience of the founders easier to see: previous roles, results achieved and why this team is the right one for this problem.
- Explain how the team is organised today and how it will grow, so that the people behind the project are as convincing as the idea.

**PT**

- Mostre com mais clareza quem está na equipa, o que cada pessoa já fez e que competências ainda faltam e como pensa colmatá-las.
- Torne a experiência dos fundadores mais visível: funções anteriores, resultados alcançados e porque é esta a equipa certa para este problema.
- Explique como a equipa está organizada hoje e como vai crescer, para que as pessoas por trás do projeto sejam tão convincentes como a ideia.


### market

**EN**

- Make your market sizing more concrete: show how you calculated it and which segment you will reach first.
- Describe your customers more precisely and show what you know about them, with evidence of their need and of how they decide.
- Compare yourself with the alternatives your customers have today and say, in a few lines, why they would choose you.

**PT**

- Torne a dimensão do mercado mais concreta: mostre como a calculou e que segmento vai atingir primeiro.
- Descreva os seus clientes com mais precisão e mostre o que sabe sobre eles, com evidência da necessidade e de como decidem.
- Compare-se com as alternativas que os clientes têm hoje e diga, em poucas linhas, porque o escolheriam a si.


### product

**EN**

- Explain more clearly what is new in your solution and how it differs from what already exists, with a simple example of how it is used.
- Show how mature the product is today (idea, prototype, tested version) and what the next technical steps are.
- Say what protects what you built, such as know-how, a patent or a hard-to-copy advantage, and what could stop you from delivering it.

**PT**

- Explique com mais clareza o que há de novo na sua solução e em que difere do que já existe, com um exemplo simples de utilização.
- Mostre em que ponto está o produto hoje (ideia, protótipo, versão testada) e quais são os próximos passos técnicos.
- Diga o que protege o que construiu, como know-how, uma patente ou uma vantagem difícil de copiar, e o que poderia impedir a entrega.


### traction

**EN**

- Add evidence that people already want what you are building: pilots, letters of intent, users, sales or any result you can show.
- Show what you have achieved so far and what you learned from it, so that the progress of the project is easy to follow.
- Describe the next milestones and how you will know you reached them, so the stage of the project is easy to understand.

**PT**

- Acrescente evidência de que já há quem queira o que está a construir: pilotos, cartas de intenção, utilizadores, vendas ou qualquer resultado que possa mostrar.
- Mostre o que já conseguiu e o que aprendeu com isso, para que o progresso do projeto seja fácil de acompanhar.
- Descreva os próximos marcos e como vai saber que os atingiu, para que o estádio do projeto seja fácil de perceber.


### business_model

**EN**

- Explain more clearly how you will earn money: who pays, for what, and why that price makes sense for the customer.
- Show how the business can grow without growing costs at the same pace, and which choices you made to make it scalable.
- Connect the strategy to the business model: which steps come first, which resources they need and what you will not do for now.

**PT**

- Explique com mais clareza como vai ganhar dinheiro: quem paga, por quê e porque é que esse preço faz sentido para o cliente.
- Mostre como o negócio pode crescer sem que os custos cresçam ao mesmo ritmo e que escolhas fez para o tornar escalável.
- Ligue a estratégia ao modelo de negócio: que passos vêm primeiro, que recursos precisam e o que não vai fazer por agora.


### finance

**EN**

- Make the financial plan easier to follow: main assumptions, how the money will be used and what it will make possible.
- Show how the amount you ask for relates to the milestones you want to reach, and what you will have achieved when it runs out.
- Add the information that lets a reader trust the numbers: where each assumption comes from and what happens if it does not hold.

**PT**

- Torne o plano financeiro mais fácil de seguir: pressupostos principais, como o dinheiro será usado e o que vai tornar possível.
- Mostre como o montante que pede se liga aos marcos que quer atingir e o que terá alcançado quando acabar.
- Acrescente a informação que permite a quem lê confiar nos números: de onde vem cada pressuposto e o que acontece se não se confirmar.


### impact

**EN**

- Describe the impact you want to have in concrete terms: who benefits, how and how you will know it is happening.
- Show how the impact is part of the business and not an extra: what would change in your results if the impact were not there.

**PT**

- Descreva o impacto que quer ter em termos concretos: quem beneficia, como e como vai saber que está a acontecer.
- Mostre como o impacto faz parte do negócio e não é um extra: o que mudaria nos seus resultados se o impacto não existisse.


### documentation

**EN**

- Complete the documents the call allowed you to add and make sure each one answers its question directly and clearly.
- Make the application easier to read: short, direct answers, a clear structure and documents that match what you wrote.
- Use the presentation to tell the story of the project in a logical order, and check that every claim has something behind it.

**PT**

- Complete os documentos que a call permitia acrescentar e confirme que cada um responde de forma direta e clara à sua pergunta.
- Torne a candidatura mais fácil de ler: respostas curtas e diretas, uma estrutura clara e documentos que correspondam ao que escreveu.
- Use a apresentação para contar a história do projeto numa ordem lógica e confirme que cada afirmação tem algo por trás.


## Lista de cliques para o Nuno
1. Numa call de teste com resultados já preparados, em **Results → Options** liga a nova opção e clica **See an example**: vês o email.
2. Publica os resultados. Nada sai logo: as dicas só saem no passo diário, 24 h depois (ou depois do prazo de contestação).
3. Para ver já: espera o passo diário ou corre-o (`/api/automations`) numa call de teste `zz-test-*`.
4. Como candidato não selecionado: recebes o email da Sherlock Deal com até 3 dicas e o convite; o link do rodapé recusa as dicas.
5. Na área **Calls → Tips from Sherlock Deal** marca a caixa: deixas de receber, também as de outras calls.
6. Desliga a opção na entidade antes do envio: nada sai.

## Limite honesto
Não testei o envio real de emails nem o passo diário em produção; testei a lógica, as rotas e o motor sobre a base falsa. O texto das frases é geral de propósito (não deve ser tomado como avaliação).
