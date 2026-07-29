-- @ablute.pt domain access (prompt 43), part 2: any founder's workspace,
-- read-only, for QA/support. FOR REVIEW ONLY, not applied — depends on
-- 0050 (is_ablute_developer()) already having run.
--
-- Unlike part 1 (backoffice), this one genuinely doesn't exist today:
-- provision-org only ever joins a confirmed @ablute.pt signup to ablute_'s
-- OWN org (org_members row there) — it gives full founder access to that
-- one org, never visibility into any other customer's. Requirement #2
-- ("não só a sua própria [org]") needs a real new grant.
--
-- Design choice, using the discretion the prompt explicitly gave
-- ("decide tu qual a forma mais limpa"): 37 policies across 30 tables
-- reference is_org_member(org_id) today, and most of them are single
-- combined `for all` policies (one policy governs select+insert+update+
-- delete together). The prompt's own example syntax
-- ("is_org_member(org_id) OR is_ablute_developer() nas SELECT policies
-- relevantes") explicitly scopes this to SELECT only — support/QA needs to
-- SEE another founder's workspace, nothing here asks for @ablute.pt to be
-- able to edit/delete another org's data. Editing those `for all` policies
-- to inject the OR would grant that write access too, well past what was
-- asked. Instead: one brand-new, purely ADDITIVE `for select` policy per
-- table, using `is_ablute_developer()` alone (no org_id argument needed —
-- the grant is intentionally "any org", per requirement #2). This never
-- touches a single existing policy's text — zero risk of a typo breaking
-- today's founder-facing write permissions, and trivial to audit (`grep
-- ablute_qa_read`) or revert (drop these specific policies) independently
-- of everything else.
--
-- entity_aliases is deliberately excluded from this list: its existing
-- policy is gated via a join through entities.org_id, not a bare org_id
-- column, and it's a minor internal dedup table, not founder-workspace
-- data a support conversation would ever need to inspect directly. Add it
-- later if that assumption turns out wrong.
--
-- Note on `entities` specifically: this policy is a SEPARATE grant from
-- entities_select's existing catalog-quota visibility logic (0042). A
-- SELECT is allowed if ANY applicable policy passes, so an @ablute.pt
-- account will see every entity in every org, INCLUDING catalog rows a
-- founder's own plan quota would otherwise block. That's intentional for
-- support (seeing the full pipeline to help debug it) but flagged
-- explicitly since it's a real, if narrow, expansion of what "QA read
-- access" touches — say if you'd rather catalog-quota-blocked rows stay
-- hidden even from @ablute.pt.
create policy access_grants_ablute_qa_read on public.access_grants for select using (is_ablute_developer());
create policy ai_reviews_ablute_qa_read on public.ai_reviews for select using (is_ablute_developer());
create policy automation_runs_ablute_qa_read on public.automation_runs for select using (is_ablute_developer());
create policy automations_ablute_qa_read on public.automations for select using (is_ablute_developer());
create policy catalog_deliveries_ablute_qa_read on public.catalog_deliveries for select using (is_ablute_developer());
create policy company_facts_ablute_qa_read on public.company_facts for select using (is_ablute_developer());
create policy company_people_ablute_qa_read on public.company_people for select using (is_ablute_developer());
create policy contributions_ablute_qa_read on public.contributions for select using (is_ablute_developer());
create policy document_versions_ablute_qa_read on public.document_versions for select using (is_ablute_developer());
create policy document_views_ablute_qa_read on public.document_views for select using (is_ablute_developer());
create policy documents_ablute_qa_read on public.documents for select using (is_ablute_developer());
create policy entities_ablute_qa_read on public.entities for select using (is_ablute_developer());
create policy folders_ablute_qa_read on public.folders for select using (is_ablute_developer());
create policy import_batches_ablute_qa_read on public.import_batches for select using (is_ablute_developer());
create policy interactions_ablute_qa_read on public.interactions for select using (is_ablute_developer());
create policy investor_submissions_ablute_qa_read on public.investor_submissions for select using (is_ablute_developer());
create policy message_templates_ablute_qa_read on public.message_templates for select using (is_ablute_developer());
create policy ndas_ablute_qa_read on public.ndas for select using (is_ablute_developer());
create policy org_invitations_ablute_qa_read on public.org_invitations for select using (is_ablute_developer());
create policy org_members_ablute_qa_read on public.org_members for select using (is_ablute_developer());
create policy orgs_ablute_qa_read on public.orgs for select using (is_ablute_developer());
create policy pack_unlocks_ablute_qa_read on public.pack_unlocks for select using (is_ablute_developer());
create policy people_ablute_qa_read on public.people for select using (is_ablute_developer());
create policy person_affiliations_ablute_qa_read on public.person_affiliations for select using (is_ablute_developer());
create policy reawakening_proposals_ablute_qa_read on public.reawakening_proposals for select using (is_ablute_developer());
create policy relationship_state_ablute_qa_read on public.relationship_state for select using (is_ablute_developer());
create policy review_runs_ablute_qa_read on public.review_runs for select using (is_ablute_developer());
create policy rule_overrides_ablute_qa_read on public.rule_overrides for select using (is_ablute_developer());
create policy tasks_ablute_qa_read on public.tasks for select using (is_ablute_developer());
