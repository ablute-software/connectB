-- Prompt 737 §0A.4 — the Fase 0 dossier-de-pessoa page (0B.1) needs org
-- members to read catalog_entity_enrichment_sources for a person already
-- delivered to their pipeline. Today only
-- catalog_entity_enrichment_sources_admin_only (FOR ALL, is_platform_admin())
-- exists — no read policy for org members at all, confirmed by querying
-- pg_policies directly before writing this.
--
-- Policy shape decided by risk, not by convenience: the prompt's own
-- earlier proposal branched per PERSON AFFILIATION (any org that has ever
-- been delivered ANY firm this person is affiliated with could read that
-- person's sources) — Nuno flagged this as a real cross-org leak risk (org
-- A delivered firm X could read a person's sources gathered while
-- researching firm Y, if that person also works at Y). Verified against
-- production before deciding:
--   - catalog_entity_enrichment_sources.entity_id is NOT NULL (migration
--     0146) — there is no such thing as a person-only source row.
--   - 3,721 total rows.
--   - 0 rows where person_id's affiliation entity disagrees with entity_id.
--   - 3 people have affiliations across more than one firm (exactly the
--     case the person-branch would have opened up).
-- Given entity_id is always present and always consistent with the row's
-- own affiliation, a per-PERSON branch is both unnecessary (entity_id
-- alone already identifies the right delivery to check) and the one thing
-- that could leak across orgs. Policy below checks catalog_deliveries by
-- entity_id only.
create policy catalog_entity_enrichment_sources_read on public.catalog_entity_enrichment_sources
for select using (
  is_platform_admin()
  or exists (select 1 from public.catalog_deliveries cd
             where cd.catalog_id = catalog_entity_enrichment_sources.entity_id
               and is_org_member(cd.org_id))
);
-- catalog_entity_enrichment_sources_admin_only (FOR ALL) already covers
-- every write path — untouched here.

-- Prompt 737 §0A.4, found while verifying grants before adding the policy
-- above, not asked for by the prompt but fixed in the same migration since
-- it's directly adjacent: `anon` and `authenticated` both held full
-- INSERT/UPDATE/DELETE/SELECT grants on this table at the Postgres ACL
-- level (confirmed via information_schema.role_table_grants) — inconsistent
-- with every sibling table this session has touched (catalog_evidence,
-- hook_suggestions, contact_outcomes, catalog_person_priority), which all
-- explicitly revoke-then-grant-select-only. RLS was already the real
-- enforcement here (admin_only's is_platform_admin() check meant a non-
-- admin anon/authenticated caller could never actually read or write a row
-- despite the grant), so this was not an active leak — but it is exactly
-- the kind of armed-but-inert gap this prompt's own §0A.4 finding about
-- catalog_evidence_read (below) warns against leaving in place. Brought in
-- line with the rest of the schema now that this table gets a real
-- authenticated-facing read policy for the first time.
revoke all on public.catalog_entity_enrichment_sources from anon, authenticated;
grant select on public.catalog_entity_enrichment_sources to authenticated;

-- Prompt 737 §0A.4 — deprecation comments (DDL only, no data touched). The
-- Fase 0 dossier page (0B) stops reading all six of these; Fase 4 is where
-- physical removal happens, not here. `people.hook`/`people.hook_status`
-- keep a different note: that pair is the founder's own private CRM note
-- (org-scoped, composer.ts still reads it, decision 4) — it is not being
-- removed from the founder-facing contact UI at all, only clarified that it
-- never feeds the platform's global priority/recommendation logic.
comment on column public.catalog_people_research.hook is 'DEPRECATED (Fase 0, 25/09/2026): não é facto do dossier nem pré-condição de recomendação/contacto; remoção física só em migração própria da Fase 4.';
comment on column public.catalog_people_research.hook_source is 'DEPRECATED (Fase 0, 25/09/2026): não é facto do dossier nem pré-condição de recomendação/contacto; remoção física só em migração própria da Fase 4.';
comment on column public.catalog_people_research.background is 'DEPRECATED (Fase 0, 25/09/2026): linha manual sem URL não é facto; não é pré-condição de recomendação/contacto; remoção física só em migração própria da Fase 4.';
comment on column public.catalog_people.hook_status is 'DEPRECATED (Fase 0, 25/09/2026): não é facto do dossier nem pré-condição de recomendação/contacto; remoção física só em migração própria da Fase 4.';
comment on column public.people.hook is 'nota privada da org, mantida; não alimenta prioridade global (Fase 0, 25/09/2026).';
comment on column public.people.hook_status is 'nota privada da org, mantida; não alimenta prioridade global (Fase 0, 25/09/2026).';

-- ============================================================
-- PROPOSTA ADICIONAL — NÃO APLICAR sem um "sim" explícito e SEPARADO do
-- Nuno em chat (distinto da autorização já dada para o resto desta
-- migração). Achado, não corrigido: catalog_evidence_read (0344, já
-- verificada byte a byte igual em produção nesta mesma sessão) tem
-- exactamente o ramo por afiliação de pessoa que o Nuno rejeitou para
-- catalog_entity_enrichment_sources acima —
--   "person_id is not null and exists(afiliação → entrega)"
-- — e catalog_evidence.entity_id É nullable (ao contrário de
-- catalog_entity_enrichment_sources.entity_id, que é NOT NULL). Hoje:
-- 0 evidências só-de-pessoa, 4.848 com pessoa+entidade, 0 desencontros,
-- as mesmas 3 pessoas com afiliações múltiplas — o ramo está hoje INERTE
-- (nunca dispara sozinho, porque toda a evidência real também tem
-- entity_id preenchido e o primeiro ramo já a cobre) mas ARMADO: uma
-- futura evidência só-de-pessoa (entity_id null) reabriria exactamente o
-- mesmo risco de fuga entre orgs que motivou a correcção acima.
--
-- alter policy não permite mudar `using` directamente em Postgres; a
-- forma correcta é create or replace policy (ou drop+create, mas isso
-- reabre a lacuna de ACL que o cabeçalho do CLAUDE.md documenta — usar
-- create or replace aqui preserva os grants já corrigidos por esta mesma
-- migração).
--
-- create or replace policy catalog_evidence_read on public.catalog_evidence for select
--   using (
--     is_platform_admin()
--     or (
--       status in ('found', 'verified')
--       and (
--         (entity_id is not null and exists (
--           select 1 from public.catalog_deliveries cd
--           where cd.catalog_id = catalog_evidence.entity_id and is_org_member(cd.org_id)
--         ))
--         or (entity_id is null and person_id is not null and exists (
--           select 1 from public.catalog_person_affiliations cpa
--           join public.catalog_deliveries cd on cd.catalog_id = cpa.entity_id
--           where cpa.person_id = catalog_evidence.person_id and is_org_member(cd.org_id)
--         ))
--       )
--     )
--     or (status = 'quarantined' and created_by_org_id is not null and is_org_member(created_by_org_id))
--   );
