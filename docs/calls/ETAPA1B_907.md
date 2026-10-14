# Calls, Etapa 1B — Prompt 907: o lado do candidato

**Branch:** `claude/907-i1-i4` (I1 `6f59f32a`, I2+I3 `8f27b814`, I4 `4bbe1c5f`). **O I5 (prazo e notificações) vai à parte, no ramo `claude/907-i5`.**
**Migração:** `20261014100000_calls_applicant_side.sql` — **já aplicada em produção** a 14/10/2026 (aditiva; teste seco revertido antes).
**I1 a I4 em `main` por OK do Nuno (14/10/2026).** Capturas em [`screenshots-907/`](screenshots-907/).
**Variáveis novas:** nenhuma. **Cron novo:** nenhum.

## O que o Nuno pode clicar (depois do merge e do deploy)

1. **O link.** Abre o link de uma call publicada (a de teste) numa janela privada: cabeçalho com nome, entidade, prazo e regulamento (se a
   entidade o mostrou); estado "abre a …" / "fechada a …" quando for o caso; um link inventado dá 404.
2. **Registo.** Na mesma janela: **Create account** → código de 6 dígitos (`sherlockdeal.com+codigo1@gmail.com`) → passo "a tua startup"
   → cai no formulário da call. **Already have an account? Sign in** volta ao mesmo sítio depois de entrar.
3. **Preencher.** Preenche metade, fecha o separador, reabre o link: continua onde ficou (o estado "Saved" aparece sempre).
   Campos que vêm do perfil aparecem preenchidos e **nunca** voltam a sobrepor o que editaste.
4. **Submeter.** Falta um obrigatório → popup com o que falta e a página; preenche → **Submit** → confirmação com referência `APP-XXXX-XXXX`.
   Carrega outra vez / abre noutro separador: não duplica; o formulário fica só de leitura.
5. **Área da startup.** Menu **Calls**: *Open calls*, *My applications*, *Past applications*; avisos no topo (receção, lembrete, novo prazo).
6. **Na entidade.** Na call → separador **Submissions**: lista só as submetidas (nunca rascunhos, nem o número deles), abre a
   candidatura em só de leitura e descarrega os documentos.
## O que mudou

### I1 — O link da call
Rota pública `/api/calls/public/[token]` (cabeçalho, regulamento por redirecionamento assinado, sondagem de sessão). Só resolve calls
**publicadas e com formulário**; o resto é 404 sem dizer porquê. Registo pelo mesmo componente de código do 904/911 (`EmailCodeSignup`,
variante `call`), com `redirectPath` de volta ao link. O link fica na memória (`call_link_access`) para a call aparecer em
"Open calls" mesmo que seja "closed — link only". Passo "startup": quem já tem organização salta-o.

### I2 — Preencher
`call_applications` ganhou referência, `unit_key`, `last_page`, `draft_revision` (gravação com controlo de concorrência) e `submitted_at`.
`call_open_application` (SQL, só `service_role`) cria-ou-retoma com bloqueio consultivo: **uma por unidade** (`org:<id>` ou entidade legal
normalizada + país) quando a call não permite várias. Pré-preenchimento único e só de chaves ausentes. Condições avaliadas também no servidor.
Documentos: carregamento (PDF verificado), ou **Vault** autorizado em nome da call com a versão fixada (`call_application_files`); se o
Vault tiver versão mais nova, o candidato vê e escolhe "usar a nova".

### I3 — Submeter
`call_submit_application` (SQL): verificação final no servidor, **idempotente por chave** (duas chamadas simultâneas dão uma só versão),
versão **imutável** (o trigger já existente impede alterações) e cópias congeladas dos documentos em `calls/<call>/applications/<app>/frozen/`.
Depois de submetida, o ecrã lê a versão imutável: mudar o perfil ou o Vault não a altera.

### I4 — Áreas
Startup: `/calls` (`ApplicantCalls`), com `buildOverview` puro e testado. Entidade: **Submissions** só de leitura; a permissão
*View all applications* passa a ser aplicada no servidor (das 9 permissões, 3 são aplicadas; 6 seguem "Used from the next stage").
O estado da call só devolve `{submitted,total}` — a entidade nunca vê contagens de rascunhos.

## Componentes reaproveitados
`EmailCodeSignup`/`CodeStep` (904/911), `FieldInput` (905, agora com `fileControl`), `auth-redirect.ts`, `email-footer.ts`/`resend.ts`
(911), `access.ts`/`permissions.ts` (909), o trigger de imutabilidade das submissões (905), `withActingOrg` (904).

## Verificação
- `tsc`, `eslint` (0 erros), `vitest` e `build` sobre a árvore final: ver o relatório no chat (códigos de saída).
- Testes novos: `phase`, `applicant-logic` (25), `overview`, `calls-907-i1-routes`, `calls-907-applicant-routes` (35: memória do link,
  pré-preenchimento, condições no servidor, submissão idempotente com dois pedidos simultâneos, imutabilidade após mudar perfil/Vault,
  limite por unidade), `calls-907-i4-routes` (8: a entidade nunca vê rascunhos), `calls-907-i1-components`.
- No ecrã (modo demo, `dev:verify`, com respostas simuladas): cabeçalho + registo, página 3 do formulário com versão nova do Vault,
  popup do que falta, confirmação e leitura, área Calls (capturas 01–05).
- Em produção, a partir da minha parte: a migração aplicada com teste seco; **não** tenho sessão de administrador nem de candidato,
  por isso o fluxo real fica para o teste do Nuno (abaixo).

## O que **não** está provado / limites honestos
- Nenhum email real, nenhuma sessão real e nenhum modelo real foram exercidos por mim: os envios foram verificados com o Resend simulado. A única notificação desta parte é o recibo da submissão (aviso na app + email, sem Reply-To, com o rodapé automático).
- A chave de "entidade legal" é aproximada (nome legal normalizado + país) porque ainda não há NIF.
- A elegibilidade em frases ainda não existe (Etapa 2); o telefone "quando a call o exigir" ainda não é configurável.
- A autorização do Vault guarda-se numa tabela própria (não em `access_grants` da data room), com cópias congeladas na submissão.

## Passos de produção (para o Nuno, depois do deploy)
1. Sem passos de painel novos. **Confirma só que `NEXT_PUBLIC_APP_URL` está definido como `https://www.sherlockdeal.com`** (no registo está `desconhecido`): o link do email do recibo é construído com ela.
2. Teste guiado: ver "O que o Nuno pode clicar", com `sherlockdeal.com+codigo1@gmail.com`; eu confirmo na base
   (`call_applications`, `call_application_files`, `call_notices`, `call_events`) e nos logs do Auth depois de cada passo.
3. A limpeza dos dados de teste só se fizer com o OK do Nuno.
