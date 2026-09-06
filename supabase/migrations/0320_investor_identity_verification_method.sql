-- Prompt 573 §B — a queryable "how was this verified" fact, for both
-- shapes of investor-identity verification: a claim on an existing catalog
-- firm (investor_entity_claims), and the seat that results from approving
-- one (matchdeal_investor_members) or from the domain-auto-eligible path in
-- /api/portal/investor-profile/add-firm.
alter table public.investor_entity_claims
  add column if not exists verification_method text not null default 'none'
    check (verification_method in ('domain', 'document', 'manual', 'none'));

alter table public.matchdeal_investor_members
  add column if not exists verification_method text not null default 'none'
    check (verification_method in ('domain', 'document', 'manual', 'none'));

comment on column public.investor_entity_claims.verification_method is
  'How the claim was (or would be) verified: domain = claimant email domain matched the firm''s own domain, document = an uploaded incorporation/registry document, manual = an admin verified it without either, none = not yet verified. Set at resolution time, default ''none'' for pending rows.';
comment on column public.matchdeal_investor_members.verification_method is
  'How this seat''s identity was verified — same meaning as investor_entity_claims.verification_method. The 6 existing rows all predate this column and default to ''none'': none was domain_verified=true, so none had verified evidence beyond what the founder self-declared at signup.';

-- Prompt 573 §C — "razão obrigatória" on reject, everywhere else in this
-- batch of prompts is logged to admin_audit_log.detail (already exists,
-- jsonb, no new column needed there) rather than a dedicated column per
-- table — this migration only adds the one column that's a genuine,
-- queryable fact (verification_method), not a free-text audit trail.
