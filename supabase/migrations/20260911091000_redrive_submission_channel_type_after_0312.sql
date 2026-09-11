-- Prompt 853 §A — migration 0312 (backfill_catalog_deliveries_missing_contacts,
-- 16:38Z) ran AFTER 0313's corrected derivation (14:47Z) and filled its new
-- rows with the OLD rule (`submission_channel <> '' -> 'form'`), re-introducing
-- the exact defect 0313 fixed: an email address in submission_channel typed as
-- 'form'. Measured today: 10 such rows, and the visible effect is the Next Clue
-- telling an email-only firm to submit through a form that does not exist.
--
-- A backfill that writes a derived column must use the CURRENT derivation. This
-- re-runs 0313's CASE (which mirrors src/lib/catalog-delivery-mapping.ts line
-- for line) over entities, updating only where the stored value is wrong.
-- Idempotent; leaves the deliberate `none` rows (e.g. Redalpine) alone.
-- Verified 2026-09-11: the control query (form-typed rows carrying an address,
-- non-URL) returns 0 after applying.

do $redrive$
declare v_before jsonb; v_after jsonb; v_changed int;
begin
  select jsonb_object_agg(t, n) into v_before
  from (select submission_channel_type::text as t, count(*) n from public.entities group by 1) s;

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
  from (select submission_channel_type::text as t, count(*) n from public.entities group by 1) s;

  raise notice 'redrive after 0312: % row(s) changed; before % after %', v_changed, v_before, v_after;
end;
$redrive$;
