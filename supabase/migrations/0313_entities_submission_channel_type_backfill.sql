-- Prompt 564 §A — the derived channel type stops calling an inbox a form.
--
-- `deriveSubmissionChannelType` returned 'form' for ANY non-empty
-- submission_channel, whatever the value contained. Measured across
-- catalog_entities on 04/09 (86 rows with a value): 5 http(s) URLs, 1
-- `mailto:`, 67 bare email addresses, 6 other values containing an `@`, 7
-- free-text form names. So 81 of 86 firms were typed as a "form" and only 5
-- were one.
--
-- That single wrong word reached the founder three times over: the Next Clue
-- ("submit to X through their form"), the wave-1 first-step task, and the
-- follow-up suggestion after logging a submission — all for firms whose real
-- channel is an address you can simply write to again. In Krohnsty's own
-- six-row pipeline three were mistyped: Superangel
-- (`mailto:10x AT superangel.io`), Portugal Ventures
-- (`contact@portugalventures.pt`) and Shilling VC (`team@shilling.vc`).
--
-- This backfills `entities.submission_channel_type` with the corrected
-- derivation, and touches NOTHING else. `catalog_entities.submission_channel`
-- is not rewritten: the raw text is the record, and the derivation is a
-- reading of it.
--
-- The CASE below mirrors src/lib/catalog-delivery-mapping.ts line for line —
-- URL first, then mailto:, then any address anywhere in the value, then
-- free-text-is-a-form, then the general email, then unknown. If one changes,
-- the other must.
--
-- TWO ROWS ARE DELIBERATELY LEFT ALONE:
--
--   * `submission_channel_type = 'none'`. The enum has four values, not the
--     three the TypeScript type declares, and the one row carrying 'none' is
--     Redalpine on ablute_, entered by hand (`source = 'manual'`) with the
--     note "info@redalpine.com - NO pitch form; they explicitly prefer warm
--     intros". That is a founder's decision about a firm, not a stale
--     derivation, and a backfill that overwrote it would delete a judgement
--     the product has no way to recover. Derivation only ever corrects rows
--     that were derived.
--
-- Expected effect, measured before applying (all on delivered rows):
--     unknown -> email   317   (ablute_; rows that predate the derivation
--                               being applied at all, and do have an email)
--     form    -> email     9   (the actual mislabel this prompt is about)
--     everything else      0
do $backfill$
declare
  v_before jsonb;
  v_after  jsonb;
  v_changed int;
begin
  select jsonb_object_agg(t, n) into v_before
  from (select submission_channel_type::text as t, count(*) as n from public.entities group by 1) s;

  with corrected as (
    select e.id,
      case
        when coalesce(btrim(e.submission_channel), '') <> '' then
          case
            when e.submission_channel ~* '^https?://' then 'form'
            when e.submission_channel ~* '^mailto:'   then 'email'
            when e.submission_channel ~ '[^@[:space:]<>()\[\]{},;:"'']+@[^@[:space:]<>()\[\]{},;:"'']+\.[^@[:space:]<>()\[\]{},;:"'']+' then 'email'
            else 'form'
          end
        when coalesce(btrim(e.email), '') <> '' then 'email'
        else 'unknown'
      end::public.submission_channel_type as want
    from public.entities e
    where e.submission_channel_type is distinct from 'none'::public.submission_channel_type
  )
  update public.entities e
     set submission_channel_type = c.want
    from corrected c
   where c.id = e.id
     and e.submission_channel_type is distinct from c.want;
  get diagnostics v_changed = row_count;

  select jsonb_object_agg(t, n) into v_after
  from (select submission_channel_type::text as t, count(*) as n from public.entities group by 1) s;

  raise notice 'submission_channel_type backfill: % row(s) changed', v_changed;
  raise notice '  before: %', v_before;
  raise notice '  after:  %', v_after;
end;
$backfill$;

-- Prompt 564 §C — the new recurring Next Clue rung needs to be snoozable
-- like the other five kinds. `sherlock_next_snoozes.kind` is a CHECK, not an
-- enum, so this is a constraint swap rather than an ALTER TYPE.
--
-- The list below is the LIVE constraint read back from production
-- (pg_get_constraintdef), plus one value — not the list in 0261, which is
-- already out of date: `cap_table_request` was added after it by a later
-- migration. Rewriting a CHECK from the original migration's text would have
-- silently dropped that value and made every existing cap-table snooze
-- unwritable. A constraint swap has to start from what is actually there.
alter table public.sherlock_next_snoozes drop constraint if exists sherlock_next_snoozes_kind_check;
alter table public.sherlock_next_snoozes add constraint sherlock_next_snoozes_kind_check
  check (kind in (
    'interest_request', 'unclassified_reply', 'follow_up_overdue', 'task_due_today',
    'onboarding_profile', 'onboarding_dataroom', 'onboarding_pipeline', 'onboarding_first_message',
    'ready_to_contact', 'pitch_review', 'readiness_nudge', 'all_clear', 'cap_table_request',
    -- Prompt 564: "who do I approach next", for as long as there is one.
    'next_approach'
  ));
