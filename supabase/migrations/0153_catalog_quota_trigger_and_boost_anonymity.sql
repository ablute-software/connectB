-- APLICADO em produção 2026-08-09 19:49:21 UTC (versão 20260809194921).
-- Verificado ao vivo depois de aplicar: trigger bloqueia insert acima da
-- quota (testado contra ablute_, 530 entregas > quota 40, excepção
-- CATALOG_QUOTA_EXCEEDED); matchdeal_my_boosts() testado com insert+rollback
-- — startup vê investor_profile_id=null, investidor vê o seu próprio id.
-- Tabela confirmada vazia (count=0) depois dos testes, sem resíduo.

-- Prompt (achado de caça a bugs, 09/08/2026) — dois bugs reais confirmados por
-- teste directo em producao (nao so leitura de codigo), FORA do escopo de
-- matchdeal_eligible_deck (esse fica de fora desta migracao, ver relatorio —
-- carve-out permanente "nunca tocar sem sign-off explicito").

-- ============================================================
-- FIX 1 — catalog_deliveries: quota de catalogo so era imposta no cliente
-- (unlockPack() em store-supabase.tsx). Confirmado ao vivo: a policy de
-- INSERT (`deliveries_admin`) so verifica is_org_member(org_id), sem checar
-- catalog_quota; catalog_top_matches tambem nao valida quota. Um membro da
-- org (ou uma segunda chamada da UI) consegue inserir alem do que o plano
-- paga. Fecha no ponto onde o dano acontece de facto: a insercao.
-- ============================================================
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

drop trigger if exists trg_catalog_deliveries_enforce_quota on public.catalog_deliveries;
create trigger trg_catalog_deliveries_enforce_quota
  before insert on public.catalog_deliveries
  for each row execute function public.catalog_deliveries_enforce_quota();

-- ============================================================
-- FIX 2 — matchdeal_boosts: a policy de SELECT (`matchdeal_boosts_participants`,
-- migracao 0053) deixa a startup boostada ler `investor_profile_id` na
-- integra — quebra a regra §15.4 (a startup sabe que recebeu, nao sabe de
-- quem). A tabela esta vazia em producao e nenhuma rota da app ainda chama
-- matchdeal_activate_super_like (BoostExtraPanel.tsx e stub) — corrigido
-- antes de ficar live, nao depois de um vazamento real acontecer.
--
-- Revoga leitura directa da tabela para authenticated/anon; substitui por
-- uma funcao que mascara a coluna consoante quem pergunta.
-- ============================================================
drop policy if exists matchdeal_boosts_participants on public.matchdeal_boosts;
revoke select on public.matchdeal_boosts from authenticated, anon;

create or replace function public.matchdeal_my_boosts()
returns table(id uuid, boosted_profile_id uuid, investor_profile_id uuid, week_start date, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select b.id, b.boosted_profile_id,
      case when b.investor_profile_id in (select f.id from public.matchdeal_current_profile_ids() as f(id))
        then b.investor_profile_id
        else null::uuid  -- startup boostada nunca ve quem a boostou
      end as investor_profile_id,
      b.week_start, b.created_at
    from public.matchdeal_boosts b
    where b.investor_profile_id in (select f.id from public.matchdeal_current_profile_ids() as f(id))
       or b.boosted_profile_id in (select f.id from public.matchdeal_current_profile_ids() as f(id));
end;
$$;

revoke all on function public.matchdeal_my_boosts() from public, anon;
grant execute on function public.matchdeal_my_boosts() to authenticated;

-- Nota para o Code: BoostExtraPanel.tsx deve passar a chamar
-- matchdeal_my_boosts() em vez de `.from('matchdeal_boosts').select(...)`
-- directo — a tabela deixou de ser legivel directamente.
--
-- Feito (mesma sessao, 2026-08-09): BoostExtraPanel.tsx reescrito para usar
-- matchdeal_my_boosts() em vez de leitura directa da tabela.
