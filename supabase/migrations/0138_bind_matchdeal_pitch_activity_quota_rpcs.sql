-- =============================================================================
-- 0138_bind_matchdeal_pitch_activity_quota_rpcs.sql
--
-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar e
-- devolver a confirmacao pos-aplicacao (ACLs, md5(prosrc), advisors).
--
-- Ficheiro companheiro: relatorio_tier2_matchdeal_rpcs_forjaveis_por_anon_20260806.md
-- §8 ("Tres achados novos, genuinamente nao amarrados, mas alcancaveis so por
-- authenticated"), mais o pedido directo do Nuno de estender a 0136/0137 a
-- estas tres.
--
-- =============================================================================
-- O PROBLEMA
-- =============================================================================
-- Tres RPC MatchDeal sao SECURITY DEFINER, aceitam um id de perfil como
-- parametro do cliente, e nunca o amarram a identidade de quem chama:
--
--   matchdeal_startup_pitch_data(p_profile_id)      -- TAM/SAM/SOM, projeccoes
--                                                       de receita, traccao,
--                                                       bios de fundadores
--   matchdeal_investor_activity(p_profile_id)        -- buckets de actividade
--   matchdeal_weekly_quota_status(p_viewer_profile_id) -- quota semanal + efeito
--                                                       de escrita via
--                                                       get_or_create_weekly_activity
--
-- Ao contrario das tres RPC fechadas na 0136, aqui o EXECUTE ja esta correcto
-- na ACL -- anon=false, public=false, authenticated=true -- confirmado em
-- 0088/0108/0089 (revokes ja aplicados na criacao). Esta migracao NAO mexe em
-- ACL nenhuma; o buraco e inteiramente a ausencia da guarda dentro do corpo.
-- Qualquer conta autenticada (mesmo sem perfil MatchDeal nenhum, ou com um
-- perfil do tipo errado) pode chamar estas RPC directamente com QUALQUER id.
--
-- =============================================================================
-- PORQUE NAO E O MESMO PADRAO NAS TRES -- lido o corpo, nao adivinhado
-- =============================================================================
-- Em record_swipe/record_exposure/undo_swipe (0136), o parametro amarrado
-- (p_actor_profile_id / p_viewer_profile_id) E o proprio chamador -- faz
-- sentido exigir que pertenca a auth.current_profile_ids().
--
-- Aqui isso so e verdade para UMA das tres:
--
--   matchdeal_weekly_quota_status(p_viewer_profile_id) -- p_viewer_profile_id
--     E o chamador (MatchDealDeck.tsx:595, "viewerProfileId" -- o proprio
--     perfil de quem esta a ver o deck). Mesmo padrao exacto da 0136.
--
-- As outras duas sao estruturalmente diferentes -- o parametro e a OUTRA
-- parte, mostrada no deck, nunca o proprio chamador:
--
--   matchdeal_startup_pitch_data(p_profile_id) -- chamado em
--     MatchDealDeck.tsx:611 com "current.id", o cartao ACTUALMENTE mostrado
--     no deck (uma startup, dado o guard client-side current.kind==='startup'
--     tres linhas acima). O proprio comentario da funcao (0088/0096) explica
--     porque existe: "RLS on orgs/company_people has no cross-org read path,
--     so this can't be a direct client query" -- ou seja, esta RPC foi criada
--     PRECISAMENTE para permitir leitura cross-org, nao para a impedir. Exigir
--     p_profile_id = chamador quebraria a funcionalidade inteira: nenhum
--     investidor conseguiria ver o pitch de startup nenhuma, incluindo as
--     legitimamente no seu deck.
--
--   matchdeal_investor_activity(p_profile_id) -- chamado em
--     MatchDealDeck.tsx:315 via useInvestorActivity, invocado em
--     MatchDealDeck.tsx:364 com "p.id" onde p.kind==='investor' -- outra vez,
--     o cartao mostrado, nao o chamador. Mesmo raciocinio: "RLS blocks a
--     startup from reading another org's swipes/exposures/matches directly
--     ... so this reads matchdeal_investor_activity" (comentario da propria
--     0106).
--
-- Ha tambem um chamador service_role de matchdeal_startup_pitch_data que uma
-- guarda "so o dono" quebraria de qualquer forma, mesmo que o parametro
-- fosse mal-lido como "o chamador": src/app/api/portal/startup/[orgId]/
-- route.ts:62 chama `admin.rpc('matchdeal_startup_pitch_data', ...)` com o
-- cliente service_role, para mostrar a um investidor com nivel de disclosure
-- ja verificado (>= 1, checado no proprio route) o dossier de uma startup
-- que nao e "dele". Confirmado: nenhum chamador service_role equivalente
-- existe para as outras duas (grep em src/, so browserClient()).
--
-- =============================================================================
-- A GUARDA CORRECTA PARA AS DUAS "outra parte" -- espelha matchdeal_eligible_deck
-- =============================================================================
-- matchdeal_eligible_deck ja impoe `p.kind <> v_viewer.kind` (0053:441) -- o
-- deck e sempre kind oposto (startup <-> investidor). A guarda aqui aplica a
-- MESMA regra, ja validada em producao, em vez de inventar uma nova: quem
-- chama tem de ter um perfil corrente do kind oposto ao alvo (investidor para
-- ver pitch de startup; startup para ver actividade de investidor), ou ser
-- service_role (so no caso do pitch_data, unico com esse chamador real).
--
-- Isto fecha os dois angulos que "qualquer perfil corrente, seja qual for"
-- deixaria aberto: uma conta Supabase sem perfil MatchDeal nenhum (o buraco
-- reportado), E uma startup a chamar directamente esta RPC para o pitch de
-- uma CONCORRENTE (mesmo kind, nunca legitimo no deck -- mesmo que meça o
-- pitch de uma startup, o alvo e sempre kind='startup' pela propria query, e
-- so um kind='investor' devia poder pedi-lo).
--
-- =============================================================================
-- O QUE ESTE FICHEIRO NAO TOCA
-- =============================================================================
-- ACL das tres funcoes -- ja correcta (anon/public revogados desde a
-- criacao); nao ha revoke aqui, so o corpo.
-- matchdeal_eligible_deck: nao tocada. access_grants: nao tocada.
--
-- =============================================================================
-- NOTA DE HONESTIDADE -- reproducao do corpo
-- =============================================================================
-- Esta sessao nao tem acesso directo a producao. Os tres corpos abaixo sao
-- reproduzidos das ultimas migracoes que os definiram no repositorio --
-- 0096 (pitch_data), 0106 (investor_activity), 0089 (weekly_quota_status) --
-- confirmadas, via grep em todo supabase/migrations/, como as unicas
-- definicoes de cada uma desde a criacao (nenhuma migracao posterior as
-- substituiu). Ainda assim, o revisor deve confirmar md5(prosrc) contra o
-- estado real de producao ANTES de aplicar -- se divergir, este ficheiro
-- precisa de ser corrigido primeiro, nao aplicado por cima.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- matchdeal_startup_pitch_data -- corpo de 0096 (ultima definicao), com UM
-- acrescento: o bloco da guarda logo a seguir ao "begin", mais
-- "set search_path = public, pg_temp" no cabecalho (a funcao nao tinha
-- nenhum -- todas as referencias no corpo ja sao qualificadas com "public.",
-- portanto e seguro; fecha mais um dos 31 avisos function_search_path_mutable).
-- -----------------------------------------------------------------------------
create or replace function public.matchdeal_startup_pitch_data(p_profile_id uuid)
returns table(
  org_name text, one_liner text, description text,
  country text, hq_city text, sectors text[],
  founded_year int, round_target_eur int, revenue_eur numeric,
  logo_url text, stage text,
  tam_eur numeric, sam_eur numeric, som_eur numeric,
  revenue_projection_12mo_eur numeric, revenue_projection_5yr_eur numeric,
  traction_metrics jsonb,
  founders jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_profile public.matchdeal_profiles;
begin
  -- GUARDA 0138: p_profile_id e a OUTRA parte (a startup mostrada no deck),
  -- nunca o proprio chamador -- ver a nota longa no cabecalho desta migracao
  -- sobre porque isto nao e "p_profile_id = chamador". Quem pode chamar:
  -- um investidor com perfil corrente (espelha matchdeal_eligible_deck's
  -- kind<>kind), ou o service_role do portal do investidor
  -- (src/app/api/portal/startup/[orgId]/route.ts:62).
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.matchdeal_profiles cp
    where cp.id in (select public.matchdeal_current_profile_ids())
      and cp.kind = 'investor'
  ) then
    raise exception 'MATCHDEAL_NOT_ELIGIBLE_VIEWER';
  end if;

  select * into v_profile from public.matchdeal_profiles
  where id = p_profile_id and kind = 'startup' and is_visible = true;

  if v_profile.id is null then
    return;
  end if;

  return query
  select
    o.name, o.one_liner, o.description, o.country, o.hq_city, o.sectors,
    o.founded_year, o.round_target_eur, o.revenue_eur, o.logo_url, o.stage::text,
    v_profile.tam_eur, v_profile.sam_eur, v_profile.som_eur,
    v_profile.revenue_projection_12mo_eur, v_profile.revenue_projection_5yr_eur,
    coalesce((
      select jsonb_agg(jsonb_build_object('type', tm.dealdigger_type, 'value', tm.value, 'label', tm.label) order by tm.sort_order)
      from public.org_traction_metrics tm
      where tm.org_id = v_profile.membership_id and tm.show_on_dealdigger = true
    ), '[]'::jsonb) as traction_metrics,
    coalesce((
      select jsonb_agg(jsonb_build_object('full_name', cp.full_name, 'title', cp.title, 'bio', cp.bio, 'photo_url', cp.photo_url) order by cp.sort_order)
      from public.company_people cp
      where cp.org_id = v_profile.membership_id and cp.is_founder = true
    ), '[]'::jsonb) as founders
  from public.orgs o
  where o.id = v_profile.membership_id;
end;
$function$;

-- -----------------------------------------------------------------------------
-- matchdeal_investor_activity -- corpo de 0106 (unica definicao), com UM
-- acrescento: o bloco da guarda logo a seguir ao "begin". O "set search_path
-- = public" ja existia (0106) e fica exactamente como estava -- o corpo usa
-- nomes de tabela NAO qualificados (matchdeal_profiles, matchdeal_exposures,
-- etc, sem "public."), e e o "set search_path" da propria funcao que os
-- resolve com seguranca; alargar para "public, pg_temp" ou tocar nessas
-- referencias esta fora do ambito desta correccao e arrisca introduzir um
-- desvio nao intencional num corpo que hoje ja fecha o lint correctamente.
-- Sem escotilha service_role: nenhum chamador service_role existe para esta
-- RPC (confirmado por grep em src/ -- so browserClient()).
-- -----------------------------------------------------------------------------
create or replace function public.matchdeal_investor_activity(p_profile_id uuid)
returns table (
  member_since date,
  likes_ratio_bucket text,
  replies_bucket text,
  matches_bucket text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_member_since date;
  v_exposures_as_viewer integer;
  v_likes_given integer;
  v_swipes_given integer;
  v_likes_ratio_bucket text;
  v_reply_count integer;
  v_reply_avg_hours numeric;
  v_replies_bucket text;
  v_match_count integer;
  v_matches_bucket text;
begin
  -- GUARDA 0138: p_profile_id e a OUTRA parte (o cartao de investidor
  -- mostrado no deck a uma startup), nunca o proprio chamador -- mesma nota
  -- que matchdeal_startup_pitch_data. So uma startup com perfil corrente
  -- pode pedir isto (espelha matchdeal_eligible_deck's kind<>kind).
  if not exists (
    select 1 from public.matchdeal_profiles cp
    where cp.id in (select public.matchdeal_current_profile_ids())
      and cp.kind = 'startup'
  ) then
    raise exception 'MATCHDEAL_NOT_ELIGIBLE_VIEWER';
  end if;

  select created_at::date into v_member_since from matchdeal_profiles where id = p_profile_id;

  -- Selective/balanced/broad: of the candidates shown TO this profile as
  -- a VIEWER, what share did it like? Needs >=20 exposures as viewer —
  -- a small sample is both noisy and easier to re-identify.
  select count(*) into v_exposures_as_viewer from matchdeal_exposures where viewer_profile_id = p_profile_id;
  select count(*) filter (where direction = 'like'), count(*)
    into v_likes_given, v_swipes_given
    from matchdeal_swipes where actor_profile_id = p_profile_id;
  if v_exposures_as_viewer >= 20 and v_swipes_given > 0 then
    v_likes_ratio_bucket := case
      when v_likes_given::numeric / v_swipes_given < 0.25 then 'selective'
      when v_likes_given::numeric / v_swipes_given <= 0.6 then 'balanced'
      else 'broad'
    end;
  end if;

  -- Reply speed: matches this profile is a participant in (either side),
  -- where a first 'user' message from one side got a 'user' reply from
  -- the other. matchdeal_messages has no read-receipt column, so this can
  -- only ever mean "time between first message and first reply," never
  -- "time to read." Needs >=3 such conversations.
  with my_matches as (
    select id from matchdeal_matches
    where startup_profile_id = p_profile_id or active_investor_profile_id = p_profile_id
  ),
  first_msgs as (
    select match_id, sender_profile_id, created_at,
           row_number() over (partition by match_id order by created_at) as rn
    from matchdeal_messages
    where match_id in (select id from my_matches) and kind = 'user'
  ),
  reply_pairs as (
    select a.match_id, a.created_at as asked_at, b.created_at as replied_at
    from first_msgs a
    join first_msgs b on b.match_id = a.match_id and b.sender_profile_id <> a.sender_profile_id and b.created_at > a.created_at
    where a.rn = 1
  )
  select count(*), avg(extract(epoch from (replied_at - asked_at)) / 3600.0)
    into v_reply_count, v_reply_avg_hours
    from reply_pairs;

  if v_reply_count >= 3 then
    v_replies_bucket := case
      when v_reply_avg_hours <= 24 then 'fast'
      when v_reply_avg_hours <= 24 * 7 then 'within_days'
      else 'slow'
    end;
  end if;

  -- Matches: needs >=1 to report at all (no minimum beyond "at least
  -- something happened").
  select count(*) into v_match_count from matchdeal_matches
    where startup_profile_id = p_profile_id or active_investor_profile_id = p_profile_id;
  if v_match_count >= 1 then
    v_matches_bucket := case
      when v_match_count <= 5 then '1-5'
      when v_match_count <= 20 then '6-20'
      else '20+'
    end;
  end if;

  return query select v_member_since, v_likes_ratio_bucket, v_replies_bucket, v_matches_bucket;
end;
$function$;

-- -----------------------------------------------------------------------------
-- matchdeal_weekly_quota_status -- corpo de 0089 (unica definicao), com dois
-- acrescentos: o bloco da guarda logo a seguir ao "begin", e
-- "set search_path = public, pg_temp" no cabecalho (nao tinha nenhum; o
-- corpo ja qualifica tudo com "public.", seguro).
-- -----------------------------------------------------------------------------
create or replace function public.matchdeal_weekly_quota_status(p_viewer_profile_id uuid)
returns table(deck_size int, shown_count int, remaining int, week_start date, resets_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_viewer public.matchdeal_profiles;
  v_weekly public.matchdeal_weekly_activity;
  v_limits record;
begin
  -- GUARDA 0138: aqui p_viewer_profile_id E o proprio chamador -- mesmo
  -- padrao exacto de record_swipe/record_exposure/undo_swipe na 0136.
  if not exists (
    select 1 from public.matchdeal_current_profile_ids() as f(id)
    where f.id = p_viewer_profile_id
  ) then
    raise exception 'MATCHDEAL_NOT_YOUR_PROFILE';
  end if;

  select * into v_viewer from public.matchdeal_profiles where id = p_viewer_profile_id;
  v_weekly := public.matchdeal_get_or_create_weekly_activity(p_viewer_profile_id);
  select * into v_limits from public.matchdeal_tier_limits(v_viewer.plan_tier);
  return query select
    v_limits.deck_size,
    v_weekly.shown_count,
    greatest(v_limits.deck_size - v_weekly.shown_count, 0),
    v_weekly.week_start,
    (public.matchdeal_current_week_start() + interval '7 days')::timestamptz;
end; $function$;

commit;

-- =============================================================================
-- VERIFICACAO PARA CORRER LOGO A SEGUIR
-- =============================================================================
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_pode,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_pode,
--        has_function_privilege('public', p.oid, 'EXECUTE')        as public_pode,
--        p.prosrc like '%MATCHDEAL_NOT_ELIGIBLE_VIEWER%'
--          or p.prosrc like '%MATCHDEAL_NOT_YOUR_PROFILE%'          as tem_guarda,
--        array_to_string(p.proconfig, ',')                         as cfg
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('matchdeal_startup_pitch_data','matchdeal_investor_activity','matchdeal_weekly_quota_status')
-- order by p.proname;
--
-- Esperado nas tres: anon_pode=false, public_pode=false, auth_pode=TRUE,
-- tem_guarda=true (ACL nao muda -- ja estava assim antes desta migracao).
--
-- Teste funcional que nenhum SQL substitui -- as tres tem de continuar a
-- funcionar para o caso legitimo, nao so bloquear o ataque:
--   1. Como investidor autenticado, com um card de startup no deck: o pitch
--      (matchdeal_startup_pitch_data) continua a carregar normalmente.
--   2. Como startup autenticada, com um card de investidor no deck: a banda
--      de actividade (matchdeal_investor_activity) continua a carregar.
--   3. Qualquer conta MatchDeal autenticada: a quota semanal
--      (matchdeal_weekly_quota_status) continua a aparecer quando o deck
--      esgota.
--   4. O portal do investidor (/portal/startup/[orgId], nivel >= 1) continua
--      a mostrar o dossier da startup -- prova a escotilha service_role.
--   5. Ataque directo (chamar com p_profile_id de OUTRO perfil, sem ser
--      dono nem do kind certo) tem de devolver o erro da guarda, nao dados.
-- =============================================================================
