-- Prompt 536 §5 — repair the accounting the client-side unlockPack lost.
--
-- unlockPack fired three persist() inserts in parallel (entities,
-- pack_unlocks, catalog_deliveries). catalog_deliveries.entity_id
-- references entities.id, so the deliveries insert raced its own foreign
-- key. Production, 2026-09-02 13:22:56.577, org Krohnsty
-- (54f1bf67-66a3-4c60-8e1b-9ec39ea2c0dd):
--
--   violates foreign key constraint catalog_deliveries_entity_id_fkey
--
-- persist() only console.error's, so nothing surfaced. Three investors
-- appeared in the founder's pipeline and zero delivery rows were written.
--
-- WHY THAT MATTERS BEYOND TIDINESS: catalog_top_matches() excludes catalog
-- entities that already have a catalog_deliveries row for the org. With the
-- rows missing, the next delivery would re-offer the same three investors,
-- spend three slots of quota on them, and drop them again on the
-- name-collision guard — the founder would pay for three and receive none.
-- So this backfill is a precondition for the top-up in §3 working at all,
-- not a cosmetic reconciliation.
--
-- MEASURED SCOPE, before this migration (the whole database, not a sample):
--   Krohnsty                 3 catalog entities, 0 deliveries   <- the only gap
--   Estojo                  13 catalog entities, 13 deliveries
--   New company (rename...) 10 catalog entities, 10 deliveries
--   every other org          0 catalog entities,  0 deliveries
-- Two orgs delivered by the monthly cron are intact, which is consistent
-- with the diagnosis: the cron always awaited its inserts in order, so only
-- the client-side path could lose rows. The prompt expected more affected
-- orgs; there is exactly one, and the query below is written to fix whatever
-- the set actually is rather than to name it.
--
-- Idempotent by construction: matched on the entity having no delivery row,
-- and guarded against the unique(org_id, catalog_id) pair, so replaying this
-- migration is a no-op. quota_exempt = false because these deliveries did
-- spend the founder's quota — that is the fact being restored.
insert into catalog_deliveries (org_id, catalog_id, entity_id, via_pack, quota_exempt, delivered_at)
select e.org_id, ce.id, e.id,
       (select p.pack_id from pack_unlocks p where p.org_id = e.org_id order by p.unlocked_at limit 1),
       false,
       e.created_at
from entities e
join catalog_entities ce on lower(ce.name) = lower(e.name)
where e.source = 'catalog'
  and not exists (
    select 1 from catalog_deliveries d where d.org_id = e.org_id and d.entity_id = e.id
  )
  and not exists (
    select 1 from catalog_deliveries d where d.org_id = e.org_id and d.catalog_id = ce.id
  );
