# Calls, Etapa 0 — Parte B: registo com palavra-passe e código de 6 dígitos (09/10/2026)

Prompt 904, Parte B (spec §13.2–13.4). Mecanismo reutilizável: rotas de servidor e um
componente, montados só em `/auth-code-test`, atrás de um interruptor, para a Etapa 1 os ligar
ao ecrã da call. **Migração aplicada em produção a 09/10/2026 às 14:17:16Z**, depois de um teste seco numa transação sempre revertida.

## O que existe

| Peça | Ficheiro |
| --- | --- |
| Migração proposta (estado, contadores, funções SQL) | `supabase/migrations/20261009120000_auth_code_state.sql` |
| Números e regras de input (partilhados cliente/servidor) | `src/lib/auth-code/policy.ts` |
| Interruptor `AUTH_CODE_MODE` | `src/lib/auth-code/mode.ts` |
| Lógica de decisão, com portas injetadas | `src/lib/auth-code/service.ts` |
| Portas reais (Supabase Auth, SQL, Resend) | `src/lib/auth-code/supabase-ports.ts` |
| Rotas `register`, `resend`, `verify`, `status` | `src/app/api/auth-code/*/route.ts` |
| Componente (vista sem estado + contentor) | `src/components/auth/EmailCodeSignup.tsx` |
| Página de teste (só administradores) | `src/app/auth-code-test/page.tsx` |
| `/api/auth-code` em PUBLIC no middleware | `src/middleware.ts` (+ teste) |

**Reutilizado:** `password-policy.ts`, `PasswordInput` (o olho do Prompt 903) e
`PasswordRequirementsIndicator`, `/api/provision-org` (cria a startup, sem alterações),
`sendTransactionalEmail` + `transactionalTemplate`, o padrão de limite por IP de
`guest_link_rate_limit`, `/set-password` e `/auth/confirm` (o link do email).

**Não reutilizado, e porquê:** `/signup` chama `signUp` do browser com a palavra-passe escolhida
e só sabe confirmar por link; o código tem de passar por uma rota nossa (contador por email),
e a palavra-passe só pode ser aplicada depois do código (ver "Palavra-passe depois do código").

## Quem garante o quê

| Garantia (prompt) | Quem a dá | Como se sabe |
| --- | --- | --- |
| Código aleatório, gerado no servidor, de uso único | **Supabase Auth** (`auth.one_time_tokens`) | Nunca geramos nem vemos o código; `verifyOtp` consome-o. Teste local: um código usado volta a ser recusado. |
| Expira | **Supabase Auth** (`mailer_otp_exp`; recomendado 1800 s) | Depende da configuração do painel (Parte A). Teste local com relógio simulado. |
| Código errado nunca confirma | **Supabase Auth** | Teste local; confirmar em produção. |
| **Pedir um código novo invalida o anterior** | **Supabase Auth, por pressuposto (um slot por utilizador e tipo)** | **NÃO provado aqui.** O teste automático modela o pressuposto. A prova é o passo 4 do teste em produção abaixo. Se o Supabase deixar o código antigo valer, é preciso mudar de desenho (ver "Se a invalidação falhar"). |
| **5 tentativas erradas obrigam a pedir outro código** | **Nós** (`auth_code_reserve_attempt`) | O Supabase só limita por IP. Reserva-se a tentativa antes de verificar, atómica por email: dois palpites em paralelo gastam duas. Teste: com 12 palpites em paralelo só 5 chegam ao Supabase; à 6.ª o código certo também é recusado. |
| Reenvio só ao fim de 60 s, com limite por hora | **Nós** (`auth_code_reserve_send`: 60 s e 6 códigos/hora por email) | O servidor recusa com o tempo em falta; o botão do browser só mostra a contagem. |
| Não revela se o email tem conta | **Nós** | Mesma resposta nos três casos (sem conta / conta por confirmar / conta confirmada); o estado dos contadores existe para qualquer email; piso de 1,5 s no tempo de resposta; erros do fornecedor só vão para o log. Quem tem conta confirmada recebe, pelo Resend, "You already have an account" com link para entrar. |
| Palavra-passe escolhida só depois do código | **Nós** | Ver abaixo. |
| O formulário mantém-se à espera do código | **Nós** (estado do componente + `sessionStorage` sem a palavra-passe) | Verificado no browser: recarregar a página repõe o email e a contagem, e pede a palavra-passe outra vez. |
| Janela fechada: a conta existe e a pessoa entra | **Nós + Supabase** | A conta fica criada e por confirmar; o email tem um link para `/auth/confirm` → `/set-password`. |
| Autenticado sem startup vai criar a startup | **Nós** (`status` + passo `startup` → `/api/provision-org`) | Verificado no browser com respostas simuladas. |

## Palavra-passe depois do código (decisão de segurança)

A conta nasce com uma palavra-passe aleatória inutilizável e `password_set:false`. A que a
pessoa escreveu só é aplicada (`updateUserById`) **depois** de o código verificar. Se fosse
aplicada à cabeça, alguém podia registar o email de outra pessoa com uma palavra-passe sua e
ficar com acesso à conta quando a vítima confirmasse o email (*pre-hijacking*). Custo: a
palavra-passe viaja duas vezes (registo e verificação), sempre por HTTPS e nunca guardada.

Se a aplicação da palavra-passe falhar depois de o código estar certo (por exemplo, política
do projeto mais exigente que a nossa), a resposta é `ok:true, passwordSet:false` com o aviso:
a conta está confirmada e autenticada, e `/set-password` acaba o trabalho.

## Limitações conhecidas (ditas, não escondidas)

1. **Falha do fornecedor invisível.** Se o Supabase não conseguir enviar o email (limite, SMTP),
   a pessoa vê a mesma frase de sucesso e a contagem; o erro fica só em `console.error` no
   servidor. É o preço de não criar um oráculo (só alguns ramos chamam o Supabase). Mitigação:
   o reenvio fica disponível ao fim de 60 s, e a Parte A pede os limites subidos.
2. **IP único para o Supabase.** Como `verifyOtp` e `signUp` saem do Vercel, o Supabase vê
   sempre o mesmo IP. Os limites por IP do Supabase têm de ser subidos (Parte A) ou o piloto
   com 200 candidatos esbarra neles. Os nossos limites por IP usam o IP do cliente.
3. **A conta de teste substitui a sessão de administrador.** Um registo bem sucedido autentica
   o browser como a conta nova. Voltar a entrar como administrador depois.
4. **O interruptor `allowlist` é anónimo por desenho** (as rotas têm de servir quem ainda não
   tem conta), por isso o que protege é a lista de emails e o 404 por omissão; a página só abre
   para administradores.

## Se a invalidação falhar

Se, no passo 4 do teste em produção, o código antigo ainda confirmar depois de um reenvio,
o desenho muda para: o servidor gera o código (6 dígitos aleatórios, `crypto.randomInt`), guarda
só o hash e a geração em `auth_code_state`, envia o email pelo Resend (que também nos tira da
dependência do SMTP e dos limites do Auth) e, depois de validar, cria a sessão com
`admin.generateLink({type:'magiclink'})` + `verifyOtp`. A tabela e as funções desta migração
servem tal e qual; muda só a origem do código.

## Interruptor e variáveis

| Variável (Vercel) | Valor | Efeito |
| --- | --- | --- |
| `AUTH_CODE_MODE` | ausente ou `off` | As quatro rotas respondem 404; a página responde 404. **É o estado de hoje.** |
| `AUTH_CODE_MODE` | `allowlist` | Só os emails de `AUTH_CODE_TEST_EMAILS` (separados por vírgula) usam as rotas. |
| `AUTH_CODE_MODE` | `on` | Aberto a todos (a Etapa 1 liga-o quando a call abrir). |

## Teste em produção, com emails reais do Nuno

**Pré-requisitos (todos do Nuno):** (1) autorizar a migração; (2) Parte A feita (SMTP próprio,
limites, OTP de 6 dígitos / 1800 s, template colado); (3) definir no Vercel
`AUTH_CODE_MODE=allowlist` e `AUTH_CODE_TEST_EMAILS=<endereço A>,<endereço B>` e fazer deploy do
branch; (4) estar autenticado como administrador.

**Endereços a usar:**

- **A — um endereço novo que o Nuno controle**, sem conta no Sherlock Deal, por exemplo
  `nuno+codigo1@ablute.pt` (um alias `+` entrega na mesma caixa).
- **B — o email de uma conta que já existe** (a conta de administrador do Nuno chega), para
  provar que o registo com email existente dá a mesma resposta e envia "You already have an
  account".

**Passos em `/auth-code-test`:**

1. Com **A**: preencher o formulário (startup `zz-test-codigo`) e submeter. Esperado: "We sent a
   code to A.", o email chega com o código a negrito e o link, e o botão de reenvio mostra a
   contagem.
2. Escrever **um código errado** 5 vezes. Esperado: "4 attempts left"… e à 5.ª "request a new one".
   Escrever então o código **certo**: recusado (o bloqueio é nosso).
3. Esperar a contagem e carregar em "Send a new code". Esperado: chega outro código.
4. **Prova da invalidação:** escrever o código do passo 1 (o primeiro). Esperado: **recusado**.
   Escrever o do passo 3: aceite → ecrã "Create your startup" → criar → "You're in".
   *(Se o primeiro for aceite, parar e dizer-me: ver "Se a invalidação falhar".)*
5. Reenvio antes do tempo: em nova tentativa com **A**, carregar no reenvio por script/segundo
   separador antes dos 60 s. Esperado: recusado pelo servidor ("Please wait N seconds").
6. Com **B**: submeter o formulário. Esperado: **exatamente a mesma mensagem** "We sent a code to B.",
   nenhum código no email, mas um email "You already have a Sherlock Deal account" com o link
   para entrar.
7. Recarregar a página a meio (depois do passo 1 de uma nova tentativa): os campos voltam, a
   contagem continua, a palavra-passe é pedida outra vez.

**Limpeza (só com autorização do Nuno):** apagar a conta A (`auth.users`), a sua startup/org e
membership de teste, e as linhas de `auth_code_state` e `auth_code_ip_events` dos dois endereços.
Eu faço-o por SQL depois do "sim" dele e confirmo as contagens.

## Verificação feita

- `tsc --noEmit` EXIT=0.
- `vitest` nos ficheiros novos: serviço (26 testes: código errado, expirado, usado, reenvio
  invalida o anterior, 5 tentativas, 5.ª certa, novo código repõe as 5, palpites paralelos,
  reenvio cedo recusado, teto por hora, limite por IP, email existente com resposta idêntica
  nos três casos e com o piso de tempo, falha do fornecedor invisível, password a falhar),
  interruptor/política, rotas (404 por omissão, allowlist, IP do cliente, normalização),
  componente (ecrãs), middleware (as rotas abertas, a página não).
- Browser em modo demo (`dev:verify`, identidade confirmada: cwd e SHA corretos): formulário com
  botão bloqueado por palavra-passe fraca; ecrã do código com contagem a descer; código colado
  com espaço aceite; erro "4 attempts left" e caixa limpa; recarregar repõe o estado e pede a
  palavra-passe; código certo → passo da startup. As respostas do servidor foram simuladas
  (o modo demo não tem Supabase): isto verifica o ecrã, **não** o Supabase.
- **SQL verificado em produção por teste seco (14:17Z, transação sempre revertida, nada ficou gravado):** 1.º envio permitido, 2.º `too_early`; 4.º envio com cap 3 → `hourly_cap`; tentativas 1–5 com `attempts_left` 4→0, a 6.ª `locked`; email nunca pedido → `no_code`; novo envio repõe as 5 tentativas; código usado → `locked`; limite por IP (3.º pedido com limite 2 → excedido); `user_state` distingue conta confirmada de inexistente; RLS ativo; `anon` sem execute, `service_role` com. Os testes automáticos continuam a modelar o mesmo em TypeScript.
- **Não verificado, depende do Nuno:** tudo o que é Supabase/Resend reais (passos 1 a 7).
