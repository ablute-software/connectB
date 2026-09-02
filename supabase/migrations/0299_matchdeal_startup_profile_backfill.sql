-- Prompt 543 §A.1 — every org gets its startup matchdeal_profiles row.
--
-- NUMBERING: 0299. Checked with `git ls-remote --heads origin` across every
-- remote branch, not against `main` alone, per Prompt 537's own entry in
-- DECISIONS.md: 0290-0292 are on main, 0293 (claude/prompt-518-reconciled),
-- 0294 + 0298 (claude/prompt-534-round-blueprint), 0295-0297
-- (claude/sherlockdeal-git-access-bek6d7). 0299 is the first free number.
--
-- WHY THIS EXISTS. No code path has ever created a startup profile row.
-- `git log -S"from('matchdeal_profiles').insert"` finds exactly one insert
-- in the whole history and it is kind 'investor' (Prompt 63); migration
-- 0098's trigger only UPDATEs a row that already exists; provision-org
-- never touched the table; and migration 0115's schema-level auto-sync was
-- rejected in Prompt 125 Block B. The four orgs that do have a row got it
-- by hand between 28 Jul and 5 Aug. Every org created since — 9 of them in
-- production, including every real founder account — had none, which is
-- why /api/company/visibility reported "Incomplete" with an empty missing
-- list that rendered as a literal ellipsis.
--
-- WHAT THIS DOES NOT DO, deliberately: it does not publish anything. The
-- row is created EMPTY, so migration 0105's trigger computes
-- is_complete = false and therefore is_visible = false. Becoming visible
-- to investors stays an explicit act by the founder (Prompt 125 Block B),
-- performed through POST /api/company/matchdeal/publish. A backfill that
-- copied the org's fields in would have published nine companies to
-- investors without anyone asking — the exact decision 125 rejected, made
-- accidentally.
--
-- Demo orgs are included on purpose: they are ordinary orgs to every code
-- path that reads this table, and leaving them as the only rows without a
-- profile would just reintroduce the same null-row branch for whoever
-- opens one next.
--
-- IDEMPOTENT. `on conflict (membership_id, kind) do nothing` against the
-- existing unique index matchdeal_profiles_membership_id_kind_key (already
-- present — verified, not added here), so re-running is a no-op and the
-- four hand-made rows are left exactly as they are.
--
-- plan_tier mirrors src/lib/plans.ts's PLAN_TO_MATCHDEAL_TIER, which is the
-- authority; this is the same mapping expressed in SQL for the one-off
-- backfill, and new rows get it from that constant in TypeScript.

insert into public.matchdeal_profiles (membership_id, kind, plan_tier)
select o.id, 'startup',
  case o.plan
    when 'motherfunding' then 'tier_c'
    when 'garage' then 'tier_b'
    else 'tier_a'
  end
from public.orgs o
on conflict (membership_id, kind) do nothing;
