-- Prompt 450 — ADJACENT is now a real classifyCompetitor output (market-
-- competition.ts), not just something emerging/potential_entrant mapped
-- TO via relationForCompetitorType. The 447 constraint never allowed
-- 'adjacent' as a stored competitor_type value itself.
alter table org_competitors drop constraint if exists org_competitors_competitor_type_check;
alter table org_competitors add constraint org_competitors_competitor_type_check
  check (competitor_type in ('direct','functional','budget','status_quo','emerging','potential_entrant','adjacent'));
