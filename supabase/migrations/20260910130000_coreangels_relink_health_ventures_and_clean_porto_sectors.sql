-- Prompt 883 — COREangels is 12 distinct funds; the catalogue knew only 2,
-- and the older of the two absorbed the others' names.
--
-- coreangels.com lists 12 separate funds (Porto, Health Ventures, SportsTech,
-- Food, Big Data & AI, Lisbon, Barcelona, Madrid, Atlantic, Pacific, MEA,
-- CyberDefense), each its own page. The catalogue has two rows: the 27 Jul
-- "COREangels Porto" (d7b237d7), whose sectors array absorbed four sibling
-- FUND names — "Health Ventures", "Big Data & AI", "SportsTech", "Food" — as
-- if they were Porto's sectors; and the 1 Sep "COREangels Health Ventures"
-- (ef5aa1aa), correct and verified (25 people, 21 with LinkedIn).
--
-- When only the Porto row existed (27 Jul), ablute_'s two entities — created
-- 21 Jul, before any catalogue row — were both linked to it, including the
-- "COREangels Health Ventures" one that had no better option then. The
-- correct Health Ventures row arrived 1 Sep and nothing relinked the old
-- pointer. Verified in production 2026-09-10: ONLY ablute_ has this, and it
-- is exactly one entity (ea4b68f1) pointing at the wrong row.
--
-- Two fixes, both guarded to be idempotent and to touch nothing else.

-- 1) Relink ablute_'s "COREangels Health Ventures" entity to the correct,
-- verified catalogue row. entities.catalog_id only; interactions, tasks and
-- deal history hang off entity_id, not catalog_id, so no relationship data
-- moves. Guarded on the current (wrong) catalog_id so a replay is a no-op.
update public.entities
   set catalog_id = 'ef5aa1aa-8a51-4791-afb2-edda0a3ec127'
 where id = 'ea4b68f1-35d2-420b-a029-528d9c80ca70'
   and catalog_id = 'd7b237d7-b027-4164-b5ca-72bd530dd131';

-- 2) Clean the Porto catalogue row's sectors: drop the four sibling FUND
-- names the old import folded in, keep whatever real sectors remain (just
-- "Multi-sector" — Porto is the regional/generalist chapter). Fires only
-- while the residue is present, so a replay is a no-op.
update public.catalog_entities
   set sectors = array(
     select s from unnest(sectors) as s
     where s not in ('Health Ventures', 'Big Data & AI', 'SportsTech', 'Food')
   )
 where id = 'd7b237d7-b027-4164-b5ca-72bd530dd131'
   and sectors && array['Health Ventures', 'Big Data & AI', 'SportsTech', 'Food'];

-- Not done here, by the prompt's own framing: creating catalogue rows for the
-- other uncovered funds (SportsTech, Food, Big Data & AI, and the seven not
-- listed at all) is new data, not a fix, and is Nuno's call — flagged, not
-- built. The broader "does this old-import-merges-a-network pattern hit other
-- angel networks" question is left open for the same reason.
