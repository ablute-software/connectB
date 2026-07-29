-- Investor Workspace shell (prompt 57), Zona 2 — About tab / investor
-- thesis. Extends matchdeal_profiles (kind='investor') rather than a new
-- investor_profiles table: that table already carries sectors,
-- geographies, stages_invested, instruments, ticket_min/ticket_max,
-- lead_or_colead, portfolio_companies, country, preferred_contact_channel
-- — and is already linked to catalog_entities via
-- matchdeal_investor_members.catalog_entity_id. A parallel table would be
-- exactly the disconnected copy Nuno explicitly asked not to build.
--
-- specific_criteria (already on the table) is reused as "thesis notes" —
-- no new column for that.
--
-- Identity resolution (session -> matchdeal_investor_members) needs no new
-- schema either: on first About visit with no matchdeal_investor_members
-- row for this user, the UI reuses investor-domain-match.ts (Prompt 41) —
-- search/confirm the catalog entity, auto-link on a real domain match,
-- fall back to the same manual-review message otherwise. See prompt 57
-- session notes.
alter table matchdeal_profiles drop constraint matchdeal_profiles_lead_or_colead_check;
alter table matchdeal_profiles add constraint matchdeal_profiles_lead_or_colead_check
  check (lead_or_colead = any (array['lead','co_lead','both']));

alter table matchdeal_profiles
  add column if not exists investments_per_year int,
  add column if not exists capital_to_deploy_eur int,
  add column if not exists usual_co_investors text,
  add column if not exists exclusions_sectors text[] not null default '{}',
  add column if not exists exclusions_notes text;
