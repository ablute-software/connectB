-- RENUMBERED 0302 -> 0305 (Prompt 557 follow-up, 2026-09-03, authorised by Nuno).
-- 0302 was taken on `main` by 0302_matchdeal_investor_firm_view.sql (Prompt
-- 555, merged as b17b66a) — two different files with the same number on the
-- two branches about to be merged. Both statements are ALREADY APPLIED in
-- production (catalog_readiness_breakdown 18:16, the firm-view block
-- 16:29-16:51), so nothing about the database changes here: this is a rename
-- only, for the benefit of a fresh `db reset`, exactly the precedent Prompt
-- 537 set for 0295.
--
-- WHY 0305 AND NOT A NUMBER BELOW 0303. Renaming to 0305 sorts this AFTER
-- 0303_catalog_outreach_supply, reversing the order the two were written in.
-- Checked before choosing it: 0303 contains zero references to
-- catalog_readiness_breakdown, so there is no dependency to preserve and the
-- reorder is inert. Had there been one, both files would have had to move to
-- keep their relative order.
--
-- Prompt 544 Part D — the numbers behind the readiness score, for the
-- Pipeline row's strip.
--
-- outreach_readiness (0300) is a single 0-100 number. The row needs the parts
-- — "18 people · 14 on LinkedIn · form ✓ · email ✓ · 0 hooks" — because that
-- is what tells the founder WHO and HOW before they open anything, which was
-- the actual complaint. A score cannot say "nobody has a LinkedIn here".
--
-- One RPC for the whole org rather than a per-row read: the Pipeline renders
-- up to 40 rows, and 40 round trips to draw a subtitle is not a subtitle, it
-- is a stall. Returns only rows the org has actually been delivered, so it
-- carries no information about the catalog beyond what the founder already
-- has in their own pipeline.
create or replace function public.catalog_readiness_breakdown(p_org_id uuid)
returns table (
  entity_id uuid,
  catalog_id uuid,
  readiness int,
  people_count int,
  linkedin_count int,
  hook_count int,
  has_form boolean,
  has_email boolean
)
language sql
stable security definer
set search_path = public, pg_temp
as $function$
  select
    d.entity_id,
    c.id,
    c.outreach_readiness,
    (select count(*)::int from public.catalog_person_affiliations pa where pa.entity_id = c.id),
    (select count(*)::int from public.catalog_person_affiliations pa
       join public.catalog_people p on p.id = pa.person_id
      where pa.entity_id = c.id and p.linkedin_url is not null),
    (select count(*)::int from public.catalog_person_affiliations pa
       join public.catalog_people p on p.id = pa.person_id
       join public.catalog_people_research r on r.person_id = p.id
      where pa.entity_id = c.id and coalesce(r.hook, '') <> ''),
    c.submission_channel is not null,
    c.email is not null
  from public.catalog_deliveries d
  join public.catalog_entities c on c.id = d.catalog_id
  where d.org_id = p_org_id
    and d.entity_id is not null
    -- The caller must be in the org. SECURITY DEFINER is needed to read
    -- catalog_people (0147 removed public read after a real PII leak), so the
    -- membership check is what keeps that narrow — and this returns COUNTS,
    -- never a name, an email or a LinkedIn URL.
    and (auth.role() = 'service_role' or public.is_org_member(p_org_id) or public.is_platform_admin());
$function$;

revoke all on function public.catalog_readiness_breakdown(uuid) from public, anon;
grant execute on function public.catalog_readiness_breakdown(uuid) to authenticated, service_role;
