# Hype List v2 — exact schema proposal (Bloco 2, Prompt 81) — NOT APPLIED

Reenvio pedido no `mini_prompt_hype_list_v2_aprovado_reenviar_schema_20260802.md`. Nada disto foi
aplicado — fica à espera de confirmação antes de qualquer migração.

## 1. `matchdeal_detail_views` — nova tabela

Regista a primeira abertura de "mais informação" (o swipe up para o mini-pitch, Bloco 1) por perfil —
sinal 3 da fórmula. Espelha `matchdeal_exposures` exatamente (mesmas colunas/tipos/índice), porque é a
mesma forma de dado (um evento "X viu Y"), só um verbo diferente ("abriu detalhe" em vez de "foi
exposto a").

```sql
create table matchdeal_detail_views (
  id uuid primary key default gen_random_uuid(),
  viewer_profile_id uuid not null,
  shown_profile_id uuid not null,
  viewed_at timestamptz not null default now()
);
create index matchdeal_detail_views_viewer_idx on matchdeal_detail_views (viewer_profile_id, viewed_at desc);
```

Nova RPC `matchdeal_record_detail_view`, espelhando `matchdeal_record_exposure` (mesma forma, sem tocar
em `matchdeal_weekly_activity` — este sinal não consome quota, só regista o evento):

```sql
create or replace function matchdeal_record_detail_view(p_viewer_profile_id uuid, p_shown_profile_id uuid)
returns void language plpgsql security definer as $$
begin
  insert into matchdeal_detail_views (viewer_profile_id, shown_profile_id)
  values (p_viewer_profile_id, p_shown_profile_id);
end; $$;
```

Chamada do lado do cliente: `MatchDealDeck.tsx`, quando `subIndex` avança de 0 para 1 pela primeira vez
neste perfil (não a cada swipe up repetido) — um `useEffect` novo, mesma forma do que já existe para
`matchdeal_record_exposure`.

## 2. `matchdeal_profiles.completeness_pct` — nova coluna

Substitui o binário `is_complete` como base do sinal 6 (só para o cálculo do Hype — `is_complete`
continua a existir e a controlar `is_visible`, inalterado).

```sql
alter table matchdeal_profiles add column completeness_pct smallint not null default 0
  check (completeness_pct between 0 and 100);
```

**O que conta para a percentagem** — proposto, mais campos do que os 7 já obrigatórios para
`is_complete`, para dar variação real dentro do pool elegível (todos já têm os 7 obrigatórios):
`photo_url, website, description, sectors, country, investment_stage_sought, company_phase` (os 7 já
existentes) **+** `pitch_deck_url, gallery_urls (≥1), revenue, team_summary, founded_year` — 12 campos
no total, `completeness_pct = round(100.0 * campos_preenchidos / 12)`. Sinal 6 conta como cumprido
quando `completeness_pct >= 90`.

## 3. `matchdeal_hype_scores` — nova tabela (cache diário)

Um snapshot por dia, nunca sobrescrito — o badge "sai e entra consoante o dia" fica auditável.

```sql
create table matchdeal_hype_scores (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  computed_at date not null default current_date,
  score numeric not null,
  is_hype boolean not null default false,
  created_at timestamptz not null default now(),
  unique (profile_id, computed_at)
);
create index matchdeal_hype_scores_profile_idx on matchdeal_hype_scores (profile_id, computed_at desc);
```

## 4. O que o recálculo diário lê e escreve, exatamente

Corre **dentro do cron diário já existente** (`/api/automations`, `0 9 * * *` — o plano Hobby só
permite 1 cron/dia, já documentado; não é um cron novo).

**Lê**, por cada `matchdeal_profiles` com `kind='startup', is_visible=true`:
1. Likes na semana: `count(*) from matchdeal_swipes where target_profile_id=p.id and direction='like' and created_at >= current week start`.
2. Ritmo de crescimento: mesma contagem para a semana anterior; sinal = (esta semana − semana anterior).
3. Aberturas de detalhe na semana: `count(distinct viewer_profile_id) from matchdeal_detail_views where shown_profile_id=p.id and viewed_at >= current week start`.
4. Pedidos de reunião recebidos: `count(*) from matchdeal_meeting_proposals mp join matchdeal_matches m on m.id=mp.match_id where m.startup_profile_id=p.id and mp.proposed_by_profile_id <> p.id`.
5. Super likes/Boosts recebidos: **fixo a 0 para todos, até o Bloco 3 (Boost) existir** — não há
   `super_like` na BD (`matchdeal_swipes_direction_check` só aceita `like`/`pass`) nem `matchdeal_boosts`
   tem linhas ou código ligado. Sinal ativo assim que o Bloco 3 aplicar o schema dele.
6. Completude: `p.completeness_pct >= 90`.
7. Assiduidade de resposta: só entra se `count(distinct match_id) from matchdeal_messages where sender_profile_id=p.id >= 3`; caso contrário, sinal fica de fora do cálculo desse perfil (não conta como zero, conta como "não aplicável").

**Escreve**: uma linha por perfil elegível em `matchdeal_hype_scores` (`computed_at = hoje`), com
`score` = combinação dos sinais (**pesos ainda por decidir — ver nota abaixo**) e `is_hype` = `true`
para os perfis no percentil 95 (top 5%) desse `score`, `false` para o resto.

**Nota em aberto, não é schema**: "pesos ficam como constantes no código, não configuráveis" foi
confirmado, mas os valores exatos dos pesos nunca foram enviados — vou propor pesos iguais (1/7 cada,
sinal 5 e 7 excluídos do denominador quando não aplicáveis a um perfil específico) como omissão razoável
por defeito, e digo-o explicitamente no código quando escrever a função — não é uma decisão de schema,
por isso não bloqueia esta aprovação, mas sinalizo para não ser assumido em silêncio.

## Guardas confirmadas

- Nenhuma tabela/coluna toca `access_grants`.
- `matchdeal_eligible_deck()` não é lida nem escrita por nada disto — o cálculo do Hype é
  inteiramente downstream (lê `matchdeal_swipes`/`matchdeal_detail_views`/etc., nunca ao contrário). O
  badge é consumido pela UI como etiqueta pura; a ordenação do baralho continua exclusivamente a spec
  v1 §1/§2.
- Investidor nunca vê `score` nem `matchdeal_hype_scores` — só o campo `is_hype` do dia mais recente,
  exposto como booleano num endpoint próprio (a construir depois do OK ao schema).

À espera de confirmação para aplicar.
