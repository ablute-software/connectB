-- Prompt 166 §D — orgs.swot_visible_to_investors: per-org toggle for whether
-- the founder's SWOT snapshot (strengths/weaknesses/opportunities/threats
-- from the latest review_runs report) is shown on the investor-facing
-- startup dossier (/portal/startup/[orgId]). Additive, boolean, default TRUE
-- (opt-out, not opt-in — Nuno's own spec for the tickbox: "por omissao
-- marcada"). PROPOSTA, NAO APLICADA — esta sessao nao aplica as proprias
-- migracoes (same discipline as 0158).
--
-- Read/write both go through existing service-role routes with their own
-- ownership checks — the write via /api/org/update (owner/admin only, via
-- the org_editing permission matrix, same as every other orgs column), the
-- gated read via /api/portal/startup/[orgId] (projectDossier in
-- investor-interest-level.ts, level >= 1 AND this flag both required). No
-- new RLS policy needed — same as every other orgs column, both routes
-- already go through the service role.
alter table public.orgs
  add column swot_visible_to_investors boolean not null default true;
