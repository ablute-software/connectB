# Prompt 923 — Login de investidor, convites de lugar e mensagens do código — relatório

28/10/2026 · branch `claude/923-login-areas-invites` · migração `20261028150000_investor_seat_invite_links.sql` (aditiva, com teste seco, **aplicada a 28/10 no connectB**, ledger `20261028155222`).

## A — para onde se vai depois do login

**A causa** (três coisas encadeadas, no código, e **confirmadas na base** a 28/10): a conta `alexandrameira.ablute@gmail.com` é membro da startup *e* membro ativo da firma **«Invest green»** (`is_internal = true`, cobrança `active`) — **não** da «ablute_ — Internal QA», como o prompt dizia; nunca teve acesso a data rooms. O convite dela para a Internal QA (12:46) está agora `cancelled`.

1. **O destino era fixo.** `/login?as=investor` mandava sempre para `/portal` e o login normal para `/pipeline`, fosse a pessoa o que fosse. Esta conta é owner da startup *e* membro da firma interna; a escolha «Investor» nunca era lida.
2. **`/portal` só mostrava a área do investidor a quem tinha um data room.** O espaço da firma (Calls, perfil, lugares, pipeline) só era desenhado quando havia documentos, pastas ou NDA pendente; um membro de firma sem data room caía em «No active access for this account» com só «Log out». **Não** era a firma interna, o `is_internal` (não decide nenhuma rota de entrada) nem a falta de plano de lugares.
3. **Nada dizia à pessoa que tinha outras áreas.**

**A regra, num só sítio** (`src/lib/areas.ts`, router `/go`): quatro áreas — founder, ecosystem, investor (o espaço da firma, `/portal`) e data rooms. Entra-se por esta ordem: **o que a pessoa escolheu no login**, **a última área que usou**, **a primeira que tem**. Há um **seletor de área** no menu (só mostra as áreas que a pessoa tem, marca onde está) e **nenhum beco sem saída**: `/portal` sem data rooms diz o que é, que ainda não há acesso e mostra um botão por cada outra área. Detalhes em `DECISIONS.md` («Prompt 923»).

**Testes:** `areas.test.ts` (cada combinação: só founder, só firma, só data room, founder + firma, founder + firma + data room, nenhum), `go-route.test.ts` (a rota real: o caso de 28/10 aterra na firma, a escolha no login, a última área, a conta sem área, o link falhado), `areas-components.test.ts` (o seletor e a página sem beco), `middleware-dead-org.test.ts` (tudo passa por `/go`).

## B — convites de lugar

**A causa de o `+aval1` ter ido parar ao registo de founder:** o convite **não tinha ligação própria**. O email dizia «inscreve-te, procura a firma e reclama o perfil» e o botão ia para `/login`, que por omissão é o login de founder.

**Agora:** cada convite tem a sua ligação `/invite/seat/<token>`, que abre um registo **de investidor** ligado a ele: só o email (preenchido e bloqueado), o código de 6 dígitos, o nome e o cargo. Nunca pergunta pela startup nem passa pelo «Claim this profile». No fim a pessoa é membro da firma e cai na área da firma.
- **Conta que já existe:** o mesmo link; entra se puder. **A prova é o email confirmado**, não o link.
- **Se não puder entrar:** a página diz porquê e o que fazer; o convite **fica aberto e não é gasto**.
- **O administrador vê** *Open*, *Accepted* ou *Couldn't be accepted* (com o motivo) e tem **«Send the link again»**.
- **O token não se perde no caminho** (verifiquei): não há `next=` nem callback no percurso; o link é uma página e o código verifica-se nela.

**A regra «uma ou várias firmas por conta» — hoje:** **uma conta pode pertencer a várias firmas.** A tabela só é única por (utilizador, firma), a rota de auto-ligação faz `upsert` nesse par e o código que precisa de «a» firma usa a mais antiga. Por isso hoje **nada recusa** uma pessoa por pertencer a outra firma. **Dados reais:** a 28/10 **nenhuma** conta está em mais de uma firma ativa (a regra «várias» nunca foi exercida em produção). **Não mudei a regra.** A recusa «This account already belongs to «Firm»…» está feita e testada atrás de uma constante (`ONE_FIRM_PER_ACCOUNT`), **desligada**. **Preciso de uma decisão tua:** queres ligá-la?

**O `+aval1` (lido na base, nada alterado):** a conta existe (criada às 14:19, já fez login às 14:20), **não ficou a meio de nenhum registo de founder** (0 startups) e **não pertence a nenhuma firma**; o convite dele para a Internal QA continua **aberto** (agora com token). Para o usar: «Send the link again» no painel de lugares (ou o link que te dou no fim), abrir e entrar com o código; como a conta já existe, o código inicia sessão e, se ainda não tiver nome e cargo, pede-os.

**Testes:** `seat-invite-accept.test.ts` (a regra, pura), `seat-invite-flow.test.ts` (17: o percurso inteiro pelas rotas reais com o simulador de lugares que também modela o trigger de limite — convite → email com o link → página → «Send me a code» só para o email do convite → conta nova → nome e cargo → membro → cai na área da firma → o administrador vê *Accepted*; conta existente; outra firma com a regra ligada e desligada; outro endereço; sem lugar; plano terminado; cancelado), `seat-invite-page.browser.test.ts` (7, Chrome real a 1280/768/375).

## C — mensagens do código

Mapa único (`src/lib/auth-errors.ts`): **429** → «For security, wait N seconds before asking for a new code.» com contagem decrescente e botão desligado; **403 `otp_expired`** → «This code has expired or was replaced by a newer one…»; **email incompleto** → «Check the email address — it looks incomplete.», validado **antes** de pedir o código (cliente e servidor; o `…@gmail.c` já não chega ao fornecedor); **outro erro** → «Something went wrong. Try again in a minute. (ref XXXXXX)» com a referência também no registo do servidor. Depois de enviar um código o ecrã diz que **um novo substitui o anterior**. Já não aparece texto cru do Supabase nos ecrãs de entrada.
**Limite assumido:** os pedidos de código que o navegador faz diretamente ao fornecedor (o login de investidor) só se validam no cliente; as rotas nossas validam também no servidor.

## Capturas (sem códigos nem passwords)

`docs/auth/screenshots-923/`: o convite (intro, código, nome e cargo, recusa) a 1280/768/375 e a espera do código a 375.

## O percurso completo com a `+aval2` (B.5) — o que fiz e o que tem de ser teu

- **Fiz** o percurso inteiro **automatizado** (rotas reais, regras reais de lugares, base com estado, Chrome real nos ecrãs): `seat-invite-flow.test.ts` («THE WHOLE PATH…») e `seat-invite-page.browser.test.ts`.
- **Em produção fiz** tudo o que não é criar uma conta nem introduzir um código: a migração (com teste seco) e a sua verificação, o deploy, a leitura da base (factos acima), o convite da `+aval2` e a verificação de que a produção lê o convite novo.
- **Não posso** criar a conta `+aval2` nem introduzir o código de 6 dígitos em produção: são passos que as minhas regras me proíbem de fazer (criar contas e autenticar), mesmo a teu pedido; e o conector Gmail também pede autenticação, por isso nem leria o código. **Esses três cliques são teus**; depois confirmo na base que a `+aval2` ficou membro da Internal QA.
## Lista de cliques (parte D do prompt, depois do deploy e da migração)

1. Com a `alexandrameira@ablute.pt`: Investor workspace → About → Seats → convidar `sherlockdeal.com+aval1@gmail.com`; abrir o link do email numa janela privada → «Send me a code» → código → nome e cargo → cai na área da Internal QA.
2. Login normal da `alexandrameira.ablute@gmail.com` escolhendo «Investor»: cai no espaço da firma, com o seletor de área no menu; já não aparece o `/portal` vazio. Escolhendo «Startup»: cai no espaço de founder.
3. Pedir dois códigos seguidos: aparece «For security, wait N seconds…» a contar. Escrever um email incompleto: aparece «Check the email address — it looks incomplete.» sem pedir código.

## Estado

- Migração **aplicada** e verificada (3 colunas novas, 0 tokens em falta, 3 distintos nos convites existentes).
- Gate completo: `tsc`, lint (0 erros), build e verificação de URLs assinados a 0; o vitest tem só o teste de carga conhecido (`website-health-reads`, timeout de 5 s), que passa sozinho.
