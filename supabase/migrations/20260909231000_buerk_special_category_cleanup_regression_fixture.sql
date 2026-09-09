-- Prompt 634 §3.4 — one row of data, and from now on the regression fixture
-- for §3.1 (the Article 9 net) and §3.3 (hook vs its own kill words).
--
-- Jan-Hendrik Bürk, b2venture: the first web-path run ever (Prompt 630's
-- controls) wrote "Born with diabetes, which he described as motivation to
-- prove himself." as the opening sentence of his background — a health
-- condition of an identified person in a catalogue whose lawful basis is
-- legitimate interest. And the hook "…became partner in 2021 at age 28, one
-- of the youngest VC partners ever" contains "youngest partners ever", which
-- the SAME response listed as a phrase that makes him disengage, and fails
-- the hook's own rule (b): 2021 is not current.
--
-- background: removed. hook: removed and the person marked none_found — not
-- to_research, because the research DID run; it simply produced nothing
-- usable, which is what none_found means. intro_path, watch_outs and
-- kill_words stay: the watch_outs sentence ("Biographical details…
-- diabetes diagnosis… should be distinguished from investment thesis") is
-- clean and is the model correctly describing the problem it then caused.
-- The audit row below is what makes this reproducible; the prompt's own
-- expectation is that re-running him under the guarded worker yields the
-- same shape.

update public.catalog_people_research
   set background = null,
       hook = null,
       hook_source = null,
       updated_at = now()
 where person_id = '2183c484-4256-4b9a-8f8e-9c0b8edf807e'
   and coalesce(background, '') ilike '%born with diabetes%';

update public.catalog_people
   set hook_status = 'none_found'
 where id = '2183c484-4256-4b9a-8f8e-9c0b8edf807e';

insert into public.admin_audit_log (admin_user_id, action, subject_type, subject_id, detail)
values (null, 'special_category_field_rejected', 'catalog_person', '2183c484-4256-4b9a-8f8e-9c0b8edf807e',
        jsonb_build_object('path', 'manual', 'field', 'background', 'term', 'diabet', 'marker', 'born with',
                           'note', 'Prompt 634 §3.4 — first web-path run; cleaned by hand, guard added in the worker')),
       (null, 'hook_contains_kill_word', 'catalog_person', '2183c484-4256-4b9a-8f8e-9c0b8edf807e',
        jsonb_build_object('path', 'manual', 'kill_word', 'youngest partners ever',
                           'note', 'Prompt 634 §3.4 — hook contained its own kill word and failed rule (b); set none_found'));
