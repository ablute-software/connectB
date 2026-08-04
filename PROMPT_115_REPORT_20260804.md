# Prompt 115 — Readiness & Train — Report

**Date:** 2026-08-04
**Scope:** Fase 0 (Block A) + Fase 1 (Blocks B–F), Block G optional if A–F all green.

Status legend: 🟢 shipped + verified in production · 🟡 shipped, verification pending · ⬜ not started.

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

## Block D — Cross-document coherence analysis 🟢

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

---

## Blocks E–G

Not started as of this report snapshot: E (pre/post-money valuation, schema proposed-not-applied
per the explicit instruction), F (Train question rotation), and optional G (investor pure-function
tools).

---

## Schema applied vs. proposed-not-applied (through Block D)

Applied directly (pre-authorized): Block D's additive `ai_review_kind` enum value
(`'cross_document_review'`, migration `0110`). Block E's `orgs.round_valuation_basis` migration is
explicitly **not** authorized to apply — write the migration file only.
