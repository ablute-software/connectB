-- Prompt 918 — ROLLBACK of migration 20261015130000_company_badges_public_source.sql. NOT to be run unless that migration has to be undone.
--
-- Order: the triggers and their function first (they read the new columns), then the CHECKs, then the metered action, then the columns.
--
-- DROPPING THE COLUMNS DELETES what was recorded in them after the migration: the source links, the titles and logos Sherlock found, the
-- kinds, and who found each source. If any of it matters, copy it first:
--   create table public.company_badges_918_backup as
--     select id, kind, source_url, source_title, source_found_by, logo_url, updated_at from public.company_badges;
--
-- The metered action: ai_credit_charges.action_key references ai_actions(key) WITHOUT a cascade, so once one verification has been charged the
-- row can no longer be deleted. The script deletes it when nothing was charged yet and otherwise only switches it off (the route then
-- answers "not available" instead of charging).
--
-- The backfill's one row is put back as production had it on 15/10/2026 before the migration (the statement is guarded: it touches the row
-- only while it is still exactly as the backfill left it, so a verification made since is never overwritten):
--   id 2cf54c37-8e9b-4aeb-b817-ab77288dccc2 · Mob2is / "Altice Innovation Awards" (2023) · verification_status 'verified'
--   verified_at '2026-10-14 10:51:46.58+00' · verification_note 'Confirmed: Mobiis was a finalist in the Inclui category of the 2023 Altice
--   International Innovation Award, presented by David Verde. Multiple credible sources verify this claim.'
-- That note says "finalist", which is exactly why the new rule does not accept it as a confirmation of the award.

drop trigger if exists company_badges_protect_verification on public.company_badges;
drop trigger if exists company_badges_touch on public.company_badges;
drop function if exists public.company_badges_protect_verification();

alter table public.company_badges drop constraint if exists company_badges_verified_has_source_check;
alter table public.company_badges drop constraint if exists company_badges_source_lengths_check;
alter table public.company_badges drop constraint if exists company_badges_source_found_by_check;
alter table public.company_badges drop constraint if exists company_badges_kind_check;

-- put the demoted row back BEFORE the columns go (it reads verification_note / verified_at, which stay; the guard on the source column is gone)
update public.company_badges
   set verification_status = 'verified',
       verified_at = '2026-10-14 10:51:46.58+00',
       verification_note = 'Confirmed: Mobiis was a finalist in the Inclui category of the 2023 Altice International Innovation Award, presented by David Verde. Multiple credible sources verify this claim.'
 where id = '2cf54c37-8e9b-4aeb-b817-ab77288dccc2'
   and verification_status = 'unverified'
   and verification_note = 'Re-verify to attach a public source';

delete from public.ai_actions a
 where a.key = 'badge_verification'
   and not exists (select 1 from public.ai_credit_charges c where c.action_key = 'badge_verification');
update public.ai_actions set enabled = false where key = 'badge_verification';

alter table public.company_badges
  drop column if exists source_url,
  drop column if exists source_title,
  drop column if exists source_found_by,
  drop column if exists logo_url,
  drop column if exists kind,
  drop column if exists updated_at;
