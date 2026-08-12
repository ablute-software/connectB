-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar.
--
-- Ficheiro companheiro: prompt_181_limite_bonus_10_25_50_e_excecao_ablute_20260812.md §3

-- =============================================================================
-- O PROBLEMA
-- =============================================================================
-- Ao contrario do que se pensava, contas @ablute.pt NAO estao isentas do
-- limite de catalogo. is_ablute_developer() (migracao 0050, '%@ablute.pt',
-- email confirmado) ja existe e ja e usado noutros sitios (QA read-only,
-- developer viewer) -- mas nunca foi ligado a plan_catalog_quota() nem a
-- catalog_blocked_count(). Confirmado por leitura directa de ambas as
-- funcoes (0042/0164): so leem orgs.catalog_quota, sem excepcao nenhuma.
--
-- =============================================================================
-- O QUE ESTA MIGRACAO FAZ
-- =============================================================================
-- 1) plan_catalog_quota(check_org) -- quando is_ablute_developer() e
--    verdadeiro para quem chama, devolve 999999 (efetivamente sem limite)
--    em vez de orgs.catalog_quota. Esta funcao alimenta catalog_is_visible()
--    (0042), que por sua vez alimenta a RLS SELECT de `entities` -- logo
--    isto desbloqueia a VISIBILIDADE de qualquer linha catalog ja inserida.
--
--    NAO mexe nos GRANTs desta funcao. A migracao 0134 (06/08, auditoria de
--    seguranca) revogou EXECUTE de public/anon/authenticated
--    DELIBERADAMENTE: plan_catalog_quota() nao verifica is_org_member nem
--    nada parecido -- so foi desenhada para ser chamada de DENTRO doutra
--    SECURITY DEFINER (catalog_is_visible), nunca directamente pelo
--    cliente, porque um `anon`/`authenticated` a chamar directamente lia
--    orgs.catalog_quota de QUALQUER org por uuid, sem RLS. Confirmado
--    (0134 §2): "plan_catalog_quota(uuid-zeros) -> HTTP 200, null" com a
--    publishable key. Reabrir esse grant so para ligar o bypass seria
--    reverter uma correcao de seguranca deliberada -- por isso o bypass e
--    adicionado ao CORPO da funcao, os GRANTs ficam exactamente como a 0134
--    os deixou ({postgres,service_role}).
--
-- 2) catalog_blocked_count(check_org) -- mesma excepcao: devolve 0 (nunca
--    mostra vidro fosco) quando quem chama e is_ablute_developer(). Esta
--    ja tem is_org_member(check_org) como primeiro guard (0164) e ja e
--    grant a `authenticated` (chamada directa do cliente, pipeline/page.tsx)
--    -- fica exactamente assim, so ganha a excepcao.
--
-- 3) NOVA funcao catalog_effective_quota(check_org uuid) -- o equivalente
--    de plan_catalog_quota() mas SEGURO para o cliente chamar directamente:
--    comeca por is_org_member(check_org) (devolve 0 se nao for membro,
--    mesmo padrao de catalog_blocked_count), so depois aplica o mesmo
--    bypass. unlockPack() (store-supabase.tsx, mesmo commit) passa a ler a
--    quota atraves desta funcao em vez de `select catalog_quota from orgs`
--    directo -- sem isto, o bypass SQL acima só mudava a VISIBILIDADE de
--    linhas ja entregues, nunca quantas unlockPack esta disposto a
--    inserir, o que deixaria o teste de aceitacao do proprio prompt
--    ("todas as entidades do catalogo visiveis" para uma conta @ablute.pt
--    de perfil vazio) por cumprir -- so 3 linhas (o default da coluna)
--    teriam sido alguma vez inseridas nessa org.
--
-- 4) catalog_deliveries_enforce_quota() (trigger BEFORE INSERT em
--    catalog_deliveries, migracao 0153) -- outro ponto que le
--    orgs.catalog_quota directamente, sem passar por nenhuma das funcoes
--    acima. Confirmado por leitura directa: mesmo com catalog_effective_quota()
--    a devolver 999999 e unlockPack a tentar inserir mais linhas, este
--    trigger continuaria a comparar contra a quota REAL, pequena, e a
--    rejeitar com CATALOG_QUOTA_EXCEEDED a partir da entrega numero
--    catalog_quota+1 -- a cadeia partia-se aqui, no ultimo passo. Mesma
--    excepcao adicionada. Uma chamada do job mensal (Prompt 179 §B, corre
--    via service_role, sem auth.uid()) nao e afectada -- is_ablute_developer()
--    devolve falso para service_role, o trigger continua a aplicar a quota
--    real para esse caminho, correctamente.
--
-- 5) Por conta de UTILIZADOR, nao por org (is_ablute_developer() le
--    auth.uid() do JWT de quem chama, nao check_org/new.org_id) -- mesmo
--    padrao que resolveRole()/is_ablute_developer() ja usam no resto da
--    app. Um membro nao-@ablute.pt na mesma org que um membro @ablute.pt
--    continua sujeito ao limite normal.
-- =============================================================================

create or replace function public.plan_catalog_quota(check_org uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when public.is_ablute_developer() then 999999
              else (select catalog_quota from public.orgs where id = check_org)
         end;
$$;
-- Grants deliberadamente NAO tocados -- ver nota acima. Continuam
-- {postgres=X/postgres,service_role=X/postgres} tal como a 0134 deixou.

create or replace function public.catalog_blocked_count(check_org uuid) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_quota int;
  v_delivered int;
  v_catalog_size int;
  v_undelivered_eligible int;
begin
  if not is_org_member(check_org) then return 0; end if;
  if is_ablute_developer() then return 0; end if;

  select catalog_quota into v_quota from public.orgs where id = check_org;
  if v_quota is null then return 0; end if;

  select count(*) into v_delivered from public.catalog_deliveries where org_id = check_org;
  select count(*) into v_catalog_size from public.catalog_entities;

  select count(*) into v_undelivered_eligible
  from public.catalog_top_matches(check_org, greatest(v_catalog_size, 1));

  return greatest(0, v_undelivered_eligible + v_delivered - v_quota);
end;
$$;
grant execute on function public.catalog_blocked_count(uuid) to authenticated;

create or replace function public.catalog_effective_quota(check_org uuid) returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_org_member(check_org) then return 0; end if;
  if is_ablute_developer() then return 999999; end if;
  return (select catalog_quota from public.orgs where id = check_org);
end;
$$;
revoke all on function public.catalog_effective_quota(uuid) from public, anon;
grant execute on function public.catalog_effective_quota(uuid) to authenticated;

-- Point 4 above — the trigger's own quota check, bypassed the same way.
create or replace function public.catalog_deliveries_enforce_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quota int;
  v_delivered int;
begin
  if is_ablute_developer() then
    return new;
  end if;

  select catalog_quota into v_quota from public.orgs where id = new.org_id;
  if v_quota is null then
    raise exception 'catalog_deliveries: org % sem catalog_quota definido', new.org_id;
  end if;
  select count(*) into v_delivered from public.catalog_deliveries where org_id = new.org_id;
  if v_delivered >= v_quota then
    raise exception 'CATALOG_QUOTA_EXCEEDED: org % ja tem % entregas, quota=%',
      new.org_id, v_delivered, v_quota;
  end if;
  return new;
end;
$$;
-- Trigger ja existe (0153) e aponta para esta funcao por nome -- `create or
-- replace function` e suficiente, nao e preciso recriar o trigger.

-- =============================================================================
-- VERIFICACAO PARA CORRER LOGO A SEGUIR
-- =============================================================================
-- Como um utilizador @ablute.pt confirmado (email_confirmed_at not null),
-- membro da sua propria org:
--   select catalog_effective_quota('<org do proprio>'); -- esperado: 999999
--   select catalog_blocked_count('<org do proprio>'); -- esperado: 0
-- Como um utilizador normal (nao @ablute.pt) na mesma org de um membro
-- @ablute.pt:
--   select catalog_effective_quota('<org>'); -- esperado: orgs.catalog_quota real, nao 999999
-- Como anon/authenticated sem ser membro da org, tentando o antigo caminho
-- directo (deve continuar bloqueado -- confirma que 0134 nao foi revertida):
--   select plan_catalog_quota('<qualquer org>'); -- esperado: 42501 permission denied
-- =============================================================================
