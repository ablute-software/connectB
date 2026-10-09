# Calls, Etapa 1A — o lado da entidade (Prompt 905, 09/10/2026)

Branch `claude/905-calls-etapa1a`, a partir de `main` (já com o 904). Entrega o separador **Calls**, a
criação e configuração de uma call, o construtor de formulário, a pré-visualização, a confirmação e a
publicação com link. O ecrã do candidato é o Prompt 906 e reutiliza o que aqui existe.

## O que o Nuno pode clicar

**Variáveis no Vercel (production):**

| Variável | Valor |
| --- | --- |
| `CALLS_MODE` | `allowlist` |
| `CALLS_TEST_EMAILS` | o email de uma conta que seja **owner/admin de uma firma de investimento** ou **owner/manager de uma organização de ecossistema** (vários, separados por vírgula) |

Sem estas variáveis (ou com `CALLS_MODE` ausente/`off`) **nada aparece e as rotas respondem 404**. `on` abre a
qualquer membro com o papel certo.

**O que clicar para testar** (≈ 10 minutos):

1. Entrar com a conta da lista. No menu da esquerda do investidor (*Data room · Pipeline · **Calls***) ou do ecossistema
   (*Portfolio · **Calls** · Team · Settings*) aparece **Calls**. Uma conta de fora da lista não vê nada.
2. **+ New call**. Em **General**: dar um nome, abertura e fecho (datas futuras) e escolher o fuso; ver a linha
   `= … UTC` por baixo de cada data; o canto superior direito vai dizendo *Unsaved changes → Saving… → ✓ Saved*.
3. **Phases**: renomear a fase, **+ Add phase**, arrastar (ou ↑↓) para reordenar.
4. **Form → + Add field**: um *Yes/No* ("A empresa está constituída?", obrigatório), um *Date* ("Data de constituição")
   com **+ Show only if… → a empresa está constituída → is → Yes**, um *Number* ("Faturação") com *Show the call's
   currency*, um *File (PDF)* ("Pitch deck", validade 6 meses) e um *Short text* ligado a **Link to platform data → Startup name**
   (aparece 🔗). Arrastar para reordenar; **Suggest pages**.
5. **Preview & confirm**: o formulário como o candidato o vê. No número tentar escrever `abc-1,5.000500`: só ficam
   os dígitos e por baixo aparece `15 000 500 €`. Responder *No* esconde a data (mesmo sendo obrigatória, não
   bloqueia); *Yes* mostra-a. O ficheiro só aceita PDF. À direita: o resumo e **o que falta**.
6. **Confirm** (fica "Confirmed", o formulário bloqueia) → **Edit configuration** (volta a Draft) → **Confirm** →
   **Publish and get the link** → **Copy link**. Abrir o link: mostra "Applications open on [data]".
7. Com a call *Scheduled*: **Extend the deadline for everyone**. Na lista de calls: **Duplicate** (copia a configuração,
   as fases e o formulário; nunca candidaturas nem datas).

## O que foi feito

| Incremento | Conteúdo |
| --- | --- |
| **I1** | Entrada **Calls** nos menus do investidor e do ecossistema (atrás do interruptor), lista em cards (estado com etiqueta, datas com fuso, nº de candidaturas, campos, fases), **New call** e **Duplicate**. |
| **I2** | Editor com as 7 tabs (*Eligibility*, *Team & distribution* e *Evaluation* desativadas, "Coming in the next stage"); **General** (§5.1 completo) e **Phases** (adicionar, renomear, reordenar, apagar; uma por omissão). Gravação automática com *Saving… / Saved / Save error*. |
| **I3** | **Form**: 8 tipos; número só com dígitos e formatado por baixo; ficheiro só PDF; opções com identificador estável; condições (avaliadas também no servidor); páginas à mão e **Suggest pages** determinístico; ligação explícita a dados da plataforma; documentos com nome, descrição, obrigatoriedade, tipo esperado e validade em meses. |
| **I4** | **Preview & confirm**: pré-visualização página a página, resumo e "o que falta"; ciclo `draft → validated → scheduled/open → closed`; *Edit configuration*, abertura automática, bloqueio do formulário, prolongar o prazo, encerrar; link com **Copy link** e página placeholder. |

## O que foi reutilizado

- Os dois *shells* de entidade (`InvestorWorkspaceShell`, `IncubatorWorkspace`) e a `WorkspaceSidebar`; o `HatSwitcher` ficou intacto.
- A resolução de membros que já existe (`resolveActiveInvestorMember`, `resolveIncubatorMember`), sem papéis novos.
- O interruptor segue o desenho do `AUTH_CODE_MODE` do 904 (`off` por omissão = 404, `allowlist`, `on`).
- O padrão de rota pública + teste de middleware das falhas dos Prompts 538/749 (`/call` e `/api/calls/public` em PUBLIC, com teste).
- O padrão "só membros veem, tudo o que escreve passa pelo servidor" do backoffice e dos seats (904).

**Não reutilizado:** o `Tab` do `InvestorWorkspaceShell` — o *Calls* **não** foi acrescentado a essa união, porque ela é
espelhada na barra lateral do convidado (`INVESTOR_NAV`, com teste de compilação) e um convidado não pode pré-visualizar
uma funcionalidade atrás de interruptor. É uma vista separada que substitui o conteúdo enquanto está aberta.

## Alterações de dados

**Migração `20261009150000_calls_foundation.sql` — aplicada em produção a 09/10/2026 às 15:24:44Z**, depois de
teste seco numa transação sempre revertida (pré-autorização do Nuno: só aditiva). **Uma só migração para toda a Etapa 1**
(entidade e candidato), para o 906 não a refazer. 7 tabelas novas, 2 funções, 3 triggers sobre as tabelas novas; **nenhum objeto
existente foi alterado**.

| Tabela | Para quê |
| --- | --- |
| `calls` | A call: promotor (firma **ou** organização de ecossistema, exatamente um), nome, descrição, abertura/fecho + fuso, listada/fechada, unidade do limite e "mais de uma", língua, moeda, estado, `link_token` (gerado ao publicar), `config_version`, quem criou. |
| `call_phases` | Fases ordenadas (nome, datas indicativas). |
| `call_form_fields` | Campos com **id estável**; opções em jsonb com **ids estáveis**; condição, ligação a dados da plataforma, tipo esperado e validade dos documentos. |
| `call_config_snapshots` | A configuração tal como foi confirmada (histórico, só acrescenta). |
| `call_applications` / `call_application_submissions` | Para o 906: rascunho, e versão submetida **imutável** (trigger recusa `update`/`delete`) com respostas, documentos fixados, hora e **chave de idempotência** única por candidatura. |
| `call_events` | Histórico da call e das candidaturas (só acrescenta; o tipo do evento é texto livre para as etapas seguintes não terem de alterar um CHECK). |

**Isolamento:** RLS ativo em todas; o único privilégio de `authenticated` é `select`, através de `calls_is_member` e
`calls_can_manage` (membro ativo da firma / do ecossistema; gerir = owner/admin numa firma, owner/manager no ecossistema).
Todas as escritas passam pelas nossas rotas com a service role, que voltam a verificar. Teste seco em produção: estados e
constraints (dois promotores, sem promotor, datas desordenadas, nome em branco, tipo inválido) recusados; submissões, eventos
e snapshots imutáveis; membro de uma firma não vê/gere calls de outra; `anon` sem acesso.

## Como foi verificado

- `tsc`, `eslint` e `vitest` (ver commit) e `next build`: todos com código de saída 0 (valores no fim deste ficheiro).
- **Testes de lógica** (`calls-logic.test.ts`, 50): fusos (verão/inverno, hora inexistente na mudança de hora), números
  (só dígitos), PDF, condições (campo obrigatório oculto não bloqueia, cascata, ponteiro para campo apagado, ciclos),
  construtor (ids de opções estáveis, arrastar, recusar mover um campo para antes do que o condiciona, páginas), **Suggest pages**
  (determinístico, ≤ 5 por página, nunca reordena), o que o servidor aceita, ciclo de vida.
- **Testes de rotas** (`calls-routes.test.ts`, 31): as rotas, o acesso e o *store* reais sobre uma base em memória que aplica as
  escritas e as constraints. Interruptor, quem vê e quem cria, **isolamento entre entidades (404, não 403)**, autosave com
  conflito de versão, bloqueio depois de confirmar, o ciclo todo (confirmar → publicar → abre sozinha → prolongar → fechar), duas
  confirmações em corrida (só uma passa), duplicar (ids novos, condições remapeadas, sem datas nem link nem candidaturas) e o link público.
- **Testes de componentes** (17) e o do middleware.
- **No browser, em modo demo** (`dev:verify`, identidade confirmada: cwd e SHA), com um servidor de calls em memória que corre as mesmas funções
  da lib (o modo demo não tem Supabase, e as regras do projeto proíbem clicar contra produção): capturas em
  [`screenshots-905/`](screenshots-905/). Verifiquei o separador, a lista, o editor, gravação automática, datas com fuso, adicionar campo,
  condição (e o seu valor), páginas, pré-visualização com a condição a esconder/mostrar, `abc-1,5.000500` → `15000500` / `15 000 500 €`,
  confirmar, publicar, link, prolongar o prazo, *Edit configuration* e a página do link.
- **Achado a clicar:** uma condição a meio ("is" sem valor escolhido) fazia a gravação automática falhar. Passou a gravar como rascunho
  (não esconde nada) e **só bloqueia o Confirm**, com a razão. O recurso do *Copy link* (sem permissão de *clipboard*) deixou de usar `prompt()`.

## Decisões técnicas e o que fica em aberto

1. **Quem edita:** a spec diz "owner ou admin". As organizações de ecossistema só têm `owner` e `manager` (não há `admin`), por isso lá
   gerem o `owner` e o `manager`; nas firmas, `owner` e `admin`. Um membro sem esse papel **vê** as calls mas não escreve.
2. **Depois de confirmar** a configuração toda fica bloqueada (também o nome e as datas) até "Edit configuration". Depois de aberta, só
   prolongar e encerrar. A spec lista como permitido só isso; nome e descrição não foram libertados.
3. **O estado atualiza-se quando alguém olha** (lista, editor, link): os crons da Hobby só correm 1×/dia. Uma call agendada abre sozinha
   à hora (se estiver confirmada **e** publicada); uma aberta fecha no prazo. O que se mostra é sempre o estado efetivo.
4. **Autosave não escreve eventos** (seria ruído); ficam as confirmações (com *snapshot*), edições da configuração, publicação,
   abertura/fecho, prolongamento. As mudanças de configuração em várias tabelas não são uma transação única: o número de versão é reservado
   primeiro (se alguém gravou entretanto, não se escreve nada) e só depois se substituem as linhas.
5. **O link público** mostra só o cabeçalho (entidade, título, descrição, datas, uma frase). Com `CALLS_MODE=off` responde 404. Uma call devolvida a
   Draft guarda o link mas deixa de ser anunciada.
6. **Opções de escolha única/yes-no** é o que pode alimentar quotas (§11.2); nesta etapa só se guardam os ids.
7. **Não implementado, por ser de etapas seguintes:** elegibilidade, equipa/distribuição, avaliação, importação por IA, emails, o lado do candidato.
