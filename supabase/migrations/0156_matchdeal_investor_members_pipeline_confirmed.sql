-- Prompt 156 — investor side of "confirm before unlock". The completeness
-- gate itself already existed (Bloco 3, /api/portal/investor-profile's own
-- `completeness()` + InvestorWorkspaceShell.tsx's `gateOpen = pct >= 50`) —
-- contrary to Prompt 153/156's own assumption that no investor-side
-- completeness check exists at all. What was actually missing is narrower:
-- crossing 50% flipped the Pipeline tab straight from the "complete your
-- profile" message to a live, already-populated Pipeline, with no explicit
-- moment where the investor confirms their thesis data is correct before
-- the match runs against it.
--
-- Purely additive column, default null so every existing investor member
-- row (and every existing reader of matchdeal_investor_members) is
-- unaffected until this flow sets it. Once set, it never needs to be
-- cleared by app logic — same one-way "unlocked, stays unlocked" semantics
-- unlockPack() already has on the startup side (see pipeline/page.tsx's
-- EmptyCompanyBlock).
alter table public.matchdeal_investor_members
  add column pipeline_confirmed_at timestamptz;
