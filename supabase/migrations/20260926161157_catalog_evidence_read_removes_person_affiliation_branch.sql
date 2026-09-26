-- RECUPERADA por introspecção directa de produção (supabase_migrations.schema_migrations.statements),
-- 2026-09-26, por uma sessão diferente da que assina este ficheiro. Aplicada em
-- produção às 16:11 UTC de 2026-09-26 por uma sessão a trabalhar no "Passo 3"
-- do dossier de pessoa (importação do showcase da Portugal Ventures), que não
-- tinha permissão de git push — por isso nunca chegou a um branch até agora.
-- SUPERSEDIDA às 19:25 do mesmo dia pela migração seguinte
-- (catalog_evidence_read_entity_scoped), aplicada por esta sessão (Prompt 737)
-- com uma decisão diferente sobre o ramo entity_id IS NULL — ver essa migração
-- e DECISIONS.md para o porquê. Mantida aqui, inalterada, como registo
-- histórico exacto do que esteve vivo entre as 16:11 e as 19:25 — nunca editar
-- um ficheiro já aplicado.
--
-- Fixes the same cross-entity RLS shape already corrected for
-- catalog_entity_enrichment_sources_read (migration 20260925151126) but left
-- unapplied on catalog_evidence_read (0344), pending a separate "sim" from
-- Nuno per that migration's own DECISIONS.md entry. Confirmed live 2026-09-26:
-- 39 people hold >1 current affiliation, 41 catalog_evidence rows on those
-- people all carry entity_id (0 rows are entity_id IS NULL among them), and a
-- concrete real-data proof (Pedro Bandeira, real orgs Estojo/Krohnsty,
-- zero synthetic data, all inside BEGIN/ROLLBACK) showed 35 evidence rows
-- scoped to "Investors Portugal" readable by orgs delivered only to
-- "COREangels Porto" via his shared affiliation — a live leak, not a
-- hypothetical one.
--
-- New rule: if catalog_evidence.entity_id is set, access depends solely on
-- delivery of that exact entity. A person's affiliation to another firm
-- never grants indirect access. Person-level evidence with entity_id IS NULL
-- gets NO implicit affiliation-based access here — today there are 0 such
-- rows (confirmed), so this is safe for the model that actually exists; a
-- future person-level sharing case needs its own explicit authorization
-- model, not an implicit one reinstated here.
alter policy catalog_evidence_read on catalog_evidence
using (
  is_platform_admin()
  or (
    status in ('found', 'verified')
    and entity_id is not null
    and exists (
      select 1 from catalog_deliveries cd
      where cd.catalog_id = catalog_evidence.entity_id
        and is_org_member(cd.org_id)
    )
  )
  or (
    status = 'quarantined'
    and created_by_org_id is not null
    and is_org_member(created_by_org_id)
  )
);
