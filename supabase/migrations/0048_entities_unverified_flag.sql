-- Explicit "unverified stub" marker for entities with no proof of their own
-- existence (prompt 42 part 1, point 2). FOR REVIEW ONLY, not applied.
--
-- Deliberately NOT derived purely from field-presence (unlike grantStatus()
-- / benefitStillActive() elsewhere in this repo): a nullable timestamp here
-- can't be replaced by "website/email_domain/phone/address/source_url are
-- all null" — see the comment on entities.unverified_stub_at.
--
-- Nullable timestamp, same idiom as unlocked_at/last_verified elsewhere on
-- this table: NULL = never reviewed as a stub; non-null = reviewed and
-- flagged, "por verificar" badge shows instead of blank dashes.
alter table entities add column unverified_stub_at timestamptz;

comment on column entities.unverified_stub_at is
  'Set when a human reviewer confirms this entity has no proof of its own independent existence (no website/email_domain/phone/address, or a source_url that doesn''t actually document THIS entity specifically) — never inferred automatically. UI shows a "not yet verified" badge instead of blank fields. Cleared (set back to null) once real evidence is found and backfilled.';

-- 2026-07-29 correction (prompt 42 follow-up): Pathena Family Office and
-- COREangels Health Ventures were external-verified and backfilled with
-- real source_url/website/notes instead — they no longer belong here, see
-- the separate data-only update applied alongside this migration. Only 3
-- entities remain genuinely unverifiable, confirmed 2026-07-29: no real
-- proof anywhere, including their imported interactions.content (checked
-- directly, not assumed).
update entities set unverified_stub_at = now()
where id in (
  '42a85764-b9fd-4aaf-a80b-780232df8f10', -- Semilla Impact
  '963c3b07-1377-4d86-9ffb-fe7a08914a25', -- TN Ventures
  '49fc35e3-5dc7-43a0-814e-20be33e807a0'  -- Triggr Ventures (its imported interaction is only a bare date, no URL/contact)
);
