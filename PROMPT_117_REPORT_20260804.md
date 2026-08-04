# Prompt 117 — Readiness: histórico, fontes, partilha e gating — Report

**Date:** 2026-08-04
**Scope:** §1 diagnosis + Blocos A, D, B, C, G.1/G.3–G.5 (per the prompt's own §11 order). Blocos E, F
and §8 held pending Nuno's answer to §10 — not built.

Status legend: 🟢 shipped + verified in production · ⬜ not started (held).

## Summary

| Bloco | What | Status |
|---|---|---|
| A | Feed all AI-review cards with confirmed `company_facts` | 🟢 shipped, verified in prod |
| G.2 | Fix `REVIEW_OPTIMIZATION_PREVIEW_COPY`'s dead "Premium plan" reference | 🟢 shipped, verified in prod |
| D | Park the draft-review card behind a flag (not deleted) | 🟢 shipped, verified in prod |
| B | History tab — every past review, one archive | 🟢 shipped, verified in prod |
| C | Print/PDF/email/WhatsApp/copy sharing per report | 🟢 shipped, verified in prod |
| G.1/G.3–G.5 | Plan-tier gating (Cross-document check + Market data) | 🟢 shipped, verified in prod |
| §8 | Vault PDF text-extraction migration | ⬜ held — needs Nuno's §10.1 decision |
| E | Document-review mode selector (Specific doc / Theme) | ⬜ held — blocked on §8 |
| F | Cross-document sweep redesign (1 ref vs up to 15) | ⬜ held — blocked on §8 |

Every shipped Bloco landed as its own commit, `npx tsc --noEmit` + `npx vitest run` + `npm run build`
clean before each push, and live evidence (real Anthropic API calls, real screenshots, real 403s)
captured against **both** the local dev server and production (`www.sherlockdeal.com`) before moving
on. Test rows created for verification were deleted after capture in every case (before/after
row-id snapshots), never left as production pollution.

---

## Bloco A — Feed all AI-review cards with confirmed `company_facts` 🟢

**Commit:** `2e13806`

**What changed:** `CompanyContext` (`src/app/api/ai-review/route.ts`) gained an optional `facts:
string[]` field. `contextBlock()` now injects confirmed facts as the founder's canon — explicitly
labeled as distinct from the document under review — and instructs the model that a materially
relevant confirmed fact *absent* from the document is itself a finding to recommend adding.
`ReviewPanel.tsx`'s two request bodies (`reviewDocument`, `checkCrossDocument`) now send
`facts: confirmedFacts`; `cross_document_review` received company context of any kind for the first
time.

**Proof required by the prompt:** re-run a `business_plan_review` with text that doesn't restate
team/traction facts and show it no longer says "team unknown."

- **Dev run:** new report cited the confirmed pilot fact by name ("Pilot is mentioned in confirmed
  facts but not in the plan itself") and dropped "team unknown"/"no traction signals" entirely.
- **Production run** (real API call, real cleanup): report explicitly recommended *"Add a 'Team'
  section highlighting that Carla Dias is a WomenInTech EU award, and any relevant domain/technical
  co-founders"* and cited the manufacturing-visit fact by name — both confirmed facts, named, in a
  live production response.
- **SQL side-by-side:** old row `357d79e1…` (10:28) says `"Team unknown: hardware + health + AI
  requires rare multidisciplinary talent"`; new rows (11:50, 11:54) contain zero occurrences of
  "team unknown" and cite the confirmed facts by name instead.

---

## Bloco G.2 — Fix the non-existent "Premium plan" reference 🟢

**Commit:** `31e6aad`

**What changed:** `REVIEW_OPTIMIZATION_PREVIEW_COPY` (`src/lib/plans.ts:208`) was hardcoded to
`'Coming soon on the Premium plan'` — a tier name that has never existed in this product (same class
of bug as the earlier `WATSON_DRAFT_QUOTA` 100/300-vs-90/210 divergence). Now built from
`planName('motherfunding')`.

**Verified:** runtime-evaluated to `"Coming soon on the It's the butler! plan"`; confirmed rendered
live in the frost overlay on `/readiness` (screenshot).

---

## Bloco D — Park the draft-review card behind a flag 🟢

**Commit:** `00786bd`

**What changed:** the "AI Review — second opinion on a draft" card (reviews a message draft against
one specific person's CRM context) doesn't fit the founder-facing Readiness surface. Wrapped in
`SHOW_DRAFT_REVIEW_CARD = false` — state, handler (`reviewMessage`), and the `message_review` API
branch all stay intact for a future networking/advisor-facing surface.

**Verified:** screenshot of `/readiness` Review tab shows the card absent (heading list goes
directly from "Investability ranking" to "Document reviews"); `grep` confirms `reviewMessage`,
`personId`, `draft` state and the `SHOW_DRAFT_REVIEW_CARD` flag are all still present in source.

---

## Bloco B — History tab: every past review, one archive 🟢

**Commit:** `0bfc74e`

**What changed:** every AI review has always persisted to `ai_reviews` (since Prompt 99 §3.1) and
every investability run to `review_runs`, but there was never a UI to browse past runs. New
`HistoryPanel.tsx` merges both tables into one chronological, read-only archive; `ReportView.tsx`
extracted from `ReviewPanel`'s former local `StructuredReportView` so both surfaces render the same
structured-report shape.

**Migration 0112** (`ai_reviews.input_text/title/created_by/source/input_meta` + an index) is
**PROPOSE ONLY — not applied.** Gated by `aiReviewHistoryFieldsAvailable` via `/api/me`, same pattern
as every other migration-gated feature in this repo. Until Nuno applies it (and for every row that
predates it — explicitly no backfill), a row's original pasted text shows "not recorded" instead of
being guessed at.

**Real bug found and fixed while building this:** two production `ai_reviews` rows have a structured
`kind` but a malformed `strengths` field (a markdown bullet *string* instead of `string[]`) — the
model occasionally doesn't conform to its own declared tool-call schema, and `/api/ai-review`
persists it unvalidated. This was always latently possible; History is simply the first surface that
re-renders a *past* result instead of only the one just returned from a live call, so it's the first
place it could crash. `HistoryPanel` (via the extracted `isRenderableReport` guard) now validates
shape before calling `ReportView` and falls back to a plain notice instead of crashing. **Flagged,
not fixed at the source** — the `route.ts` validation gap is a separate, deeper issue outside this
Bloco's scope; worth a follow-up prompt.

**Verified:** production run — created a real `one_pager_review`, confirmed it appeared in History
alongside all 9 other real production rows (including the two malformed ones, rendering their
fallback notice instead of crashing), confirmed the "not recorded" original-text fallback, confirmed
the full structured report body rendered correctly citing Carla Dias/manufacturing by name (Bloco A
composing correctly with Bloco B). Test row cleaned up after capture.

---

## Bloco C — Print/PDF/email/WhatsApp/copy sharing 🟢

**Commit:** `8dae1ca`

**What changed:** new standalone `/readiness/report/[id]` page, linked from each History item via
"Open full report (print / share)". Deliberately its own route rather than a modal — `window.print()`
prints whatever's on the page, so isolating exactly one report (not the whole History list) is what
makes Print actually produce a clean result. `ReviewResultBody.tsx` extracted from `HistoryPanel` so
the report page and the History list render identically instead of drifting;
`reviewResultToMarkdown()` is the shared serializer behind Copy as Markdown.

**Zero server-side sending, as required:** Print is `window.print()` (never jsPDF/html2canvas),
Email/WhatsApp are plain `mailto:`/`wa.me:` links the browser's own client opens, Copy is a
clipboard write. Nothing on this page calls an API route or sends anything on the founder's behalf.
Explicit amber warning banner: the link is RLS-protected and won't open for an outside investor who
hasn't been granted workspace access.

**Verified in production:** loaded a real `business_plan_review` report page — title/score render,
RLS warning shows, `mailto:` and `wa.me:` hrefs are well-formed, Copy as Markdown wrote a correct
4471-character markdown document to the clipboard, and the share buttons + warning banner correctly
disappear under `@media print` (confirmed via Playwright's print-media emulation) while the report
body stays. Note: the Shell's sidebar/topbar chrome is **not** print-hidden — this matches the
existing, already-shipped `/people/[id]/prep` printable page exactly (same limitation, not a
regression introduced here); fixing Shell-wide print behavior is a separate, cross-cutting change
outside this Bloco's ask.

---

## Bloco G.1/G.3–G.5 — Plan-tier gating for Cross-document check + Market data 🟢

**Commit:** `c1a675d`

**What changed:** new `Entitlements.reviewTopTierTools` (`true` for `motherfunding` plan or
developer role) gates the two heavier-compute review tools, composing with `reviewOptimization`
the same way `aiComposer` composes with `capabilities.ai`. New reusable `PlanBadge.tsx` component
decorates the two gated card titles; `TopTierLocked()` mirrors the existing `ComingSoon` pattern for
the locked body state.

**Server-side 403 — the real enforcement, not just the badge:** `/api/ai-review` now resolves the
caller's role + plan and returns a genuine `403` (not a soft `configured:false`) for both
`cross_document_review` and `market_data` when the plan doesn't qualify.

**Verified with a real 403, against both dev and production:** minted a session for a real
garage-plan test account (`carladias96@gmail.com`, org "Sherlock Deal_ test") and called
`/api/ai-review` directly — both kinds returned `403 {"error":"This tool is available on the It's
the butler! plan."}`. The same platform-admin account that passes every other gate got a normal
`200` through the same endpoint, confirming the gate discriminates correctly rather than blocking
everyone.

**Known limitation, by design:** `reviewOptimization` itself is still developer-only (Prompt 115
Fase 0 preview) — so today, this inner gate has no live-reachable UI state for any real customer
(a developer-role viewer always passes both gates; anyone else is stopped by the outer frost first).
Built ahead of that rollout per the prompt's own §11 ordering, same reasoning as why Blocos E/F stay
held below.

---

## §10 — Open decisions for Nuno (Blocos E, F, §8 held, not built)

Per the prompt's own explicit instruction and this session's standing rule (propose schema, never
apply without sign-off; never guess on genuinely open product decisions), the following were **not**
built and require Nuno's explicit go-ahead before any of them start:

1. **§10.1 — does PDF text extraction for the Vault proceed at all?** This is the prerequisite for
   Blocos E and F (58 of 69 Vault documents are PDF; zero are DOCX; the `documents` table has no
   extracted-text column today, so "pick a specific document" and "sweep against N documents" modes
   are literally not buildable without it). A propose-only migration
   (`documents.extracted_text/extraction_status/extracted_at`) is ready to write the moment this is
   answered — not written yet, since writing an unusable migration ahead of a "no" wastes nothing but
   isn't the point either.
2. A real **privacy question sits inside §10.1**: should `is_view_only`/watermarked documents even
   have full text extracted and stored in a queryable column? That's a data-handling decision, not an
   engineering one.
3. The remaining §10 items (exact scope of the document-mode selector's UI copy, whether the
   cross-document sweep's reference-document picker should default to the most recently uploaded
   document or the most recently reviewed one, and the retention window for extracted text if §10.1
   is yes) are downstream of #1 and #2 — genuinely can't be scoped further without those two answers
   first.

**Recommendation, not a decision:** given Cross-document check is now gated to the top tier
(Bloco G) and `reviewOptimization` is still developer-only, there's no live urgency to unblock §8/E/F
this week — the confusing paste-two-boxes version (proven via SQL earlier to always return empty
results) is currently invisible to every real customer. Flagging so it doesn't silently fall off the
list, not because it's blocking anything today.
