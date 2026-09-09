-- Prompt 634 §5.2 — the retroactive run of the net over every text field in
-- catalog_people_research (21 backgrounds, plus hooks, intro paths and
-- watch-outs) rejects exactly ONE field: Jan-Hendrik Bürk's watch_outs, which
-- reads "…(tennis career, family background, diabetes diagnosis) appear
-- designed to create personal connection…". The prompt asked to keep the
-- watch_outs because the sentence is the model correctly naming the problem
-- — but it names the diagnosis while doing so, and the net the prompt asked
-- for flags it. Consistency wins: a field the deployed guard would reject is
-- not kept by hand. Nothing else in the table trips the net; 634 expected "1,
-- at most 2", and 1 is what it is.

update public.catalog_people_research
   set watch_outs = null, updated_at = now()
 where person_id = '2183c484-4256-4b9a-8f8e-9c0b8edf807e'
   and coalesce(watch_outs, '') ilike '%diabetes diagnosis%';

insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
values (null, 'special_category_field_rejected', 'catalog_person', '2183c484-4256-4b9a-8f8e-9c0b8edf807e',
        jsonb_build_object('path', 'manual', 'field', 'watch_outs', 'term', 'diagnos', 'marker', 'personal',
                           'note', 'Prompt 634 §5.2 retro run: the only field in the table the net rejects'));
