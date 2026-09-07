-- Prompt 605 §A — suggestions reuse support_tickets rather than getting a
-- table of their own. The ticket machine around that table (events history,
-- attachment malware scans, IP rate limit) already exists and is exactly
-- what a suggestion needs; a parallel table would have had to grow all of
-- it again. "Treated separately" (Nuno) is a VIEW problem, not a storage
-- problem — /backoffice/suggestions is a different query over the same rows,
-- and /backoffice/support now excludes them.
--
-- Additive and reversible: two widened CHECKs, three new nullable columns,
-- one partial index. Nothing existing changes meaning.

-- 1. The new category. Every other value is carried over byte-for-byte from
--    the constraint currently in production (verified before writing this).
alter table public.support_tickets drop constraint if exists support_tickets_category_check;
alter table public.support_tickets add constraint support_tickets_category_check
  check (category = any (array[
    'question'::text, 'problem'::text, 'billing'::text, 'data_correction'::text,
    'claim_profile'::text, 'network_content_report'::text, 'other'::text,
    'suggestion'::text
  ]));

-- 2. The new source. §A asks for a source of its own so a suggestion raised
--    from the floating widget is distinguishable from anything that arrives
--    through Help & Support, which shares the same table and the same route.
alter table public.support_tickets drop constraint if exists support_tickets_source_check;
alter table public.support_tickets add constraint support_tickets_source_check
  check (source = any (array[
    'landing'::text, 'landing_investors'::text, 'founder_app'::text,
    'investor_portal'::text, 'suspended'::text, 'blocked'::text,
    'feedback_widget'::text
  ]));

-- 3. §E — "um estado próprio do ciclo de uma ideia, que não é o de um
--    problema". Deliberately NOT more values on `status`: a problem's five
--    states and an idea's four mean different things, and an operator
--    reading one queue should never have to know the other's vocabulary.
--    Null on every non-suggestion row, which is also how the two queues
--    stay honestly separable if the category filter is ever got wrong.
alter table public.support_tickets add column if not exists suggestion_status text
  check (suggestion_status is null or suggestion_status = any (array[
    'received'::text, 'under_review'::text, 'accepted'::text, 'declined'::text
  ]));

-- §E — "uma sugestão aceite tem de poder apontar para o que originou.
-- Sem isso, a fila enche-se e ninguém sabe se serviu para alguma coisa — e
-- quem sugeriu percebe." The note is what was done; the link is where it
-- landed (a commit, a prompt, a changelog entry). Both free-form on purpose:
-- there is no internal entity worth constraining this to yet.
alter table public.support_tickets add column if not exists suggestion_outcome text;
alter table public.support_tickets add column if not exists suggestion_outcome_url text;

-- The suggestions queue always filters on this one value; the problem queue
-- always excludes it. A partial index serves both directions and costs
-- nothing on a table of this size.
create index if not exists support_tickets_suggestion_idx
  on public.support_tickets (created_at desc)
  where category = 'suggestion';
