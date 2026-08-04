-- PROPOSED, NOT APPLIED. Extends migration 0098's orgs -> matchdeal_profiles
-- sync trigger (which only ever covered sectors/country) to the rest of the
-- fields matchdeal_recompute_profile_completeness() (migration 0105) checks
-- for kind='startup': photo_url, website, description, investment_stage_sought,
-- company_phase.
--
-- Why this exists: found live via Prompt 120 acceptance testing against
-- production. Caramel Biscuit's Company tab (orgs) is fully filled in —
-- one_liner, sectors, country, stage, logo_url, website all set — but its
-- matchdeal_profiles row (kind='startup') was completely empty, so
-- is_complete/is_visible were both false and it could never appear in any
-- investor's Pipeline (Prompt 120 Block A) or MatchDeal deck, no matter how
-- long anyone waited. The Company tab and the MatchDeal Profile tab
-- (src/components/matchdeal/ProfilePanel.tsx) are two separate forms
-- writing to two separate tables, and only sectors/country were ever wired
-- to flow from one to the other.
--
-- Two mapping decisions here are NOT mechanical and need your sign-off
-- before this is applied:
--
--   1. current_phase (orgs, free text) -> company_phase (matchdeal_profiles,
--      checked against 'concept'/'prototype'/'pilot'/'launch'/'growth').
--      Sherlock Deal's own Company tab already writes 'concept' (not
--      'concept_idea' — the one place these appeared to differ was Caramel
--      Biscuit's row, which reads 'concept_idea', likely a value from
--      before the current_phase options were finalized). This trigger
--      copies the value through as-is; a legacy/mismatched value on an
--      existing org would fail matchdeal_profiles' own check constraint on
--      write and this trigger would then need an explicit mapping — I did
--      not invent one blindly since I don't know every legacy value that
--      might exist across all orgs.
--
--   2. stage (orgs enum: pre_seed/seed/series_a/later/other/series_b/
--      series_c_plus) -> investment_stage_sought (matchdeal_profiles,
--      checked against pre_seed/seed/series_a/series_b_plus/growth) is NOT
--      a 1:1 domain match. Proposed mapping below (series_b/series_c_plus/
--      later -> series_b_plus, other -> left unmapped/null) is a
--      reasonable default, not a confirmed product decision — please
--      confirm or correct before this migration is applied.
--
-- photo_url<-logo_url, website<-website, description<-description have no
-- such ambiguity (same meaning, compatible types) and are safe as written.

create or replace function public.orgs_sync_matchdeal_profile_fields()
returns trigger
language plpgsql
as $function$
declare
  v_mapped_stage text;
begin
  if new.stage is distinct from old.stage then
    v_mapped_stage := case new.stage::text
      when 'pre_seed' then 'pre_seed'
      when 'seed' then 'seed'
      when 'series_a' then 'series_a'
      when 'series_b' then 'series_b_plus'
      when 'series_c_plus' then 'series_b_plus'
      when 'later' then 'series_b_plus'
      else null -- 'other', or any future value not covered above
    end;
  end if;

  if (new.logo_url is distinct from old.logo_url)
     or (new.website is distinct from old.website)
     or (new.description is distinct from old.description)
     or (new.stage is distinct from old.stage)
     or (new.current_phase is distinct from old.current_phase) then
    update public.matchdeal_profiles
      set photo_url = coalesce(new.logo_url, photo_url),
          website = coalesce(new.website, website),
          description = coalesce(new.description, description),
          investment_stage_sought = coalesce(v_mapped_stage, investment_stage_sought),
          company_phase = coalesce(new.current_phase, company_phase),
          updated_at = now()
      where membership_id = new.id and kind = 'startup';
  end if;
  return new;
end;
$function$;

create trigger orgs_sync_matchdeal_profile_fields
after update on public.orgs
for each row execute function public.orgs_sync_matchdeal_profile_fields();

-- Deliberately NOT backfilling existing orgs here (e.g. Caramel Biscuit) —
-- this trigger only fires on future UPDATEs. A one-time backfill UPDATE for
-- currently-affected orgs is a separate, explicit statement to run
-- alongside applying this migration, not bundled into the DDL itself.
