-- Structural protection against zero-evidence entities (prompt 42 part 1,
-- point 3). FOR REVIEW ONLY, not applied — and depends on 0048 already
-- having run (references unverified_stub_at, added there).
--
-- Why these 5 columns and not more: they're the ones that can prove an
-- entity's own independent existence — a website, an email domain, a phone,
-- a postal address, or a source_url documenting where the name came from.
-- key_people/aum/thesis etc. are deliberately NOT included: a thesis can be
-- inferred/guessed (see Pathena Family Office), and none of those fields
-- alone proves the entity is real rather than a name typed into a form.
--
-- `or unverified_stub_at is not null` is the one exemption, and it's
-- narrow: it lets the 3 rows 0048 flags with genuinely zero evidence
-- (Semilla Impact, TN Ventures, Triggr Ventures) keep existing, openly
-- marked, instead of forcing this migration to fabricate a fake website
-- just to satisfy the constraint. Pathena Family Office and COREangels
-- Health Ventures don't need this exemption — both now have a real
-- source_url (COREangels also a website), backfilled from external
-- verification alongside 0048, so they satisfy the constraint on the
-- merits, same as any other real entity. It is NOT a loophole for new
-- entities —
-- unverified_stub_at is "set by human review only, never inferred" (see
-- 0048's own comment) and nothing in the app lets a founder set it at
-- creation time; a brand-new manual/bulk-paste/enrichment entity still
-- needs real evidence to be insertable at all.
--
-- Applies to INSERT and UPDATE (a normal CHECK constraint, not NOT VALID —
-- deliberately not grandfathering anything in silently once this runs;
-- every existing violator must be resolved first via 0048, not exempted
-- wholesale).
alter table entities add constraint entities_has_identity_evidence check (
  website is not null
  or email_domain is not null
  or phone is not null
  or address is not null
  or source_url is not null
  or unverified_stub_at is not null
);
