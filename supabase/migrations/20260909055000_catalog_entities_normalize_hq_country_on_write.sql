-- Prompt 627 §2.4, second half — the constraint I added needs something to
-- satisfy it, or it is just a new way to fail.
--
-- The CHECK from 20260909053000 (`hq_country ~ '^[A-Z]{2}$'`) normalises the
-- 230 stored rows and stops the duplicates coming back. What it does NOT do
-- is tell the next writer. And there are several: /api/backoffice/catalog
-- (create), /api/backoffice/catalog/promote, /api/backoffice/submissions/
-- [id]/review, /api/import/structured/commit, AddInvestorModal — all of them
-- pass `hq_country` straight through from a free-text field whose placeholder
-- merely SUGGESTS a code ("Country (e.g. PT)"). An admin typing "Portugal"
-- into that box would, from this morning, get a 23514 and no catalog entity.
-- Adding a constraint without this trigger would have converted a scoring bug
-- into an outage on the create path.
--
-- So the boundary normalises. Same single map, applied where rows enter,
-- which also means the app routes need no change and no future route can
-- forget: patching five call sites would have left the sixth.
--
-- IT REFUSES RATHER THAN DISCARDS. If the value is not a code and not a name
-- the map knows, the row is rejected with the offending value named. Silently
-- writing null would lose what somebody typed and leave them looking at an
-- empty field wondering; and a country we cannot resolve is exactly the case
-- where guessing is worst — it moves a fund's score by up to 8 points on a
-- scale that cuts at 55.

create or replace function public.catalog_entities_normalize_hq_country()
returns trigger language plpgsql set search_path = public as $fn$
declare
  v_norm text;
begin
  if new.hq_country is null or btrim(new.hq_country) = '' then
    new.hq_country := null;
    return new;
  end if;

  v_norm := public.normalize_country_code(new.hq_country);
  if v_norm is null then
    raise exception 'Unrecognised country %. Use an ISO-3166-1 alpha-2 code (PT, DE, GB) or a country name the catalogue knows.', quote_literal(new.hq_country)
      using errcode = 'check_violation';
  end if;

  new.hq_country := v_norm;
  return new;
end $fn$;

drop trigger if exists catalog_entities_normalize_hq_country on public.catalog_entities;
create trigger catalog_entities_normalize_hq_country
  before insert or update of hq_country on public.catalog_entities
  for each row execute function public.catalog_entities_normalize_hq_country();

comment on function public.catalog_entities_normalize_hq_country() is
  'Prompt 627 §2.4 — every write of catalog_entities.hq_country goes through normalize_country_code, so the ISO-2 CHECK is satisfied by construction rather than by each caller remembering. Refuses an unknown country instead of nulling it.';
