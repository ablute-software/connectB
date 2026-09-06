-- Prompt 583 §E.5(a) — a reusable aggregate over ai_call_log, scoped to
-- one org and one window, summing every row regardless of purpose (no
-- whitelist — a purpose born in a new file next month is caught the same
-- as one that's existed for months). Confirmed live before writing this:
-- the backoffice "AI Costs" route (src/app/api/backoffice/ai-costs) does
-- NOT actually filter by a purpose whitelist today — it already sums
-- every row for the window unfiltered; MECHANISM_LABEL there is display
-- labeling only, never a filter. This function exists because §E.6's
-- founder-cost fixture (and any future single-org cost lookup) needs
-- exactly this shape and nothing built it yet — not because the existing
-- dashboard was undercounting, which it wasn't.
create or replace function public.ai_cost_by_org(p_org_id uuid, p_since timestamptz, p_until timestamptz default now())
returns table (total_cost_eur numeric, request_count bigint, tokens_in bigint, tokens_out bigint)
language sql
stable
set search_path = public
as $$
  select
    coalesce(sum(cost_eur), 0)::numeric,
    count(*)::bigint,
    coalesce(sum(tokens_in), 0)::bigint,
    coalesce(sum(tokens_out), 0)::bigint
  from ai_call_log
  where org_id = p_org_id and created_at >= p_since and created_at < p_until;
$$;

-- Backoffice-only, same default-deny as every other admin-facing function.
revoke execute on function public.ai_cost_by_org(uuid, timestamptz, timestamptz) from public, anon, authenticated;
