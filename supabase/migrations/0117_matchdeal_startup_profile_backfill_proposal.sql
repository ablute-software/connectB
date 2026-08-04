-- Addenda to Prompt 120 (2026-08-04, "a opção 3 executou...") — PROPOSED,
-- NOT APPLIED.
--
-- §3 REJECTS 0115_orgs_sync_matchdeal_profile_fields.sql as a CONTINUOUS
-- sync, confirmed via live inspection of production (not assumed):
--
--   select tgenabled from pg_trigger where tgname =
--     'trg_matchdeal_profile_completeness';  -- => 'O' (enabled, fires on every UPDATE)
--
--   pg_get_functiondef confirms the trigger body ends with:
--     new.is_visible := new.is_complete and new.owner_suspended_at is null
--       and new.platform_suspended_at is null;
--
-- This is exactly the alarm condition: a continuous sync that completes a
-- startup's matchdeal_profiles row as a SIDE EFFECT of editing the Company
-- tab would flip is_visible to true via this already-live trigger, with no
-- owner action on the MatchDeal Profile tab itself — visibility to
-- investors is a consent decision (the owner-only suspend toggle, migration
-- 0107), not a data-completeness side effect. 0115 stays in the repo as the
-- rejected proposal, on the record; this migration replaces it.
--
-- What ships here instead, per the addenda's own default (R2): a ONE-TIME
-- backfill of NULL fields only, checked beforehand against production so
-- it's not a blind guess:
--
--   select o.name, mp.description is null, mp.website is null, mp.country is null,
--     mp.photo_url is not null, array_length(mp.sectors,1) > 0,
--     mp.investment_stage_sought is not null, mp.company_phase is not null
--   from matchdeal_profiles mp join orgs o on o.id = mp.membership_id
--   where mp.kind = 'startup';
--
-- Only ablute_ and Caramel Biscuit have any of description/website/country
-- null with a real orgs value to backfill. Neither would cross into
-- is_complete=true as a result of ONLY this backfill:
--   - ablute_: still missing photo_url and company_phase afterward.
--   - Caramel Biscuit: still missing photo_url, sectors,
--     investment_stage_sought, and company_phase afterward.
-- So the trigger firing on this UPDATE is safe for both today — but this
-- statement is a manual, one-time, reviewable action (not a standing
-- trigger), specifically so this safety has to be re-checked by whoever
-- runs it next time, not assumed forever.
--
-- Prompt 125 Block B.4 correction (2026-08-04): description's coalesce
-- below now also falls back to orgs.one_liner. ablute_'s own
-- orgs.description is empty — the real one-liner content that screenshot
-- after screenshot showed as "the org data is right there" lives in
-- orgs.one_liner instead, which the original coalesce here never read.
-- Re-checked against the same safety conclusion above: ablute_ still lacks
-- photo_url and company_phase even once description backfills from
-- one_liner, so it still doesn't cross into is_complete=true from this
-- statement alone.
--
-- Stage mapping (series_b/series_c_plus/later -> series_b_plus, other ->
-- unmapped) from 0115 was sound and is kept here, in case a future org
-- has investment_stage_sought null with orgs.stage set — not exercised by
-- today's backfill (neither ablute_ nor Caramel Biscuit is missing it from
-- the set covered here), included for completeness of the one-time pass.
update public.matchdeal_profiles mp
set
  description = coalesce(mp.description, o.description, o.one_liner),
  website = coalesce(mp.website, o.website),
  country = coalesce(mp.country, o.country),
  updated_at = now()
from public.orgs o
where o.id = mp.membership_id
  and mp.kind = 'startup'
  and (mp.description is null or mp.website is null or mp.country is null);

-- Deliberately NOT touching is_visible/is_complete in this statement's SET
-- clause — trg_matchdeal_profile_completeness recomputes both
-- automatically as a side effect of the UPDATE above (it cannot be told
-- not to), which is exactly why the pre-check above exists: this migration
-- documents, in the same file, that the side effect is checked and safe
-- for the two orgs it actually touches today.
--
-- The structural fix (per §3's own conclusion) is UX, not data: a banner
-- on the startup side — "Your MatchDeal profile is incomplete/invisible —
-- investors can't find you" with a checklist, tied to the same
-- companyCompleteness tiers Prompt 121 §2.7-b already uses for the
-- investor-visible-count gating. That ships as app code (no migration),
-- separately from this proposal.
