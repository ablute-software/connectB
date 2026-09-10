-- Prompt 645 §2 — the ledger catches up with the database.
--
-- At 00:05 UTC on 2026-09-10, on Nuno's direct instruction ("cessa o
-- custo, paramos a despesa"), the verification session ran three writes in
-- production: cron.unschedule of enrichment_worker_sweep (*/15, the worker
-- itself), enrichment_cold_seed_sweep (03:20, entities) and
-- enrichment_cold_person_sweep (03:45, people, mixed), and set the four
-- still-queued 638 jobs to 'skipped'. cron.job now holds matchdeal_sla_sweep
-- only. This file records that state so the migration ledger is not behind
-- the database by somebody else's hand; it reschedules NOTHING — 645 §4
-- says how and by whose word anything comes back: 642 §4 in production
-- first (worker v33, live since 00:13 UTC); Layer 2 web stays off; the bio
-- path returns only when Nuno says; Layer 1 on request, not by sweep.
-- Idempotent: unscheduling a job that is already gone is not an error here.
--
-- Also: the 00:00 UTC drain ran three jobs on worker v32, thirteen minutes
-- before v33's positional rules went live, and one of them wrote the 641 §2
-- shape the rules now reject — "Índico Capital Partners, where Sofia Egídio
-- is a key team member, launched Indico Blue Fund…": the fund as subject,
-- the person in a relative clause. Same treatment as Rodrigues and Trigo da
-- Roza (643 §3): hook null, none_found, the text in the audit row.

do $$
declare
  v_name text;
begin
  foreach v_name in array array['enrichment_worker_sweep', 'enrichment_cold_seed_sweep', 'enrichment_cold_person_sweep', 'enrichment_cold_person_bio_sweep'] loop
    if exists (select 1 from cron.job where jobname = v_name) then
      perform cron.unschedule(v_name);
    end if;
  end loop;
  insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
  values (null, 'enrichment_crons_unscheduled', 'cron', null,
          jsonb_build_object('prompt', 645, 'on', 'Nuno''s instruction 2026-09-10 00:0x UTC: cessa o custo, paramos a despesa',
                             'jobs', jsonb_build_array('enrichment_worker_sweep', 'enrichment_cold_seed_sweep', 'enrichment_cold_person_sweep'),
                             'remaining', (select coalesce(jsonb_agg(jobname), '[]'::jsonb) from cron.job)));
end $$;

update public.catalog_people_research r
   set hook = null, hook_source = null, updated_at = now()
  from public.catalog_people p
 where p.id = r.person_id and p.full_name = 'Sofia Egídio' and r.hook_source = 'web'
   and r.hook ilike '%ndico Capital Partners, where Sofia Eg%';

update public.catalog_people p
   set hook_status = 'none_found', updated_at = now()
 where p.full_name = 'Sofia Egídio'
   and not exists (select 1 from public.catalog_people_research r where r.person_id = p.id and coalesce(btrim(r.hook), '') <> '');

insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
select null, 'hook_about_fund_not_person', 'catalog_person', p.id,
       jsonb_build_object('path', 'manual', 'rule', 'starts_with_entity', 'entity_mention', 'indico capital partners',
                          'hook', 'Índico Capital Partners, where Sofia Egídio is a key team member, launched Indico Blue Fund…',
                          'note', 'Prompt 645 / 641 §2 — written by v32 at 00:00 UTC, thirteen minutes before v33; cleaned the 643 §3 way')
  from public.catalog_people p
 where p.full_name = 'Sofia Egídio' and p.hook_status = 'none_found';
