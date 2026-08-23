-- Prompt 319 — My Network 4/9: follow-on signal ("I'd invest in this again").
-- Declared by the investor, about a startup they already have a verified
-- 'invested' relationship with (an entities.status='invested' row in the
-- founder's own pipeline, resolved via the SAME catalog_deliveries
-- (org_id, catalog_id) identity join 316/317/318 already use — never a
-- second heuristic for "who invested in whom").
--
-- Extends catalog_deliveries rather than a new table (Pedido A's own stated
-- preference "if there's an obvious slot"): catalog_deliveries is already
-- the canonical, unique-per-(org_id, catalog_id) row this whole series
-- treats as the investor-startup relationship's identity anchor, so a
-- follow-on signal is naturally an optional attribute of that same row, not
-- a second source of truth about who invested in whom.
alter table catalog_deliveries
  add column if not exists followon_visibility text check (followon_visibility in ('named', 'anonymous')),
  add column if not exists followon_signaled_at timestamptz,
  add column if not exists followon_expires_at timestamptz,
  add column if not exists followon_revoked_at timestamptz;

-- "a pedido da startup" (Pedido C.4) — the startup can ASK, never mark
-- directly, same consent discipline as the rest of this series. A partial
-- unique index (not a plain constraint) blocks a duplicate open ask for the
-- same pair while resolved_at is null; once the investor's decision
-- resolves it (whether by signaling or just dismissing it), a fresh ask is
-- a normal insert again — same shape as 0212's live-referral partial index.
create table if not exists network_followon_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  investor_catalog_entity_id uuid not null references catalog_entities(id) on delete cascade,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists network_followon_requests_open_idx
  on network_followon_requests (org_id, investor_catalog_entity_id) where resolved_at is null;
create index if not exists network_followon_requests_investor_idx on network_followon_requests (investor_catalog_entity_id, resolved_at);

-- RLS: the startup side reads its own asks through ordinary org membership.
-- No investor-side policy — exactly like network_referrals/network_actors,
-- every My Network route uses the service-role client, and there is no
-- existing RLS-friendly session identity for "this investor's own
-- catalog_entity_id" to key a policy off (network_actors.matchdeal_profile_id
-- would need a subquery per row here; not worth it for a table with no
-- direct client-side reader on that side).
alter table network_followon_requests enable row level security;
create policy network_followon_requests_org_member on network_followon_requests for select using (is_org_member(org_id));
