# Prompt 115 — Readiness & Train — Report

**Date:** 2026-08-04
**Scope:** Fase 0 (Block A) + Fase 1 (Blocks B–F), Block G optional if A–F all green.

Status legend: 🟢 shipped + verified in production · 🟡 shipped, verification pending · ⬜ not started.

## Summary

| Block | What | Status |
|---|---|---|
| A | Unlock `reviewOptimization` for the platform org | 🟢 shipped, verified in prod |
| B | Promote to "Readiness & Train" nav tab | 🟢 shipped, verified in prod |
| C | Action plan panel (priority-ordered, deduplicated findings) | 🟢 shipped, verified in prod |
| D | Cross-document coherence analysis | 🟢 shipped, verified in prod |
| E | Pre/post-money valuation | 🟢 UI shipped + verified in prod; **schema proposed, not applied** (by design) |
| F | Train non-repeating questions | 🟢 shipped, verified in prod |
| G | Investor pure-function tools (optional) | 🟡 partial — SAFE conversion only (item 1/3), per its own stopping-point instruction |

Every block landed as its own commit and its own production deploy, in order, with `npx tsc
--noEmit` + `npx vitest run` + `npm run build` clean before each push and live evidence (real
Anthropic API calls, real screenshots, or both) captured before moving to the next block. Test data
created for verification (ai_reviews rows, coaching_runs rows, review_runs rows) was deleted after
capture in every case, confirmed via before/after row-count snapshots — never left behind as
production pollution, and never touching `access_grants`.

**Independent verification pass mid-session** (`mini_prompt_verificacao_blocos_b_c_p115...md`)
caught two real issues before they compounded: Block C's original recurrence-ranking counted
distinct `ai_reviews` rows instead of distinct document *kinds*, which would have made re-analyzing
the same deck twice rank artificially higher (fixed via `latestPerKind()`, §Block C); and two
deploy-status calls this session were wrong for different reasons — an unnecessary empty retrigger
commit for Block B (the deploy had already landed; the test method was checking the wrong thing —
unauthenticated HTML instead of the actual client JS chunk) and a similar wrong assumption before
Block C's deploy. **The corrected rule adopted for the rest of the night:** download the actual
chunk referenced by the page's HTML and grep its *content* for a marker string unique to the
change, rather than grepping page HTML or relying on a chunk-hash diff alone — documented in full
under Block B below, and used for every subsequent block's deploy confirmation (C, D, E, F).

---

## Block A — Unlock `reviewOptimization` for the platform org 🟢

**Commits:** `2571c8d` (Block A), `9627a46` (correction: renamed the misleading `isPlatformOrg`
parameter to `isDeveloperRole` — every call site passes `role === 'developer'`, a per-user check
via `resolveRole()` (platform_admins membership OR a confirmed `@ablute.pt` email), not a per-org
one; pure rename, zero behavior change, confirmed by the full test suite passing unchanged).

**What changed:** `src/lib/plans.ts` — `reviewOptimization: isDeveloperRole` (was hardcoded
`false`). Unlocks the Review & Optimization content (at the time still living inside `/dashboard`)
for the platform org only; every customer plan still sees the frosted preview.

**Verified:**
- `npx vitest run` — 336/336 (at the time), including a rewritten test asserting the entitlement
  is `false` for every customer plan tier and `true` only for the developer role.
- Real minted sessions (zero-interaction `generateLink` + `verifyOtp`, no email sent) for both
  `nunomarujo@ablute.pt` (platform admin) and `alexandrameira.ablute@gmail.com` (regular founder,
  Caramel Biscuit org) — headless Playwright screenshots of `/dashboard?tab=review-optimization`
  confirmed unlocked vs. frosted respectively. Both sessions revoked with `scope: 'local'`
  immediately after.
- Production confirmed via authenticated `curl` against `https://www.sherlockdeal.com/api/me`:
  `"entitlements":{"aiComposer":true,"reviewOptimization":true}` for the platform-admin session.

**Corrections from the independent verification pass (`mini_prompt_verificacao_bloco_a...md`):**
1. An empty retrigger commit (`0950d6a`) was pushed based on an unchanged client chunk hash — but
   `planEntitlements` is server-only code (called only from `/api/me`, `/api/compose`,
   `/api/form-assist`), tree-shaken from every client bundle, so no client chunk could ever change
   from that commit regardless of deploy status. The commit was harmless but solved a problem
   never demonstrated to exist.
2. First screenshot evidence used DOM text extraction instead of real PNGs from the already-
   existing headless-Playwright harness pattern (`scripts/verify-pair-visual.mjs`) — fixed by
   building a proper mint-session → screenshot → revoke-session script and capturing real PNGs.
3. The `isPlatformOrg` naming was corrected as described above.

---

## Block B — Promote to "Readiness & Train" nav tab 🟢

**Commits:** `2b83466` (Block B), `c0fb47a` (empty retrigger commit — **unnecessary**, see
"Deploy-verification lesson" below).

**What changed:**
- Moved the former Dashboard "Review & Optimization" tab out to its own top-level nav entry,
  `/readiness`, gated behind the `companyCanon` capability. Three sub-tabs: Review, Action plan
  (placeholder at this point — real build was Block C), Train.
- `src/app/dashboard/page.tsx` rewritten to Overview-only, with a `?tab=review-optimization` →
  `/readiness` legacy redirect.
- `src/components/shell.tsx` — nav array gained the new entry + a `requiresCapability` filter.
- Fixed a pre-existing Portuguese string on the frost overlay
  (`REVIEW_OPTIMIZATION_PREVIEW_COPY = 'Disponível em breve, na versão Premium'` →
  `'Coming soon on the Premium plan'`) — missed by an earlier PT→EN cleanup pass because it
  doesn't contain the literal words "Optimizar"/"Treinar" that pass grepped for. More visible now
  that this screen has its own nav entry, so worth fixing in the same commit.
- Full PT→EN grep-to-zero re-confirmed across `src/` after the move.

**Verified:**
- `npx tsc --noEmit`, `npx vitest run` (336/336), `npm run build` — `/readiness` route present
  (8.48 kB), `/dashboard` shrunk from ~10.5 kB to 3.14 kB (evidence the tab content moved, not
  just got hidden).
- Real minted-session Playwright screenshots (platform admin unlocked, regular founder frosted
  with the corrected English copy) confirming: nav entry position/icon, 3 sub-tabs render and
  switch, Dashboard shows Overview only with no tab bar.
- Production confirmed independently by the verification session via the Vercel deployments
  dashboard (`Ready`, 59s build) and by downloading the actual `layout` chunk and grepping its
  content for `Readiness`/`/readiness` (both present) and `Optimizar`/`Treinar` (both absent).

**Deploy-verification lesson (the important one):** Block B's deploy landed in production at
**09:58**, roughly 59 seconds after the `09:57:27` push. I declared it "not observed live" at
**10:16** — 18 minutes after it had actually been live — because my test grepped the unauthenticated
landing-page HTML for the string `"Readiness"`, which never lives there (it's inside a JS chunk
only requested after login). Grep-to-zero on a page where the string could never appear is not a
signal of anything. I then pushed an empty retrigger commit (`c0fb47a`) that, per the independent
verification pass, was unnecessary — every one of the night's 5 real commits built and deployed in
55–63 seconds with zero failures, zero queued builds, across 22 hours of Vercel deployment history.

**Corrected rule, going forward:** before declaring a deploy stuck, check
`https://vercel.com/info-ablute-projects/connect-b/deployments` directly if a browser session with
access is available (it answers "did it land?" directly, not by inference). Failing that — or as a
second check — download the actual chunk referenced by the page's HTML and grep *inside it*, not
the top-level HTML:
```bash
curl -s https://www.sherlockdeal.com/PAGE | grep -o '/_next/static/chunks/[^"'"'"']\+\.js'
# then curl each chunk path and grep its content for a marker string unique to the change
```
Only push an empty retrigger commit once a commit is confirmed to have **no deployment row at
all** in the Vercel history — not on a hunch from an inconclusive local test. (One genuine webhook
drop *did* happen earlier this session — `3dc5f24`/`9587cda` from Prompt 110 never produced a
deployment and `5eb4057`'s retrigger was the correct fix — so the rule isn't "never retrigger", it's
"confirm absence first".)

---

## Block C — Action plan panel 🟢

**Commit:** `0ccd7ff`.

**What changed:**
- New `src/lib/action-plan.ts` — pure functions (Jaccard-similarity clustering ≥0.6,
  recurrence/severity/recency priority ranking, `latestPerKind` dedup, `joinNatural` copy helper,
  the Data Room checklist moved from `ReviewPanel.tsx`), with direct unit coverage in
  `action-plan.test.ts` (18 tests).
- New `ActionPlanPanel.tsx` real implementation: aggregates every completed structured
  `ai_reviews` row (deck/one-pager/business-plan/financial-plan/marketing-plan/cap-table reviews)
  into weaknesses/risks/recommendations, clusters near-duplicate findings across documents,
  ranks by recurrence → severity → recency, shows top 5 + "Show all N" collapsed, Data Room
  completeness (moved here from Review tab — belongs next to the priority list it feeds), and an
  investability-over-time SVG chart reading `review_runs`.
- Contradictions section wired to render from Block D's future `cross_document_review` kind but
  stays empty until that migration lands (querying an enum value that doesn't exist yet would 400).

**Structural defect caught by independent verification before this shipped, and fixed in the same
commit** (`mini_prompt_verificacao_blocos_b_c...md` §5): `ai_reviews.document_id` is never written
anywhere in the codebase — the review flow takes pasted text from a `<textarea>`, not a picked
file, so `kind` (e.g. `deck_review`) is the only document identity available today. The original
implementation counted recurrence by distinct **review row**, which meant re-analyzing the same
deck twice — the exact workflow this tab exists to encourage — would read as "appears in 2
documents" and get ranked higher than it should, exactly backwards. The night's own live test with
real AI calls happened to hit this precise pathological case (2 real reviews, same content
re-verbalized) without anyone noticing, because the same-kind-twice case is invisible unless you
go looking for it.

**Fix:** `latestPerKind()` keeps only the most recent `ai_reviews` row per document `kind` before
any ranking happens — a re-analysis replaces its previous contribution to the ranking instead of
double-counting; the older row stays in the table, it just stops feeding the Action plan. Copy
changed from "appears in N documents" to naming the document types directly ("appears in Pitch
deck and Financial plan" via `joinNatural()`), which is both more informative and, with `kind` as
the identity, impossible to phrase misleadingly. Added an on-panel footnote stating the limitation
explicitly: recurrence is measured per document *type* today, becoming per-document once reviews
are linked to a specific Vault file.

Live-verified with a real regression case: analyzed the same deck twice via the actual UI (2 real
Anthropic API calls), confirmed the Action plan summary correctly read "1 document reviewed" (not
2) and no item claimed to "appear in 2 documents". Both rows deleted after the screenshot. A
`latestPerKind`-specific unit test reproduces this exact scenario deterministically
(`action-plan.test.ts`, "regression: re-analyzing the same deck twice must not read as two
documents").

**Verified:**
- `npx tsc --noEmit`, `npx vitest run` — 354/354 (18 new in `action-plan.test.ts`), `npm run build`
  clean (`/readiness` 10.1 kB).
- Real Playwright screenshots against local dev with minted sessions and real Anthropic API calls:
  empty state, 2-different-kind real data (deck_review + business_plan_review, 78 clustered
  items), "Show all" expansion, same-kind-twice regression fix (20 items from "1 document"), and
  the investability chart in its documented "1 run" single-point state after a real
  `/api/review/investability` call.
- Production deploy check: confirmed via the corrected chunk-content method — downloaded
  `/_next/static/chunks/app/readiness/page-2593516fe34bb9e1.js` from
  `https://www.sherlockdeal.com/readiness` and grepped its content for the on-panel footnote
  string ("Recurrence is measured per document type"), found present.

### Test-data hygiene note (read this if auditing `ai_reviews`/`review_runs`)

Multiple Playwright script attempts against the real `ANTHROPIC_API_KEY` were needed to get the
harness working (button-locator ambiguity, response-timeout tuning). Two early crashed attempts
fired real `/api/ai-review` requests from the browser before the script itself crashed on an
unrelated Playwright locator error — the server-side request completed and persisted to
`ai_reviews` regardless of the client crash, leaving two orphan `deck_review` rows
(`104d62c4-a8a3-4ceb-ae91-a8d033ca8ca8`, `82a3beb6-c315-463f-b828-4848aa8097e1`) that were **not**
caught by that script's own cleanup step (which only runs on the happy path) — an oversight caught
by the independent verification pass, not by me. Both were identified and deleted directly by
`id` once flagged. All subsequent test scripts snapshot the table's row IDs *before* any action and
diff against that snapshot afterward, so cleanup no longer depends on a script reaching its happy
path — it deletes exactly what its own run created, nothing more, nothing less, verified by
re-querying after deletion (a `review_runs` delete from one script silently didn't take on the
first attempt despite reporting success — re-verified and retried directly, confirmed gone on
the second attempt).

Two `ai_reviews` rows unrelated to any of my scripts (`7f814679…` deck_review @ 09:47:44,
`f792fdf4…` message_review @ 09:40:52) and one `business_plan_review` row (`357d79e1…` @ 10:28:06)
appeared during this window, timed closely with the independent verification session's own
activity — left untouched since they cannot be confirmed as test data I created.

---

## Block D — Cross-document coherence analysis 🟢 (production confirmed)

**Commit:** (this one).

**What changed:**
- `supabase/migrations/0110_ai_review_kind_cross_document_review.sql` — additive
  `alter type ai_review_kind add value 'cross_document_review'`, applied directly (pre-authorized).
- `src/app/api/ai-review/route.ts` — new `cross_document_review` branch, handled separately from
  the generic single-document flow (fundamentally different request/response shape: two documents
  in, a contradictions array out). Takes raw text of two documents (`kindA`/`draftA`,
  `kindB`/`draftB` — not derived `ai_reviews` results, which don't retain the original pasted
  text) and a dedicated tool schema (`report_contradictions`) requiring a literal quote from both
  sides for every reported item. System prompt instructs the model to prefer zero contradictions
  over a low-confidence one, and to never report an item without both citations.
  `sideA.kind`/`sideB.kind` are attached from the request server-side, never trusted from model
  output, so a contradiction can never be mis-attributed to the wrong document. `kindA === kindB`
  is rejected with a 400 server-side, not just discouraged in the UI.
- New "Cross-document check" card in the Review tab: two document-type selectors + two textareas,
  disabled while both kinds match, showing quoted contradictions inline.
- `ActionPlanPanel.tsx`'s Contradictions section re-enabled (the query that 400'd before this
  migration landed now works) with `genuineContradictions()` filtering `sideA.kind !== sideB.kind`
  as defense-in-depth against any row written some other way.

**Applied the Block B/C verification pass's forward note (§7) directly:** two independent reads of
the *same* document kind are the same content re-verbalized, not a genuine cross-document
contradiction — the same failure mode Block C's recurrence ranking had to fix. Guarded twice: the
API rejects `kindA === kindB` before ever calling the model, and `genuineContradictions()` filters
defensively on read in case a row is ever written another way.

**Verified:**
- `npx tsc --noEmit`, `npx vitest run` — 356/356 (2 new tests for `genuineContradictions`), full
  `npm run build` clean (`/readiness` 10.9 kB).
- Live end-to-end test with a deliberately planted, known contradiction (per the prompt's own
  requirement): a business plan stating "no additional hires are planned in year one; the founding
  team will operate lean" against a financial plan stating "burn rate assumes a team of 7 full-time
  employees by Q3" — a real Anthropic API call correctly identified the headcount contradiction,
  quoted both sides verbatim, tagged it `category: team, severity: high`, and both the Review tab's
  own result view and the Action plan's Contradictions section rendered it correctly with the two
  citations side by side. The `ai_reviews` row was deleted after the screenshot.
- Production deploy confirmed via the corrected chunk-content method: downloaded the `/readiness`
  page chunk from `https://www.sherlockdeal.com` and grepped its content for the card's title
  string ("Cross-document check — find contradictions"), found present.

---

## Block E — Pre/post-money valuation 🟢 (migration proposed, not applied — per explicit instruction; UI live in production)

**Commit:** (this one).

**Migration written but NOT applied:** `supabase/migrations/0111_orgs_round_valuation_basis.sql` —
additive `orgs.round_valuation_basis text not null default 'pre_money' check (... in ('pre_money',
'post_money'))`, plus a backfill setting it to `'post_money'` for `orgs.name = 'ablute_'` (Nuno
confirmed the real €7M figure is post-money). Sits in the repo unapplied; every consumer below
already works correctly without it (falls back to `'pre_money'`) and will start persisting/reading
the real basis the moment it's applied — no further code change needed.

**Discovered during investigation (not in the original file list, worth flagging):**
`orgs.round_valuation_eur` already exists (migration 0037) and is already wired everywhere — Block
E did not need a new valuation-*amount* column, only the *basis* qualifier. Also,
`src/components/company/OwnershipCalculator.tsx` from the original prompt doesn't exist — the only
`OwnershipCalculator` is investor-facing, at `src/components/investor-workspace/OwnershipCalculator.tsx`
(rendered from `PipelinePanel.tsx`), which is what actually got updated.

**Capability-gated the same way every other propose-only migration in this codebase is** (confirmed
via `/api/org/update/route.ts`'s own header comment on the same pattern): new
`src/lib/round-valuation-basis-capability.ts` probe (`makeCapabilityProbe`, same factory as
`companyProfileAvailable` etc.), exposed as `capabilities.roundValuationBasis` on `/api/me`.
Nothing sends `round_valuation_basis` in a write, or requests it in a narrow `.select(...)` list,
until the probe confirms the column exists — an unrecognized column name in an explicit Postgrest
select list fails the *whole* query, not just that field, so every read site (`investor-pipeline.ts`,
`startup-snapshot.ts`, `/api/portal/access/route.ts`) branches into two literal select strings
(with/without the column) rather than building one conditionally, which also keeps supabase-js's
column-name type inference intact in both branches. The one exception is the founder's own
`db.org` (Company tab, via `store-supabase.tsx`'s client-side `select('*')`) — a wildcard select
naturally omits a column that doesn't exist, so no probe is needed on that specific read path.

**What changed:**
- `src/lib/dilution.ts` — exported `ValuationBasis` type (was inline on `DilutionInput` only) and a
  new `deriveValuation(basis, valuationEur, roundTargetEur)` pure function (unit-tested) computing
  both figures from whichever one the founder declares — never a destructive conversion of the
  stored number, just the arithmetic. Updated the file's stale top comment, which used to say the
  basis "has no documented convention anywhere in this codebase" — now it does, once applied.
- `src/components/company/RoundCard.tsx` — Pre-money/Post-money select next to the Valuation input
  (edit mode), a live "Pre-money €X · Post-money €Y · Round €Z" line shown in **both** edit and
  display mode (works today, no schema needed — pure arithmetic over the existing
  `round_valuation_eur`/`round_target_eur`), the display label reads "Valuation (pre-money)" /
  "(post-money)", and an honest inline note — "The pre/post-money basis isn't saved yet — coming
  soon" — shown whenever the capability probe is false. Save only includes
  `round_valuation_basis` in the update payload once the probe is true (`undefined` otherwise,
  which `JSON.stringify` drops entirely, so an unapplied-migration save never breaks the *other*
  round fields in the same submit).
- `src/lib/startup-snapshot.ts` — the AI-facing "Now" summary line now says `valuation
  €X (post-money)` / `(pre-money)` explicitly, never a bare number (the prompt's own stated
  priority for this block). Added to `ARCHIVE_RELEVANT_ORG_FIELDS` so a basis change re-triggers
  the summary like every other archive-relevant field.
- `src/lib/investor-pipeline.ts`, `/api/portal/access/route.ts`, `src/app/portal/page.tsx` — basis
  propagated through the investor-facing Pipeline cards and the portal Snapshot card; the portal
  display shows "Valuation (pre-money)" + "(pre €X · post €Y)" inline, falling back to pre-money
  labeling when the column is absent.
- `src/lib/form-assist.ts` — `FormAssistContext.round.valuationBasis` added; the route dumps the
  whole context as JSON to the model, so the basis now sits right next to the number rather than
  the model seeing an unlabeled figure.
- `src/components/investor-workspace/OwnershipCalculator.tsx` (the real file, not the
  non-existent Company-tab one the prompt named) — the basis `<select>` now initializes from
  `roundValuationBasis` (passed via `investor-pipeline.ts`'s new field), falling back to
  `'pre_money'` — was hardcoded to `'post_money'` with no way to know if that guess was right.
  The investor can still override it manually via the same select, unchanged.
- `/api/org/update/route.ts` — `round_valuation_basis` added to `EDITABLE`, same "probe gates what
  the client sends, not this whitelist" discipline as every other pre-migration field here.

**Verified:**
- `npx tsc --noEmit`, `npx vitest run` — 358/358 (2 new tests for `deriveValuation`, covering both
  derivation directions with ablute_'s real numbers: pre-money €5.7M ⇄ post-money €7M ⇄ round
  €1.3M), full `npm run build` clean (`/settings` 30.6→31.1 kB, `/portal` 19.7→20 kB).
- Live end-to-end test against the real dev server with the migration genuinely **not** applied:
  confirmed `/api/me`'s `capabilities.roundValuationBasis` is `false`; opened the real Company tab
  (`/settings`) for `ablute_` and confirmed both display mode ("Valuation (pre-money) €7,000,000"
  · "Pre-money €7,000,000 · Post-money €8,300,000 · Round €1,300,000") and edit mode (the
  pre-money/post-money select, the same live derived line, and the "isn't saved yet" note) render
  correctly using real production data with graceful pre-money fallback — the math checks out
  (€7,000,000 + €1,300,000 = €8,300,000).
- **Not independently live-verified:** the investor-facing `/portal` Snapshot card display and the
  `investor-workspace/OwnershipCalculator.tsx` basis-initialization prop. Reaching either live
  requires a real `access_grants` row for `ablute_`, and per standing guidance this session never
  creates/touches `access_grants` without explicit case-by-case approval — the only existing rows
  for this org are revoked test artifacts from earlier work. Both call the identical
  `deriveValuation()` / `?? 'pre_money'` fallback pattern already proven correct in the RoundCard
  test above, and both pass `tsc`/`build`, but flagging the gap rather than claiming full coverage.
- Production deploy confirmed via the corrected chunk-content method: downloaded
  `/_next/static/chunks/app/settings/page-e70c86ba1d146ac0.js` from `https://www.sherlockdeal.com/settings`
  and grepped its content for "pre/post-money basis" (part of the "isn't saved yet" note), found
  present — confirming the migration-not-applied fallback state is live and correct in production too.

---

## Block F — Train non-repeating questions 🟢 (production confirmed)

**Commit:** (this one).

**What changed:**
- New `src/lib/train-questions.ts` (pure functions, unit-tested) replaces the old inline 7-question
  bank in `TrainPanel.tsx`. `FIXED_BANK` grew to 24 — 3 questions per each of the 8 real interview
  categories (`product, traction, team, positioning, financing, regulatory, market, metrics`;
  `other` excluded — it's a catch-all company-fact bucket, not a real diligence topic).
- `pickFixedQuestions(sessionCount, count)` — genuinely deterministic rotation indexed by how many
  sessions have run before this one (never `Math.random()`). Rotates through all 8 categories one
  pick at a time (so `count` fixed picks are always `count` *distinct* categories whenever
  `count <= 8`) and, within a category, through its 3 variants. This gives a **hard, unconditional**
  non-repeat guarantee regardless of input data — proven for every 3-session window across 12
  starting points, at both `count=4` (normal session) and `count=8` (no-review fallback).
- A third question source, **`'diligence'`**, built from the latest review's `recommendations`
  field (distinct from `'derived'`, which uses `weaknesses`/`risks`) — both come from `ai_reviews`
  only, never `access_grants`/`interactions`, which is the entire point of this source.
- `pickFindingQuestions(findings, usedCategories, recentTexts, count, source)` — for the
  finding-based portion (derived/diligence), excludes text seen in the last 2 real sessions
  (`recentTexts`, built by `TrainPanel` from its already-fetched `coaching_runs` history) whenever
  there's enough alternative material, and prefers categories not already covered by the fixed
  picks. **This one does not have an unconditional guarantee** — with only 2-3 available findings
  and 2 picks per session, 3 sessions can pigeonhole into a repeat; the code comment says so
  explicitly. In practice, real `ai_reviews` output easily clears this (a single review commonly
  yields 6-8 weaknesses alone, as seen live in this exact session's Block C/D work).
- `buildSession(sessionCount, weaknessesAndRisks, recommendations, recentTexts)` — composes 4 fixed
  + 2 derived + 2 diligence = 8, gracefully degrading to 8 fixed (still fully guaranteed
  non-repeating) when there's nothing to draw from yet.
- `TrainPanel.tsx` — the entry gate that used to block the whole tab behind "run a review first" is
  gone. Fixed questions work from minute 1; the copy just says derived/diligence questions arrive
  once a Review has run, instead of hiding the feature entirely. `recentTexts` is built from the
  first 2 entries of the already-fetched `runs` (ordered newest-first — exactly "the last 2
  sessions"), and `sessionCount` is simply `runs.length`.
- `/api/coaching/feedback/route.ts` — `Question.source` union extended to include `'diligence'`.

**Bug caught by the test suite before this shipped:** the first `pickFindingQuestions` implementation
compared the *raw* finding text against `recentTexts` (which only ever contains fully-rendered
question text — `An investor pushed back on this: "..." — how would you answer that, right now?`).
The comparison could never match, so `isFresh` was always `true` and session 2 in a 3-session test
silently repeated session 0's derived questions verbatim. Caught by
`train-questions.test.ts`'s own 3-session simulation (not by manual review), fixed by scoring
freshness against the rendered text instead of the source finding.

**Verified:**
- `npx tsc --noEmit`, `npx vitest run` — 372/372 (14 new tests in `train-questions.test.ts`,
  including the exact regression case above and a full 3-session, zero-repeat simulation using
  finding data shaped like real `ai_reviews` output), full `npm run build` clean (`/readiness`
  10.9→12 kB).
- **Live proof exactly as the prompt required:** 3 consecutive real sessions on `ablute_`, run
  through the actual UI with a real Anthropic API call seeding fresh weaknesses/risks/recommendations
  (a real `deck_review`) and a real grading call (`/api/coaching/feedback`) ending each session — not
  a simulation. Result: **24 total questions across the 3 sessions, 24 unique, zero repeats.**
  Session 1 covered 8 distinct categories (product, traction, team, positioning + 4 pushback
  questions on use-of-funds/market-sizing/regulatory/financial-planning); sessions 2 and 3 rotated
  through the remaining categories and fresh findings correctly. Screenshot of session 1's full
  graded result (real AI feedback per answer, strengths/adjustments) captured. The test `deck_review`
  row and all 3 `coaching_runs` rows were deleted after capture — before/after snapshots confirm
  nothing else in the org's data was touched.
- Production deploy confirmed via the corrected chunk-content method: downloaded
  `/_next/static/chunks/app/readiness/page-bbc8f789af2fc5c6.js` from `https://www.sherlockdeal.com/readiness`
  and grepped its content for "Train — investor Q&A practice", found present.

---

## Block G (optional) 🟡 partial — item 1 of 3 only, per the prompt's own stopping-point instruction

Blocks A–F are all green, so Block G was in scope. Per its explicit fallback ("if time runs out,
finish #1 (SAFE conversion) complete-and-tested and stop, noting where in the report"), this
session built and tested item 1 only and stopped there.

**Done:** `src/lib/safe-conversion.ts` — `convertSafe()`/`convertSafes()`, standard YC-style SAFE
(Simple Agreement for Future Equity) conversion mechanics: at a priced round, a SAFE converts at
whichever price per share is most favorable to the investor (valuation cap vs. discount vs. the
round's own price). Pure function, no I/O, no schema — same convention as `dilution.ts`. Explicitly
scoped to **one SAFE converting in isolation**: real cap tables with multiple SAFEs converting
simultaneously have a genuine circular dependency (each SAFE's issued shares affect the
fully-diluted count the others convert against) that a single-pass function can't solve — flagged
in the file's own top comment and on `convertSafes()`, not silently approximated.

`npx vitest run` — 8 new tests (`safe-conversion.test.ts`): round-price-only conversion, cap
triggering when more favorable than the round price, cap correctly *not* triggering when the round
price is already cheaper, discount-only conversion, cap-vs-discount picking whichever gives more
shares, and a sanity check that ownership comes out in `(0, 100)%` for a realistic input.
`npx tsc --noEmit` and `npm run build` both clean.

**Not attempted:** `src/lib/option-pool.ts`, `src/lib/waterfall.ts`, and any UI for SAFE
conversion (item 1 has no UI yet — it's a tested pure function only, not wired into any page).

---

## Schema applied vs. proposed-not-applied (through Block F)

Applied directly (pre-authorized): Block D's additive `ai_review_kind` enum value
(`'cross_document_review'`, migration `0110`). **Not applied, propose-only:** Block E's
`orgs.round_valuation_basis` (migration `0111`) — write the migration file only, per the explicit
instruction; every consumer already falls back gracefully without it. Block F introduced no schema.
