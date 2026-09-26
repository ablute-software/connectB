-- Prompt 737, follow-up (26/09/2026, Nuno's "sim") — closes the finding
-- flagged in 0A.4 (migration 20260925151126) and left commented out there
-- deliberately: catalog_evidence_read's person-affiliation branch let an
-- org with entity A delivered read a shared person's evidence tied to a
-- DIFFERENT entity B, as long as that person is affiliated to both — the
-- exact cross-org leak Nuno rejected for catalog_entity_enrichment_sources_read.
--
-- Verified before writing this (2026-09-25/26): entity_id IS nullable on
-- catalog_evidence (unlike catalog_entity_enrichment_sources.entity_id,
-- which is NOT NULL) — so evidence genuinely about a person in general,
-- with no specific firm attached, is a real case this policy must still
-- serve. The fix: the person-affiliation branch only ever applies when
-- entity_id IS NULL; evidence with an entity_id is gated by that entity's
-- own delivery, never by the person's other affiliations.
--
-- Uses ALTER POLICY, not CREATE OR REPLACE POLICY — the latter is not
-- valid PostgreSQL syntax (confirmed against production, which runs
-- 17.6); the 0A.4 migration's own commented-out draft used it and was
-- therefore never applicable as written. ALTER POLICY changes the USING
-- expression directly, without dropping the policy or touching its
-- grants (already verified: anon has no grants on catalog_evidence,
-- authenticated has exactly SELECT — unaffected by this change).
--
-- Supersedes 20260926161157_catalog_evidence_read_removes_person_affiliation_branch
-- (applied 16:11 UTC the same day, by a different session working the "Passo
-- 3" dossier-de-pessoa showcase import, which had no git-push access and so
-- never got a file until this session reconstructed it). That migration
-- closed the same leak by dropping the person-affiliation branch entirely
-- (0 entity_id-IS-NULL rows existed at the time, so it was safe for the data
-- then). This migration, applied 19:25 UTC after Nuno's explicit "sim" in
-- this session, reinstates that branch scoped to entity_id IS NULL only —
-- his own design from resposta_737_0A_revisao_e_catalog_evidence_read_20260926.md
-- — so future person-level-only evidence (still 0 rows today) has a defined
-- access rule instead of none. Confirmed with Nuno directly: this version is
-- the one to keep.
alter policy catalog_evidence_read on public.catalog_evidence
  using (
    is_platform_admin()
    or (
      status in ('found', 'verified')
      and (
        (entity_id is not null and exists (
          select 1 from public.catalog_deliveries cd
          where cd.catalog_id = catalog_evidence.entity_id and is_org_member(cd.org_id)
        ))
        or (entity_id is null and person_id is not null and exists (
          select 1 from public.catalog_person_affiliations cpa
          join public.catalog_deliveries cd on cd.catalog_id = cpa.entity_id
          where cpa.person_id = catalog_evidence.person_id and is_org_member(cd.org_id)
        ))
      )
    )
    or (status = 'quarantined' and created_by_org_id is not null and is_org_member(created_by_org_id))
  );
