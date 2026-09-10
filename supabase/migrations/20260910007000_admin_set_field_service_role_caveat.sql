-- Prompt 646 §1.3 — said where it has to be read.
--
-- Both *_admin_set_field functions accept auth.role() = 'service_role' as
-- well as a platform admin. Under service_role there is no auth.uid(): the
-- write is stamped verified_by_admin with no author, no contributions row is
-- written (the ledger needs an org and a user), and the only trace is an
-- admin_audit_log row with admin_user_id = null. That is acceptable exactly
-- as long as nothing automatic calls them: the worker does not, and must
-- not — its writes are AI and have no rung on the ladder (642 §1). A
-- service-role caller is a person at a console, and the audit row is what
-- they leave. No body changes; the comment is the deliverable.

comment on function public.catalog_entity_admin_set_field(uuid, text, jsonb) is
  'Prompt 632 §2.3 / 642 §1 — applies a field at verified_by_admin through catalog_entity_apply_field. Callable by a platform admin (auth.uid() stamped, ledger row written by the caller''s path) or by service_role — in which case there is NO author and NO ledger row, only an admin_audit_log row with admin_user_id = null (646 §1.3). Nothing automatic may call it: the worker''s writes are AI, never verified_by_admin.';

comment on function public.catalog_person_admin_set_field(uuid, text, jsonb, uuid) is
  'Prompt 642 §3.1 — the people mirror of catalog_entity_admin_set_field: applies a field at verified_by_admin through catalog_person_apply_field and writes the contributions row as verified. Callable by a platform admin or by service_role — under service_role there is NO auth.uid(), so no ledger row, only an admin_audit_log row with admin_user_id = null (646 §1.3). Nothing automatic may call it: the worker''s writes are AI, never verified_by_admin.';
