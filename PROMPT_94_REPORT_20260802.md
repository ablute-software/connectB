# Prompt 94 — Tasks/Agenda/Warrants — construído

Investigação primeiro, como pedido, respondendo às três confirmações antes de tocar em código:

## As três confirmações pedidas

**1. Rotas/URLs que apontam para `/today`/`/outbox`** — mapeadas por grep, todas cobertas:
- `/today`: `shell.tsx` (nav), `W1Badge.tsx` ("First contact" do checklist inicial).
- `/outbox`: `shell.tsx` (nav + 2 condições de badge), `queue/page.tsx` (redirect antigo de `/queue`).
Nenhum deep link/notificação externa encontrado a apontar para nenhuma das duas (grep ao repo inteiro,
não só a estes dois ficheiros).

**2. Dados persistidos com a chave "Outbox"** — dois encontrados, tratados de forma diferente:
- `onboarding_state.seen.guide_outbox` (jsonb, por utilizador) — **renomeada para `guide_warrants`**
  (nova chave). Consequência aceite, não escondida: quem já tinha visto o tour antigo vai voltar a ver
  o novo uma vez — razoável para uma reestruturação real, não um simples reforço de UI.
- `org_permissions.ts`'s `outbox_approval` (chave gravada em `orgs.permission_matrix` jsonb, por org) —
  **chave mantida, só o rótulo mudou** ("Warrants — approve sends"). Mudar a chave partiria
  silenciosamente os overrides já gravados por qualquer org que já tenha personalizado isto.

**3. Colisão de "Agenda"** — nenhuma encontrada. `InvestorAgendaPanel`/o endpoint iCal existem no
Investor Workspace (audiência completamente separada, já tinha "Agenda" como separador lá desde o
Prompt 59) — mesmo nome, produto diferente, sem sobreposição de rota nem de utilizador.

## O que foi construído

- **`/tasks`** (novo, topo) — separadores "Today" (`TodayPanel`, inalterado) / "Warrants"
  (`WarrantsPanel`, novo).
- **`/agenda`** (novo, topo, independente) — `AgendaPanel` (inalterado), a rota `/agenda` já existia
  como redirect do merge de 27/07 — reaproveitada, não duplicada.
- **`WarrantsPanel.tsx`** (substitui `OutboxPanel.tsx`, removido) — a mesma fila de sempre, agora com
  dois sub-separadores reais: "Pending Review" e "Data Room Mail Access". A distinção **não era óbvia
  à partida** — hoje tudo estava misturado numa lista só — mas encontrei a automação exata por nome
  (`auto-grant`, `name: 'Email data-room link when a grant is activated'`, `mode: 'draft_review'`,
  `seed.ts`/`seed.sql`): é literalmente a automação que o pedido queria isolar. "Pending Review" mostra
  tudo exceto as suas runs; "Data Room Mail Access" mostra só as dela. Renomeei a própria automação
  (nome, não `id`) para "Data Room Mail Access" — no seed de demo, no `seed.sql`, e na linha real de
  produção (`automations.id = 'ddb97336-...'`, org ablute_) via `UPDATE` direto (só o `name`, `trigger`/
  `action`/`mode` inalterados — confirmado por `returning`).
- **`/today` e `/outbox`**: redirects permanentes. `/today` distingue `?tab=agenda` (→ `/agenda`) do
  resto (→ `/tasks`); `/outbox` → `/tasks?tab=warrants`; `/queue` (já um redirect antigo) atualizado
  para ir direto a `/tasks?tab=warrants` em vez de saltar por `/outbox`.
- **`shell.tsx`**: nav atualizada (Tasks substitui Today, Agenda entra a seguir, Outbox sai — 7 itens
  mantidos), badge de pendentes movida de `/outbox` para `/tasks`, ícone do Dashboard trocado (deixou
  de colidir com o ícone novo da Agenda).
- **`W1Badge.tsx`**: link do "First contact" atualizado para `/tasks`.

`tsc --noEmit`, `vitest` (330/330) e `npm run build`, todos limpos — `/tasks` e `/agenda` aparecem na
lista de rotas, `/today`/`/outbox`/`/queue` continuam a existir só como redirects.

**Por confirmar visualmente** — ainda não clicado numa sessão de browser real.

---

## Hype List v2 — schema exato reenviado

Documento próprio: [HYPE_LIST_V2_SCHEMA_PROPOSAL_20260802.md](HYPE_LIST_V2_SCHEMA_PROPOSAL_20260802.md)
— 3 tabelas/colunas novas (`matchdeal_detail_views` + RPC, `matchdeal_profiles.completeness_pct`,
`matchdeal_hype_scores`), o que o recálculo diário lê e escreve sinal a sinal, e a nota em aberto sobre
os pesos (ainda não recebidos — proponho iguais por defeito, sinalizado, não decidido em silêncio).
**Nada aplicado.** Guardas confirmadas: nada toca `access_grants` nem `matchdeal_eligible_deck()`.

---

## Disciplina seguida

`access_grants` e o motor de matching intocados em ambos os itens. A única escrita em produção foi o
`UPDATE` de 1 coluna (`name`) numa automação já existente, sem mudança de comportamento — não é schema
novo. Todas as chaves persistidas mapeadas antes de mexer, uma mantida (permission_matrix), uma
renomeada com a razão explícita (onboarding tour).
