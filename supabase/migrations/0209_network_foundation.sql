-- Prompt 316 — My Network 1/9: data foundation. A rede interna entre
-- founders e investidores com UMA finalidade: entreajuda no levantamento de
-- capital. Vendas/parcerias/prospecção comercial são proibidas (aplicado por
-- produto em prompts seguintes, 321). Duas regras estruturais valem para
-- toda a série 316-324, fixadas aqui porque a fundação é onde têm de ser
-- respeitadas desde o primeiro dia:
--   - Anti-spam: nenhuma ligação sem contexto verificável — não existe
--     pesquisa livre de pessoas. Toda ligação nasce de um convite com
--     contexto/evidência (network_invites.context_kind/context_ref).
--   - Anti-ranking: nada aqui permite comparar founders entre si — nenhuma
--     destas tabelas guarda ou expõe uma métrica agregável/ordenável entre
--     actores (cadência, contagens de sucesso, etc. — essas vêm, com essa
--     mesma disciplina, só a partir do Prompt 322 em diante).

-- ---------------------------------------------------------------------------
-- network_actors — nó de primeira classe para os dois lados da rede.
-- Identidade dupla, nunca uma terceira: mesmo padrão de usage_sessions
-- (migração 0203) — org_id para o lado founder/CRM, matchdeal_profile_id
-- para o lado investidor. Um matchdeal_profiles.kind='investor' é a
-- identidade cross-org estável que este produto já tem para "um investidor"
-- (ao contrário de access_grants, que é por-org/por-email-convidado, não uma
-- identidade única da pessoa) — por isso é essa, e não access_grants, a
-- reutilizada aqui. Consequência real, documentada porque não é óbvia: um
-- investidor só pode participar em My Network depois de ter um perfil
-- MatchDeal — não basta ter um access_grants de founder nenhum.
create table if not exists network_actors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id) on delete cascade,
  matchdeal_profile_id uuid references matchdeal_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint network_actors_exactly_one_identity check (
    (org_id is not null and matchdeal_profile_id is null)
    or (org_id is null and matchdeal_profile_id is not null)
  ),
  constraint network_actors_org_unique unique (org_id),
  constraint network_actors_matchdeal_profile_unique unique (matchdeal_profile_id)
);

-- Provisionamento automático — nunca lazy-criado por código de app. Todo
-- org e todo perfil MatchDeal de investidor ganha o seu actor no mesmo
-- instante em que passa a existir, para "founders E investidores são nós
-- de primeira classe desde já" ser literalmente verdade, não uma promessa
-- para quando alguém visitar /network pela primeira vez.
create or replace function public.network_actor_for_new_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.network_actors (org_id) values (new.id) on conflict (org_id) do nothing;
  return new;
end;
$$;
create trigger network_actor_for_new_org after insert on orgs
  for each row execute function public.network_actor_for_new_org();

create or replace function public.network_actor_for_new_investor_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind = 'investor' then
    insert into public.network_actors (matchdeal_profile_id) values (new.id) on conflict (matchdeal_profile_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger network_actor_for_new_investor_profile after insert on matchdeal_profiles
  for each row execute function public.network_actor_for_new_investor_profile();

-- Backfill — todo org e todo perfil de investidor que já existia antes
-- desta migração ganha o seu actor agora, uma única vez.
insert into network_actors (org_id) select id from orgs on conflict (org_id) do nothing;
insert into network_actors (matchdeal_profile_id) select id from matchdeal_profiles where kind = 'investor' on conflict (matchdeal_profile_id) do nothing;

-- ---------------------------------------------------------------------------
-- network_connections — ligação simétrica, revogável. Guarda canónica:
-- menor id primeiro + unique (nenhum precedente equivalente encontrado no
-- repo — matchdeal_pairings é emparelhamento de DISPOSITIVO, não de
-- actores), exactamente como o próprio prompt sugeriu.
create table if not exists network_connections (
  id uuid primary key default gen_random_uuid(),
  actor_low_id uuid not null references network_actors(id) on delete cascade,
  actor_high_id uuid not null references network_actors(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'removed', 'blocked')),
  -- Só preenchido quando status='blocked' — quem bloqueou. Bloqueio é
  -- silencioso por desenho (o prompt é explícito: "quem bloqueia não
  -- notifica o outro") — este campo é só para a UI do bloqueador saber que
  -- foi ele, nunca lido nem exposto ao lado bloqueado.
  blocked_by_actor_id uuid references network_actors(id) on delete set null,
  -- Texto legível, capturado no momento em que a ligação nasce (do convite
  -- aceite) — ex. "Shared investor: Acme Ventures". Nunca recalculado
  -- depois: se o investidor partilhado deixar de o ser mais tarde, a
  -- ligação já feita não desaparece nem se reescreve sozinha.
  origin_context text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint network_connections_ordered check (actor_low_id < actor_high_id),
  constraint network_connections_unique_pair unique (actor_low_id, actor_high_id)
);
create index if not exists network_connections_low_idx on network_connections (actor_low_id);
create index if not exists network_connections_high_idx on network_connections (actor_high_id);

-- ---------------------------------------------------------------------------
-- network_invites — nunca uma ligação nasce sem isto. context_kind fechado
-- à lista que já existe hoje ('shared_investor', deste prompt) mais as duas
-- que os prompts seguintes desta série vão preencher (317 grupos, 318
-- referências) — declaradas já no check para não precisar de migração nova
-- só para as desbloquear quando esses prompts chegarem.
create table if not exists network_invites (
  id uuid primary key default gen_random_uuid(),
  from_actor_id uuid not null references network_actors(id) on delete cascade,
  to_actor_id uuid not null references network_actors(id) on delete cascade,
  context_kind text not null check (context_kind in ('shared_investor', 'shared_group', 'referral')),
  context_ref text,
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint network_invites_no_self check (from_actor_id <> to_actor_id)
);
create index if not exists network_invites_from_idx on network_invites (from_actor_id, status);
create index if not exists network_invites_to_idx on network_invites (to_actor_id, status);

-- Máx. 5 convites pending por actor origem — aplicado no servidor via
-- trigger (não só a UI), fail-closed: uma corrida entre dois pedidos
-- concorrentes ainda serializa correctamente porque o COUNT() dentro do
-- trigger corre sob o lock de escrita da própria transacção de insert.
create or replace function public.enforce_network_invite_pending_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'pending' and (
    select count(*) from public.network_invites
    where from_actor_id = new.from_actor_id and status = 'pending'
  ) >= 5 then
    raise exception 'NETWORK_INVITE_PENDING_CAP_REACHED';
  end if;
  return new;
end;
$$;
create trigger network_invites_pending_cap before insert on network_invites
  for each row execute function public.enforce_network_invite_pending_cap();

-- ---------------------------------------------------------------------------
-- RLS — leitura só da própria identidade (actor a que o utilizador
-- autenticado corresponde); escrita nunca directa do browser, só via rotas
-- API service-role. is_my_network_actor reutiliza matchdeal_current_profile_ids()
-- (migração 0053) em vez de reinventar a resolução de "que perfis MatchDeal
-- são meus" — mesma função que as RPCs matchdeal_record_swipe/exposure já
-- usam para a mesma pergunta.
create or replace function public.is_my_network_actor(p_actor_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.network_actors a
    where a.id = p_actor_id
      and (
        (a.org_id is not null and public.is_org_member(a.org_id))
        or (a.matchdeal_profile_id is not null and a.matchdeal_profile_id in (select public.matchdeal_current_profile_ids()))
      )
  );
$$;

alter table network_actors enable row level security;
alter table network_connections enable row level security;
alter table network_invites enable row level security;

-- Nota: isto só deixa um actor ler a SUA PRÓPRIA linha em network_actors —
-- não a do outro lado de uma ligação/convite (não há aqui informação
-- suficiente para resolver nome/tipo do outro actor com segurança
-- genérica). Resolver nomes para mostrar na UI é trabalho das rotas
-- /api/network/* (service-role), não de um select directo do browser.
create policy network_actors_self_read on network_actors
  for select using (public.is_my_network_actor(id));

create policy network_connections_self_read on network_connections
  for select using (public.is_my_network_actor(actor_low_id) or public.is_my_network_actor(actor_high_id));

create policy network_invites_self_read on network_invites
  for select using (public.is_my_network_actor(from_actor_id) or public.is_my_network_actor(to_actor_id));

-- ---------------------------------------------------------------------------
-- Prompt 316 §B — opt-in de descoberta por investidor partilhado. Off por
-- omissão (ao contrário de swot/roadmap/round_progress_visible_to_investors,
-- que são opt-OUT — este é opt-IN genuíno, mesma disciplina que
-- reawakening_ai_filter_enabled, migração 0193): "a startup B foi investida
-- por X" é dado do pipeline de B, e a regra raiz de privacidade (CLAUDE.md)
-- exige consentimento antes de ser exposto a outro founder, mesmo que só
-- como "partilham o investidor X" sem mais nenhum detalhe.
alter table orgs add column if not exists network_discoverable boolean not null default false;
