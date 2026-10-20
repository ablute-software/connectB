# Prompt 918 — melhorias da Team (teste do I1)

Três pedidos do Nuno, depois de testar o I1. Decisões e razões em `DECISIONS.md` ("Prompt 918, melhorias da Team") e na spec §9.1.

## O que mudou

1. **Os checks mudam ao clique.** A gravação vai por trás, um pedido de cada vez, e vários cliques seguidos nos mesmos checks (400 ms) viram um pedido. Se falhar, o check volta atrás com uma mensagem curta. O mesmo para a categoria da pessoa e adicionar/remover da call.
2. **A lista de categorias da pessoa tem sugestões e "+ New category…".** Escolher uma sugestão cria a categoria com permissões por omissão e atribui-a logo (Evaluator: "Evaluate assigned"; Analyst: "View all applications"; Manager: tudo menos "Manage team & permissions").
3. **"Create a category" no topo da secção Team**, numa caixa de fundo suave com a linha explicativa; em telemóvel, a largura toda.

## Lista de cliques

1. Calls → uma call → Setup → Team & distribution. No topo está a caixa **Create a category**.
2. Abre a categoria Administrator e carrega depressa em três checks de uma categoria que tenhas: mudam logo; abre o separador da rede, deve haver **um** pedido a `/team` uns 0,4 s depois do último clique.
3. Numa pessoa que já está na call, abre a lista de categorias: vês as que existem, "Suggested — created when you pick one" (Evaluator, Manager, Analyst…) e "+ New category…". Escolhe **Evaluator**: a categoria é criada, a pessoa passa para lá e a caixa abre-se.
4. Numa pessoa que ainda não está na call ("People of …"), escolhe **Analyst** na lista dela e carrega em "Add to the call".
5. "+ New category…" numa pessoa: aparece um campo de nome ali mesmo; escreve, Enter.
6. Tira a permissão "Manage team & permissions" à única categoria administradora: o check volta atrás com "… Change undone." e a explicação.
7. No telemóvel (375 px), a caixa "Create a category" fica no topo, com o campo e o botão na largura toda.

## Verificação

`tsc`, `eslint`, `vitest` e `next build` com código de saída 0 (números no relatório da sessão). Capturas em `docs/calls/screenshots-918-team/`.
