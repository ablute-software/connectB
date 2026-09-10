-- Prompt 644 §2.2, §2.3, §2.4 (data side) — the history the cards never had.
--
-- §2.2 catalog_metrics_daily: one row per (day, metric), admin-only. The
-- snapshot function upserts catalog_metrics_compute(p_day) — idempotent,
-- may run N times for the same day — and leaves one admin_audit_log row per
-- run with the number of metrics written, so a silent failure is visible.
-- pg_cron at 00:05 UTC closes the previous day. This is NOT
-- metrics_snapshots (the business overview payload written on every page
-- open, 19–83 times a day under the name daily_cron): one function, one
-- table, one run a day.
--
-- §2.3 Backfill once, here: every day from 2026-07-21 (the first catalogue
-- row) to yesterday, through the same function, so the dated series come
-- out right and the undated ones come out NULL — the chart shows "no data
-- before <date>" instead of a zero that would be a lie. The backfill writes
-- a single audit row, not fifty-one.
--
-- §2.4 catalog_metrics_series(p_from, p_to, p_metrics) returns day, metric,
-- value from the table, plus today's live values from the same function
-- when the window reaches today — the cards are the last point of the
-- curve by construction.

create table if not exists public.catalog_metrics_daily (
  day         date not null,
  metric      text not null,
  value       numeric,
  computed_at timestamptz not null default now(),
  primary key (day, metric)
);
alter table public.catalog_metrics_daily enable row level security;
revoke all on public.catalog_metrics_daily from public, anon;
grant select on public.catalog_metrics_daily to authenticated;
drop policy if exists catalog_metrics_daily_admin_read on public.catalog_metrics_daily;
create policy catalog_metrics_daily_admin_read on public.catalog_metrics_daily
  for select to authenticated using (public.is_platform_admin());
comment on table public.catalog_metrics_daily is
  'Prompt 644 §2.2 — one row per (day, metric) from catalog_metrics_compute(day), closed at 00:05 UTC by pg_cron. NULL = not reconstructible for that day, never zero.';

create or replace function public.catalog_metrics_snapshot(p_day date default current_date - 1, p_audit boolean default true)
returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  v_n int;
begin
  if current_user not in ('postgres', 'service_role') and auth.role() is distinct from 'service_role' and not public.is_platform_admin() then
    raise exception 'catalog_metrics_snapshot: platform admin only';
  end if;
  insert into catalog_metrics_daily (day, metric, value, computed_at)
  select p_day, c.metric, c.value, now() from public.catalog_metrics_compute(p_day) c
  on conflict (day, metric) do update set value = excluded.value, computed_at = excluded.computed_at;
  get diagnostics v_n = row_count;
  if p_audit then
    insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
    values (null, 'catalog_metrics_snapshot', 'catalog_metrics_daily', null, jsonb_build_object('day', p_day, 'metrics_written', v_n));
  end if;
  return v_n;
end $fn$;
revoke all on function public.catalog_metrics_snapshot(date, boolean) from public, anon, authenticated;

-- Close yesterday at 00:05 UTC, every day.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'catalog_metrics_snapshot') then
    perform cron.unschedule('catalog_metrics_snapshot');
  end if;
  perform cron.schedule('catalog_metrics_snapshot', '5 0 * * *', $cron$select public.catalog_metrics_snapshot(current_date - 1);$cron$);
end $$;

-- Backfill: 2026-07-21 → yesterday, one audit row for the whole run.
do $$
declare
  d date;
  v_days int := 0;
  v_rows int := 0;
begin
  for d in select generate_series('2026-07-21'::date, current_date - 1, interval '1 day')::date loop
    v_rows := v_rows + public.catalog_metrics_snapshot(d, false);
    v_days := v_days + 1;
  end loop;
  insert into admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (null, 'catalog_metrics_backfill', 'catalog_metrics_daily', null,
          jsonb_build_object('prompt', 644, 'from', '2026-07-21', 'to', current_date - 1, 'days', v_days, 'rows', v_rows));
  raise notice 'catalog metrics backfill: % days, % rows', v_days, v_rows;
end $$;

create or replace function public.catalog_metrics_series(p_from date, p_to date, p_metrics text[] default null)
returns table (day date, metric text, value numeric)
language plpgsql stable security definer set search_path = public as $fn$
begin
  if current_user not in ('postgres', 'service_role') and auth.role() is distinct from 'service_role' and not public.is_platform_admin() then
    raise exception 'catalog_metrics_series: platform admin only';
  end if;
  return query
  select d.day, d.metric, d.value
    from catalog_metrics_daily d
   where d.day >= p_from and d.day <= least(p_to, current_date - 1)
     and (p_metrics is null or d.metric = any(p_metrics))
  union all
  select current_date, c.metric, c.value
    from public.catalog_metrics_compute(current_date) c
   where p_to >= current_date and p_from <= current_date
     and (p_metrics is null or c.metric = any(p_metrics))
  order by 1, 2;
end $fn$;
revoke all on function public.catalog_metrics_series(date, date, text[]) from public, anon;
grant execute on function public.catalog_metrics_series(date, date, text[]) to authenticated, service_role;
