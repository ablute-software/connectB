-- Prompt 919 — ROLLBACK of migration 20261016140000_website_health.sql. NOT to be run unless that migration has to be undone.
--
-- DROPPING THE TABLE DELETES every analysis and every summary recorded in it since the migration. If any of it matters, copy it first:
--   create table public.org_website_audits_919_backup as select * from public.org_website_audits;
-- DROPPING THE COLUMN turns every founder's opt-in ("Show my website health score to investors") back off — which is also exactly what
-- makes the investor side stop showing anything: nothing reads the column once it is gone, and the dossier code treats a missing table
-- or column as "not shared" (it fails closed).
--
-- The metered action: ai_credit_charges.action_key references ai_actions(key) WITHOUT a cascade, so once one summary has been charged
-- the row can no longer be deleted. The script deletes it when nothing was charged yet and otherwise only switches it off.

drop policy if exists org_website_audits_member_read on public.org_website_audits;
drop table if exists public.org_website_audits;

alter table public.orgs drop column if exists website_score_visible;

delete from public.ai_actions a
 where a.key = 'website_summary'
   and not exists (select 1 from public.ai_credit_charges c where c.action_key = 'website_summary');
update public.ai_actions set enabled = false where key = 'website_summary';
