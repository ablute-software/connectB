-- "Correction" path for contributions (see DECISIONS.md) — lets a
-- contribution explicitly marked as a correction overwrite a field the
-- subject already holds (website rebrands/stale-domain fixes and similar),
-- distinct from the normal fill-empty-field flow which must never overwrite
-- an existing value. Default 'fill' means every existing row and every
-- future normal proposal is unaffected — only a contribution explicitly
-- inserted with kind='correction' can ever take the overwrite path
-- (enforced in contribution-promotion.ts, not just here).
create type contribution_kind as enum ('fill', 'correction');
alter table contributions add column if not exists kind contribution_kind not null default 'fill';

-- A correction must always carry its source — reviewing "trust me, change
-- this" with no link is exactly what this whole system exists to prevent.
alter table contributions add constraint contributions_correction_requires_source_url
  check (kind <> 'correction' or source_url is not null);
