# connectB — autonomous-mode decisions log

Non-critical product decisions made while working unattended through the
NEXT_STEPS/IRM_SPEC backlog, so they're visible instead of buried in commits.
Reversible; flag if any should change.

## Auth pages: standalone frosted-glass screens

`/login`, `/signup`, `/forgot-password` (as asked) **and `/reset-password`**
(added — same wrapper pattern, part of the same reset flow; leaving it out
would mean a founder going forgot-password → email → reset-password lands back
on the OLD app-shell-wrapped page mid-flow, which reads as a bug, not a design
choice) now render standalone: no sidebar, no top bar, no "Log interaction",
no plan/seed-round footer. `Shell` early-returns bare children on all four
routes, same mechanism as `/` and portal/back-office.

**Backdrop** (`components/auth/AuthShell.tsx` + scoped CSS module): the
landing's dark teal gradient (`--ink`→`--ink-2`) behind three blurred,
low-opacity rounded-rect shapes (decorative only — no real app UI or data),
then a `backdrop-filter: blur(18px) saturate(1.1)` wash on top so nothing
behind is ever readable. `@supports not (backdrop-filter)` falls back to a
solid 88%-opacity wash for browsers without support — verified both render via
computed styles (`backdrop-filter` present; fallback rule compiles).

**Card**: unchanged content/logic on every page — only the brand-text header
swapped for `LogoLockup` (the landing's logo component: teal badge + serif "S"
+ lens, "sherlock" + accent "deal"), and `shadow-sm` → `shadow-2xl` so it reads
against the glass. A "← Back to sherlockdeal.com" link (→ `/`) sits above each
card.

**Untouched**: auth logic, redirects, middleware, API routes. The logged-in
redirect away from `/login`/`/signup` (middleware.ts) was not touched and still
applies — `/forgot-password`/`/reset-password` were already not
redirect-protected for a logged-in user before this change and remain so
(pre-existing, unrelated to this pass). Verified in demo mode: all four pages
render with no app shell, correct back-link, correct logo; the magic-link
button/flow on `/login` is present and untouched. Could not exercise the
logged-in→redirect path live (needs a real session). Build + 171 tests green.

## Plans & billing — English translation sweep

Translated the plans/billing surface end to end (logic/pricing/routing
untouched): nav label "Planos e conta" → **"Plans & billing"**; the whole
`/plans` page (headings, CTAs, toggle labels, banners, plan bullets, the
security line, the no-payment-processing footer); the three server-side error
strings each in `/api/stripe/checkout`, `/api/stripe/portal`,
`/api/plan/request` (these surface verbatim as `{err}` on the Plans page, so a
PT string there would have defeated the whole translation). `SECURE_PAYMENT_COPY`
(billing.ts) → "Secure payment" (only consumer was this one line).

**Also translated the price labels** (`PLANS[].monthly`/`.annual` in
plans.ts) — "/mês"→"/month", "/ano"→"/year", "equivale a"→"equivalent to",
and the PT thousands-separator fixed to English convention (€1.308→€1,308).
Confirmed safe: the landing's `PricingSection` builds its own copy from the
raw `monthlyEur`/`annualEur`/`annualPerMonthEur` numbers, never from these
label strings — only `/plans` and its test consumed them, both updated.
`CONSULTANCY_TEASER` (PT) is kept as instructed (unreferenced now, by design);
the page renders the existing `CONSULTANCY_TEASER_EN_LEAD`/`_EN_REST` pair
instead (the same one the landing uses).

**Back-office is exempt, confirmed untouched**: `backoffice/startups/page.tsx`
still shows Mensal/Anual, "Aplicar pedido", etc.

**Flagged, not touched**: the sweep found pre-existing Portuguese strings
outside the billing surface — `/needs-review`, `/log`'s LinkedIn-request-note
copy, and `ReawakeningQueue`/`QuickCreatePerson` (a few founder-facing
tooltips/labels: "identidade não confirmada", the reawakening tooltip). These
are deliberate, pre-existing PT copy in the founder's internal triage tools
from earlier batches — not "stray" billing-adjacent leftovers — so left as-is
rather than silently expanding this pass's scope. Flag if you want a dedicated
translation pass over those too.

Verified live in demo mode: `/plans` renders "Plans & billing", "Your plan",
"Current plan", "€149/month" (Monthly) and "€1,308/year (equivalent to
€109/month)" (Annual toggle), the English consultancy teaser, and the English
no-payment-processing footer. Build + 171 tests green (2 price-label
assertions updated in plans.test.ts to match).

## Public landing page + app home moves to /pipeline

The approved design (`landing-reference.html`, kept in the repo as the source of
truth) is now the public page at `/`. Faithful port: same layout, copy, palette
(--ink #0c272e / --teal #2a7f8e / --amber #d9a441), and animations.

**Routing.** `/` is the landing for logged-out visitors; an authenticated
session is redirected to the app, which now lives at **`/pipeline`**. Auth logic,
middleware protections and API routes are untouched — the landing only *reads*
the session. Notes:
- `'/'` was added to the middleware PUBLIC list. It only ever matches the root
  exactly (the `startsWith(p + '/')` arm becomes `startsWith('//')`, never true),
  so the rest of the app stays protected — verified: `/pipeline` with no session
  still 307s to `/login?next=/pipeline`.
- Every app-home reference was retargeted to `/pipeline` (nav item, post-login
  and post-signup redirects, `/auth/callback` default `next`, back-office
  "back to app", demo-mode "Enter the app" links, `/log` save redirect).
- `Shell` early-returns bare children on `/` (same as portal/back-office), so the
  landing brings its own nav/footer and the app shell is never wrapped around it.

**Implementation.** Server component + two small client bits (`LandingEffects`
for nav-scroll/reveal/meters, `PricingSection` for the Monthly/Annual toggle).
- Styles are a **CSS module** (`landing.module.css`) — nothing can reach the app
  shell. JS hooks are **data attributes** (`data-nav` / `data-reveal` /
  `data-fill`), never class names, so the effects can't break on hashed modules.
- A CSS module can't target `html`, so smooth anchor scrolling is applied by
  `LandingEffects` and reverted on unmount rather than leaking app-wide.
- **Safety net:** `.rv` starts at `opacity:0`; if `IntersectionObserver` were
  ever unavailable the page below the hero would be invisible, so the effect
  reveals everything immediately in that case. `prefers-reduced-motion` also
  short-circuits every animation. The hero/nav carry no `.rv`, so the top of the
  page is visible regardless.
- Fonts (Fraunces + Inter) via `next/font` scoped to the landing container — the
  app shell's fonts are untouched.
- **Prices come from `plans.ts`**, not the markup: added raw `monthlyEur` /
  `annualEur` / `annualPerMonthEur` alongside the existing Portuguese labels so
  the English landing formats its own copy (€85↔€63 "billed €756 per year",
  €149↔€109 "billed €1,308 per year") without parsing PT strings or drifting
  from the in-app Plans page. The consultancy teaser is an English constant in
  the same module — still no percentages, no terms (fee stays suspended).
- The logo (teal badge, serif "S", lens) is a shared `components/Logo.tsx` used
  in the landing nav + footer, and `src/app/icon.svg` is generated from it as
  the favicon. The wordmark split ("sherlock" + accent "deal") lives in
  `brand.ts` as `BRAND_WORDMARK`.
- SEO: page-level `<title>`, description and Open Graph built from `APP_URL`.
  Root `/` is 99.7 kB first load, no libraries, inline SVG only.

**Not verified here (flagged):** the logged-in `/` → `/pipeline` redirect could
not be exercised — it needs a real session and I can't sign in. The scroll-driven
effects (nav state, reveal, meter fills) also couldn't be exercised: the headless
preview pane doesn't composite frames, so scroll events and IntersectionObserver
callbacks never fire there. Both are straight ports of the reference's script and
compile clean; worth a 10-second look on the deployed page.

## Rebrand — connectB → Sherlock Deal

Name change only — the visual design (colours #0E7490 / #22D3EE, layout, fonts)
is unchanged; a proper wordmark/logo comes later. New single source of truth
`src/lib/brand.ts`: `BRAND_NAME = 'Sherlock Deal'`, `BRAND_SHORT`,
`APP_URL` (from `NEXT_PUBLIC_APP_URL`, falling back to the current Vercel URL).
Nothing user-visible hard-codes a product name anymore.

- **Swept surfaces** (all read `BRAND_NAME`): sidebar wordmark + mobile header,
  HTML `<title>`/metadata, login/signup/invite/reset/forgot wordmarks,
  back-office header, the invite-account line, the transactional-email wordmark
  + subject/heading, and DEMO_SCRIPT.md.
- **Wordmark** is now single-tone `{BRAND_NAME}` — the old two-tone accent was
  tied to the "B" letter, which no longer exists. Colours/fonts unchanged.
- **Internal names kept** (no code-identifier churn): repo, table names,
  IRM_SPEC.md/DECISIONS.md, and code comments. DoD grep (case-insensitive,
  comments/infra exempt) leaves only two comments and the Vercel-URL fallback in
  brand.ts.
- **Emails**: sender display name is now "Sherlock Deal", but the address stays
  the verified Resend one (`onboarding@resend.dev`) until the sherlockdeal.com
  domain is verified in the provider — a separate infra step. `RESEND_FROM_EMAIL`
  overrides both, so the from-address switch stays env-gated.
- **User-facing links** (invite accept, Stripe checkout/cancel/portal return)
  now build from `APP_URL`, not the request origin — so the domain cutover is
  **one env change (`NEXT_PUBLIC_APP_URL=https://sherlockdeal.com`) + redeploy,
  no code edits**. OAuth/magic-link redirects deliberately stay on the request
  origin (they must match the actual host + Supabase/Google allowlists).
- No migration; build + 171 tests green; wordmark/title/login smoke-tested.

## Billing — Stripe subscriptions (env-gated)

Subscriptions are the only revenue (fee suspended). Everything is dark behind
`stripeConfigured()` (STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET + the 4 price
IDs) — same env-gate pattern as Resend/Gmail. **Until the env vars are set the
Plans page keeps its exact request-to-back-office flow; once set, the CTA
becomes real checkout.** Raw fetch to the Stripe API, **no SDK** (matches the
Anthropic/Resend convention) — one less dependency, and webhook signatures are
verified with Node `crypto` (HMAC-SHA256, 5-min tolerance, timing-safe).

- **Checkout** (`/api/stripe/checkout`, owner/admin): subscription-mode session
  for the price ID of tier+period; org_id/user/tier/period in metadata on BOTH
  the session and the subscription, so every webhook resolves the org with no
  lookup. Client redirects to the hosted page — **no card data touches our
  code**.
- **Webhook** (`/api/stripe/webhook`, public in middleware since Stripe has no
  cookie, signature-verified, service-role) is the **only** billing writer of
  `orgs.plan`: `checkout.session.completed` activates from metadata;
  `customer.subscription.updated/deleted` map the live price → plan via the pure
  `billingEffectFromEvent`. The manual back-office set-plan stays as an override
  (platform org, comps, support).
- **Portal** (`/api/stripe/portal`, owner/admin): "Gerir subscrição" → hosted
  portal (invoices, card, monthly↔annual switch, cancel); changes flow back
  through the same webhooks.
- **Downgrade/cancel**: `cancel_at_period_end` keeps status 'active' → the plan
  **stays until period end**; the `subscription.deleted` event then drops the
  org to `idea`. The AI-composer gate reacts automatically (it reads
  `orgs.plan`). Unit-tested.
- **Copy hygiene**: the UI says "🔒 pagamento seguro" — never the provider name.
- **Storage**: migration 0031 adds `orgs.stripe_subscription_id` +
  `stripe_billing_period` (`stripe_customer_id` already existed). Pending apply;
  the webhook falls back to a plan-only update if 0031 lags, so plan sync never
  breaks. Pure logic (`billing.ts`: price-ID resolution, event→plan, downgrade,
  sig-header parse) has 16 tests. Suite 171 green.

**⚠️ FLAG — IVA / Stripe Tax (needs your decision, not guessed):** checkout is
created WITHOUT `automatic_tax`. For EU/PT VAT you'll likely want Stripe Tax on
(and to decide B2B reverse-charge / collecting VAT IDs, and whether prices are
tax-inclusive). I did **not** enable it — tell me the tax treatment and I'll
wire `automatic_tax[enabled]=true` + `tax_id_collection` accordingly.

## Plans page — success fee suspended + Mensal/Anual toggle

**Success fee SUSPENDED** (founder decision after legal consultation): pending
regulatory clarity. Every user-facing trace is gone — the 1,3%, the 18-month
tail, the plan-deduction, and the "Termos sujeitos a contrato" caveat, plus the
`SUCCESS_FEE_COPY`/`SUCCESS_FEE_CAVEAT` constants themselves. In their place, one
discreet, terms-free note: **"Brevemente: opção de consultoria para captação de
capital."** No DB fields ever backed the fee (it was copy only), so nothing
dormant to keep. **Subscriptions are the only charge at this stage.**

**Mensal/Anual toggle** at the top of the plans table drives every price
(garage €85 ↔ €756/ano, motherfunding €149 ↔ €1.308/ano, free €0 either way)
via the pure `planPriceLabel(row, period)` — unit-tested.

**The request records the period.** No migration (as expected), so the chosen
period is encoded into the existing free-text `plan_change_requested` column:
annual → `<tier>@annual`, monthly stays a bare `<tier>` (back-compatible with
rows written before this). `encodePlanRequest`/`parsePlanRequest` (tested,
back-compat + legacy free/paid) handle both ends; the Plans page and back-office
Startups (pending list + set-plan) both parse it and show the period label.

## Fact-triggered reawakening + Data Room polish (E6 · E7 · F)

Two migrations ship pending application (0029 document_versions, 0030
reawakening_proposals) — both additive + capability-gated, so the app degrades
gracefully until each lands (the store loads them missing-table-safe, exactly
like company_facts/ndas).

**E6 — Collapsible folder tree.** Folders with subfolders get a ▾/▸ chevron;
collapsing hides the subtree. State persists per org in localStorage
(`dataroom-collapsed-<orgId>`). No migration. Smoke-tested: collapsing
"Materials" hid its 4 subfolders and persisted.

**E7 — File versioning (Google-Drive-style).** The "Replace" action becomes
"Nova versão" when migration 0029 is applied: uploading against a document
KEEPS the prior Storage object as a version (never deletes) and repoints the
document — so portal/signed URLs serve current automatically. The details area
gains a "Versões (N)" list: open any version, or **restore** an old one.
- *Design:* "restore" = another `addDocumentVersion` pointing at the older
  object (a new current version), never a deletion — matches the "never
  deletion" rule. The FIRST time a document is versioned, its existing file is
  snapshotted as v1 before the new upload becomes v2, so nothing is lost.
- *Fallback:* pre-0029 (capability off), the button keeps its legacy "Replace"
  behaviour (swap + remove old). One store action, `addDocumentVersion`, in
  both providers.

**F — Fact-triggered reawakening engine (the architecture).** The single
knowledge choke point: reawakening is evaluated ONLY when a canon fact is
confirmed (or superseded). There is **no cron, no periodic scan, anywhere** —
recorded here as a hard design rule; anything that would add a scheduled AI
sweep is out of scope and should be flagged, not built.
- **Trigger** (`store-supabase` confirm/editAndConfirm/supersede) fires
  `/api/reawakening/evaluate` fire-and-forget. Supersede passes the OLD
  statement so the model sees the delta.
- **Step 1 — mechanical prefilter (no AI):** dormant/passed entities carrying a
  `reopen_trigger`, MINUS (fact_id, entity_id) pairs already evaluated. The
  unique(fact_id, entity_id) constraint on `reawakening_proposals` IS the dedup.
  Empty shortlist → **zero AI calls**.
- **Step 2 — ONE batched AI call per chunk of ≤40** (the spec's guard):
  new fact + per-entity {name, reopen_trigger, prior pass reason, last contact}
  → per-entity {reopens, rationale, suggested wave, suggested fit}, forced
  tool-use. Prior pass reason is read from the entity's interactions
  (`pass_reason` lives on the interaction, not the entity).
- **Step 3 — proposals, never auto-moves:** reopens:true → 'pending' (Pipeline
  queue), reopens:false → 'dismissed' (evaluated, silent). The Pipeline banner
  ("N investidores podem renascer") cites the prior "não" verbatim + the AI
  rationale, with wave/fit **editable at approval**. Approve → entity back to
  'contacted' with the chosen wave/fit + a `follow_up_no_reply` agenda task;
  reject → 'rejected' (pair stays evaluated, never re-proposed).
- **Cost discipline (design rule):** AI runs only on fact confirmation, one
  batched prefiltered call per fact, deduped by evaluated pairs. Idempotent
  (upsert ignoreDuplicates), so a re-fired confirm is harmless.
- **Pure + tested:** `reawakening.ts` (prefilter, priorPassInfo, chunk,
  proposalStatusForVerdict, buildReawakenApproval) with 13 tests — the two
  store providers share `buildReawakenApproval` so the approval effect can't
  drift from the tested reference. Suite 148 green.
- *Flagged:* approval sets status → 'contacted' and keeps `reopen_trigger` (so
  the /log reopen-doctrine banner still fires on the next draft). If you'd
  rather it clear the trigger on reawakening, that's the line to change.

## Plans & Account + premium frosting (business model partially unparked)

Three tiers, names/prices verbatim, in one pure module `plans.ts` (single
source of truth): **Mom, I have an idea** (€0), **Dad, I'm leaving the garage**
(€85/mês · €756/ano), **Motherfunding** (€149/mês · €1.308/ano). All display
copy, the success-fee text, and the entitlement gate live there and are
unit-tested (11 tests).

**Migration surprise — a migration WAS needed.** The spec expected
`orgs.plan` to be free text; it was actually the enum `plan_tier ('free',
'paid')` from 0001. So **migration 0028** moves the column to text, remaps
legacy rows (`free→idea`, `paid→garage`), sets the default to `idea`, sets
ablute_'s org to `motherfunding` (full access), and adds the plan-change
request columns. **Pending manual application** — but everything degrades
gracefully first: `normalizePlan()` maps legacy values in code, so display +
gating work pre-migration; only *writing* the new tier names and the request
queue are gated on the `planAccounts` capability (a probe of
`orgs.plan_change_requested`). Safe to deploy before applying.

**A — Review & Optimization → premium preview.** The whole cards region is
wrapped in a frosted-glass overlay (`bg-white/55 backdrop-blur-[3px]` + a
centered "Disponível em breve, na versão Premium" pill) over a
`pointer-events-none blur-[2px]` content wrapper, so the Run action can't fire.
Everything built in Batch 3 is kept intact underneath. Gate = the
`entitlements.reviewOptimization` server value.
- *Flagged:* `reviewOptimization` is **false for every org, including the
  platform org** — so the founder sees the frost in their own session and the
  tool is fully parked. "Lift later without code changes" isn't literally
  achievable (there's no feature-flag store), but lifting is a **one-line**
  change in `plans.ts` (e.g. return `isPlatformOrg` or `plan === 'motherfunding'`).
  If you'd rather keep the built investability tool usable for the platform
  team now, say so and I'll flip that line.

**B — "Planos e conta" (new nav item, everyone).** Current-plan card + the
three tiers + the success-fee section with the PT copy verbatim and a
**"Termos sujeitos a contrato"** caveat pill — **no checkbox, nothing presented
as accepted terms**. **No payment processing:** the upgrade CTA files a
plan-change *request* (`/api/plan/request`, owner+admin only, service-role,
gated on `planAccounts`), which lands in the back-office. **Back-office
Startups** gained per-org plan management: a set-plan dropdown, a pending-
requests card with one-click "Aplicar pedido", and an "req" badge — all
platform-admin + service-role (`/api/backoffice/set-plan`), and the flip clears
the request. The startups route now `select('*')`s orgs (robust to the request
columns not existing pre-migration) and returns a `planManagement` flag.

**C — AI-composer plan gate (server-side).** The free `idea` tier does **not**
get AI-personalized outreach: the compose route resolves the caller's org plan
+ platform status and returns the locked copy ("A personalização por AI faz
parte dos planos pagos", reusing `configured:false` so `/log` shows it with no
client change). Mechanical templates + manual writing stay for everyone. The
gate **composes on top of** the existing env switch (`ANTHROPIC_API_KEY`) — both
must pass — and is enforced in the route, not just hidden in `/log` (which also
shows the locked copy, sourced from `/api/me` entitlements). Platform admins and
paid plans are unchanged. Skipped in demo mode (no auth to resolve a plan).

**PlanTier moved to the 3 tiers** in `types.ts`; seed/EMPTY_ORG/tests updated
(ablute_ seed → `motherfunding`, new-org default → `idea`). No callsite compared
against `'free'`/`'paid'`, so the type change had a small ripple. Smoke-tested in
demo mode: plans page (verbatim copy + CTA states), the R&O frost
(blur + non-interactive content confirmed), current-plan resolution.

## Restructure + founder-feedback batch 3 (nav/Settings redesign, permissions matrix, "melhorias e problemas")

Founder-specified execution order **B+D → A → C → E**. Three migrations
(**0025 review_runs, 0026 orgs.permission_matrix, 0027 documents.position**)
ship in the code but are **pending manual application** — every feature that
needs one is capability-gated (`/api/me` probes the column/table), so the app
degrades to its pre-migration behaviour until they land, then lights up within
~60s (the negative-probe TTL). Nothing here breaks if a migration is late.

**B — Organisation editing (was a bug: owner couldn't edit).**
`can()`'s `manage_org_settings` widened from owner-only to **`['owner','admin']`**;
manager/member stay read-only. Enforcement is **server-side** in a new
`/api/org/update` route (service-role, after an app-level role check) rather
than an RLS change — the `orgs` UPDATE policy is owner-only and a route mirrors
the team-member pattern already in the codebase without a schema migration.
`OrganisationCard` gates the form; the Supabase store's `updateOrg` optimistic-
commits then posts there. EDITABLE fields are an explicit allow-list
(name, sender_email, website, sector, stage, round_target_eur, country,
one_liner, daily/weekly cap); `''`→null so a cleared field really clears.

**D — Email flow cleanup (remove the investors@ablute.pt BCC).**
The BCC on every compose/send path read as surveillance; the in-app interaction
log is already the record. Swept `mailto:` links (ui.tsx), the §8d send route,
and the "how it works" copy in /log, /people/[id], /automations. The
`bcc_email` column is **left in place but unused** — additive/reversible; no
destructive migration just to drop a column.

**A — Nav / Settings restructure + "Review & Optimization".**
Settings now holds only: Organisation, **Company facts** (the full canon
management panel, moved here — see interpretation below), Invite teammates /
People, and **Automations** (moved *into* Settings; the `/automations` route
still resolves for deep links but is no longer a top-level nav item). The
"Company" nav item is renamed **"Review & Optimization"** (kept the `/company`
href + `companyCanon` gate) and now carries AI Review, deck/one-pager review,
**Market data repurposed** to benchmark the *startup's own* sector (not
investor research), and the **investability ranking (§11f MVP)**: a "Run
review" action that grounds on confirmed canon facts + live pipeline stats and
returns a structured report (score + strengths/weaknesses/risks/
recommendations) via forced tool-use, **stored per run** in `review_runs` so
the founder can watch readiness evolve. Full SWOT depth iterates later.
- *Interpretation flagged:* "Company facts moves to Settings" was read as moving
  the **entire canon panel** (add + confirm/reject/supersede), not just the
  "Add a fact" block — so add and confirm don't end up split across two pages.
  Revert if you wanted only the add-block relocated.

**C — Owner-configurable permissions matrix.**
New pure module `org-permissions.ts`: a `MatrixCapability` union (data-room
read/upload/manage, access grants, outbox approval, automations config, packs
unlock, back-office access, invites, org editing), `DEFAULT_MATRIX` = today's
permissions, and `resolveMatrix(overrides)` which merges overrides but **always
force-grants the owner every capability** (no lockout is representable). Stored
as `orgs.permission_matrix` jsonb (0026); owner-only GET/POST at
`/api/org/permissions`; owner-only `PermissionsMatrixCard` table with the owner
column fixed/disabled.
- *Enforcement scope, flagged honestly:* the two capabilities whose writes pass
  through a **server route** are enforced against the matrix today — **org_editing**
  (in `/api/org/update`) and **invites** (in `/api/invite/create`), both via
  `loadOrgMatrix` + `canWithMatrix`. The remaining capabilities' writes currently
  go through the **browser client under membership RLS**, so their matrix toggles
  are configuration + client-gating until those paths move server-side. That's a
  mechanical follow-up, not a redesign — the pure layer and storage already model
  the full matrix. **Back-office access** is doubly protected: the matrix toggle
  can only *further restrict*; `platform_admins` + `is_platform_admin()` remain
  the hard gate.

**E — "melhorias e problemas" (items 1–5; item 6 was folded into A).**
1. **Entity classification editing** — new `EntityClassificationEditor` with
   per-field pencil toggles; sectors/geos are **multi-value chips** off a
   standardized `taxonomy.ts` (SECTORS/GEOGRAPHIES/STAGE_OPTIONS) with an
   "outro…" free-text escape; stage is a min–max pair. Writes via the generic
   `updateEntity`. *Deferred:* the optional per-edit **note** — the inline
   editor lands the value; annotating each change is a later pass.
2. **Pipeline reopen note** — a dormant/passed entity that resurfaced via the
   reopen doctrine shows its `reopen_trigger` inline (↻) so "why is this back"
   is answered in place.
3. **Agenda** — events are clickable → a summary popover with a mark-done
   toggle; **completed tasks no longer vanish** — they stay, turn green with a
   ✓, and a `completed` rail is shown.
4. **Dashboard** — the "follow-ups due (7d)" and "passes (with reasons)" cards
   are now buttons that toggle an inline quick-list (dates; entity + reason
   category + verbatim reason).
5. **Data Room v3** — nested subfolders **already worked** (FolderNode recurses
   on parent_id/position — no change needed). Added: **drag-to-reorder within a
   folder** (persisted `documents.position`, 0027), **drag a document onto a
   folder to move it**, and a per-document **Replace file** action that keeps
   the same row/name/grants/details and swaps only the Storage object. The pure
   `reorderByDrag()` reorder math is unit-tested (6 cases); reorder + move are
   gated on the `documentOrdering` capability, Replace is independent.

**Tests** (founder's standing ask — cover where logic lives): `org-permissions.test.ts`
(8: defaults/override/owner-always/canWithMatrix), taxonomy multi-value via the
editor, and `reorderByDrag` persistence (6). Suite 124 green; build green.

## Needs-review triage toolkit + capability-cache fix (founder use case: Alantra)

**Bug fixed first (its own commit):** the capability probes cached a NEGATIVE
result for the life of the server instance, so an instance that first probed
before a migration was applied reported the feature unavailable forever — the
founder's live session showed "AI pre-classification isn't available in this
workspace yet" long after migration 0021 landed. New shared
`makeCapabilityProbe()` factory: positives cache indefinitely (a table
doesn't un-exist), negatives re-probe after a 60s TTL. All five probes
refactored onto it (also DRYs out five copies of the boilerplate). `/needs-
review` and `/company` now fetch `/api/me` with `cache:'no-store'`.

**The toolkit** — each pending dossier item gained:
- **Full inline edit** of content, date, channel, direction, and
  classification. The import's placeholder date (`2018-01-01`, stamped on
  "(sem data)" rows) shows as a muted "data por confirmar" pill with a
  tooltip, and a date parsed from the item's own Portuguese text ("25 de
  maio de 2022") is offered as a one-click "📅 usar 2022-05-25" correction —
  fixing the "last touch 3125 days ago" distortion the Alantra case
  described.
- **Route-to actions**: "Criar pessoa daqui" (parses name/email from the
  text, pre-fills the existing quick-create mini-form, links the item, and
  offers to link the rest of the dossier's unassigned items); "Guardar como
  dados da entidade" (fills empty entity contact fields + files the full
  text as a dated note); "Adicionar interação ao fio" (backfills a
  remembered interaction the import never captured).
- **Single-step undo**: a persistent bar + `u` key reverts the last triage
  action, including un-creating a routed person (unlink-then-remove) and
  un-filling entity fields.

**Design decisions worth flagging:**
- **Manual triage no longer flips entity pipeline status.** The original
  dossier's classify pills went through `classifyInteraction`, which
  transitions the entity's status (e.g. → in_conversation). All manual
  triage now goes through a new generic `updateInteraction(id, patch)`
  instead, WITHOUT that side effect — deliberately: these are historical
  imported memories, and one old "interested" reply shouldn't flip an
  entity's *live* pipeline status. It also makes every action cleanly
  reversible (the AI pre-classification pass still uses the old path,
  unchanged). If the founder wants historical triage to still move pipeline
  status, this is the line to revisit.
- **Undo is single-step and session-scoped**, per the spec. The inverse
  logic (`invertTriageAction`) is a pure function in needs-review-logic.ts
  with its own tests; the store gained matching primitives
  (`updateInteraction`, `addInteraction` [side-effect-free, unlike
  `logInteraction`], `removeInteraction`, `removePerson`). Also added an
  `undefined→null` coercion (`nullify`) to the Supabase `updateInteraction`/
  `updateEntity` persists — without it a patch that *clears* a field was
  silently dropped by `JSON.stringify` (a latent bug for the entity-contact
  edit card too, now fixed).
- **"Guardar como dados da entidade" falls back to a bare-email regex** when
  the item isn't a labelled "Email: X" contact card — so it works on ANY
  item's prose (Alantra's email is in a sentence), per the spec's "invoke on
  any item." email/phone/address fills are gated on the entityContactFields
  (migration 0024) capability; website/email_domain/note always work.

**Verified:** 110 unit tests green (17 new: PT-month date parser, person-hint
parser, undo inverses); typecheck + build green. Smoke-tested the full
Alantra flow live in demo mode — the placeholder-date "📅 usar 2022-05-25"
one-click, "Criar pessoa daqui" pre-filling "Merce Tell"/email and creating
her unverified + linked, "Guardar como dados da entidade" filling the domain
+ note and clearing the item, and "Adicionar interação ao fio" backfilling a
remembered meeting with NO follow-up-task side effects — each with its undo
reverting cleanly, zero console errors throughout.

## Founder-feedback batch 2 (23 Jul): profile editing, send flow, quick-create, conflict cleanup

Shipped in the requested order — 4 (cleanup/hygiene) → 1 (contact fields,
migration first) → 2 (post-compose flow) → 3 (quick-create + verification) —
four separate pushes, each build/typecheck/test green.

**Item 4 — conflict-display cleanup.** Entity/person profiles were
rendering raw import-conflict log lines verbatim ("submitted — §9b import
conflict — existing: X vs imported: Y") straight to the founder: backend
jargon, a leaked spec reference, and a repeat of what the field above
already showed. Now a small "por verificar" pill; clicking it opens a
compact compare popover (valor atual vs importado) with "Manter"/"Usar
importado". New founder-facing `/api/contributions/resolve` route (flips
the contribution's status only — RLS has no update policy for org members
on `contributions` by design, so this needed service-role after an
explicit org-membership check; distinct from and never touches the
existing platform-admin-only back-office review route) plus new generic
`updateEntity`/`updatePerson` store actions for the actual write-back.
Swept the rest of the app for similar leaks — none found; the import
staging pages show this detail in-context while the founder reviews their
own import, which is expected, not a leak.

**Item 1 — editable entity contact fields.** Entities had no direct
email/phone/address, only indirect/verification-tracked website/
email_domain with no edit affordance at all. Migration 0024 (email, phone,
address on entities; bundled with item 3's people.gender/
identity_verified since both are small and land in this batch) — pushed
alone first as instructed, capability-gated via the established probe
pattern. One correction worth flagging: the instruction assumed person
profiles already had an inline-edit pattern to mirror for entities; they
didn't — only the existing `interest_eur` input+Save on the entity page
did. This establishes the pattern (edit-toggle + Save, one small "Contact"
block) rather than copying something that wasn't actually there.

**Item 2 — post-compose action flow.** The primary action after a draft
now matches the channel: email+Gmail is unchanged (existing "Send from X &
log"); email without Gmail gets a new Copy button + "Confirmo que enviei";
LinkedIn (DM or connection note) states the ToS constraint explicitly and
adds connection-stage guidance (first-ever touch → suggests a connection
request + note, hard-capped at 300 chars — new `LINKEDIN_NOTE_MAX` in
rules.ts, distinct from the DM cap — over a DM that assumes an existing
connection). "Confirmo que enviei" is not new logic — it calls the exact
same `save()`/`logInteraction` path everything else uses, which already
auto-creates the 14-day follow-up task for outbound interactions. That
task-shape object literal was duplicated verbatim between store-demo.tsx
and store-supabase.tsx; extracted to `rules.ts`'s `buildFollowUpTask()` so
it's tested once (2 tests) instead of never, alongside 3 tests for the new
LinkedIn-note cap.

**Item 3 — quick-create person.** `/log`'s person select gets "Outra
pessoa…" → an inline mini-form (name required, role/gender/LinkedIn/email/
phone optional) → new `addPerson` store action, attached to the entity
immediately, seniority rank defaulting to least-senior-so-far. Verified
live: the new contact correctly triggers the existing seniority-order
pre-flight check against the entity's real rank-1 person — no special-
casing needed, it's a real row like any other. Flagged `identity_verified:
false`, shown as an "identidade não confirmada" pill on their profile.

Cross-org existence signal: a new pure module
(`src/lib/person-similarity.ts` — Sørensen–Dice bigram name similarity +
greedy same-context clustering, `CROSS_ORG_REPORT_THRESHOLD = 10`
configurable constant, 12 tests) plus a minimal platform-admin/service-role
route (`/api/backoffice/unverified-people-signal`) computing it cross-org
and returning aggregate-only data (counts + proposed fields, never org
identities or interaction content — same discipline as Startups/Métricas).
No back-office UI added for it — with today's single-org reality it always
returns an empty list, so a UI would show nothing to look at; deferred
rather than built speculatively, exactly as the founder's own framing
anticipated.

**One assumption that didn't hold, disclosed rather than papered over**:
the spec described reusing "the existing AI research (§6b-3) mechanism"
for a quick-created person. That mechanism (`/api/backoffice/research`) is
cross-org-by-catalog-entity-name and platform-admin-only — it looks up VC/
investor firms, not individual people, so it doesn't actually apply here.
Not wired up to anything; noted rather than building a route that only
superficially resembles reuse.

**Migration numbering**: the founder's message assumed "migration 0022"
for item 1, written before knowing last session's Data Room V2 work had
already claimed 0022 and 0023. This is 0024.

## Data Room V2 (founder feedback batch, 23 Jul: 2 bugs + 5 features)

Shipped in three pushes, in the order requested — bugs first (unblock daily
use), then document/folder management, then the grants redesign.

**B1 — Storage upload "Invalid key" for accented/spaced filenames.** Supabase
Storage keys must be ASCII-safe; a real file named "Consulta de Certidão
Permanente 07-2026 (1).pdf" broke the upload. Fixed with `sanitizeStorageKey()`
(`src/lib/data-room.ts`, NFD diacritics-fold — same technique as
catalog-dedupe.ts's `normalizeName`) applied only to the Storage key; the
original filename is untouched as the document's display name.

**B2 — Google Docs/Sheets/Slides/Drive links always rejected as "editable".**
Their canonical share URL always contains `/edit` regardless of actual
(server-side) permission — a real DB constraint (`no_edit_links` on
`documents`, migration 0001) enforces this at the database level too, so the
fix has to rewrite the URL before it's ever stored, not just relax a client
check. `normalizeDocumentUrl()` rewrites the specific, well-known Google
formats to `/preview` or `/view`; every other `/edit` link (Notion, anything
else) is still rejected. 14 unit tests.

**F1/F2/F3 — document delete/rename/details, multi-file upload, folder
CRUD.** New store actions (`deleteDocument`, `renameDocument`,
`updateDocumentDetails`, `createFolder`, `renameFolder`, `deleteFolder`).
Folder delete is blocked with a clear error if non-empty unless the founder
explicitly chooses "move contents to parent" — never a silent cascade, even
though the DB's own `folders(id) on delete cascade` would otherwise allow
one. `documents.details` (migration 0022) is capability-gated exactly like
§11/needs-review before it — hidden with a plain note until applied.

**F4 — access grants redesigned as a tri-state selection tree.** Pick the
investor, then click through the org's whole folder/document tree: one
click = shared, two = shared + NDA required, three = back to not shared.
Clicking a folder cascades to everything inside it; clicking an individual
document afterward overrides just that one. `diffGrantSelection()` turns
"what changed since this investor's existing grants" into a minimal
add/revoke plan, so reopening the panel and resubmitting the same selection
is a no-op rather than duplicating grants.

**A real bug caught during live smoke-testing, not by the unit tests**:
sharing a folder, then overriding one document inside it to require an NDA,
did nothing — the portal still showed that document, because it was ALSO
reachable via the folder's own (unlocked) grant, and the original
"any applicable grant unlocks it" check let the looser one win. Fixed with
`resolveDocumentAccess()`: a document's own grant now always takes priority
over the folder it lives in, in *either* direction (a doc can be unlocked
inside a locked folder, or locked inside an unlocked one) — 5 new unit
tests covering exactly this, plus the fix wired into both the real
`/api/portal/access` route and the demo-mode portal page (same function,
not two reimplementations that could drift).

**F5 — NDA handling replaces the old self-serve "I accept the NDA terms"
click** (which never attached a real document — just a timestamp) with the
founder uploading the actual signed file, cross-checked by AI against the
investor's name/entity and the org (Claude's native PDF input, no separate
text-extraction step). A mismatch or unclear verdict is stored and still
unlocks access — flagged "correspondência incerta — verificar" for the
founder to check, never a block. The file is kept as a real attachment,
visible in a new "NDAs on file" card on the entity/person page (migration
0023, `ndas` table, capability-gated: `src/lib/data-room-capability.ts`'s
`ndaSystemAvailable()`). `/api/portal/accept-nda` and its portal button are
deleted, not deprecated — there's nothing left to click through.

**A second real fix, found while rebuilding the portal route for the above**:
`/api/portal/access` used to fetch and mint signed URLs for EVERY granted
item regardless of NDA status, and rely entirely on the client hiding the
whole page behind a blanket gate — meaning a locked document's real signed
URL was already sitting in the network response before any "acceptance."
The gate is now per-item and server-side: a locked item is never fetched or
included in the response at all, and the portal just shows a count of how
many are still pending ("Awaiting NDA — N more item(s)...").

**Migration numbering note**: the founder's message assumed the grants
remodel would land as "migration 0021," written before knowing last
session's needs-review work had already claimed that number. Used 0022
(documents.details) and 0023 (ndas) instead, in sequence — flagging here
since the original ask named a specific number.

**Verified**: 76/76 unit tests, typecheck, and build green on every push;
each batch smoke-tested live in demo mode (folder/document CRUD, the
tri-state tree's cascade + override + submit-as-diff, and the portal's
per-item visibility both before and after the resolveDocumentAccess fix) —
zero console errors throughout. Not verified live: the actual AI NDA
cross-check and real Storage upload path, both of which need a real
Supabase project + ANTHROPIC_API_KEY and are gated behind capability probes
exactly like every other AI-assisted feature in this codebase, so they stay
inert until the founder applies 0022/0023 and confirms.

## Needs-review redesign: dossier view + AI/mechanical pre-classification (23 Jul, founder feedback)

**Why:** the original one-card-at-a-time /needs-review flow (shipped the
night before) doesn't work at ~380 cards — the founder's real feedback:
"the unit of work is the entity dossier, not the interaction; many items
aren't even interactions; and text isn't editable." Full redesign per that
feedback, everything additive and capability-gated so nothing changes until
the founder applies the new migration (see below).

**What shipped:**
- `/needs-review` is now entity-grouped: a left rail of entities with
  pending counts, and a main pane showing the FULL chronological thread for
  the selected entity (reviewed or not, for context) — not just the pending
  items. Each row has an inline edit affordance for the text
  (`updateInteractionContent`, new store action) and the existing
  classify/no-signal pills. Keyboard: `j`/`k` moves the focused item, `J`/`K`
  (or `n`/`p`) switches entity, `1`/`2`/`3`/`r` classify exactly as before,
  `e` edits, `a` accepts every stored AI proposal in the current dossier.
- **Contact-metadata cards** (an auto-reply/signature dump like "Email: X /
  Telefone: Y / Endereço: Z / De <url>") are detected by regex
  (`src/lib/needs-review-logic.ts`'s `looksLikeMetadataCard`/
  `parseMetadataCard`, mirroring the existing `.md`-import contact-fact
  parser and its `linkedin.com`-etc bogus-site filter) and resolved via a new
  `applyMetadataCard` store action: fills ONLY empty entity fields
  (`email_domain`, `website` — never overwrites a founder-verified value),
  appends the full original text as a dated "Ficha de contacto (importada)"
  note on a new `entities.notes` column, and clears the review flag. Phone
  and address stay inside that note text — no new schema fields for them,
  per the explicit instruction not to add any.
- **Mechanical (no-AI) resolution**: an outbound message with no inbound
  reply anywhere later in that entity's thread is deterministically resolved
  as `awaiting`/no-signal — the one shape in this data that's genuinely
  unambiguous from direction alone. Free, instant, no API call.
- **AI pre-classification** (`/api/needs-review/classify-entity`, one call
  per entity dossier, same batched-per-unit pattern as the `.md` import's
  person-mention extraction): only ever called for interactions the
  deterministic pass couldn't already resolve — a real cost guard, not just
  a suggestion. High-confidence proposals auto-apply and get tagged
  `classified_by` (new `interactions` column: `'ai' | 'mechanical' | null`);
  everything else stays queued with the model's reasoning shown inline.
  Every auto-applied row is findable via the "Show AI-classified" toggle in
  the dossier view and revertible with one click (`revertToNeedsReview`).
  Any human reclassification (the plain 1/2/3 pills, no extra argument)
  automatically clears the tag back to null — ownership always reflects who
  currently owns the call, not a permanent history of who first touched it.
- The single source of truth for "what's confident enough to auto-apply" is
  `decideAutoApply()` in `needs-review-logic.ts` — a metadata_card claim only
  auto-applies if the regex actually found a real email/website to back it
  up (never on the model's say-so alone); a real interaction only auto-
  applies at high confidence. 15 unit tests, all against fixtures, no DB.
- **Migration 0021** (`interactions.classified_by`, `entities.notes`, both
  additive/nullable) — capability-gated exactly like §11's Company Canon:
  `src/lib/needs-review-ai.ts` probes column existence, exposed as
  `capabilities.needsReviewAi` via `/api/me`. Until applied, the dossier
  view still works today (grouping, full thread, manual classify, inline
  edit — none of that needs the new columns), but the "Run pre-classification
  pass" button and the AI-classified filter/revert stay hidden, with a
  plain note explaining why.

**Verified tonight:** typecheck/vitest (44/44)/build all green; a live smoke
test in demo mode (temporarily working around the fact that local dev now
authenticates against real Supabase, same as production — moved `.env.local`
aside, tested, restored it byte-for-byte afterward) confirmed the dossier
render, entity-switch, classify, no-signal, and inline-edit-save all work
against injected fixture data with zero console errors.

**Not run against production tonight — here's why, and what's left:**
While preparing to apply migration 0021 (and the still-unapplied 0020 from
last night, in the order the founder asked for), the Supabase MCP tools
connected to this session turned out to be scoped to a **different account's
projects** — `ablute_wellness_master_project` and
`ablute-wellness-staging-disposable` — neither matching connectB's actual
project ref (`wkjcaoqdvhykrfacsylr` per CLAUDE.md); a direct `get_project`
call against the real ref returned a permission error. Flagged this
immediately rather than guessing which project was "close enough." The
founder chose to apply both migrations manually via the SQL editor rather
than granting this MCP connection access to the right project. **So:**

1. Apply `supabase/migrations/0020_company_canon.sql`, then
   `supabase/migrations/0021_needs_review_ai_triage.sql`, in that order.
2. Reload the app once — `/api/me` will report both capabilities as `true`.
3. Go to `/needs-review` and click "✨ Run pre-classification pass" — this
   is a browser-driven action (real auth required), so it has to be the
   founder clicking it, same as every other AI-assisted flow in this app.
   It runs the deterministic pass first, then AI only for what's left, and
   shows a summary banner (contact cards / mechanical / AI-high auto-
   applied vs. left for human review) right in the page — no need to ask
   for the numbers separately.
4. Whatever's left in the queue after that is the real remaining human
   review work — expected to be a small fraction of the ~380 it started at.

**If a Supabase MCP connection to the correct project is ever wanted**,
worth checking why this session's connector only surfaced the wellness
projects — possibly a different Supabase organization/account than the one
`wkjcaoqdvhykrfacsylr` lives under.

## MORNING BRIEFING (overnight block, 23 Jul → demo morning)

**Three things to glance at before the demo:**
1. **Nothing changed in how the app looks or behaves tonight, on purpose.** The
   composer, pre-flight, and rules.ts are byte-behavior-identical to yesterday
   — the entire Company Canon feature (§11) is code-complete but wired behind
   a capability check that's currently OFF (migration 0020 not applied yet).
   You will not see a "Company" nav item, an alignment banner, or a
   confirmation popup anywhere tonight or during the demo unless you apply
   that migration first.
2. **When you're ready for Company Canon to go live** (any time after the
   demo — no rush): apply `supabase/migrations/0020_company_canon.sql`
   (already pushed to main) via the SQL editor. The app will pick it up on
   the next request — no redeploy needed, no further code changes. A
   "Company" nav item appears, and you can start confirming facts.
3. **Two small real fixes landed** that DO change today's behavior, reviewed
   as safe: the investor portal's sign-in button no longer claims
   "(demo: signs in directly)" when it's actually doing a real access check
   in production (was misleading investors), and Automations' "Full auto"
   toggle is no longer greyed out behind a paid-plan lock that nothing
   server-side ever enforced anyway (dead UI, now just works).

**What shipped tonight, in brief:**
- **Task A — demo-readiness sweep**: walked every founder-facing route in
  demo mode (proxy for "does the code work," since I can't log in as you —
  see the note in Task C below). Zero console errors anywhere. Fixed the
  portal button text bug above and neutralized two "Supabase" mentions in
  `/api/automations`'s internal (never-rendered) JSON messages. Wrote
  `DEMO_SCRIPT.md` at the repo root — a 15-minute walkthrough in Portuguese
  using real pipeline entities (Bynd, MAZE, Lurdes Gramaxo), verified
  against production read-only right before writing it, plus a "do not
  click" list of anything that would send a real email or mutate real data
  live in front of the prospect.
- **Task B1 — Contributions bulk triage**: a pure byte-diff classifier
  (`src/lib/contribution-diff.ts`, tested) tags each of the back-office's
  pending contributions cosmetic/substantive (case, accents, quotes,
  whitespace, "AT"/"Austria"-style pairs) — filter chips, select-all-in-
  filter, bulk verify/reject. Bulk is a UI convenience only: every id still
  goes through the existing single-item review endpoint, so per-row audit
  logging is unchanged.
- **Task B2 — needs_review triage** (`/needs-review`, new nav item with a
  count badge): keyboard-first (j/k/1/2/3/r) review of the ~380 imported
  interactions whose original outcome coloring was lost. Found and fixed a
  real timing bug while building this — a lazy-initialized "reviewed count"
  raced the demo store's async localStorage hydration and could read stale;
  replaced with an explicit counter.
- **Task C — Company Canon (§11)**: full stack, capability-gated throughout.
  Migration 0020 pushed already (company_facts + entity alignment columns).
  `/api/me` exposes `capabilities.companyCanon` from a cached, cheap
  existence probe (`src/lib/company-canon.ts`) — the single source of truth
  every canon-dependent code path checks. Built: the data model + store
  actions (add/confirm/edit-confirm/reject/supersede — facts are never
  deleted, only superseded), the `/company` page (review queue + confirmed
  facts by category + history), the composer's provenance gate (§11b — a
  real hard gate: `/api/compose` only asks the model for `claims[]` when it
  was actually given confirmed facts to ground against, and `/log` never
  shows a draft with an unconfirmed claim — it shows a confirmation popup
  instead, whose answer is saved as a new fact and triggers a regenerate),
  the consistency-engine delta for reopened entities (§11c), and the
  misalignment verdict shown on the entity page (§11d). All three
  computational cores (gate contract, delta, alignment) are pure functions
  with 12 passing unit tests against fixtures — no DB, no migration needed
  to run them. One real bug caught by writing those tests: the alignment
  verdict's severity was originally inferred by grepping its own reason
  text for words like "exceeds," which silently misclassified a case whose
  wording didn't happen to match — fixed to tag severity explicitly instead
  of re-parsing generated text.
- **Deferred, logged rather than rushed**: the §11e bootstrap extraction
  pass (AI-scanning already-imported history + Data Room docs for candidate
  facts) — a genuinely separate feature on top of an already-large night;
  the review-queue UI it would feed already exists and works for
  manually-added facts. Task D (TODO sweep, more `rules.ts` test coverage)
  — explicitly lowest priority in tonight's instructions ("if time
  remains"), and it didn't.
- **One verification gap, by necessity, not oversight**: I could not log in
  as you to click through the real authenticated app or fire a real
  `/api/compose` call end-to-end tonight — entering your password is
  outside what I'm allowed to do, and there is no other path to an
  authenticated session in this environment. Everything above was verified
  via demo mode (same components, same code, no auth needed), direct
  read-only checks against production, and full `tsc`/`vitest`/`next build`
  passes on every change. The provenance gate specifically is marked in the
  spec itself as "verified after the demo, not during it" — consistent with
  that, tonight's verification is code-level (types, tests, build) plus the
  capability check confirmed live against production (`capabilities.companyCanon: false`, exactly as expected before you apply the migration).

## PERMANENT RULE — copy hygiene (added 2026-07-23, founder-mandated)

**User-facing copy must never mention:**
- Environment variable names (`ANTHROPIC_API_KEY`, `RESEND_API_KEY`, etc.)
- AI/service vendor names (Anthropic, Claude, Resend, Supabase, Vercel, Stripe)
- Development phases or roadmap internals ("Phase 7", "billing isn't wired
  up yet", "NEXT_STEPS")
- Spec/section references (`IRM_SPEC §x`, `§9b-4`, etc.), internal table/
  column names, RLS, migrations

Say **"AI"** generically ("AI review", "AI-assisted") — never the provider.

**Applies to every user-visible surface**: pages, tooltips, empty states,
toasts, emails, error messages returned from API routes and rendered by a
page. **Back-office (developer/platform-admin role) screens are exempt** —
that's a different, technical audience and IRM_SPEC/vendor references stay
useful there.

**Why**: screenshots showed real leaks — an env var name, a roadmap phase
number, and a spec citation, all in founder-facing Settings. A founder
mid-fundraise should never see the seams of how the product is built.

**How to apply going forward**: before adding any user-facing string,
check it against this list. When a feature isn't available, say what's
true in plain language ("isn't available in your workspace yet" /
"coming soon") — never why (env var missing) or when (a phase number).
Error messages returned from API routes are just as "user-facing" as page
copy the moment any page renders them — sanitize at the source (the route),
not just at the display site, so a future caller can't accidentally
re-introduce the leak.

## §2/§3 entity & person profile enrichment

- **Entity summary card uses only existing fields.** IRM_SPEC §2 mentions
  "notable portfolio, co-investors" — those aren't modeled on `Entity` yet.
  Rather than bolt on ad-hoc columns before §1 (contributions) formalizes
  the authored-field data model, the summary card only surfaces what's
  already there (website, domain, HQ, geos, sectors, stage range, check
  size, thesis, network notes). Portfolio/co-investors should be designed
  as part of §1's field schema, not invented twice.
- **"Add info" is a placeholder, not a real flow.** Clicking it shows an
  inline "coming in a later phase" acknowledgment — no data is written.
  Real authored contributions land with §1.
- **One page-level "private to your org" badge, not per-field.** §3 asks
  for a private/public badge per field; since nothing is public yet (no
  catalog promotion exists until §1b ships), a per-field badge would be
  15 identical pills with zero information value today. One badge near
  the page header communicates the same fact without the noise. Revisit
  once §1b promotion is real and fields can actually differ.
- **Person "preferences/thesis" and "likes/interests" are not new fields.**
  Same reasoning as portfolio/co-investors — `hook`/`watch_outs`/`kill_words`
  already cover outreach intelligence; adding parallel free-text fields
  before §1's contribution model exists would mean re-modeling them later.
  Only genuinely-existing-but-unshown field surfaced: `personal_notes`.

## Phase 2 onboarding

- **Only org name + person full_name/title are required.** IRM_SPEC lists
  a longer field set (website, sector, stage, round target, country,
  one-liner, phone, LinkedIn) without marking which are mandatory. Requiring
  all of them would block signup on details a founder may not have typed up
  yet; the rest of the app already tolerates partial/missing data everywhere
  (optional fields throughout `Entity`/`Person`). Matches that pattern.
- **Owner-email special-case kept, not removed.** `ablutecompany@gmail.com`
  still auto-links to the real ablute_ org (15 real entities) instead of
  getting a fresh empty org — removing it would strand Nuno's own account.
  "Revisit" was interpreted as "make sure it still works with the new
  profile fields," not "delete it." Now also stores the owner's own person
  profile (full_name/title/phone/linkedin) on that org_members row.
- **Owner email became a LIST (`OWNER_EMAILS`), 2026-07-27.** The project
  account moved to `sherlockdeal.com@gmail.com`, so both that address and
  the original `ablutecompany@gmail.com` now grant owner-of-ablute_ plus
  `platform_admins`. Swapping one for the other was the alternative and was
  rejected: with a single constant, signing up as the address that ISN'T in
  the code produces an ordinary founder with a fresh empty org and no
  back-office, and nothing in the UI explains why — an easy way to lock the
  owner out of the platform console. A list costs nothing and fails safe.
  `RESEND_FROM_EMAIL` deliberately did NOT move: the from-address must sit on
  a domain verified in Resend, and only `ablute.pt` is verified today.
- **profiles live on `org_members`, not a separate `profiles` table.**
  IRM_SPEC allowed either. One row per (org, user) already exists; adding
  columns there avoids a join for something that's 1:1 per membership today.
  If a user ever needs one profile shared across multiple orgs, revisit.

## Phase 3 team invitations

- **Only "who can invite" is enforced, not the full permission matrix.**
  NEXT_STEPS asks for permission checks on "who can invite, edit, approve
  outbox, manage data room, unlock packs" — that's granular ACL work across
  ~10 existing pages/actions, a materially bigger scope than "add team
  invitations." This pass gates invite-creation to owner/admin (enforced in
  RLS itself, not just the UI) and stops there. Every other action stays
  open to any org member, same as before. Retrofitting the rest is a
  follow-up once the invite flow itself is proven, not bundled in blind.
- **Email sending is a literal stub, per instruction.** `sendInvite()`
  creates the row and shows the `/invite/<token>` link in the UI for the
  owner/admin to copy and send by hand. No email is sent — that's Phase 5.
- **Invite accept flow lives outside the StoreProvider abstraction.**
  Invitations are account/org administration, not CRM content, and don't
  make sense in demo mode (no real multi-user auth there) — so they're
  handled directly via `browserClient()` in the settings page + two service-
  role API routes, rather than extending `StoreApi` with invitation CRUD.

## §1 contributions + back-office verification

- **No two-tier public/private catalog for entities/people.** IRM_SPEC's
  §1a design assumes entities/people sit on top of a shared public catalog
  with a per-org overlay (like `catalog_entities` already does for investor
  packs) — that doesn't exist for entities/people; each org's `entities`/
  `people` rows are just their own private data, full stop. Building the
  real two-tier model is a significant remodel (new catalog tables, a merge/
  diff layer, migrating existing per-org rows) — bigger than "add
  contributions." Instead: `contributions` is a free-form field/value log
  keyed to the org's own subject_id, shown back to that org immediately,
  and readable cross-org by platform admins for §1b. "Verify" confirms
  accuracy; it does not yet rewrite anyone's entity/person row or "flow to
  every org" — there's no shared row to flow into yet. Revisit once/if the
  catalog model gets built out for entities/people the way it exists for
  packs.
- **§1c (multi-affiliation people) is not in this pass.** The work item
  said "§1 contributions + back-office verification queue," not §1c —
  treated as intentionally separate. `person_affiliations` (many-to-many
  entity↔person) is a real schema change to how People pages, contact
  order, and the entity People list all query, and deserves its own pass
  rather than being folded in silently.
- **Contributions live outside StoreProvider too**, same reasoning as
  invitations: `ContributionBox` talks to Supabase directly (RLS-gated),
  gracefully falling back to the old placeholder button in demo mode.

## §6b completeness score + enrichment queue

- **Weights are a first cut, not a tuned model.** Entity/person completeness
  each use ~5-6 equally-weighted existing fields (no schema change needed —
  scoring runs entirely off what's already on `Entity`/`Person`). Verified
  live against real data: David Alves (IRM_SPEC's own motivating example)
  scores 60% — missing LinkedIn + email, exactly the spec's complaint.
  Revisit weights once real usage shows which gaps founders actually care
  about most.
- **"Request more info" reuses the `contributions` table** (a row with
  `field='__enrichment_request__'`) instead of a new table for one boolean
  signal — same table already carries author/org/timestamp, which is all
  this needs. Depends on the same pending `0006_contributions.sql` as §1;
  no new migration for §6b.
- **No AI research button — per instruction.** The enrichment queue is a
  prioritized manual worklist (ranked by demand: active orgs pursuing the
  profile + explicit requests). §6b-3/§6b-4 (AI-assisted research +
  provenance logging) are explicitly out of scope this pass and have
  nothing to attach to without the AI step existing.

## §8 AI outreach composer

- **"Editing tracked, AI draft vs founder final" simplified to one boolean.**
  IRM_SPEC §8c wants to learn what founders change after an AI draft — that
  implies diffing the original AI text against what was actually saved,
  which needs somewhere to store the original draft. No such table exists
  and adding one wasn't asked for. `interactions.ai_generated` (migration
  0007) just tags "AI helped compose this," true regardless of subsequent
  manual edits. Real edit-diff analytics is a follow-up if it's wanted.
- **Intent is founder-selected, not fully automatic.** `pickIntent()` picks a
  sensible default (first_touch / follow_up / reply / meeting_ask) from the
  relationship stage and whose-turn, but the founder can override via a
  dropdown — "which message is this" is a judgment call, not something to
  silently decide for them.
- **Subject line folded into the content field for email**, not a new
  `subject` column — the existing /log form has never had a separate
  subject field (even for manually-logged emails), so adding one just for
  AI drafts would be inconsistent. The draft's subject is prefixed into the
  same textarea as `Subject: X\n\n{body}`.

## Phase 4 Data Room (Storage)

- **Investor portal access ships in two independent pieces.** The API
  routes + middleware fix (real per-org grants, signed URLs for future
  Storage-backed docs, external links work today) needed no schema change
  and are already pushed. Only the actual file-upload UI in `/documents`
  needs migration 0008 (the Storage bucket + RLS) — held separately so the
  portal fix didn't wait on infrastructure it doesn't actually need.
- **One investor identity = one org's grants per login.** If the same email
  has active grants from two different startups, the API returns the first
  match only. A single login surfacing multiple unrelated startups' data
  needs a real investor identity model — that's IRM_SPEC §5 (self-claim),
  not this pass.
- **Portal sign-in stays email-typed, not a real Supabase Auth session.**
  Making the *data* real (service-role API resolving actual access_grants)
  was in scope; replacing the sign-in mechanism itself with magic-link
  session auth is the cross-cutting "verify investor magic-link end-to-end"
  item / §5, tracked separately.

## §1c multi-affiliation people

- **Additive layer, not a remodel.** `people.entity_id` stays the person's
  primary/home entity and keeps driving contact-order and seniority
  enforcement in `rules.ts` — per instruction, `rules.ts` stays untouched.
  `person_affiliations` (migration 0009) is a parallel, informational table
  for the *other* funds/angel activity a person has (IRM_SPEC's own
  examples: partner at several VCs, independent angel investing). Extending
  contact-order to be per-affiliation-at-an-entity rather than per-primary-
  entity would require changing `preflight()`'s seniority check — deferred,
  flagged here rather than done silently.
- **Consistency-check heuristic upgraded, not replaced.** `relatedContacts()`
  (§4d) already fuzzy-matched free-text `linked_funds`/`linked_companies`;
  it now also checks real `person_affiliations` rows first (precise) and
  falls back to the fuzzy match (for the cases nobody has recorded
  structurally yet, like the spec's own Polagnoli↔Speedinvest example).
- **Entity page shows secondary affiliations as a separate, clearly-labeled
  section** ("Also connected — other affiliations"), not merged into the
  main contact-order People list, so it's never ambiguous which people are
  actually subject to seniority/lock enforcement at this entity.

## §6b-3 Research with AI

- **One research call, applied to every org's matching row.** Since there's
  no shared catalog for entities/people (per the §1 decision above), the
  "same" fund/person can be N separate private rows across N orgs. Rather
  than pick one arbitrarily, a research call finds all rows matching the
  name and inserts a contribution for each org that has one — so every
  affected org's own contribution feed gets the same proposal to verify
  independently. Nothing is shared or merged between orgs; each contribution
  row is still fully scoped to its own org_id.
- **No email research.** IRM_SPEC only explicitly restricts LinkedIn to
  URL-only (no scraping), but the same caution extends to emails: the model
  proposes `linkedin_url`/`role`/`background`/`hook` for people, deliberately
  excluding email guesses — there's already a dedicated, lower-risk mechanism
  for that (`email_guess` + confidence), and an AI-sourced email guess is a
  GDPR-sensitive claim that deserves more scrutiny than a field proposal.
- **`web_search_20250305` + `tool_choice: auto`, not forced.** The model
  needs to search first, then call `propose_fields` — forcing the structured
  tool on the first turn would prevent the search step. This means the
  proposal step could theoretically be skipped by the model; the route
  treats an empty/missing `propose_fields` call as "no confident findings"
  rather than an error. Not yet live-tested against a real ANTHROPIC_API_KEY
  (empty locally) — worth a real run once a key is available locally, in
  case the web-search tool's exact behavior needs adjustment.

## §9 interaction history import

- **Only .txt/.csv parse for now — no xlsx/docx.** Tried adding the `xlsx`
  npm package (SheetJS) for spreadsheet support; `npm audit` flagged it with
  two unpatched high-severity CVEs (prototype pollution, ReDoS) with no fix
  available via npm. Removed it rather than ship a known-vulnerable parser.
  Founders can export to CSV/plain text as a workaround until a safer
  library (or SheetJS's non-npm patched CDN build) is evaluated — which
  should happen once the two real example files land anyway, since they'll
  determine what's actually needed.
- **Extraction schema stays a loose jsonb blob** (`import_batches.extraction`),
  not rigid per-item tables — per instruction, the field mapping isn't
  finalized until real example files arrive, so reshaping it later shouldn't
  need another migration.
- **File text is truncated to 20k characters** before hitting the Anthropic
  API (token-budget guard). Chunking/summarizing longer files is a future
  enhancement once real file sizes are known.
- **Entity type always defaults to `'vc'` for new entities.** Nothing in a
  history file reliably signals angel_fund vs corporate_vc vs accelerator;
  `'vc'` is the most common case and the founder can correct it after import
  (same as any other entity field).
- **Reconciliation is single-org, session-scoped by design** — the commit
  route runs as the founder's own session (not service role), so RLS alone
  guarantees it can only read/write their own org's entities/people. New
  entities also get an `investor_submissions` row (reusing the existing
  pack/catalog review flow) so back-office sees them; new people get a
  `contributions` row tagged `__import_new_person__` (same reuse pattern as
  the enrichment "Request more info" signal) instead of inventing a parallel
  table for one boolean signal.
- **Name matching is simple normalized-string equality**, not real fuzzy
  matching (no fuzzy-match library added) — email-exact match is tried
  first per the spec's own priority order, name match is the fallback. Good
  enough to flag likely dupes for the founder to confirm/override in
  staging; a proper fuzzy algorithm is a follow-up if false-negatives turn
  out to be common in practice.
- **Post-import stage/status derivation is a simple heuristic** (meeting
  channel present → diligence/meeting stage; any inbound → in_conversation/
  engaged; else contacted) — matches the spirit of §9e without trying to
  replicate every nuance of manual classification.

## §5 self-claim + GDPR/RGPD

- **Split the two halves cleanly: GDPR requests work now, claiming does
  not.** A data-subject rights request is legally valid however it arrives —
  it doesn't need a verified LinkedIn identity — so `/privacy-request` is a
  real, working, unauthenticated form today. The "claim your profile" flow
  genuinely needs OAuth (the whole point is verifying *this* LinkedIn
  account is *that* person before trusting a match_score), so it stays
  behind `NEXT_PUBLIC_LINKEDIN_OAUTH_ENABLED` (currently unset) showing an
  explanatory message and a link to the GDPR form as the interim path.
- **`person_id` is nullable on both new tables.** People aren't a shared
  cross-org identity (unlike `catalog_entities`) — a claimant's email might
  match zero, one, or several org-private `people` rows. The GDPR intake
  route does a best-effort email match at submission time for a starting
  point; the back-office queue re-resolves matches at read time (across
  every org) so an erase action isn't scoped to a stale snapshot.
- **Erasure cascade nulls PII on every matching `people` row by email,
  across every org** — the closest thing to "every org affected" available
  without a shared person identity. Sets `do_not_contact = true` on those
  rows too, since an erased person obviously shouldn't be re-contacted.
  Rectification has no generic auto-apply (the correction is free-text and
  field-specific); a developer edits the record via the normal person
  screen, then marks the request resolved.
- **The GDPR queue highlights the 30-day legal deadline** (amber ≤14 days,
  red ≤7 days or overdue) computed from `created_at` — no separate
  `deadline` column, since it's always `created_at + 30d` by law.

## Full permission matrix + password reset

- **No migration needed.** `org_role` already had all four values (owner/
  admin/manager/member) since migration 0005 — confirmed live against
  production (`org_members` currently has one `owner` and one `member` row).
  This pass is pure app-code: a `src/lib/permissions.ts` rank/capability
  matrix, consumed by both the settings UI and new server routes.
- **Admin can manage anyone below admin; only owner can create/touch
  owner or admin rank.** (`canAssignRole`/`canActOnMember` in
  `permissions.ts`.) An admin inviting or promoting someone to 'admin' or
  'owner' is blocked server-side — previously nothing stopped this (RLS on
  `org_invitations` only checked the actor was owner/admin, not what role
  they were granting). Moved invite creation from a direct client insert
  into `/api/invite/create` specifically to close that gap.
- **Role changes/removal run under service role**, not new RLS policies —
  `org_members` only ever had a `select` policy. Enforcement lives in
  `/api/team/members/[userId]` (`PATCH`/`DELETE`) instead, mirroring how
  `/api/invite/[token]/accept` already works. Always blocks demoting/
  removing the last owner, and blocks acting on your own membership through
  this endpoint (no self-service "leave org" yet).
- **Didn't retrofit the matrix onto entity/person/document actions** — the
  product has no delete functionality for those yet, so `delete_pipeline`/
  `manage_documents` capabilities exist in the matrix but aren't wired to a
  UI control anywhere yet. Wire them in whenever those actions are built,
  rather than adding dead gates now.
- **Password reset reuses the existing magic-link plumbing** —
  `resetPasswordForEmail` redirects through the same `/auth/callback` that
  already exchanges a code for a session, landing on a new `/reset-password`
  page that calls `updateUser({ password })`. No new callback logic needed.
  Works as soon as Supabase's SMTP is configured (same dependency the
  existing magic-link investor sign-in already has) — nothing to flip later.

## §8d Gmail OAuth pairing + LinkedIn copy-assist

- **Tokens are encrypted at rest with AES-256-GCM before they ever reach
  Postgres** (`src/lib/crypto.ts`, `TOKEN_ENCRYPTION_KEY`) — RLS on
  `email_connections` scopes each row to `user_id = auth.uid()` too (not
  just org membership), since these are one person's mailbox credentials,
  not org-shared data. Both the encryption key AND Google OAuth credentials
  must be present for the feature to switch on — see
  `googleOAuthConfigured()`.
- **`state` in the OAuth flow is just a CSRF nonce, not a lookup key** —
  it's stored in a short-lived httpOnly cookie and compared at the callback.
  Since this is a same-browser redirect round-trip, the Supabase session
  cookie is what actually identifies which user gets the connection, not
  the OAuth `state` param.
- **New capability, not a redo of existing behaviour**: before this, the
  `/log` "Save interaction" flow only ever recorded a message the founder
  already sent by hand elsewhere. `/api/compose/send` is the first route in
  the app that actually dispatches an outbound message — gated behind
  having a Gmail connection, and still requires the founder to review/edit
  the draft and click Send each time (same review gate as §8c), never
  autonomous. Without a Gmail connection, the old paste-then-save flow is
  unchanged and remains the fallback for every channel.
- **LinkedIn stays copy-assist only, per spec** — no message API exists,
  and automating it violates LinkedIn's ToS and risks the founder's
  account. Added a "copy message" + "open profile" shortcut next to the
  existing paste-and-save flow; no new mutation, just convenience.
- **Scope requested is `gmail.send` + `userinfo.email` only** — never
  `gmail.readonly` or broader — the product only ever needs to send as the
  founder, never read their inbox.

## BLOCO 3 — back-office console

- **The pre-existing "Review queue"/"Global catalog"/"Distribution log"
  cards were reading the founder's own org-scoped store** (`useStore()` →
  `.eq('org_id', orgId)` in store-supabase.tsx), not a cross-org view — fine
  for a founder checking their own submission, silently wrong for back-
  office triage (it only ever showed the viewing admin's own org's rows).
  Replaced with dedicated `/api/backoffice/*` service-role routes across
  the board — Submissions, Claims, and Catalog CRUD are new; Contributions
  and GDPR already had the right architecture from earlier passes.
- **`/backoffice` fully separates from the founder Shell**, same pattern as
  `/portal` (`shell.tsx` early-returns bare children for both prefixes).
  Its own `layout.tsx` provides nav (Hoje/Fila/Catálogo/Startups/Métricas),
  dark "PLATFORM"-branded header — per DESIGN_IDEAS.md's own explicit note
  for this block. A dual-role user (Nuno) gets a "Back-office →" link in
  the founder sidebar and a "← ablute_ (founder)" link back, never a merged
  nav.
- **Permission check duplicated three ways on purpose**: middleware.ts
  blocks `/backoffice*` and `/api/backoffice*` before they're reached;
  `requirePlatformAdmin()` (`src/lib/backoffice-auth.ts`) re-checks in every
  route; the layout also re-checks client-side for UX (fast redirect
  without waiting on a failed fetch). Per the instruction: never just UI.
- **"Pessoas públicas" catalog CRUD was NOT built.** Unlike investors
  (`catalog_entities`, global, no org_id), there is no shared public-person
  identity anywhere in the schema — `people` rows are still fully org-
  private (see §1c). Building one is a real schema project (verification
  flow, promotion rules, its own dedup) that this instruction's wording
  gestured at but didn't specify — scoping it out rather than inventing a
  table shape nobody's reviewed. The existing contributions-based person
  verification (Fila → Contributions) still covers person-level fact
  curation in the meantime.
- **Merge-duplicates tool matches on the IRM_SPEC §9b-3 algorithm**:
  normalized website domain, normalized name (diacritics/legal-suffix/
  parenthetical-alias stripped via `src/lib/catalog-dedupe.ts`), plus a new
  `entity_aliases` table so a merge's history (e.g. "Busy Angels SCR" as a
  former name of "Bynd") stays discoverable for future clustering — this is
  exactly the table §9b-3a asks for, scoped for now to `catalog_entities`
  (the org-level `entities` import-matching integration is a separate,
  not-yet-built piece). Merge never blind-overwrites: a field that's
  non-empty-and-different across the merged rows is left alone and named in
  the audit log for a human to reconcile, rather than silently picked.
- **Startups/Métricas are aggregates only, enforced by what the queries
  select** — never a name, note, or message body from any org's own
  `entities`/`people`/`interactions` content, only counts and timestamps.
  There is no route anywhere in the console that reads into a specific
  org's pipeline, and no impersonation exists.
- **`last_sign_in_at` isn't queryable via a normal table join** (it lives on
  `auth.users`, Supabase-managed) — Startups does one bulk
  `admin.auth.admin.listUsers()` call and takes the max per org in JS,
  rather than one query per org.
- **"Emails this week" in Métricas is a proxy**: count of `interactions`
  rows with `channel='email', direction='out'` in the last 7 days (i.e.
  outreach logged as sent, whether pasted-after-manual-send or via the new
  §8d Gmail path) — there's no separate send-log table, and this is the
  honest signal already being recorded either way.
- **Verified live**: migrations 0010-0013 were confirmed applied by direct
  read-only query before this block started (not just trusted from
  conversation history) — `org_role` already had all 4 values, and the
  §8d-held commit was pushed once confirmed. `npm run build` passes with
  all new `/backoffice/*` and `/api/backoffice/*` routes present;
  unauthenticated `/backoffice` correctly redirects to `/login` (verified
  live in-browser). Full authenticated click-through of Hoje/Fila/Catálogo/
  Startups/Métricas was NOT done — no test credentials available in this
  session — so treat the new UI as build-verified and logically reviewed,
  not click-tested end-to-end.

## §9b structured import (real files: entities.csv/people.csv/interactions.csv)

- **A dedicated importer, not a retrofit of the generic §9 one.** The
  generic `/import` flow (AI-extraction into a loose jsonb blob) exists for
  *unknown*-shaped files; this pack has a known, rich, authoritative
  schema, so `src/lib/structured-import.ts` parses and matches it
  deterministically — no LLM call, fully reproducible. Lives at
  `/import/structured`, linked from the generic `/import` page.
- **Entity matching found a real false positive during its own dry-run,
  fixed before this ever reached the founder**: a loose "one normalized
  name contains the other" tier proposed "Investors Portugal" (new, an
  angel network) as a match for the EXISTING "Portugal Ventures" (an
  unrelated VC fund already invested) — both normalize to contain the bare
  word "portugal". Fixed by requiring the shorter name to be ≥60% the
  length of the longer one before containment counts at all (see
  `MIN_CONTAINMENT_RATIO` in structured-import.ts) — re-ran the dry-run
  against the live ablute_ org data afterward and confirmed it disappeared
  with no loss of the real matches (Bynd VC/Bynd Venture Capital and
  Speedinvest/Speedinvest Health both match via website domain anyway, not
  containment). This is exactly why a dry-run step exists before commit.
- **`status`/`hard_filter_status` are treated as "not asserted" when they
  hold their table default** (`not_contacted`/`not_applicable`) **on either
  side of a merge** — a fresh seed row's default isn't a founder-asserted
  fact, so the CSV's real, documented value (e.g. Bynd: `passed` /
  `resolved_blocked`, backed by three recorded email passes) fills it
  without being flagged as a conflict. If BOTH sides hold a real
  (non-default) value that differs, that's still a genuine conflict, left
  for review — this only relaxes the rule for placeholder defaults.
- **Conflicts become `contributions` rows** (source='user', one per
  conflicting field) on commit, reusing the existing back-office Fila →
  Contributions queue instead of a bespoke "conflict inbox" — matches how
  the rest of the product already models "a fact someone should verify."
- **The two §9b-4 affiliation upgrades (Lurdes Gramaxo, Antonio Murta) are
  hard-coded by name**, not derived by parsing free-text backgrounds
  generically. The annex names these exact people as required test cases;
  a general "infer affiliations from prose" heuristic would be fragile
  and speculative for data that isn't there yet. Lurdes gets 2 additional
  `person_affiliations` rows beyond her base `entity_id` (Bynd): Investors
  Portugal (is_primary, the note "approach only as President...") and APBA
  (independent, entity_id null — APBA isn't in entities.csv, so no entity
  is invented for it). Antonio Murta gets 1: a new derived entity "Pathena
  Family Office" (not in entities.csv, invented from his own bio in
  people.csv notes) with an `angel`-kind, is_primary affiliation. Future
  real files would need a person to add affiliations manually via the
  existing AffiliationsCard unless a future annex names new required cases.
  Nuno Sousa (also under Pathena, "approach as clinical validator") gets no
  extra affiliation — the acceptance tests don't require one, and inventing
  an entity for "clinical validator" would be speculative.
- **Interaction idempotency** matches on (org, entity, occurred_at date,
  direction, channel, exact content) — re-submitting the same plan a second
  time re-detects all 8 Bynd/Crista-Galli interactions as duplicates and
  imports nothing new. Verified by design/algorithm inspection against the
  live dry-run output; a literal second-pass-after-commit re-run happens
  once the founder approves the actual commit.
- **Ran the dry-run against live ablute_ production data** (read-only —
  fetched existing entities/people/interactions via service role, computed
  the plan, wrote nothing) to produce the staging preview. Approved by Nuno,
  then committed for real (details below).

### Committed to production — what actually happened

Ran via a scratch script using the exact same plan-building/commit logic as
the real routes (service role, scoped to the ablute_ org — no session
available to drive the founder's own UI flow non-interactively). Two real
bugs surfaced and were fixed *before* the final state was accepted, not
worked around:

1. **`btov Partners`/`HCapital Partners` have `stage_max="series_b"`** —
   the `stage` enum only goes to `later` (no series_b+). The first commit
   attempt crashed here after already creating 7 entities. Fixed by folding
   anything past `series_a` into `later` (`normalizeStage` in
   structured-import.ts) rather than failing the whole batch; safe to
   re-run because already-created rows just re-match as MATCHED/no-op.
2. **People merge crashed on `entity_name` (a CSV lookup key, not a people
   column) and silently would have mismapped `notes` → should be
   `personal_notes`.** `mergeFields` was being handed the raw CSV row
   instead of a column-mapped object. Fixed by building an explicit
   `incomingColumns` object before merging (see `buildImportPlan`, people
   branch) — this bug would have hit any real user of this importer, not
   just this pack.
3. **Idempotency was broken for affiliations and conflict-contributions**:
   a second full run (deliberately triggered to verify "import twice =
   zero changes") duplicated all 3 `person_affiliations` rows and all 112
   conflict `contributions` rows, because neither insert had an
   existence check the way entities/people/interactions already did.
   Caught it BY running the idempotency check, not by skipping it — cleaned
   up the 3+112 duplicate rows, then fixed both commit routes (real route
   and the scratch script) to check-before-insert, and re-verified a third
   run was a true no-op (all-zero) before calling it done.
- **Final production state** (ablute_ org): 28 entities (15 existing + 13
  new), 36 people (20 existing + 16 new), 9 interactions (1 pre-existing +
  8 imported), 3 affiliations, 112 field-level conflicts queued in Fila →
  Contributions for manual review. All 4 acceptance tests verified directly
  against the committed rows: Bynd `status=passed`/`hard_filter_status=
  resolved_blocked` with 7 interactions; Lurdes Gramaxo 2 affiliations
  (Investors Portugal primary with the exact approach-only note, plus
  APBA); Antonio Murta's Pathena Family Office angel affiliation present
  and the Pathena fund itself still `resolved_blocked`; re-running the
  import a second time (post-fix) changed nothing.
- **112 conflicts is a lot** — many are cosmetic (e.g. `"AT"` vs
  `"Austria"`, curly vs straight quotes, near-identical rephrasing of the
  same fact) rather than substantive disagreements, because the merge rule
  compares strings byte-for-byte with no fuzzy/semantic equality. That's
  the deliberately conservative choice (never guess two differently-worded
  facts are "the same"), but it does mean the Contributions queue now has
  real bulk-review work — flagged here rather than silently adding a fuzzy-
  match layer that risks the opposite mistake (silently treating two
  actually-different facts as equal).

## Real interaction-history import (ablute_historico_fundos.md)

- **The .md file itself never enters git and never will** — read directly
  from its local path, uploaded straight to the org's private `data-room`
  Storage bucket by the app, parsed server-side. This is an absolute rule
  from the instruction (public repo, private personal history), not a
  style preference — every route touching it treats the file as Storage-
  only, same trust boundary as any other data-room document.
- **TEMA A and TEMA B share entity rows but never share a queue.** Contact
  facts (website/email_domain) and private history (status, reopen_trigger,
  interaction content) both live on the same `entities`/`interactions` rows
  — they're the same real relationship — but the commit route only ever
  queues TEMA-A-field conflicts to `contributions`; TEMA B conflicts are
  logged in the plan for the founder to see and resolved by editing the
  entity directly, never as a contribution, never near the shared catalog.
- **A second real false-positive match, caught the same way as the CSV
  import's "Investors Portugal" bug**: "Core Capital" lists two genuinely
  different site domains (`coreangels.com/angel-groups/atlantic` — an
  angel-group portal page — and its own `corecapital.pt`), and the domain-
  match tier confidently proposed it as the same entity as the existing
  "COREangels Porto." Rather than trust a domain-only match when a section
  cites multiple distinct domains, that case now downgrades to `conflict`
  (founder must explicitly confirm), while exact-name matches (Bynd, MAZE,
  Pathena, etc.) stay auto-matched. Same lesson twice: a real dry-run step,
  actually run and actually inspected, is what catches this class of bug —
  not writing the matching code carefully in the first place.
- **Alias groups are unioned across ALL sections that mention any member
  name**, not just literal pairs — the file itself scatters the same real
  fund across 2-4 separate `##` sections in inconsistent order (e.g.
  "3xp global - Grosvenor" AND, 1200 lines later, "Grosvenor - 3xp global";
  "BrainTrust - Brain capital - Bevin CP" AND a separate solo "Bevin CP"
  AND a separate solo "Biven CP", an OCR-typo spelling of the same name).
  Merged 118 raw sections down to 111 real entities this way.
- **entity_aliases (0014, catalog-scoped) extended to also point at
  org-level `entities`** (migration 0017) specifically so these 7 real
  alias pairs have somewhere durable to live, per the instruction. Own RLS
  policy lets org members manage their own entities' aliases; the existing
  admin-only policy still covers catalog-scoped rows untouched.
- **`interactions.needs_review`** (migration 0018) — persisted, not just a
  staging-screen checkbox: ~380 of ~494 historical interactions have no
  color marking, and the file's own header warns positive (green) markings
  never survived the OneNote→PDF export. That's too many for a one-time
  review gate; the flag lets the founder work through them over time via
  the normal entity/person screens.
- **Direction/channel aren't in the source data and had to be inferred**:
  direction from the color code itself (`—` reads as "usually a send from
  us" per the file's own README line; `NÃO`/`TALVEZ`/`RESPOSTA` all read as
  the fund's own response, so `in`); channel from keyword-matching the
  interaction text (liguei/telefone → call, reunião → meeting, LinkedIn →
  linkedin_dm, formulário/site → web_form, else email — most of this
  correspondence is email). Both are heuristics on messy real text, not
  guaranteed correct per row — flagged here rather than silently trusted.
- **A NOT NULL `occurred_at` needs a value even when the source has none**
  (`(sem data)`, or a date that fails sanity bounds — found and fixed one
  literal `"2024-26-26"` mid-run, an OCR/typo month-26). Used a fixed
  placeholder (2018-01-01, older than everything else in the pack) rather
  than "now" (which would misrepresent decade-old history as today's) —
  `needs_review` is already true for every one of these, so the placeholder
  is never presented as a real date without that flag alongside it.
- **No entity `type` in this file's schema** (unlike the CSV pack) — new
  entities default to `'vc'`, same convention as the generic §9 importer,
  founder-correctable afterward.
- **Reopen triggers only populated for the 4 cases the doctrine section
  itself names with sourced reasoning** (Bynd, Indico, Pathena, MAZE) — not
  derived generically for the other 24 `NAO_FECHADO` entities. That broader
  per-entity reopen/reabordagem analysis is IRM_SPEC §9e, explicitly a
  separate step in the instruction, run only after this import is approved
  and committed.
- **"Nomes de pessoas mencionadas" uses one Claude call per entity section**
  (not regex — the source is free Portuguese prose with no person column),
  proposing candidates with a confidence + evidence quote. Nothing is
  auto-created: every proposal needs an explicit per-person checkbox before
  commit, same review discipline as everything else in this importer. Runs
  client-driven, one section at a time, so the UI can show real progress
  across ~111 sections rather than one opaque multi-minute call.
- **Contact_lock_until is computed from the imported interactions' own
  historical dates** (latest outbound + 14 days), not "now" — correctly
  yields mostly-expired locks today (2026-07-22) for a pack whose most
  recent entries are Jan 2026, which is honest: the point was never to
  block outreach right now, it's to make the existing `contact_lock`
  preflight check consult real history instead of nothing.

### Post-approval commit: 4 more real bugs found and fixed live

Committed to production with the founder's explicit OK (Armilar → merge,
Core Capital → confirmed separate via web research: CoRe Capital is a
distinct CMVM-registered PE firm, not COREangels Porto). A full post-commit
integrity sweep (interaction-count reconciliation + a duplicate re-scan
with the matcher) caught four more real issues, all fixed live and folded
back into the source so future imports don't repeat them:

1. **My own resolution script had a bug**: I read `candidates[0].name` to
   confirm Armilar's match to the user but never actually set
   `chosenId`/`status` on the plan item — since `conflict`-status items
   always compute `chosen = undefined`, Armilar silently went through the
   "create new" path anyway, producing a duplicate "Armilar" entity instead
   of merging into "Armilar Venture Partners." Caught via the interaction-
   sum integrity check (10 interactions on an entity that shouldn't have
   existed), fixed by moving its interactions to the real entity, applying
   its patch there, and deleting the duplicate.
2. **Reopen-trigger dictionary used the CSV pack's full name
   ('indico capital partners') as the only key**, but the .md file's own
   section — and the doctrine text itself — calls it "Indico." Exact-key
   lookup silently missed it; Indico Capital Partners committed with no
   reopen_trigger at all. Fix: list both the short and full name as keys
   (not a containment match — a first attempt at that wrongly matched
   "Pathena Family Office", a different entity, against the `pathena` key).
3. **"Blue Crow" (this file) and "BlueCrow Capital" (already in the org,
   from the earlier CSV import) never matched** — `bluecrow` (space
   stripped by normalization removing "Capital") vs `blue crow` (genuinely
   has a space) fail both the exact and containment tiers purely because
   one source spells it as one word. Added a whitespace-collapsed exact-
   match tier to `matchEntities` (structured-import.ts, shared with the
   CSV importer) — still a precise, non-fuzzy comparison, just space-
   insensitive. Found via a full duplicate re-scan; the file's own
   "Sobreposição" table had actually named this exact correspondence, which
   this import didn't consult programmatically (a scope gap, not fixed
   generically — see below).
4. **Personal LinkedIn profile URLs were treated as company websites**:
   several sections list "the person I actually talked to"'s own
   `linkedin.com/in/...` profile as their **Sites:**, not the fund's real
   site. Every such profile shares the `linkedin.com` domain, so the
   domain-match tier was one re-run away from confidently proposing
   unrelated funds (Active Cap, BIG START VENTURES, Cedrus Capital, EggNest,
   August Capital Partners, Kleber CP) as duplicates of each other — it
   hadn't actually bitten *this* import (matching only checks against
   pre-existing rows, not entities newly created within the same batch),
   but would have on any later re-run. Added `linkedin.com` to the bogus-
   site filter; nulled out the 6 already-written bad `website` values.
   Also found and nulled one unrelated source-file data-quality artifact
   this doesn't explain: "ONETIER"'s site field pointed to
   `startventures.vc` (a different fund's URL — ONETIER's own emails are
   `@big.pt`), most likely two adjacent original pages cross-contaminated
   during the OneNote export.

**Not generically fixed**: the "Sobreposição" table's 12 explicit name
corrections were never consulted as a matching hint — the ones that worked
did so by luck (exact/domain match), and Blue Crow only got caught by a
manual post-commit scan. A more robust version would parse that table and
feed each row in as a forced-candidate hint. Flagged rather than built
silently, since it wasn't asked for and the current fix (space-insensitive
matching + a full re-scan before/after commit) closed the actual gap this
time.

## Agenda action types + Log Interaction recommendation (migration 0019)

New `task_action_type` enum on `tasks` (`first_contact`, `follow_up_no_reply`,
`follow_up_thread`, `research_hook`, `other`) — a finer label than the
existing `task_kind` (follow_up/meeting/research/admin), tied to WHY the
task exists from an outreach-discipline standpoint rather than what kind of
task it is. `task_kind` is untouched; both axes coexist.

1. **No 6th enum value for the reopen-doctrine case.** The request listed
   exactly 5 action types; reopening a `dormant` entity with a
   `reopen_trigger` doesn't map to any of them (it can co-occur with any of
   the 5 depending on interaction history). Rather than inventing a 6th
   value not in the requested set, `/log` shows the reopen trigger as a
   separate banner (title: `Reabertura — cite o "não" anterior e o que
   mudou`) layered on top of whichever action type is otherwise
   recommended. Revisit if this reads wrong once used for real.
2. **The reopen banner is a hard gate, not just a note.** "Exigir que o
   rascunho cite" was implemented as an explicit checkbox ("O rascunho cita
   o pass anterior e o que mudou") that blocks the Save button
   (`formReady`) until checked — chosen over automated text-matching
   against the trigger string, since `reopen_trigger` is a full sentence of
   reasoning, not a short tag a founder could plausibly quote verbatim.
   This mirrors the existing override-justification pattern already used
   in `/log` for pre-flight bypasses, so it's consistent with the app's own
   established gate style rather than a new interaction pattern.
3. **`recommendedActionType()` priority order** (in `relationship.ts`,
   reused by `/log`, Today, and the Agenda selector default): hook not
   researched outranks everything else, since that's an existing *blocking*
   rule already enforced by `preflight()` — you can't productively plan a
   next step around a person you haven't researched. Then: no prior
   interactions → first_contact; last touch inbound → follow_up_thread;
   last touch outbound past the 14-day lock → follow_up_no_reply;
   otherwise → other. The founder can always override the pre-fill
   manually — it's a default, never an imposition.
4. **§9e analysis labeling**: the request asks that "a análise §9e" also
   label its suggestions with these action types. §9e was a one-time
   analysis (a compiled script + a published Artifact report), not a
   persistent page in the app — there's no living §9e UI to update. Any
   future re-run of that analysis should tag its per-entity suggestions
   using `recommendedActionType`/`ACTION_TYPE_LABEL` for consistency, but
   no code change was made here since nothing currently re-runs it.
5. `entities.reopen_trigger` / `entities.reopen_eligible_after` (added to
   the DB by migration 0016, back in the MD-history-import phase) had never
   been added to `types.ts`'s `Entity` interface — only raw Supabase calls
   in the importer wrote to them directly. Added both fields now that the
   UI needs to read `reopen_trigger`; no backend change needed since
   `select('*')` + the generic `fromRow<Entity>()` mapper already carried
   them, just untyped.

## Composer feedback round: seniority bug, stale-draft warning, tests

Feedback from a production run of the composer surfaced two issues and one
confirmation:

1. **Seniority pre-flight bug, confirmed and fixed.** `preflight()`'s
   seniority check only failed when a more senior contact had been
   *outbound-contacted but not replied* — it never considered a senior who
   hadn't been contacted at all, so approaching Alberto Gomez (rank 2) at
   Adara Ventures while Rocio Pillado (rank 1) was still `not_contacted`
   incorrectly showed ✓. Fixed in `rules.ts`: the check now blocks whenever
   any non-`do_not_contact` senior lacks an inbound reply, regardless of
   whether they were ever contacted — "unresolved" covers both
   not-yet-approached and contacted-with-no-reply; only an actual reply
   (any classification, including a pass) clears the way for the junior.
   Confirmed against the live seed data too: Yahel Halamish (rank 3, Nina
   Capital) now correctly shows ✗ against Dr. Marta G. Zanchi (rank 1,
   never approached).
2. **Test infrastructure added.** The repo had zero automated tests.
   `rules.ts` encodes the outreach-discipline rules the whole product is
   built around (per this file's own CLAUDE.md framing) — worth protecting
   with real regression tests rather than only interactive/manual
   verification. Added `vitest` (minimal devDependency, `npm test`) and
   `src/lib/rules.test.ts` covering the seniority check: the exact reported
   case (never-contacted senior → blocked), the pre-existing
   contacted-no-reply case, the resolved-by-reply case, the
   do_not_contact-senior-is-ignored case, and the most-senior-contact
   case (never triggered). Scoped to this one check, not a general test
   suite build-out — not asked for, and `rules.ts`'s other functions
   weren't implicated in the report.
3. **Stale-draft warning, added to `/log`.** When the founder switches the
   selected entity or person while the message textarea still holds
   content composed for the previous selection, a highlighted banner now
   reads "Este rascunho foi composto para [nome anterior] — atualiza ou
   regenera antes de usar" with Regenerar (re-runs the AI draft for the
   new selection) and Limpar buttons. Implemented via a `draftedFor` stamp
   that re-captures the current entity/person whenever `content` itself
   changes (typed or AI-drafted) — a mismatch between that stamp and the
   live selection is what triggers the banner. Deliberately does not
   auto-clear or auto-block Save on its own (unlike the reopen-doctrine
   gate above) — the request asked for a prominent warning with a way to
   act on it, not a hard stop; the founder can still knowingly save a
   cross-referenced or reused message if that's genuinely intended.
4. **Action-type feature confirmed working in production** (migration
   0019 applied) — the held commit from the prior session was pushed with
   no further changes needed.

## Real-use feedback round: tooltips, sortable pipeline, packs polish

1. **Global Tooltip** (`src/components/ui.tsx`): a single `Tooltip` component,
   500ms hover/focus delay, dark neutral chip (no semantic color — that stays
   reserved for status/verification per DESIGN_IDEAS.md). Applied by wrapping
   the shared pill components (`StatusPill`, `FitTag`, `WaveTag`, `VerBadge`)
   directly, so every existing usage across the app inherited a tooltip for
   free instead of needing per-page edits. Also applied to: `PreflightCard`
   and `/log`'s duplicate inline pre-flight list (one sentence per check,
   independent of the pass/fail reason already shown), the composer's AI/
   copy/save/override buttons, the top-bar cap counter and Log-interaction
   button, the back-office switcher, and the Fila queue's review buttons
   (Verify/Reject/Approve across all 4 tabs). Not attempted: exhaustive
   coverage of every button in the app (e.g. Catálogo's merge tool, Startups,
   Métricas) — scoped to the categories the feedback named explicitly
   (top actions, pre-flight, pills, composer, back-office), not a blanket
   sweep.
2. **Sortable Pipeline table** (`src/app/page.tsx`): the old single-select
   "Sort: …" dropdown (4 keys) replaced with clickable column headers across
   all 10 requested columns, asc/desc arrow, persisted to localStorage
   (`ablute-pipeline-sort-v1`). A generic nulls-last comparator handles every
   column uniformly rather than a bespoke comparator per key; missing values
   (no HQ, no check range, no next action, etc.) always sink to the bottom
   regardless of direction, which reads better than nulls flipping to the
   top on a "desc" click.
3. **Packs frosted-glass names**: investor names in a locked pack are
   rendered with a CSS blur filter + `select-none`, matching the existing
   convention this app already uses for other not-yet-actionable data
   (the guessed-email treatment in `PersonEmailBlock`) rather than inventing
   a new pattern. Note the honest limit: this is a *presentational* blur —
   the catalog rows are already loaded client-side (same as before), so it
   deters casual copying but isn't a network-level redaction guarantee. If
   pack contents ever need to be provably unextractable pre-purchase, that
   requires withholding the names server-side until unlock — a real
   architecture change, not attempted here since the feedback specifically
   asked for "efeito frosted glass/blur," a client-side technique.
4. **`Org.credits`**: added as a type-only field (no migration, no DB
   column, nothing reads or writes it) — a placeholder for a future real
   crediting mechanic, per the explicit instruction not to touch the pricing
   model yet.
5. **Future spec, not implemented — custom packs by keyword.** Idea: let a
   founder type free-text keywords (e.g. "health + portugal + seed +
   hardware") and generate a pack on the fly from the catalog, showing the
   matching investor count before purchase. Needs a materially larger
   catalog than exists today to produce non-trivial results — a handful of
   seed investors sliced by 4 keywords would mostly return near-empty packs.
   Revisit once the catalog has grown past a few dozen verified entries per
   sector/geo combination.

## Entities that are people (§1c data-quality fix)

Real bug: "António Gama Amaral" (and likely similar rows) imported as a
`vc`-type entity with no website/domain and zero people under it — he's
actually an individual (probably a solo angel), not a fund.

1. **No migration needed.** `people.entity_id` and `interactions.entity_id`
   are both `NOT NULL` in the DB (migration 0001) — a genuinely
   entity-less person isn't representable without a schema change nobody
   asked for. `person_affiliations.entity_id`, though, was already
   nullable from the start (migration 0009, "null + kind='angel' =
   independent angel activity") — the exact pattern already used for
   António Murta's angel-path affiliation. `convertEntityToPerson` reuses
   that existing pattern instead of inventing one: the entity row is
   *kept* as the person's technical "home" (same id, so `Person.entity_id`
   / `Interaction.entity_id` stay satisfied), relabeled `type: 'angel_fund'`
   (closest existing `EntityType` fit) and stamped `last_verified` (doubles
   as "reviewed" for the sweep). A brand-new `Person` row is created under
   it, plus a `PersonAffiliation` with `entity_id` omitted + `kind: 'angel'`
   — the same independent-activity marker Murta already uses. Any
   interaction already logged against the entity with no `person_id` gets
   backfilled to point at the new person. Net effect: the "entity" stays
   visible in Pipeline exactly as before (same name, same interaction
   thread) but now has a real Person underneath it with hook/kill-words/
   etc., which the founder can actually research and log against — an
   improvement, not a removal.
2. **Sweep heuristic** (`isPersonCandidate` in `relationship.ts`, backed by
   `looksLikePersonName` in `structured-import.ts`, shared with both
   importers): no website, no email domain, name shaped like "First
   Last(-Last)" with no firm keyword (Capital/Ventures/Partners/Fund/VC/
   etc.), AND zero existing `Person` rows under the entity, AND not
   already `last_verified`. The "zero people" signal is doing real work
   here — a genuine fund entity almost always has at least one contact
   attached; a `vc`-type row with none is the actual tell, more reliable
   than the name shape alone. Surfaced as a dismissible banner on both the
   Pipeline page (org-wide sweep) and the entity page (single-entity), with
   "Convert to person (angel)" and "Not a person" (dismiss via
   `markEntityVerified`, which just stamps `last_verified` so it stops
   resurfacing).
3. **Importer heuristic is visibility-only, not a separate commit path.**
   Both `buildImportPlan` and `buildMdImportPlan` now flag new-entity plan
   items with `looksLikePerson` (surfaced as a purple staging badge:
   "looks like a person, not a fund — review after import"), reusing the
   same `looksLikePersonName` check. Deliberately did NOT build a parallel
   person-creation code path inside either importer — imports are rare,
   one-off events, and the conversion action from point 1 already handles
   the fix post-commit. Building two full person-vs-entity branches into
   the commit routes for an occasional-use import flow would be a much
   larger change than the reported bug calls for; flagged rather than
   silently deferred.
4. Added a `structured-import.test.ts` covering `looksLikePersonName`
   against the exact reported name, a couple of real fund names (must NOT
   flag), and the with-website/with-domain cases (must clear the flag).

## Data Room cleanup: simulate-view removal + real Open

1. **`recordDemoView` renamed to `recordDocumentView`** (store-context.tsx/
   store-demo.tsx/store-supabase.tsx/portal/page.tsx) rather than deleted —
   it's not actually a simulation. It's the real view-tracking call the
   investor portal's `openDoc` makes in demo mode (the Supabase-backed
   build calls `/api/portal/view` instead); only its confusing "Demo" name
   was era-of-demo cruft, not its function.
2. **The real simulate action removed**: `/documents`'s "simulate view"
   button, which manually fired a fake view against a hardcoded
   `demo-investor@example.com` — a founder-facing testing artifact with no
   real analog (views should only ever be recorded when an actual investor
   opens the portal).
3. **Found and fixed one more piece of demo-era leakage while sweeping
   the whole app per the "qualquer página" instruction**: `store-
   supabase.tsx`'s `recordDocumentView` was fabricating a random
   `seconds: 60-460` view-duration on every REAL portal view, in
   production, since the app doesn't actually measure time-on-page. Now
   left unset rather than invented. Demo mode's version keeps synthesizing
   a plausible value — that store exists specifically to look "alive" for
   local testing with no real users behind it, a different situation from
   the real backend fabricating data a founder would actually see.
4. **Two more stale references removed**: automations page's "(Demo:
   toggle the plan in Settings.)" hint pointed at a control that was never
   actually built (grepped for it — nothing toggles `org.plan` anywhere);
   removed rather than built, since billing isn't wired up yet (Phase 7)
   and the surrounding copy already says to ask the platform team.
   Settings' "Demo data / Reset demo to seed" card was rendering
   unconditionally, even in a real Supabase-backed session — gated behind
   `!authEnabled` now, matching every other demo-only control in that page.
5. **`DocumentItem.created_at`**: same pattern as `entities.reopen_trigger`
   earlier this session — a real DB column since migration 0001 (`documents
   .created_at timestamptz not null default now()`), never previously
   surfaced in the TypeScript type. Added the field and stamped it
   client-side in both `addDocument` implementations (matching the
   existing `addGrant`/`granted_at` convention: the DB default exists too,
   but the app stamps explicitly for optimistic-UI consistency).
6. **File size has no DB column and doesn't need one** — Supabase Storage
   already tracks it per-object. `/documents` now lists the org's Storage
   prefix once (`storage.from('data-room').list(org.id)`) and reads
   `metadata.size` from the response, keyed by full path. Link-type
   documents show no size (there isn't one), only the upload date.
7. **Verification**: link-based add/Open/date verified live in the browser
   (demo mode — Storage upload is gated behind `authEnabled` in the UI and
   can't be reached without it). File-upload/signed-URL/size-listing
   verified against production Supabase via a reversible service-role
   script — uploaded a real minimal PDF (valid `%PDF-1.4` structure, not
   just a `.pdf`-named text file) to the `data-room` bucket under the
   ablute_ org, inserted a matching `documents` row, confirmed the Storage
   listing reports the correct byte size, fetched the signed URL over HTTP
   and confirmed the returned bytes are the same PDF, then deleted both the
   Storage object and the row. Did not attempt an interactive founder
   login to click through the real UI — entering the founder's password is
   outside what I'm allowed to do, and there's no other way to reach an
   authenticated session in this environment.

## Copy hygiene sweep + paywall removal

Triggered by screenshot evidence of Settings leaking internals to a founder:
an env var name, "(Phase 7)", and "(IRM_SPEC §8d)" in a card title. See the
PERMANENT RULE at the top of this file for the standing policy; this entry
covers what changed to satisfy it right now.

1. **The bug (Task 3): why AI Review showed locked while the composer
   worked.** Two completely different gates existed for the same
   capability. The composer (`/api/compose`) and AI Review's own route
   (`/api/ai-review`) both ONLY ever checked `process.env.ANTHROPIC_API_KEY`
   server-side — no plan/billing check anywhere in either route. But
   Settings' UI gated the AI Review/Deck-review/Market-data cards on
   `db.org.plan === 'paid'`, a completely unrelated billing field that was
   never `'paid'` for ablute_ (billing was never wired up). Composer worked
   because its gate matched reality; Settings didn't because its gate
   checked something that was never going to be true. Fixed by deleting the
   `plan`-based gate entirely and adding one real source of truth:
   `/api/me` now returns `capabilities: { ai: !!process.env.ANTHROPIC_API_KEY }`
   — the exact same check the AI routes already make internally — and every
   AI-gated card in Settings reads that instead. They cannot disagree again
   by construction, since it's the same boolean computed the same way.
2. **Paywall UI removed** (Task 2): the `PaidFeatureLock` component (🔒,
   "Upgrade to unlock", the Phase-7/billing sentence) is gone. Also found
   and removed one more paywall the original report didn't mention:
   Automations' "Full auto 🔒" gate, same `plan === 'paid'` pattern, same
   fix (removed — nothing server-side ever enforced it either, so the gate
   was purely cosmetic and just as stale as the Settings one). Unavailable
   AI features now show a single muted line, "Coming soon to your
   workspace." — no icon, no price, no CTA. `org.plan` itself is untouched
   in the schema/type and still displays in the Organisation card; only the
   gating logic and the paywall chrome are gone, per the explicit "UI
   removal, not a schema change" instruction.
3. **Error-message sanitization done at the API route, not the page**
   (`/api/ai-review`, `/api/compose`, `/api/import/extract`,
   `/api/import/md/extract-people`, `src/lib/resend.ts`): every one of
   these was capable of returning a raw provider error string (e.g.
   `"Anthropic API error: <300 chars of raw response>"`) straight into a
   `configured:false` message or a caught-exception `.error` field that a
   page then renders verbatim (`/log`'s composerNote, Settings'
   `aiResult`/`docResult`/`marketResult`, `/import`'s batch error list).
   Fixed at the source: routes now log the real error server-side
   (`console.error`) and return a generic, still-actionable message
   ("AI draft failed — try again in a moment.") to the client. This matters
   more than fixing today's rendering sites — a future page could start
   displaying `.error` without knowing it might contain a vendor name.
4. **Backoffice is intentionally untouched.** `/api/backoffice/research`
   still says `ANTHROPIC_API_KEY`/"Anthropic API error" and several
   `src/app/backoffice/**` pages still cite `IRM_SPEC §x` — per the
   permanent rule, that's the platform team's own screen, a technical
   audience where these references are useful, not a leak.
5. **Swept beyond the two screenshots** (per "and any similar leaks"):
   found and fixed `§9b`/`§9b-4`/`§1c` spec references visibly rendered on
   `/import/structured`, `/import`, and every entity page's "Also
   connected" card; "Vercel cron"/"Resend" mentions in Automations' and
   Outbox's explanatory copy; "Supabase" in Documents' upload label and
   both import pages' not-connected states; `RESEND_API_KEY`/
   `GOOGLE_CLIENT_ID/SECRET` in Settings' invite-link hint and Gmail
   not-configured message; and the investor-facing portal's "LinkedIn
   sign-in isn't set up yet" (rewritten to "coming soon," matching the
   Gmail treatment the task specified). Left untouched: `db.org.plan`
   display in Settings' Organisation card (a fact, not a paywall), the
   entity contact-lock 🔒 (outreach discipline, unrelated to billing), and
   `layout.tsx`'s meta description mentioning "the platform team" (product
   marketing describing connectB's three real user roles, not an internal
   leak).

## Investor profile enrichment — "Request more info" was a stub, now a real lookup

**Diagnosis.** The entity page's "Request more info" link (`EnrichmentBadge`)
never called anything beyond writing a `contributions` row with
`field: '__enrichment_request__'` — a demand flag for the back-office queue,
nothing else. There was no AI, no web search, no fallback message; it just
looked functional. Confirmed on the real "One Planet" row
(`86267db3-9220-480c-8825-709e73d9e7f8`, org `bca54499-…`): every enrichable
field was `null`/`[]` before this change, exactly as reported. The AI+web-search
machinery already existed (`/api/backoffice/research`, §6b-3) but is
platform-admin-only, matches by name string across orgs, and — this is the
real gap — even a "verified" contribution there was never written back onto
the entity/person row. That promotion step didn't exist anywhere in the
codebase before now.

**Fix — single-entity, on-demand, founder-facing.**
- `src/lib/entity-enrichment.ts` (new, pure, unit-tested): the allowed field
  list, type coercion (comma-lists → arrays, currency strings → numbers, stage
  phrasing → the exact enum), and — enforced in code, not just prompt text —
  a field the entity already has a value for is dropped before it's even
  proposed, an unrecognised field name is dropped, and a value that fails to
  coerce is dropped. A proposal can never silently overwrite founder-entered
  data or write an arbitrary column.
- `src/app/api/entities/[id]/enrich/route.ts` (new): org-scoped (any org
  member may enrich their own org's entity — modeled on
  `/api/contributions/resolve`'s membership check, not the platform-admin
  gate `/api/backoffice/research` uses), calls Anthropic's real
  `web_search_20250305` tool with an explicit instruction to verify via fresh
  search rather than prior/training knowledge, and never scrape LinkedIn.
  Surviving proposals are inserted as `contributions` rows
  (`source:'ai', status:'submitted'`) — nothing ever writes to the entity
  directly. Env-gated on `ANTHROPIC_API_KEY` with a generic, vendor-neutral
  fallback message, same pattern as every other AI route in this codebase.
- `EnrichmentBadge` keeps the existing demand-flag write unchanged, and for
  entities only, now also calls the new route and shows a generic-copy
  loading/result state ("searching public sources…", "suggestions added
  below, unconfirmed", "no confident matches found"). Person enrichment is
  untouched — no lookup exists for people yet, out of scope for this pass.
- `ContributionBox` now renders AI-sourced `submitted` rows with their own
  Accept/Reject UI ("AI-sourced · unconfirmed", plus a link to the
  `source_url`), wired to the existing generic `/api/contributions/resolve`
  route (already reusable — despite its origin comment mentioning import
  conflicts, it just flips any contribution's status given an id + decision).
  Accept applies the value via the same `onApplyValue` callback the import-
  conflict flow already used; reject just marks it rejected. The pre-existing
  PT-language import-conflict popover is untouched.

**Verified live against real data**, since no migration was needed (the
`contributions` table already had `source`/`confidence`/`source_url` from
0010_ai_contributions.sql) and `ANTHROPIC_API_KEY` is configured locally.
Could not drive this through the browser end-to-end — no local credential for
the founder account, and generating one via `auth.admin.generateLink` turned
out to redirect to the production Site URL rather than localhost (the
project's redirect-URL allowlist), which would need a Supabase Auth setting
change I didn't make unilaterally. Instead verified the actual new logic
directly against production (bypassing only the thin, already-proven auth
wrapper): ran the real prompt through the real Anthropic web-search call
against the real "One Planet" and "Banif Capital" (0%-complete) entities.
One Planet: 13/13 proposed fields survived the pipeline and were inserted as
`submitted`/`ai` rows — website, sectors (9 of them), stage range (seed→series_a),
a real check-size range, thesis, HQ, email and phone, all sourced from
oneplanet.capital and matching what's publicly on their site. Banif Capital:
the model found and proposed 6 fields (website, domain, country, geographies,
sectors, thesis) and correctly left `hq_city`, `stage_min/max`, check size,
email and phone blank rather than guessing — confirming the "skip, don't
invent" behavior holds under a real partial-information case, and nothing
crashed. Both are now sitting as real, unconfirmed AI-sourced contributions in
production, exactly as the review-before-apply design intends. Build, `tsc
--noEmit`, and all 191 tests (20 new) green.

**Left out of scope, on purpose:** `address` was excluded from the
enrichable-field list — it's gated behind the migration-0024 contact-fields
capability probe and wasn't asked for; bulk/scheduled enrichment (Step 2 of
the task) is report-only for now, not built.

## Contribution-promotion bug — "verified" never reached the entity (Banif Capital)

**Reported symptom:** Banif Capital had 14 `contributions` rows, every one
`status: 'verified'`, but every structured entity field (`website`,
`email_domain`, `hq_city`, `hq_country`, `sectors`, `thesis`, …) was still
null. Also 2-3x duplicates of the same fact.

**Root cause, confirmed by reading the actual verified rows and both review
routes:** neither place that flips a contribution to `'verified'` ever wrote
the value back onto the entity. `/api/backoffice/contributions/[id]/review`
(the back-office Fila queue — the most likely path here, since it's the
general cross-org review tool and Nuno reviewed these one at a time with
staggered timestamps) only ever updated the `contributions` row itself —
there was no promotion step at all. The founder-facing ContributionBox Accept
button (shipped in the previous investor-enrichment pass) was less broken but
still fragile: the entity write only happened via a separate client-side
`onApplyValue` call *after* the status flip succeeded — two round trips, no
guarantee the second one lands. Because the entity field stayed empty either
way, a second "Request more info" run on the same entity saw the field as
still unfilled and proposed it again — the duplication is the exact same bug,
not a second issue.

**Fix:** moved the entity/person write server-side into whichever route
flips status to `'verified'`, so it happens exactly once, regardless of
which UI triggered it.
- `src/lib/entity-enrichment.ts`: `coerceEnrichmentValue` widened to accept
  already-typed jsonb values (arrays/numbers coming back out of a stored
  contribution), not just fresh model strings; added `resolveEntityFieldWrite`,
  the single-field version of the existing batch pipeline — same allowlist +
  non-clobbering + coercion guarantees, applied to one promoted fact instead
  of a proposal batch.
- `src/lib/contribution-promotion.ts` (new): `applyVerifiedContribution` —
  the one place a verified contribution's value gets applied, for both
  entities (via `resolveEntityFieldWrite`) and people (a small parallel
  allowlist: `linkedin_url`, `role`, `background`, `hook`, mirroring
  `/api/backoffice/research`'s own `PERSON_FIELDS`). A freeform "+ Add info"
  contribution with no matching column (e.g. "co-investor") correctly stays
  contributions-only — nothing to write, by design, not a bug.
  `fieldsAlreadyProposed` — queries existing submitted/verified AI
  contributions for a subject, so the enrich route can skip re-proposing a
  field that's already pending or already landed, closing the duplication
  path directly rather than just waiting for the entity write to eventually
  catch up.
- Both `/api/contributions/resolve` and
  `/api/backoffice/contributions/[id]/review` now call
  `applyVerifiedContribution` immediately after flipping status.
  `/api/entities/[id]/enrich` now also filters proposals through
  `fieldsAlreadyProposed` before inserting.
- 5 new unit tests on the exact Banif Capital shape (non-clobbering, jsonb
  array/number round-trip, unknown-field rejection).

**Retroactive backfill:** fixing the code doesn't fix contributions already
stuck in the same state, so every `contributions` row with
`status='verified' AND source='ai'` across the whole DB (35 rows) was
re-checked with the exact same promotion logic. Ran a dry pass first to see
the blast radius before writing anything: only Banif Capital's 7 unique
fields would change; the other 28 rows (21 other contributions, several were
themselves duplicates) all resolved to `already_set` — meaning those
entities' fields already held real founder-entered data, correctly left
untouched. Applied for real after the dry run confirmed the narrow, safe
blast radius; verified live that Banif Capital's entity now shows
`website`, `email_domain`, `hq_city: "Rio de Janeiro"`, `hq_country:
"Brazil"`, `sectors`, `invests_in_geographies`, and `thesis` all populated.
The 14 historical Banif Capital contribution rows (with their duplicates)
were left as-is — they're an audit trail of what actually happened, not
something worth pruning; the entity now correctly reflects only the first
accepted value per field.

## Packs removed from founder nav; suggest-investor moved into Pipeline

**Diagnosed before removing, per the explicit ask.** Read the full
`src/app/packs/page.tsx` (142 lines) and every backoffice consumer:
- The founder-facing Packs page has exactly one capability worth keeping:
  "Suggest an investor to the catalog" (`submitInvestor`). Everything else —
  browsing/unlocking curated packs, blurred pre-unlock investor names,
  de-dup/no-double-charge messaging — is being retired along with the page,
  per the task's explicit "a única funcionalidade que interessa manter."
- **No founder-facing suggestion-history/approval-status view exists
  today**, before or after this change — post-submit was always just a
  static "submitted, thanks" message. Flagging this as asked: if you want
  founders to later check whether their suggestion was approved/rejected,
  that's new work, not something this change removed.
- **Back-office is fully independent, confirmed by reading every consumer**:
  `/backoffice/catalog` manages `packs`/`pack_items` through its own
  `/api/backoffice/packs*` routes; `/backoffice/queue`'s Submissions tab
  reads `investor_submissions` through `/api/backoffice/submissions*`.
  Neither renders or calls anything on `src/app/packs/page.tsx`. Removing it
  breaks nothing admin-side.
- **No deep links** (grepped emails, notifications, hardcoded `/packs`
  strings) point at the old page from anywhere outside normal nav/the
  Pipeline button.

**Change:** sidebar nav entry removed (`shell.tsx`). The old
"+ Add investor" link (`pipeline/page.tsx`, previously a plain `next/link`
to `/packs` — there was no dropdown/other-options menu today, contrary to
what the task's phrasing implied; it was single-purpose) now opens
`AddInvestorModal` (new component) as a popup, same overlay/panel
convention already used elsewhere (`fixed inset-0` + centered panel,
matching `agenda/page.tsx`'s pattern) — exact same form fields, exact same
`submitInvestor` call, exact same post-submit confirmation copy, just
presented as a modal instead of a page nav. `src/app/packs/page.tsx` itself
now redirects to `/pipeline` rather than 404ing — no internal link needed
this (none exist), but a bookmarked/typed URL on a live product shouldn't
break, so this is a small proactive addition beyond the literal ask.
Underlying pack tables (`packs`, `pack_items`, `pack_unlocks`, `catalog`,
`catalog_deliveries`) and the `unlockPack`/`reviewSubmission` store actions
are untouched — only the founder's entry points into `submitInvestor`
moved; the admin pack-management tooling keeps working exactly as before.

## Plan display names renamed (Elementary, my dear / Suspect list / It's the buttler!)

Display names only — `src/lib/plans.ts`'s `PLANS[].name` for tiers
`idea`/`garage`/`motherfunding` respectively. Tier slugs, Stripe Price ID
env vars, and every DB enum/column are untouched, so no subscription,
webhook, or plan-gate logic changes. Confirmed via grep that every UI
surface (Plans & billing page, landing `PricingSection`, back-office
Startups org list, `OrganisationCard`) renders the name exclusively through
`planName(tier)` or `.map`-ing the `PLANS` array — never a copy-pasted
string — so the rename's blast radius was genuinely just the one array
literal, plus:
- `src/lib/plans.test.ts` — the three `planName()` assertions updated to
  match (a required lockstep change, not optional).
- `src/components/landing/PricingSection.tsx` — a feature-bullet string
  ("Everything in Garage") referenced the OLD tier's *nickname* in prose,
  not the literal old display name, so an exact-string grep wouldn't have
  caught it; found it by re-checking the rendered landing page live and
  fixed it to "Everything in Suspect list."
- Grepped for any other standalone "Garage"/"Motherfunding" nickname
  references after that fix — none found.

**Order preserved** everywhere a comparison table renders (`PricingSection`,
`/plans` page): both map over `PLANS` in array order, unchanged —
idea → garage → motherfunding == Elementary, my dear → Suspect list →
It's the buttler!, basic to complete, confirmed live in demo mode.

**Stripe Product `name` NOT updated — could not, not just "chose not to."**
`STRIPE_SECRET_KEY` and all four `STRIPE_PRICE_*` env vars are empty in this
local environment (confirmed by reading `.env.local` directly), so there is
no credential and no known Product ID to call `stripe.products.update()`
against from here, and none is stored anywhere in this codebase (billing.ts
only ever references Price IDs, never Product IDs — confirmed by grepping
for `stripe.products`/`product.name` across `src/`, zero hits). This needs
either the founder updating the two Products' display names directly in the
Stripe Dashboard (simplest — a 2-minute manual edit, safe exactly as the
task noted: Stripe references by Price ID, not name) or handing over the
real production secret key and Product IDs for a script to do it, which
isn't something to request or handle in chat per the credential-handling
rule. Flagged rather than silently skipped.

Verified: `tsc --noEmit`, full build, and all 197 tests green. Live-checked
in demo mode (temporarily unset `.env.local`, restored after) — sidebar has
no Packs entry, "+ Add investor" opens the modal with the full form intact,
`/packs` redirects to Pipeline, and both the in-app Plans page and the
public landing pricing section render the three new names in the correct
order. Back-office Startups' org-list plan display could not be checked
live (needs the real Supabase-backed API, unavailable in demo mode) —
verified by source read only, same limitation noted on earlier passes.

## Three more external-research batches imported (zero AI cost) + confidence-routed import infrastructure

**Batches 4-6** (`European_Investors_103_No_UK` batch already covered above;
this entry covers `European_Investors_Additional_100` and
`European_VC_Family_Offices_150_A_to_L`, plus the confidence-routing
infrastructure built afterward): same zero-cost seed-import process — no
`/api/entities/[id]/enrich` or Anthropic call anywhere in this path. Real
bugs found and fixed mid-stream, both caught by re-checking actual prior
output rather than trusting my own summary of it:
1. The batch-import scripts' `--dry-run` flag was **opt-in**, meaning any
   invocation that wasn't the literal `node script.mjs --dry-run` — including
   an unrelated debug command that happened to `import()` the module — wrote
   for real by accident (confirmed happened once, on the 103-batch). Fixed
   from that point on: every import script now defaults to dry-run and
   requires an explicit `--commit` to write anything.
2. Non-EUR check-size values (CHF/SEK/GBP/DKK) were being silently dropped
   instead of preserved anywhere — confirmed by re-querying the 103-batch's
   VI Partners/Industrifonden/Almi Invest rows and finding no trace of their
   real check-size figures. Fixed going forward (folded into `notes`) and
   backfilled the 3 affected rows retroactively.

New per-batch judgment calls, both narrow (1 occurrence each), both flagged:
`Type: "Venture studio"` (Buildit Accelerator) → `accelerator`; `Type:
"Other"` (Novo Holdings, a foundation-owned evergreen capital vehicle) →
`family_office` as the closest existing fit to patient/non-fee-charging
capital, rather than a fee-charging fund. `Type: "Family Office"` (batch 3)
needed no judgment call — direct match to the existing enum value.

**Confidence-routed import (migration 0032 + `scripts/import-confidence-routed.mjs`).**
The three batches above surfaced a real gap: contact/financial fields
(Street, Postal Code, Email, Phone, Key People, GP Emails, AUM, Current/
Latest Fund, Last Investment Found) had no dedicated entity columns, so they
were folded into `notes` free text — which is exactly why this data never
surfaced on the investor profile, per the founder's own diagnosis. Fixed:
- **Migration 0032** adds `postal_code`, `key_people`,
  `general_partner_emails`, `aum`, `current_funds`, `latest_fund`,
  `last_investment_found` — all plain nullable `text` (AUM/fund fields are
  narrative by design: mixed currencies, fund names, not clean numbers —
  never parsed/converted). `address`/`email`/`phone` already existed
  (migration 0024). **Not applied by me** — the Supabase MCP tool available
  in this session is bound to an unrelated project
  (`ablute_wellness_master_project`, a different Supabase account entirely),
  and the service-role REST client can't run DDL — presenting the SQL for
  the founder to run via the Supabase SQL editor, same as every prior
  migration in this repo's history.
- **`entity-enrichment.ts`** — `ENTITY_ENRICHMENT_FIELDS` (the shared write-
  allowlist every promotion path checks against) now includes the 8 new
  fields, but a new `AI_SEARCH_FIELDS` constant keeps the live AI-enrichment
  route's own prompt scoped to exactly what it asked for before — widening
  the schema on purpose does not silently start asking Anthropic to go
  search for GP emails. Unit-tested: the new fields are real write targets
  (`isKnownEntityField`) but never appear in `buildEntityEnrichmentPrompt`'s
  output.
- **`scripts/import-confidence-routed.mjs`** (new, committed — not a one-off,
  reusable for every future v2.1/v3.1 CSV the founder hands over) routes
  every confidence-tracked field three ways: `high` → direct, non-clobbering
  write onto the real column; `medium`/`low` → a pending `contributions` row
  via the exact same mechanism `contribution-promotion.ts` already uses for
  AI-web-search proposals (`source:'ai'`, `status:'submitted'`) — so it lands
  in ContributionBox's existing Accept/Reject UI with no new UI needed, with
  `source_url`/evidence attached for the reviewer; `not found` → no-op.
  Auto-detects CSV shape from the header (`First Check Min_confidence` =
  v2.1 entity-creation pass; `Street_confidence` = v3.1 entity-*update*-only
  pass, matched to an existing entity by normalized firm name, never creates
  new rows). Follow-on Min/Max has no dedicated column (not in the founder's
  own list of fields needing one) — stays in `notes` regardless of
  confidence, same as before; flagged, not silently dropped. v3.1's LinkedIn
  field has no confidence rating and no entity-level column (only
  `Person.linkedin_url` exists) — flagged, not written anywhere.
  Safe by default (dry-run unless `--commit`, learned from bug #1 above).
  Verified against two hand-built synthetic CSVs (not real data — none was
  provided for this step) covering: high/medium/low/not-found routing, the
  non-EUR-currency fallback-to-notes path (kept as its own report bucket,
  separate from genuine "not found" — an early version of the report
  conflated the two), non-clobbering against a real existing entity
  (Newion's already-set `address` correctly skipped while its still-empty
  new `postal_code` column got a direct high-confidence write), and
  unmatched-firm reporting for the v3.1 update-only path.

Verified: `tsc --noEmit`, full build, all 198 tests (2 new) green. Not yet
run against real data — per the founder's explicit "só executa quando eu
disser 'importa este lote'."

## Contribution "correction" path (migration 0033) — overwrite a field on purpose, not by accident

Follow-up to the confidence-routing infrastructure above: the first real
batch surfaced a case the design hadn't covered — two entities (A/O
PropTech, AENU) had a **wrong** `website` (rebrand, dead domain), not a
missing one. Every existing promotion path (`resolveEntityFieldWrite`) is
built around non-clobbering — never overwrite a field the subject already
holds — which is exactly correct for a fresh fill but silently defeats a
correction: a normal `contributions` row proposing a new `website` for an
entity that already has one would sit forever as "pending" because Accept
would find the field already-set and no-op. Confirmed this really would
have happened before building the fix (dry-run showed the proposal fine;
tracing Accept's code path showed it would never actually apply).

Fix, scoped narrowly per the founder's explicit requirements:
- **Migration 0033** adds `contributions.kind` (`'fill' | 'correction'`,
  default `'fill'`) plus a CHECK constraint requiring `source_url` on any
  `correction` row. Every existing and future normal contribution is
  `'fill'` by default — nothing becomes a correction by accident.
- **`entity-enrichment.ts`** — `resolveEntityFieldWrite` gained an
  `opts.allowOverwrite` parameter, defaulted off. It bypasses the
  already-has-value check for exactly the one field being resolved — no
  broader overwrite permission anywhere else in the pipeline. Unit-tested:
  overwrite works when explicitly requested, is still blocked when the
  option is omitted/false, and a coerce failure still rejects even with the
  option on (allowOverwrite widens *what* can be overwritten, not *what
  counts as a valid value*).
- **`contribution-promotion.ts`** — `applyVerifiedContribution` reads
  `c.kind` and passes `allowOverwrite: kind === 'correction'` through. Both
  review routes (`/api/contributions/resolve`,
  `/api/backoffice/contributions/[id]/review`) now select `kind` so it
  survives the round trip.
- **`ContributionBox`** — a `kind:'correction'` row gets its own card
  (distinct color, "correction · unconfirmed" label) showing **current vs.
  proposed side by side**, not just the proposed value like a normal
  fill-empty row — per the explicit requirement that a reviewer must see
  what they're replacing, not just what's being offered.
- The two real corrections (A/O PropTech → noavc.com, AENU → aenu.com) are
  now created via this path in `scripts/_import_extra_fields_10firms.mjs`
  — Accept will actually apply them once reviewed, unlike the earlier
  dry-run's proposal which would have silently done nothing.

Also fixed a cosmetic reporting bug found while running Step 1 for real:
`import-confidence-routed.mjs`'s "Matched N of M rows" count double-counted
any entity that had both a direct write and a pending contribution from the
same row (an entity can get both — e.g. address direct + Key People
pending). Simplified to `rows - unmatched`, which is what the number is
actually meant to convey.

Verified: `tsc --noEmit`, full build, all 201 tests (3 new) green. Live dry-run
against the real batch_maxinfo_10firms_v31.csv (Step 1, v3.1 shape): 10/10
matched by name — including the 2 rows with no Unique ID (360 Capital, Adara
Ventures), confirming name-only matching works as the founder hoped — 29
direct writes, 2 pending (both Key People, medium confidence), 0
already-set skips (all 10 entities were genuinely empty on every v3.1
field, confirmed live beforehand). extra_fields_10firms.csv (Step 2-4):
1 direct write (ACE & Company's AUM, confirmed safe since `aum` is text,
not currency-gated like `check_min/max_eur`), 9 pending (2 of them the new
`correction`-kind website fixes), 24 skipped (stage/sectors/thesis already
set from the original batch import for all 10 — confirmed live, not
guessed), 4 preserved to `notes` only (non-EUR or structurally ambiguous
check-size figures that would risk an uncoercible pending contribution
later). Nothing written yet — dry-run only, per the founder's explicit
"só corro com --commit quando eu disser 'importa este lote'."

## Both batches committed for real — and a real PostgREST bulk-insert bug caught mid-run

After confirming migration 0033 was applied, ran both scripts with
`--commit`. Step 1 (`batch_maxinfo_10firms_v31.csv`) landed clean: 29 direct
writes, 2 pending (both Key People, medium confidence), 0 already-set, 0
unmatched.

Step 2-4 (`extra_fields_10firms.csv`) hit a real bug on the first attempt:
the `contributions` insert failed outright — `null value in column "kind"
... violates not-null constraint` — even though `kind` has a DB default of
`'fill'`. Root cause: PostgREST's bulk insert takes the union of keys across
every object in the array as the column set; any row that doesn't include a
key gets an explicit `NULL` for it, not the column default. This script's 9
contributions were a mix — 7 objects with no `kind` key at all (meant to
fall back to the default) and 2 explicitly `kind:'correction'` — so the 7
got a literal `NULL` sent for `kind`, and the whole batch insert failed
atomically (Postgres INSERT is all-or-nothing). Step 1's script never hit
this because every contribution it creates is the same shape (`kind` always
omitted, all `'fill'`) — the bug only surfaces when a single insert call
mixes rows that specify a column with rows that don't.

Before fixing, checked exactly what had already landed from the failed
attempt (Postgres rolls back the failed INSERT, but the script's other
statements — direct writes, notes appends — run as separate calls before
it and aren't rolled back with it): ACE & Company's AUM direct write had
already applied, and all 4 notes-appends had already applied. Fixed two
things: (1) every non-correction contribution now explicitly sets
`kind: 'fill'` rather than omitting the key, and (2) the notes-append step
is now idempotent (checks whether the exact addition text is already
present before appending) so re-running the script after a partial failure
can't double-append. Re-ran — the direct write and notes-appends correctly
no-op'd (already set / already present), and all 9 contributions inserted
cleanly this time, both website corrections carrying `kind:'correction'`.

Verified live: 11 pending `submitted` contributions across the affected
entities (9 from this batch + Step 1's 2 Key People pendings), each with the
correct `kind`; 3VC's notes confirmed to contain the ambiguous-check-max
addition exactly once, not twice.

## Second direct-research batch — 15 Portuguese entities — committed

Founder decision (per his own record, 2026-07-25): after batch 1's fill
rates came back far above the country-by-country external-AI batches
(Street 8-13%→70%, Email 3-8%→60%, Key People 0-1%→80%), scale the
direct-research technique instead of going back to external-AI prompts or a
hybrid — starting with Portugal. No code changes needed; both scripts
(`import-confidence-routed.mjs` for the v3.1 contact CSV,
a fresh one-off `_import_extra_fields_pt15.mjs` mirroring batch 1's for the
business-data CSV) worked against the new data as designed.

Real result: Step 1 (`batch_pt15_v31.csv`) — 15/15 matched by name, 37 direct
writes, 3 pending (COREangels' email flagged medium as possibly a generic
address; Pathena's address/Key People flagged low/medium, sourced from Yelp
rather than the firm's own site). Step 2 (`extra_fields_pt15.csv`) — 15/15
matched, 3 direct writes (Indico Capital Partners' and Portugal Ventures'
AUM/current funds, all high confidence), 12 pending, 39 skipped
(already-set from earlier batches — Bynd VC and Indico already had check
sizes, most stage/sectors/thesis already populated).

One real extension of the existing policy, not previously exercised: batch
1's Sector Tags handling was always moot (every entity already had sectors
set), so "what if it's actually empty" had never been tested. Built it now
— same "no confidence rating in file → pending, never direct" rule already
used for thesis — turned out moot again for these 15, but the code path is
now real for whenever it isn't. Stage Focus stays report-only regardless of
confidence — narrative phrasing ("Late early-stage and growth", "Multiple
stages (VC, PE, capital markets)") doesn't map safely to the 4-value stage
enum, a value-shape risk that no confidence level fixes.

Also flagged, not acted on (per the founder's explicit "these don't block
the import, just need a separate human decision"): Angry Ventures may not
be an investable fund at all (a "Digital Studio", site unreachable);
"Investors Portugal" is actually APIES, a ~50-firm trade association, not a
fund; "MAZE (Mustard Seed MAZE)" and "Mustard Seed MAZE" look like the same
organization recorded as two separate entities — flagged for a manual merge
decision, no automatic merge attempted (has knock-on effects on notes/
history/relations that only a human should decide).

Verified live: Bynd VC's direct writes (address, postal_code, email,
key_people) and Indico's AUM/current_funds all present exactly as
committed; no errors this run.

## Third direct-research batch — 20 UK entities — committed, one repair

Scaled the batch size from 10-15 to 20 per the founder's own decision, same
technique. New wrinkle: this batch's v3.1 file included the entity `Unique
ID` for all 20 rows (queried directly from prod before research started),
so `import-confidence-routed.mjs` matched 20/20 by ID with zero
name-matching ambiguity — a strictly easier case than the previous two
batches, no script changes needed.

Real result: Step 1 (`batch_uk20_v31.csv`) — 20/20 matched, 70 direct
writes, 10 pending, 0 already-set, 40 empty. Step 2
(`extra_fields_uk20.csv`, one-off `_import_extra_fields_uk20.mjs`) — 13
direct writes (AUM/current_funds, high confidence), 21 pending
(AUM/current_funds medium/low + thesis, always-pending per policy), 14
notes-only preservations (non-EUR/ambiguous check sizes — GBP/USD figures
never converted, same rule as every prior batch), 53 report-only skips
(Stage Focus narrative + sectors/thesis already set from earlier CSV
imports), 36 genuine not-found.

**Real bug found and fixed, same session, before it could compound:** the
notes-append step in the one-off script read each entity's `notes` once
into an in-memory map at the start of the run, then wrote every addition
for that entity from that same stale snapshot — so an entity with two
separate notes-only additions (its First Check Min AND Max, e.g. Hoxton
Ventures' "$500K" and "$5M") had the second overwrite the first instead of
appending after it, because neither write knew about the other's change.
Caught by live-verifying Hoxton Ventures right after commit and noticing
only the Max note had landed. Root cause is the same *family* of bug as
the PostgREST mixed-key issue from batch 1 (a write that doesn't account
for another write happening in the same batch) but a different mechanism
(local stale-read, not a server-side default) — fixed by accumulating all
of an entity's note additions into one list before issuing a single
update, rather than one update per addition. Affected 5 entities total
(Seedcamp, MMC Ventures, Hoxton Ventures, firstminute capital, Beringea,
each missing their First Check Min note); repaired with a narrow one-off
script that only touched those 5 specific `notes` values — deliberately
did NOT re-run the full extra-fields script, since its pending-contribution
inserts have no dedup and a second full run would have doubled all 21.
Verified the total org-wide pending-contribution count (260) before and
after the repair to confirm nothing else moved.

Also flagged, not acted on (per the founder's own framing, not blocking):
**LocalGlobe** — `localglobe.vc` redirects to `phoenixcourt.vc/localglobe`;
several senior GPs reportedly departed, brand appears to now operate as
one vehicle inside a larger "Phoenix Court" platform, no confirmed current
fund name in a primary source. Its address wrote normally through the
usual flow; whether the entity needs a note or a relationship to a
"Phoenix Court" record is a human decision, deliberately not auto-merged
or auto-annotated.

Verified live: Atomico/Molten Ventures/Hoxton Ventures' direct writes
present exactly as committed; the 5 repaired entities each carry both
their Min and Max notes; total pending `submitted` contributions org-wide
is 260, unchanged by the repair.

## Bug fix: completeness score ignored the real contact fields

Founder-reported (found on MAZE (Mustard Seed MAZE),
`24338bb7-071d-4af8-a5aa-3e40986b87dc`): the entity summary card showed
"Profile 100% complete" while its Contacto block showed email/phone/
address all empty — confirmed genuinely `NULL` in production, not a
pending-review gap (no `contributions` rows exist for those fields on
this entity). Data was correct; only the percentage was misleading.

Root cause: `entityCompleteness()` in `src/lib/completeness.ts` never
checked the direct contact fields (`email`, `phone`, `address`,
`postal_code`, `key_people` — the last two added later, in migration
0032) at all. Its six checks were `website`, `email_domain` (a derived/
verification field, not the real `email`), `thesis`, check size, stage
range, and sectors — so any entity from the direct-research batches with
business fields filled but contact genuinely not-found (a normal,
expected outcome per those batches' own currency/not-found rules) reads
as "100%". The file's own top-of-file comment already flagged this scoring
as a "first cut... revisit once real usage shows which gaps actually
matter" — this is that gap.

Fix: added `email`, `phone`, `address`, `postal_code`, `key_people` as
five more checks (11 total, up from 6) to `entityCompleteness`. Kept a
single score rather than splitting into separate "firmographic" vs
"contact" numbers — the score's only consumers (the entity page badge and
the back-office enrichment-queue threshold in `entity-enrichment.ts`/
`ENRICHMENT_THRESHOLD`) already treat it as one flat completion signal,
and splitting it would have meant redesigning both call sites for a
UI-only bug whose actual complaint was "100% is a lie," not "I need two
numbers." `email_domain`/`website_verified` were left untouched — still
used for other logic (verification tracking), not the fix's concern.

Also fixed `personCompleteness` — same bug, smaller: `phone` exists on
`Person` and was never checked either. Added as a sixth check.

Verified: re-fetched MAZE's real production row and hand-computed the new
score — 6 of 11 checks pass (website, thesis, check size, stage range,
sectors, email_domain), 5 fail (email, phone, address, postal_code,
key_people all null) → **55%**, not 100%. Typecheck clean, all 201 tests
still green (no test file existed for `completeness.ts` before this — none
added now either, since the fix is a small, direct data addition to an
existing check list, not new branching logic). No migration, no DB write —
presentation-logic only, exactly as the founder's report specified.

## Follow-up to cc11161: completeness split into firmographic + contact scores

The founder measured the real effect of the 11-field score across all 531
production entities before asking for anything further — a good catch,
not obvious from the code alone: `ENRICHMENT_THRESHOLD = 70` was
calibrated when the score had 6 fields; unchanged at 11, it now demands 8
of 11 rather than 5 of 6. Firmographic average stayed 69%, but contact
average (only 45 entities touched by the direct-research batches so far)
was 8% — one blended score of 41% describes neither group, entities below
70% went from 203 (38%) to 500 (94%), and the entity-page badge would have
read "incomplete" on nearly the whole base. The founder recommended (with
these numbers behind it) splitting into two scores rather than lowering
the threshold back down, which would have restored selectivity but lost
the separate progress signal for the contact-research program.

**Implemented the split, not the threshold-rollback:**
- `entityCompleteness(e)` now returns `{ firmographic, contact }` — two
  independent `CompletenessResult`s, same 6 firmographic + 5 contact
  checks from cc11161, just no longer averaged together.
- `ENRICHMENT_THRESHOLD` (70) is unchanged and now applies only to the
  firmographic score — restores the exact pre-split 203-candidate
  calibration.
- **No percent threshold for the contact dimension** — the founder's own
  point: with the base at 8% contact-average, any reasonable cutoff
  selects almost everything. Instead, `qualifiesForContactEnrichment(c)`
  encodes the actionable rule the founder proposed: firmographic already
  ≥70% AND contact is exactly 0%. A profile incomplete on both fronts
  isn't a distinct contact-queue item — it's just the firmographic queue.
- `personCompleteness` is untouched (still one score) — the split request
  was entity-specific; people don't have the same firmographic/contact
  field-type distinction.

**Consumers updated:**
- `EnrichmentBadge` gained optional `label` (dimension name shown before
  the percent) and `low` (override the internal `percent < threshold` calc,
  needed for the contact badge since its own percent is misleading in
  isolation) props — both optional, so the person-profile badge call site
  is untouched.
- Entity page now renders two badges, "Firmographic X% complete" and
  "Contact Y% complete" (the latter's low/actionable state driven by
  `qualifiesForContactEnrichment`, not its own percent).
- `/api/backoffice/enrichment` now returns `{ profileQueue, contactQueue }`
  instead of one flat `queue` — same grouping/demand-ranking logic
  (factored into a shared `buildQueue()` helper, not duplicated), just run
  twice with different input rows. `profileQueue` is people + entities
  below the firmographic threshold (unchanged from before cc11161).
  `contactQueue` is entities only, built from `qualifiesForContactEnrichment`.
- Back-office Catálogo's Quality panel now renders two tables (factored
  into a shared `EnrichmentQueueTable` component to avoid duplicating the
  markup) instead of one: "profiles below 70% (firmographic)" and "contact
  gaps" with its own subtitle explaining the actionable rule.

**Verified against production** (531 entities, same dataset the founder
measured): firmographic queue is back to **203** (exact match — same
calibration as before contact fields existed). Contact queue (firmographic
≥70% AND contact = 0) is **244** — smaller than the reported 500 "100%
misleading" figure and, unlike that number, an actual actionable worklist
rather than badge noise. Added `completeness.test.ts` (9 tests, none
existed before) covering the split itself, the MAZE case reproduced as a
fixture, and the three `qualifiesForContactEnrichment` boundary cases
(zero-both, partial-contact, firmographic-just-under-threshold). Typecheck
clean, full suite 210/210 green, build green. No migration, no DB write —
presentation/filtering logic only, exactly as scoped.

## Fourth direct-research batch — 20 firms selected from the new contact queue — committed

First batch actually sourced from the `qualifiesForContactEnrichment` list
built in `9a2cb70` (SQL: firmographic ≥5/6 AND contact=0, top 20 by
firmographic desc) — the contact-queue split paid off as a real sourcing
tool, not just a UI number. New CSV shape this time: flat, one row per
field, `subject_id` pre-resolved (no name-matching), numeric confidence
(0.5–0.95) instead of high/medium/low labels, arrived with NO accompanying
prompt spelling out a routing rule. Didn't guess silently: asked the
founder to confirm a ≥0.9-direct / <0.9-pending cutoff before running
anything — confirmed correct once the actual prompt (17) arrived, which
also matched every one of the dry-run's counts exactly (87 rows, 74 @≥0.9,
13 pending, 87% fill rate).

One-off `_import_lote4_contacts.mjs` (deleted after use, per convention).
Real result: 74 direct writes (71@0.95 + 3@0.9) across 19 entities, 13
pending contributions (12@0.7 + 1@0.5) — Elkstone's phone/address/postal_code
all landed pending since its site blocks automated fetch and the founder's
own source was a lower-confidence privacy-policy page, not the firm's
imprint/contact page.

**Three firmographic corrections, deliberately kept out of the CSV** (the
founder's own framing: "decide comigo antes" — these needed a conversation,
not silent application): btov Partners rebranded to **b2venture** (name +
website both wrong, legal entity is b2venture AG); Volta Ventures' `hq_city`
said Brussels but the firm has no Brussels office (only Gent/Antwerp/
Amsterdam) — independently corroborated by the CSV's own Gent postal code
(9000) for the same entity, not just the founder's say-so; GO Capital's
`hq_city` said Rennes but the legal seat is Saint-Jacques-de-la-Lande (Rennes
metro). Asked which of these needed `kind='correction'` vs `kind='fill'`
before writing anything (AskUserQuestion) — the founder caught a real gap in
my first pass: btov's `hq_country` was also wrong (should be Switzerland,
not Germany) even though the DB actually stores `null` there — so that one
field is a `fill`, not a `correction` (nothing to overwrite), while `name`
and `website` are true overwrites. Speedinvest Health's classification issue
(no longer exists as a standalone fund, folded into Speedinvest's "Health &
Bio" vertical) was explicitly left untouched — a merge decision, not a field
fix, same discipline as the earlier MAZE/Mustard Seed MAZE non-merge.

**Real bug found, not fixed here (flagged for a separate decision):**
`entities.name` is not in `ENTITY_ENRICHMENT_FIELDS` (the write-allowlist
`applyVerifiedContribution`/`resolveEntityFieldWrite` enforce) — so the
btov name-correction contribution proposed here, and the 2 pre-existing
`name`-field contributions already in the queue, can never actually be
applied even if accepted through the UI. Surfaced during the (separate,
same-session) bulk-review dry-run's Tier E breakdown, not silently patched
— widening a write-allowlist to include the entity's own name is a product
decision, not a mechanical fix.

Committed both parts for real after confirming which of two simultaneously-
pending batches "importa este lote" referred to (the contacts CSV was
ambiguous against the also-pending bulk-review script — asked rather than
guessed). Verified live: APEX Ventures' direct writes (email/address/
postal_code/key_people) present; Elkstone's phone/address/postal_code
correctly still null (all three went pending, not direct); total org-wide
pending `submitted` contributions is 279 (260 before this batch + 13 lote4
pending + 6 correction/fill rows — exact arithmetic match).

## Bulk-review tool for the 260-pending-contribution backlog (built, NOT yet run)

Approving/rejecting 260 pending contributions one at a time in the UI
isn't viable — the founder asked for a rule-based bulk resolver instead of
a bigger AI-assisted review pass, specifically because most of the backlog
is mechanically resolvable (sourced facts landing on empty fields) and
only a residue needs real human judgement.

Built `scripts/bulk-review-contributions.mjs` — committed/reusable (not
underscore-prefixed) since future batches will keep adding to this queue,
not a one-off. Mirrors (can't import directly — this runs under plain
`node`, not the Next/TS toolchain) the exact write rules
`contribution-promotion.ts`'s `applyVerifiedContribution` already enforces:
the entity write-allowlist and the person write-allowlist, plus the same
non-clobbering check. Five tiers per the founder's spec: A (fill, sourced,
confidence ≥0.85, field empty → auto-accept), B (same but confidence
0.5–0.84, restricted to nine "objective" contact/identity fields → auto-
accept), C (confidence <0.5 → auto-reject, "abaixo do piso de confiança"),
D (legacy rows with no confidence/source at all → quarantine-reject rather
than accept blind, split D1 for `last_verified` specifically vs D2 for
everything else), E (residual: `correction` kind, unwritable fields,
already-set fields, judgement-type fields at medium confidence — never
automated).

**Chose the no-migration Tier D variant** the founder offered a choice on:
reuse the existing `rejected` status + `reviewer_notes` text, instead of
adding a new `needs_source` enum value — a one-time cleanup pass doesn't
justify a schema change when the existing terminal status already
communicates "not accepted as-is."

**A real, disclosed limitation, not silently glossed over:** the founder's
spec asked for "uma transação única, com rollback em caso de erro a meio."
This project has no direct Postgres connection configured anywhere (no
`DATABASE_URL`, no `pg` package) — only the PostgREST-backed `supabase-js`
client, which doesn't expose ad-hoc multi-table transactions. True
atomicity would need a direct connection or a Postgres function wrapping
the whole pass. Built the closest available substitute instead: rows are
written one at a time, every touched row's before/after value is logged
BEFORE being applied, and the run stops immediately on the first write
error rather than continuing past it. Idempotency (safeguard #5) still
holds because only `status='submitted'` rows are ever touched — anything
already resolved by a prior partial run silently drops out of scope on a
re-run.

**Real, dry-run-only finding that changed the numbers materially — did NOT
commit, per the founder's own stop condition ("se Tier E ficar acima de
60-70, diz-me antes"):** the founder's own SQL profile (kind/confidence/
source_url only) never cross-referenced whether each contribution's
target field was already filled by a *later* batch since the legacy rows'
2026-07-22 creation date. Non-clobbering correctly takes priority over
every other tier. Actual result: **A=36** (not ~82), **B=4** (not a chunk
of ~50), **C=9** (exact match), **D1=0/D2=0** (not 117 — nearly all of the
legacy rows' target fields turned out to already be filled by the
seed-import batches, so they fall to "already set" instead), **E=211**
(not 60-70). Spot-checked the explanation directly: Nina Capital, Calm/
Storm Ventures, Crista Galli, Bynd VC, and Speedinvest Health all already
carry a `website` in production, confirming the legacy `website`
proposals are genuinely superseded, not a classification bug. Reported
the full tier breakdown, the `entities.name` allowlist gap this dry-run
surfaced, and the transaction-safety limitation, then asked which of two
simultaneously-pending confirmations ("importa este lote") the founder
meant — this script is still **awaiting an explicit go-ahead with the real
numbers**, not the estimated ones, before any `--commit` run.

## Bulk-review tool: rule-order fix, name allowlist fix, committed for real

The founder found a real logic bug in her own spec, not in the
implementation of it: safeguard #1 ("never overwrite, in any tier") was
written generally but only actually makes sense for tiers that *write*.
Applying it as a first-pass filter ahead of the two status-only tiers
(legacy quarantine, confidence-floor rejection) meant a legacy row whose
target field happened to already be set skipped the quarantine entirely
and dropped back into "already set" — exactly the outcome the quarantine
existed to prevent. Fixed by re-ordering to 8 explicit rules, evaluated
first-match-wins: (1) unwritable field — reject as garbage, not
quarantine, since the system could never apply it regardless; (2) legacy/
no-provenance — quarantine-reject regardless of whether the field is
filled, since this is a status change, not a write; (3) confidence floor —
reject, also status-only; (4) `kind='correction'` — always manual; (5)
field already set — split duplicate (reject) vs divergent (manual); (6)
Tier A; (7) Tier B; (8) true residual.

**`entities.name` allowlist gap, fixed with the guard the founder
specified:** added `name` to `ENTITY_ENRICHMENT_FIELDS`, but
`resolveEntityFieldWrite` now refuses it outright unless the caller passes
`allowOverwrite` (i.e., it's an explicit `correction`) — a plain `fill`
targeting `name` can never apply, no matter the entity's current value.
The bulk-review script also force-routes any `name` contribution straight
to the manual residual regardless of kind/confidence, as a second,
independent guard. `knownEnrichmentValues` (the "don't re-propose this"
hint fed to the AI route) explicitly excludes `name` too — it's the
subject of the research itself, never a fact to withhold. 2 new tests in
`entity-enrichment.test.ts` (212 total, up from 210); build/typecheck
green.

**Rule 7's lote4 key_people/team-page exception, found to be "correct by
accident" — the founder's own words, and she was right.** The exception
matched 6 rows, not just the 3 from lote4: Balderton Capital, Index
Ventures, and Eight Roads Ventures (an older UK20-batch, multi-URL
citation format) also matched. Investigated why: `new URL()` on a
`source_url` containing several URLs joined by `"; "` silently absorbs
everything after the first URL into one long percent-encoded pathname —
so the regex check for `/team` was matching against a blob containing
every cited URL's path concatenated together, not genuinely checking
"does THIS source point to a team page." The result didn't change (all 6
do cite a real own-domain team page somewhere in their citation string),
but the logic was accidentally right, not actually right. Fixed by
splitting `source_url` on `;` and checking each candidate URL
independently before deciding.

**The two rule-5 normalizations, exactly as specified — no more, no
less:** a URL differing only in scheme/`www.`/trailing slash is the same
site (`indexventures.com` vs `https://indexventures.com`), and a country
code/alias proposed over its own canonical full name is the same fact
(`UK` vs `United Kingdom`) — canonical form fixed as the full name per the
founder's explicit convention, asymmetrically: a code-over-full-name
proposal is a duplicate (reject), but a full-name-over-code proposal is a
real improvement and is let through to the normal tiers. This resolves
half of the previously-open `hq_country` normalization backlog as a side
effect. Deliberately did NOT extend normalization to other fields the
founder didn't ask about (e.g. Molten Ventures' `phone` differing only in
parenthesis/spacing formatting correctly stayed in the divergent/manual
bucket) — scope discipline over cleverness.

**Real result, dry-run then committed:** residual dropped from 85 to 71
after the two normalizations (14 rows moved from divergent to duplicate),
which the founder's own instruction treated as the commit signal ("se
descer, commita a seguir"). Final counts across 279 pending contributions:
51 rejected (unwritable field), 64 rejected (legacy quarantine), 9
rejected (confidence floor), 28 rejected (duplicate), 38 accepted (Tier
A), 18 accepted (Tier B) — **96 written + verified, 155 rejected, 71 left
in the active queue** for genuine human review (5 corrections, 18
divergent-value rows, 48 judgement-field-at-medium-confidence rows).
Verified live: Index Ventures now shows `hq_country: 'United Kingdom'`
(normalized) and `website: 'https://indexventures.com'` (its pre-existing
value correctly untouched, not overwritten by the near-duplicate
proposal). The full before/after audit log (`bulk-review-2026-07-26.json`,
committed rather than deleted — it's the undo record the spec asked for,
not a disposable report) has all 208 touched rows.

## Fifth direct-research batch — 726 facts across 190 entities, new production method — committed

Production changed: instead of the founder compiling the CSV by hand, ten
research agents wrote directly to disk against a fixed contract and an
aggregator validated line by line — 1000 raw rows (200 entities × 5
fields) down to 726 real facts, 76% fill rate, zero malformed rows, zero
quarantined after the founder resolved six domain issues herself before
sending. Same source discipline as every prior batch (official imprint/
contact/team pages, national business registries where nothing else
existed), just at 10x the batch size of lote4.

**The one genuinely new mechanic: prefix resolution.** To fit the SQL
editor's read limits, the roster was built with 8-character UUID prefixes,
not full ids. Built this as an explicit two-gate pre-flight, run to
completion before a single row is classified or written:
1. Resolve every prefix via exact string-prefix match against the full
   entity table (`id.startsWith(prefix)`, done in JS after one bulk fetch
   — not a Postgres `LIKE`, since PostgREST doesn't cast a uuid column to
   text for pattern matching without extra plumbing this didn't need).
   Any prefix resolving to 0 or >1 entities **aborts the entire import**,
   not just that row — exactly as specified, since a fact written to the
   wrong entity is worse than a fact never written.
2. Second-check `entity_name` against the resolved entity's real name,
   normalized (NFD diacritic strip, lowercased, common legal suffixes —
   GmbH/Ltd/AB/Oy/BV/SA/AG/Inc/LLC/etc — stripped as whole tokens). Any
   material mismatch also aborts the whole run.
Both gates ran clean: all 190 prefixes resolved to exactly one entity,
zero name mismatches, so nothing needed the founder's promised "go back
and disambiguate" fallback.

**New idempotency requirement, also implemented as specified:** a second
run must not duplicate a pending contribution. Added a
`(subject_id, field, value)` key checked against every existing
contribution row (any status) before inserting — direct writes were
already idempotent for free via the pre-existing non-clobber/`hasValue`
check, so this only needed building for the pending-contribution path.

**Corrections (6 website rows) followed the same rule as every prior
batch**: `kind='correction'` always routes to a pending contribution for
human review, never a direct write, regardless of confidence (all 6 were
0.95) — the founder's spec explicitly said not to carve out an exception
here, and none was.

**Real result:** 545 direct writes across 174 entities (confidence ≥0.9),
187 pending contributions (181 fill at 0.5–0.7 + 6 corrections), 0
already-set skips (expected — these 190 entities were pulled from the
qualifiesForContactEnrichment queue, i.e., contact was already 0% for all
of them), 0 idempotent skips (first run, nothing to collide with yet).
Verified live: aws Gründungsfonds' direct writes (email/phone/address/
postal_code/key_people) all present; Green Generation Fund's `website`
correctly still the OLD value (`greengenerationfund.com`) — its correction
sits pending, not applied, exactly as designed. Total pending `submitted`
contributions org-wide is now 258 (71 after the bulk-review pass + 187
from this batch — exact arithmetic match).

Same two informational flags from the founder's own prompt carried
through untouched, no action taken: Buildit Accelerator and BADideas.fund
share one Riga address (both imported as-is, no auto-merge); the ten
entities the research pass found zero data for (site-dead or clearly
abandoned, e.g. fountainhealthcare.com for sale on GoDaddy) are simply
absent from this CSV — nothing to import, a status review is a separate,
later decision.

## Widened the team-page exception past English-only slugs (prompt 21)

`isOwnTeamPage`'s slug check tested literally `/team` (or a couple of
English variants). Running it against the lote5 manual residual found 40
of 42 candidate rows failing purely on slug — `/our-team`, `/equipe`,
`/chi-siamo`, `/folk`, `/mot-teamet`, and locale-prefixed/nested variants
like `/en/about-enterprise-ireland/our-team`. The underlying reasoning
(a fund's own team page is authoritative; 0.7 there is staleness risk, not
source risk) never depended on the slug being English — a European
roster can't assume that.

Rewrote the check to match per **path segment** against an explicit
multi-language list (`team`, `equipe`, `chi-siamo`, `folk`, `mot-teamet`,
etc.), or a segment whose last hyphen-joined word is `team`/`people`/
`teamet` (covers fund-specific slugs like `venionaire-team`,
`borski-team`) — except a segment containing `contact` never matches even
if it ends in `-team`, since `/contact-our-team` is a contact page, not a
team roster, and the naive suffix rule would have wrongly caught it.
Segment-based matching also finally fixes the `/steam-engine` false-
positive risk a plain substring test would have carried. The domain gate
(source must share entity.website's host) is unchanged — it's the actual
security control; the slug only classifies the page type.

Also added a small permanent diagnostic: `bulk-review-contributions.mjs`
now prints a per-batch-tag breakdown (rows whose `note` mentions a given
lote, split by which rule they resolved to) so a specific batch's
residual can be checked without conflating it with whatever carried over
from earlier passes — used to confirm lote5's own residual dropped from
187 to 35 after this widening (9 of the remainder are the categories the
founder explicitly wants to stay manual — homepage-only sources, contact
pages, national registries, bare firm-name slugs; the rest are genuine
additional slug patterns — file extensions, `-members`/`-organisation`
compounds, one subdomain variant — not yet worth widening further for a
handful of rows).

## Sixth direct-research batch — 623 facts across 150 entities, 25% of stored websites dead — committed

Same architecture as lote5 (10 agents writing directly to a fixed
contract, one aggregator validating line by line), applied to the
remaining contact=0%-with-website entities. Real, load-bearing finding:
lote5 caught 6 dead/migrated domains in 200 entities (3%); this pass
caught ~42 in 163 (~25%) — not chance, selection: these are precisely the
entities nobody could enrich before, and the most common reason is that
the stored website no longer serves the firm at all. The founder verified
all 42 by hand (`curl -sIL` + title/body inspection) before sending,
discarding 7 (a parked lander with no cross-reference, a hosted
business-card page pointing back to a different firm entirely, a domain
that 404s, one where the "old" domain was live and correct, three where
the "old" domain just responds 405 to HEAD but serves byte-identical
content to the "new" one — correcting those would be pure churn) — 35
made it into the corrections file, still `kind='correction'`, still
always pending regardless of confidence, no exception for the higher
count.

The interesting subset of the 35: **7 were a different firm's domain
entirely** — `coreangels.com` was recorded under "Core Capital" (an
unrelated firm), `bpfomento.pt` (Banco Português de Fomento) under "ISQ,
SCR, SA", `en.karma-network.com` (a digital agency) under "Faber
Ventures." Not typos — wrong-firm domains from the original seeding,
surfaced only because this pass finally tried to fetch each one and
found nothing about the firm it was supposedly for.

**A real transcription bug, caught by the founder's own verification, not
mine:** my first materialized copy of the 623-row contacts CSV parsed to
622 — I'd dropped Core Capital's `postal_code` row (`1350-118`,
confidence 0.9) while manually re-typing the ~46k-token file into the
scratchpad (chat attachments in this environment are read-once; Bash/Node
can't open them directly, so every batch this session has required
re-materializing the exact text by hand). I initially reported the
discrepancy honestly rather than guessing which row was missing or
silently proceeding with 622. The founder re-verified the source file
independently (md5 hashes, per-field/per-confidence counts, zero internal
duplicate keys) and pinpointed that the gap was on my side, in exactly
the field/confidence bracket the math predicted (a `postal_code` at
0.9–0.95, since the ≥0.9 tier was short by one and the <0.9 tier matched
exactly). Fixed the one row, re-verified every asserted number matched
byte-for-byte before writing anything.

**Real result:** 499 direct writes across 144 entities (confidence ≥0.9),
159 pending contributions (124 fill at 0.5–0.7 + 35 corrections), 0
already-set (expected, contact=0% queue), 0 idempotent skips (first run).
Verified live: entities with some contact field went from 292 to **436**
(the founder's own "perto de 440" estimate, near-exact); Core Capital's
`postal_code` present and correct; total pending `submitted`
contributions org-wide now 418.

Same discipline as every batch: `d0982a65` (Solaeng Invest) appears only
in the corrections file, not the contacts file — one of the thirteen
entities with zero contact lines at all but a website worth correcting,
not an anomaly. Thirteen entities got no lines this batch, split two ways
per the founder's own framing: eight with no live site at all (status-
review candidates: June Fund, Bevin CP, Collector Ventures, Vega Ventures,
NBS Ventures, Schenker Ventures, Solaeng Invest, Ideias glaciares — plus
BCP Capital, in liquidation, whose stored domain actually belongs to an
unrelated software company) and four blocked by the founder's own explicit
decision pending a human call (Founders Capital, Bluemint, Conexo Capital,
LEVELS) — none silently dropped.

## Bulk-review run for real: two matcher fixes, one non-bug, one real one

**The 418th contribution.** 258 pre-lote5 + 159 from lote6 = 417, not the
418 reported. The extra row was legitimate: a `__enrichment_request__`
demand-flag created via the live app at `2026-07-26T13:06:48`, between
the lote5 verification checkpoint and the lote6 import — someone clicked
"Request more info" in the UI mid-batch. Not a bug; confirmed by querying
`contributions` ordered by `created_at` around that window. It resolves
under rule 1 (unwritable field) on every run, since the demand-flag isn't
a real data field.

**Fix (a), mine to own:** the team-page segment matcher didn't strip file
extensions (`/team.html`, `/team.php`) before comparing, and compared
hyphenated slugs literally, so `/whoweare` never matched `/who-we-are`
even though both were already-accepted shapes. Neither restriction was
intentional — both were oversights from the prompt-21 widening. Fixed by
stripping `.html/.htm/.php/.asp/.aspx/.jsp` from the last path segment and
adding a hyphen-insensitive fallback match.

**Fix (b), also mine:** `TEAM_PAGE_SEGMENTS` had zero Spanish entries —
not a missed slug, a missing language, in a database whose stated
expansion order is Europe → UK → MENA → USA and Spain isn't a footnote in
that. Added `equipo/nuestro-equipo/quienes-somos` (ES), `menschen/unsere-
menschen` (DE), `meista/tiimi/hallitus` (FI), `qui-sommes-nous` (FR), and
completed the `board` family (`board-of-directors/styrelse/bestyrelse`).

**Item 4 (privacy-policy as an address source) needed no code change.**
Checked before building the proposed `isOwnLegalPage` exception: `address`
and `postal_code` are already in `OBJECTIVE_FIELDS`, which rule 7 accepts
with no domain gate at all — any sourced, empty, medium-confidence value
already passes regardless of which page it came from. Celtis, Shilling,
and byFounders' privacy-policy-sourced rows were never actually blocked;
building a narrower exception for them would have been redundant scope
against an already-permissive rule, so nothing was added.

**Impact X Capital — a real aggregator bug, not mine.** Two rows cited
`https://impactxcapital.com/assets/index-DC5XJK2H.js` (a content-hashed
JS bundle, not a page) as `source_url`: an already-applied `email` write
at 0.9 and a still-pending `key_people` row at 0.7. The hash means the
URL 404s on the site's next deploy — the proof rots. Rejected the pending
row with a note explaining why; appended a warning to the entity's
`notes` pointing at the already-written `email` needing re-sourcing from
a real page. The founder's own sweep confirmed these are the only two
such rows across lote5+lote6; a future batch will have the aggregator
reject `source_url` values ending in `.js/.css/.json/.map` or living
under `/assets//static//_next/` outright.

**Verifying against three named rows exposed a real limitation, not a
bug:** Bionova Capital, Dunas Capital, and Enjoy Venture were named as
rows fix (a)/(b) should unblock, but none did. All three share one cause:
their `entities.website` is stale (`hovionecapital.com`,
`dunascap.com`, `enjoy.vc` vs. the correct `bionovacapital.com`,
`dunascapital.com`, `enjoyventure.vc`), lote6 carries a `kind='correction'`
row to fix each, and corrections are *always* manual by explicit design
(rule 4) — so the domain gate correctly refuses to match until a human
approves the website correction first. Working as designed: the gate is
the actual security control, and a stale website is exactly the case it
exists to catch. These three will resolve on the next bulk-review run
after their website corrections are approved, not before.

**Real result of `--commit`:** 230 rows touched. Manual residual left in
the queue: 187 (rule 4 + 5b + 8), matching the dry run exactly.
Per-batch-tag breakdown: lote4 residual 5/5, lote5 residual 33/187,
lote6 residual 83/158 — **48 in `fill` (exactly the founder's expected
number) + 35 always-manual website corrections**. Total submitted
contributions org-wide: 417 (418 minus the Impact X `key_people`
rejection).

## Fixed pipeline order: website corrections before bulk-review, always

Bionova Capital, Dunas Capital, and Enjoy Venture weren't three unlucky
rows — they're the general case. `entities.website` is the domain gate's
only source of truth; while it's stale, the gate correctly rejects
*everything true* that batch found for that entity, including fields
that have nothing to do with the website itself. A `kind='correction'`
row is always manual (by design — an overwrite with no second look is
exactly what that rule exists to prevent), so if it hasn't been approved
yet, the gate has no way to know the correction is right.

**Fixed order for every future batch, no exceptions:** (1) approve that
batch's `website` corrections first, (2) run `bulk-review-contributions.mjs
--commit`, (3) run it **again** — the second pass is what catches
whatever the website corrections just unblocked. Skipping step 3 silently
strands exactly the rows step 1 was meant to free.

## Prompt 24 — verifying the bulk-review run against the founder's own count

The founder re-derived the run's numbers independently and found two real
gaps, not phantom ones (same "a one-row difference has been real twice
before" discipline that caught the lote6 transcription bug).

**1. The 67 untagged rows.** Her batch-tag breakdown (lote4/5/6) summed to
350 of the 417 pre-run `submitted` rows, leaving 67 unaccounted for —
"presumo que sejam os lotes 1–3 [...] mas presumir não serve." Reconstructed
the exact pre-run snapshot (187 still-`submitted` + 230 touched, from the
`--commit` audit log, sums to 417) and tagged all 417 by note text. The 67
are real and all pre-lote4: 22 from the VC-firms pilot batch, 39 from
various "extra fields" imports, 2 from the §9b structured-import conflict
path, 2 pre-existing website corrections, 2 one-off notes (a Volta
hq_city fix, a missing-fields flag) — plus exactly **one** row from the
live app: the `__enrichment_request__` demand-flag (the "418th"
contribution from the earlier report), which is the only one of the 67
this run touched (rejected, rule 1). Zero rows had a `NULL` note. This
closes her arithmetic: 350 + 67 = 417; 229 + 1 = 230.

**2. The 75-vs-73 discrepancy.** Sent her the full list (`subject_id`
prefix, `field`, `source_url`) for independent cross-check, per her
request, rather than trying to guess the two rows myself.

**3. The domain-gate question — this is the important one.** Checked the
code, wrote nothing:
- **What does `bulk-review` actually verify before approving an
  `OBJECTIVE_FIELD`?** Confidence tier only. Rule 6 (≥0.85) and rule 7
  (0.5–0.85 + objective field) both check *only* `c.confidence` — neither
  requires `source_url` to be non-empty. The only place a missing
  `source_url` matters is rule 2's "legacy" quarantine, which requires
  confidence to be `null` *as well* — a row with a real confidence number
  and no source_url passes through untouched. This is a real gap in the
  script, independent of anything to do with lote5/6.
- **What confidence/source_url do app-created contributions carry?**
  Traced every insert path. `ContributionBox`'s "Add info" (the plain
  founder-authored form) inserts with no `confidence`/`source_url` at
  all — both default to `NULL` per the `0006_contributions.sql`/
  `0010_ai_contributions.sql` schema. A `NULL` confidence always satisfies
  rule 2's "legacy" quarantine before rule 6/7 are ever reached, so this
  path is safe **by construction**, not by any check specific to it. The
  `/api/entities/[id]/enrich` "Research with AI" route is different: it's
  `source='ai'` but carries a *real* confidence + source_url (required by
  its own tool schema) — structurally indistinguishable from a batch
  import once it lands in `contributions`, and therefore just as exposed
  to the gap above. It hasn't produced a row in the current dataset (its
  distinct note, `"AI-sourced via Request more info"`, appears zero times
  among the 417), so it caused no harm this run, but the exposure is real
  and will matter the day that button gets used.
- **Did any of the 230 approved rows come from the app?** No. Checked all
  417 by note text; the only app-originated row in the whole set was the
  demand-flag one, which was rejected (rule 1), not accepted.

No code changed answering this — per the founder's explicit "não mexas em
código" instruction. The fix (adding an explicit `source_url` requirement
to rules 6/7, or a domain check for `OBJECTIVE_FIELDS` mirroring the
`key_people` team-page exception) is a decision for her to make and
scope, not something to bundle into this report.

## Prompt 25 — confidence is a claim, not a property of the fact

**The principle, now written down because it was never needed before:**
"A confiança não é uma propriedade do facto. É uma afirmação de quem o
produziu." Every confidence number in this pipeline so far came from the
founder's own Python aggregator, which already enforces the domain gate,
the no-paid-sources rule, and "never infer" — so a batch row's `0.95`
means "printed on the entity's own imprint page." The `/api/entities/[id]
/enrich` "Research with AI" route emits the same shape (`confidence`,
`source_url`) but the number means "the model thought so" — same field,
no shared meaning, and the two were structurally indistinguishable once
landed in `contributions`. It hadn't produced a row yet; that was luck,
not design.

**Fix (1), done now, unconditional:** `source='ai'` never reaches rules 6
or 7 (auto-accept), regardless of confidence. Added as a hard gate ahead
of both tiers in `bulk-review-contributions.mjs` — it still passes
through rules 1-5 (unwritable/legacy/floor/correction/duplicate) exactly
as before, since those are quarantine/rejection paths, not auto-accept
ones. A diagnostic block prints every row this blocks, same pattern as
the existing team-page-exception log.

**A real, load-bearing consequence, not a side effect to paper over:**
lote4/5/6's own batch-imported rows are *also* stored with `source='ai'`
in the database (they were produced by AI-assisted research, same as the
in-app route, just funneled through the founder's aggregator first) — so
this fix doesn't only guard the in-app button, it also permanently routes
every remaining and future batch-imported `fill` row to manual review,
regardless of confidence or domain match. Confirmed live: after approving
the 34 website corrections and re-running `bulk-review-contributions.mjs
--commit` a second time (per the fixed pipeline order), **0 rows were
auto-accepted** — Bionova Capital, Dunas Capital, and Enjoy Venture's
`key_people` rows now have correct domains and would have matched the
team-page exception, but all three carry `source='ai'` and are
permanently blocked from rule 7 by fix (1). This is the rule working
exactly as specified ("sem excepção"), but it means rules 6/7 no longer
auto-accept anything from *any* future batch either, not just the app —
worth the founder's explicit confirmation that this is the intended
scope, since it changes what "Tier A/B auto-accept" means going forward.

**The 68-vs-67 count:** was my own phrasing error, not a second missing
row. The five groups (22 pilot + 39 extra-fields + 2 §9b conflicts + 2
pre-existing website corrections + 2 one-off notes) sum to exactly 67 —
"plus exactly one row from the app" described one of those 67 (the
`__enrichment_request__` demand-flag, filed under the "2 one-off notes"
group alongside a Volta `hq_city` fix), not an addition to it. Total is
67, not 68; math still closes at 350+67=417 and 229+1=230.

**The 34 website corrections:** reviewed by the founder by hand, all but
one confirmed as genuine rebrands/relocations (Demeter→Demea, Seedfonds
Aachen→TVF Management, ISQ→ASK Group, Solaeng→Soläng, transliteration).
`b9f29df7` (GED Ventures → buenavistaequity.com) held back — the page
never mentions "GED" at all, so there's no printed proof linking the two
names, exactly the failure mode these corrections exist to catch. Applied
the 34 directly (`entities.website` write + `contributions.status =
'verified'`), left GED Ventures pending. Re-ran the bulk-review per the
fixed order — see the `source='ai'` finding above for why it touched
nothing.

**Impact estimates for changes (2) and (3), counts only, no code
changed** (per explicit instruction — she reviews before either is built):
- **(2) requiring non-empty `source_url` on rules 6/7:** of the 242
  lote4/5/6 rows that were auto-accepted end to end, **zero** are missing
  a `source_url`. This change would currently cost nothing — every batch
  row has always carried one.
- **(3) a domain gate on `OBJECTIVE_FIELDS`** (mirroring the `key_people`
  team-page check, no national-registry allowance yet): of the 77 non-
  website objective-field rows accepted, **33 fail a naive host-match**
  against `entities.website`. Nearly all of them are exactly the
  legitimate case the founder flagged needing a registry carve-out —
  Companies House (`find-and-update.company-information.service.gov.uk`),
  Belgian KBO (`kbopub.economie.fgov.be`), Norwegian Brønnøysund
  (`data.brreg.no`), French `annuaire-entreprises.data.gouv.fr` — plus a
  handful of legitimate imprint/privacy-policy pages on a rebranded
  domain (`b2venture.vc` for btov Partners, `msm.vc` for MAZE). Without
  her registry list this rule can't be scoped correctly; sending it
  narrow (host-match only, no registry) would wrongly quarantine most of
  these 33 real facts.

Waiting on the founder's national-registry list (format of her choosing)
before scoping (3), and her confirmation that fix (1)'s batch-wide effect
is intended before touching rules 6/7 further.

## Prompt 26 — the discriminator was "author", it should be "path"

**Confirmed: fix (1)'s scope from prompt 25 was wrong**, and the founder
caught it on her own re-derivation. `source='ai'` answers "who wrote this
fact", not "what did this fact pass through before landing here" — and
lote4/5/6 are *also* `source='ai'`, since they're AI-assisted research
too, just funneled through the founder's own Python aggregator first
(domain gate, no-paid-sources, never-infer, all enforced before the CSV
even exists). The in-app AI routes skip all of that. Same `source` value,
opposite guarantees — the gate needed to be "did this row come from the
aggregator", not "was an AI involved at all".

**Fixed:** the gate in `bulk-review-contributions.mjs` now checks the
row's `note` for the two in-app AI routes' own markers (`"AI-sourced via
Request more info"` from `/api/entities/[id]/enrich`, `"AI-proposed via
research (§6b-3)"` from `/api/backoffice/research`) instead of `source`.
Today that's zero rows — the gate is a no-op right now, and returns the
batch pipeline to normal. Documented for real next time: the durable fix
is an explicit `pipeline` column only the batch importer can write, which
auto-accept requires present — a procedural guarantee (marks that
specific code ran), not a cryptographic one, and honest to describe that
way. Not built yet — flagging it here is the followup, not a TODO buried
in a comment.

**The domain gate (prompt 25 §3, scoped for real this time):** loads two
founder-supplied reference files, `scripts/data/national-registries.csv`
(22 hosts, `host,pais,registo`) and `scripts/data/website-aliases.txt` (a
prefix|domain|proof format, six sections, each alias independently
verified — redirects, dead-DNS successors, parked-domain replacements,
wrong-firm corrections, same-site sibling hosts, and a rejected section
kept on file so a vaga-3 agent doesn't re-propose them). A `source_url`
on an `OBJECTIVE_FIELDS` row (except `key_people`, which keeps its own
team-page exception, and `website` itself, which has no "own domain" yet
to check when the field is still empty) is accepted if: its registrable
domain matches the entity's own (last two labels, three for known
second-level ccTLDs like `co.uk`), OR its host falls under a national
registry, OR the (entity, domain) pair is a proven alias — and always
rejected if the path is a build asset (`.js`/`.css`/`.json`/`.map`, or
under `/assets/`, `/static/`, `/_next/`). The same alias/registry logic
was also wired into the `key_people` team-page check (`isOwnTeamPage`) —
without it, three lote6 rows (e2vc, IBB Ventures, Apposite Capital)
stayed stuck even after finding the right team page, purely because
`entities.website` couldn't be repointed to the exact same domain string
as the alias.

**Rules 6/7 now require `source_url` non-empty**, per prompt 25's
pre-check (cost was zero across the 242 already-accepted rows — applied
without further discussion, as instructed).

**Recovered after re-running `--commit`:** lote5 residual 33→29 (the four
Vaga-1 aliases — Eleven Ventures, CapitalT, Finch Capital, bValue Fund —
now recognized as the entity's own domain); lote6 residual 48→30, right
at the founder's own estimate. 23 rows accepted this run (19 via the
`key_people` team-page/alias exception, 4 via the objective-field domain
gate), 2 rejected as genuine duplicates (see below).

**Confirmed (prompt 26 §2): the `superangel.io` match was suffix
matching, on purpose, from prompt 18's original design** — not a new
behavior. `looksLikeTeamPageSegment` falls back to
`/(^|-)(team|people|teamet)$/` for compound slugs the fixed list doesn't
enumerate (`superangel-investor-team` ends in `-team`). This matches
suffixes, not substrings or prefixes: `team-de-advisors` would NOT match
(it doesn't end in `team`/`people`/`teamet`), but `investor-team` or
`advisors-team` would, same as `fund-team` already did. The `contact`
exclusion still applies regardless. The door is open exactly as far as
"ends in the marker word", not further.

**A finding surfaced, not silently applied: GED Ventures now passes the
`key_people` domain gate**, because `website-aliases.txt` §A lists
`b9f29df7|buenavistaequity.com|gedventures.pt redirecciona...` as a
proven redirect — the founder's own re-verification, stronger evidence
than the earlier "does the destination page say GED" check from prompt
25 that held the row back. This only affects the `key_people` *fill* row;
the `website` *correction* row is still `kind='correction'` (rule 4,
always manual) and was left untouched — nothing auto-wrote GED's website.
Flagging this reversal explicitly rather than letting the domain gate
quietly re-decide something the founder had explicitly parked.

**Prompt 26 §3 — two `email` rows reverted to manual review**, per
instruction: Entree Capital's (privacy-policy page — likely the DPO
contact, not a business one) and Arkwright X's (parent company's
imprint, not the fund's own `arkwrightx.vc`). Both were already
`status='verified'` from the earlier run; flipped back to `submitted`
with `reviewer_notes` explaining why. **A fragility worth flagging, not
fixing now:** because the entity's `email` field already holds the exact
proposed value, any *future* `bulk-review --commit` run will re-classify
both as rule 5a ("duplicado, sem alteração") and silently re-reject them
— rule 5 has no way to distinguish "a human should look at this before
it's final" from "someone re-proposed a no-op". Confirmed by dry-running
after the revert. Not a code change to make unilaterally; a real
"flagged pending a human decision, exempt from rule 5" state is a design
call for the founder.

**§4 — objective-field domain-gate failures after loading both files:
zero.** All currently-pending objective-field rows now pass (own domain,
registry, or alias); the 33 that failed the earlier naive host-only check
were exactly the registry/alias cases the founder anticipated.

## Prompt 27 — a redirect outranks an absent name, and "manual review" needed a real state

**Rule, not a one-off: a domain redirect from the old name to the new one
is stronger proof of a rebrand than the new page simply not mentioning the
old name.** A redirect is machine-checkable today and in six months,
independent of anyone reading carefully; an absent name is just an absence
— the new firm almost never prints the name it dropped, so its absence
proves nothing either way, while the redirect is the one thing the new
owner can't hide. GED Ventures was the concrete case: prompt 25 held the
`gedventures.pt → buenavistaequity.com` correction back because the
destination page never says "GED" — correct read of that specific signal,
wrong conclusion, because `website-aliases.txt` §A already recorded the
redirect itself (found independently, before this website even had a
proven-alias file to check against). Applied both once flagged: GED
Ventures' `key_people` (already auto-accepted via the domain gate) and the
`website` correction itself (still `kind='correction'`, so it needed the
explicit approval it just got — never auto-applies regardless of this
rule).

**The 23-vs-22 arithmetic the founder flagged did close, no row missing.**
Decomposed the run's audit log by batch tag: 4 accepted from lote5 + 19
from lote6 = 23, exactly matching the reported count. The apparent gap
came from conflating two different populations: the two `email` rows I
reverted to `submitted` right before running `--commit` were **not** part
of the original 33/48 residual baseline — they'd already been `verified`
from an earlier pass, and only became `submitted` again because of my own
revert timing, immediately ahead of the commit. The run correctly
re-evaluated them (both landed on rule 5's duplicate check, since the
entity field already held the exact proposed value) and rejected them —
a side effect of my sequencing, not a defect in the counts. Lote5's -4 and
lote6's actual -19 (not the founder's own back-of-envelope -18) both fully
account for the residual drop on their own.

**"Manual review" needed to be a real status, not a note a later run could
overwrite.** `contributions.status` was `submitted | verified | rejected`
— nothing for "a human flagged this, don't touch it yet." Reverting the
two email rows to `submitted` with a `reviewer_notes` flag looked like it
worked, but the very next `bulk-review --commit` proved it doesn't: rule 5
can't distinguish "awaiting a human decision" from "someone re-proposed a
no-op," so it silently re-resolved both as duplicates. Migration 0034 adds
`held`: no automatic rule ever reads a `held` row — not by a check that
could be skipped, but because `bulk-review-contributions.mjs`'s fetch is
scoped to `status='submitted'`, so a `held` row is structurally absent
from what any rule ever sees. It leaves `held` only via an explicit human
decision — wired into `ContributionBox` (founder's own-org view) and the
back-office queue (cross-org, platform-admin view) with their own Accept/
Reject actions, both hitting the same `applyVerifiedContribution` path
every other resolution already uses.

**Blocked on the founder:** this session's Supabase MCP connection is
scoped to a different project (`ablute_wellness_master_project`), not
connectB's (`wkjcaoqdvhykrfacsylr`) — no DDL access to this project's
Postgres from here. Migration `0034_contribution_held_status.sql` is
written and typechecks clean, but needs
`alter type contribution_status add value if not exists 'held';` run
directly (Supabase SQL editor or CLI) before the two `email` rows can
actually move to `held`. They remain `submitted` with the `reviewer_notes`
flag in the meantime — not yet re-run through `bulk-review`, so the flag
still holds for now.

## Prompt 29 — correction, two resolutions, and the rule a wrong alias exposed

**Correction: the lote6 residual reported as 30 was wrong; it's 31.** The
founder counted directly against the database (grouping `contributions`
by a `batch_tag` extracted from `note` via
`substring(note from 'lote[ ]?[0-9]+')`, since no such column exists yet)
rather than trusting the prior report. 30 came from a snapshot taken
before the two `email` rows were reverted back to `submitted` a second
time; 31 is the real, current count (29 fill + 2 email, both lote6-tagged
as she confirmed). Every other number in the prior report's arithmetic
already held — this was the one figure that hadn't been re-verified
against a live count. **The lote6 `rejected` row she asked about is
unrelated to the two emails**: it's Impact X Capital's `key_people` row,
rejected back in prompt 24 for citing a content-hashed JS bundle as its
source — a completely different event that happened to also be
lote6-tagged. The two email rows were never in `rejected` state when she
queried; they'd already been reverted to `submitted` by the time she ran
her count.

**Two resolutions, opposite outcomes — this is why `held` existed to be
used once and correctly diverge:**
- **Entrée Capital (`f0e9249e`) `email`: kept, `verified`.** The founder
  read the actual page — `info@entreecapital.vc` appears twice in running
  text on the entity's own privacy-policy, not just matched by an
  `info@` pattern. Weak source class (a legal page, not a contact page),
  correct value — stays, with the weakness noted.
- **Arkwright X (`b24f22a2`) `email`: removed, `rejected`, and the
  already-written `entities.email` field cleared.** `info@arkwright.no`
  turned out to belong to Arkwright Consulting AG's Oslo office (a
  management consultancy, HRB 89606, four office emails for four
  countries) — not Arkwright X, the VC vehicle, whose own domain
  (`arkwrightx.vc`) was already correctly on file. A hole is better than a
  fact sitting on the wrong entity.
- **A provenance bug surfaced along the way, fixed at the source:**
  Entrée Capital's `entities.website` was `entreecapital.com`, but the
  live site is `entreecap.com` (302 redirect, confirmed) — two different
  registrable domains. Normalized `website` to `https://entreecap.com/`.
  The domain gate had already let this fact in cleanly, via a
  **pre-existing, correct alias** (`website-aliases.txt` §E,
  `f0e9249e|entreecap.com`) — not a hole, the mechanism working as
  designed; the alias entry now also carries the stronger redirect
  evidence instead of only "identical response body."

**The rule this exposes, written down because it needs to outlive this
one case:** *a domain redirect proves identity of the domain; a claimed
relationship between two firms does not.* "X is Y's fund arm" / "same
office as Y" / "part of the Y family" can all be true and still not
license a fact to cross from one firm's domain into the other's — the
domain gate exists specifically to keep entities apart, and a
relationship-based alias defeats it at exactly the moment it matters.
This is what broke `website-aliases.txt` §F's Arkwright line
(`b24f22a2|arkwright.com`, from prompt 26): the redirect
(`arkwright.no → arkwright.com`) was real, but the inference stapled to
it — that `arkwright.com` was therefore Arkwright X's own domain — wasn't;
`arkwright.com` belongs to a different, unrelated company. The founder
corrected the file (§F entry struck through, documented as
`REJEITADOS-F` rather than deleted; the correct entry was already present
independently in §D). Read alongside the redirect-outranks-absence rule
above, together they cover the two ways an alias claim can go: a redirect
is a proof, a relationship claim never is.

**Facts that entered ONLY through a proven alias (not the entity's own
domain, not a national registry) — the population the founder asked to
see before trusting any of them:** checked every `verified`, non-
`correction`, entity-level contribution on an objective field (excluding
`website` itself) or `key_people`, 297 rows total. Six entered via an
alias specifically: CapitalT, Eleven Ventures, bValue Fund (all Vaga-1
redirect-verified aliases), Apposite Capital, e2vc (Vaga-2 §E,
identical-response-body evidence), and **IBB Ventures — the one row in
this list that came through §F, the same weak "same-firm migration"
section the Arkwright line just failed out of**, not yet independently
re-verified line-by-line the way §A/§B/§D/§E were. All six are `key_people`
facts; none of the address/postal_code/email rows depended on an alias
(those passed via a national registry match instead). Short list — the
founder said she'd hand-check it if short; IBB Ventures is the one to
look at first, given its evidence class.

**Not actioned, blocked on missing context:** the founder's ordering
references "Task 3 of prompt 28" (an additive migration adding a
`pipeline` column, to also carry `batch_tag` backfilled from `note`) and
"Task 1 of prompt 28" (freezing the entity universe into
`universe_domains.txt`, now required to include a redirect-following pass
per the Entrée Capital case). Neither prompt 28 nor any resulting
migration exists anywhere in this repository or its git history — it was
never received in this session. Both are real, well-motivated asks (the
`pipeline` column mirrors what this file already proposed under prompt 26
as the durable fix for the AI-route auto-accept gap), but building them
from a title alone risks guessing a schema the founder already specified
differently elsewhere. Flagged rather than improvised; needs the actual
prompt 28 document (or its migration, if it was written in a different
session) before either task can proceed correctly.

## Prompt 28 — Task 1 (universe freeze) and Task 2 (field-level hold)

Prompt 28 arrived a turn late (attached after the fact) — the blocker
above is resolved; this covers its Task 1 (independent, do first) and
Task 2 (direct continuation of `held`). Tasks 3–6 (contributions columns
incl. `pipeline`/`batch_tag`, `entity_match`, the cross-engine importer,
and the founder's review screen) are real, substantial, and not started
this round — attempting all four shallowly in the same pass as 1 and 2
risked exactly the kind of unverified guess this file exists to catch.

**Task 1 — universe frozen, in `data-freeze/`:**
`universe_domains.txt`, `universe_no_domain.csv`, `universe_manifest.json`.
`entities_total: 531` = `entities_with_domain: 480` + `entities_without_domain: 51`
(closes). `alias_domains: 50`, `domains_unique: 492`.
`sha256_universe_domains: a9d79461887da06799242bb2a5f7c155a7d12756610fda5c6219164b0ba2a896`,
`sha256_universe_no_domain: 2d708f53c44e62a2ed2cc55acf77ddff7a137efffb74edcff441515038ab4b9c`.

**Not `wave2/aggregate.py::registrable()`** — that file isn't available in
this session, so `scripts/freeze-universe.mjs` reuses the same
`registrableDomain()` already running in `bulk-review-contributions.mjs`'s
domain gate (same ccTLD second-level list) rather than authoring a third,
possibly-divergent implementation. **This needs a line-by-line diff
against the real Python `registrable()` before the freeze is trusted** —
a single ccTLD case that resolves differently would silently corrupt the
intersection, exactly the failure mode the founder was guarding against.

**Two entities sharing a registrable domain**, as requested before
freezing: `faber.vc` (Faber Ventures + Faber — likely our own duplicate,
not a parent/vehicle pair like Speedinvest/Speedinvest Health) and
`nysnoinvest.no` (Nysno + Nysnø Climate Investments — same firm, an
accent-normalization miss, not two entities). Neither decided here — per
the founder's own instruction, flagged for her to resolve since it's the
same class of question the Task 4 marriage will hit.

**A bug found and fixed while building this, worth recording:** the
`50` no-domain rows initially came out wrong (missing "Red angels", whose
`website` field literally is a `mail.google.com` compose-link URL) because
checking the *registrable* domain against the placeholder list reduces
`mail.google.com` → `google.com`, which isn't in that list — the
placeholder check needs the raw hostname, before ccTLD reduction, not
after. Fixed; final count (51, not the founder's expected 50) also
surfaced one she hadn't flagged: `Nuno Marujo`, `website = "JYFUJYF"` —
garbage, not a URL, and worth a look as a possible person-recorded-as-
entity data issue, separate from this task.

**Task 2 — field-level `held`.** Migration `0035_entity_field_status.sql`
adds `entity_field_status` (`entity_id, field, status ∈ {OK,
UNDER_REVIEW, BLOCKED}, reason, set_by, set_at, released_at`), one active
row per `(entity_id, field)` via a partial unique index on
`released_at is null`. Wired into `bulk-review-contributions.mjs` as
**Rule 0 — runs before Rule 1**, exactly as specified: any row whose
target field has an active `UNDER_REVIEW`/`BLOCKED` status is left
untouched, full stop, regardless of what any later rule would have done
with it. **Not yet demonstrated live or populated** — the Entrée
Capital/Arkwright X fields no longer need it (prompt 29 already resolved
both to `verified`/`rejected`, not pending), so there's nothing to seed
it with right now; it'll get its first real row and dry-run demonstration
the next time a field genuinely needs freezing rather than a
contribution.

**Second migration now blocking, same class of blocker as `held`:**
`0035_entity_field_status.sql` needs the same manual application as
`0034` — this session's Supabase MCP has no DDL access to connectB's
project. Confirmed live: `bulk-review-contributions.mjs` now hard-fails
(`PGRST205`, table not found) until it's run. Needs, in the Supabase SQL
editor for `wkjcaoqdvhykrfacsylr`:

```sql
create table entity_field_status (
  id uuid primary key default uuid_generate_v4(),
  entity_id uuid not null references entities(id) on delete cascade,
  field text not null,
  status text not null check (status in ('OK', 'UNDER_REVIEW', 'BLOCKED')),
  reason text,
  set_by text not null,
  set_at timestamptz not null default now(),
  released_at timestamptz
);
create unique index entity_field_status_active_unique on entity_field_status (entity_id, field) where released_at is null;
create index entity_field_status_entity_idx on entity_field_status (entity_id);
```

**Deliberately not started:** Task 3 (`contributions` columns —
`evidence_excerpt`, `source_title`, `source_relationship`, `method`,
`origin_engine`, `external_fact_id` unique, `external_confidence`,
`pipeline`; backfilling `batch_tag` from `note`), Task 4 (`entity_match`),
Task 5 (the cross-engine importer), Task 6 (the review screen). All four
are real product/schema work the founder is depending on for the control-
group exchange with the other engine — they deserve a dedicated pass each
rather than four rushed, unverified migrations in the same turn that just
fixed a placeholder-domain bug and a scope error two prompts running.

## ablute.pt domain admin access, 2026-07-27

Any Supabase-**confirmed** email ending in `@ablute.pt` now resolves to
`developer` (full back-office) in `resolveRole` (`supabase-server.ts`) and
gets the same org-ablute_-owner + `platform_admins` treatment as the two
hardcoded `OWNER_EMAILS` in `provision-org`, via the shared
`isAbluteTeamEmail()` suffix check (`endsWith('@ablute.pt')`,
case-insensitive — deliberately not `includes`, so `x@notablute.pt` cannot
match).

**Hard requirement, both call sites:** the grant only fires on a
Supabase-confirmed address.
- `resolveRole` takes a new `emailConfirmedAt` parameter; every one of its
  16 call sites now passes `user.email_confirmed_at` from the same
  `auth.getUser()` call that already produced `user.email`. Omitted =
  treated as unconfirmed (fails closed), by construction — there's no
  default that grants access.
- `provision-org` never trusts the request body's `email` field for this
  decision (it's an unverified string the signup form sent). It re-fetches
  the authoritative user via `admin.auth.admin.getUserById(user_id)` and
  reads `email` + `email_confirmed_at` from *that* — the same data
  `resolveRole` would see once the user is actually signed in.
- Practical note: this project's Supabase Auth has `mailer_autoconfirm:
  true` (checked live via `/auth/v1/settings`), so in practice
  `email_confirmed_at` is set the instant `signUp()` returns — there is no
  real-world window today where a genuine `@ablute.pt` signup is
  provisioned before being "confirmed." The check is still enforced
  unconditionally, because that setting is infrastructure configuration,
  not a code guarantee, and could change.
- The two legacy `OWNER_EMAILS` (`ablutecompany@gmail.com`,
  `sherlockdeal.com@gmail.com`) do **not** carry this confirmation
  requirement — they're two specific, pre-vetted, hardcoded accounts, a
  narrower and different trust decision than "anyone who can receive mail
  anywhere on this whole domain." Not retrofitted; out of scope of this
  change.

**Security boundary, stated plainly:** this is safe only for as long as
`ablute.pt` is a domain we control end to end (DNS + every mailbox on it).
If that domain is ever handed to a registrar/host we don't fully trust, or
a subdomain/catch-all is delegated to a third party, this rule silently
grants back-office access to whoever can receive mail there. Revisit this
rule if that ever changes.

**Requirement for Phase 0 (Investor Workspace):** once investor accounts
and the investor side of the app exist, the same rule must extend to give
`@ablute.pt` team members observation/read access on the investor side too
— platform team members need to be able to see what an investor user sees,
the same way they already can on the founder side via back-office. Not
built now (there is no investor side yet to extend); flagged here so Phase
0's design doesn't have to rediscover this requirement.

## resolveRole priority: access_grants (investor) now outranks the ablute.pt domain fallback, 2026-07-28

Fulfils the requirement flagged above, and fixes a real bug: an
`@ablute.pt` account could never resolve as `investor`, because the
domain-based `developer` grant was checked (and returned) before the
`access_grants` lookup ever ran — no amount of granting that email
`access_grants` rows changed the outcome. Reported by Nuno testing his own
`@ablute.pt` account against the investor portal.

`resolveRole` (`supabase-server.ts`) now checks, in order: `platform_admins`
→ `org_members` (founder) → `access_grants` (investor) → the `@ablute.pt`
domain fallback (developer) → `none`. An explicit `access_grants` row — a
founder sharing their data room, or a back-office admin approving an
investor access request (`/backoffice` → Investor access requests, backed
by migration 0041) — is a deliberate, specific act; it now outranks the
blanket domain default, which stays only as the fallback for `@ablute.pt`
accounts with no explicit grant. `platform_admins` is untouched and still
checked first — a real platform admin never loses back-office access this
way, whatever else is granted to their email.

## Catalog deliverability tiers, 2026-07-28

Tester feedback surfaced that the catalog problem isn't "needs enrichment" —
it's that a name+website row doesn't deliver the product's actual promise
(direct contact with a specific person, personalized outreach, a real hook).
Reprioritized: catalog quality now comes before the matching engine
(`MATCHING_ENGINE_SPEC.md`) — ranking an unusable list still produces an
unusable list.

**Three tiers**, by what a founder can actually do with the row:
- **Tier A** — qualified investor entity + thesis + stage + ticket + geography
  + at least one named person (role + contact path) + at least one dated,
  sourced hook.
- **Tier B** — same entity-level fields, no named person, but a real
  institutional submission path (pitch form, verified general inbox).
- **Tier C** — name + website only. Stays in the catalog as a lead to
  enrich; never delivered, never counted toward a plan's quota, never shown.

Four distinct defects were being treated as one, with very different fixes:
(a) qualification — non-investors in the catalog (e.g. an audit/consulting
firm), costs trust in the whole list, not just its own row; (b) mapping —
systematic import bugs (e.g. domain populated, `website` left empty) fixed
once via remapping + backfill, not row by row; (c) liveness — dead investor
domains, needs a periodic sweep, nobody currently checks; (d) depth — no
people/thesis/hooks, the real content work, tiered above.

**Pilot before industrializing**: 30 records taken to Tier A by hand first,
shown back to the testers whose complaint motivated this — if the complaint
changes, the doctrine is right and scales; if not, something here was
missed, cheaper to find at 30 records than at 3,000.

**Tier A's own definition is still moving**: an early pilot (UK sample, 155
named people) found only 7 had a publicly listed email — most firms simply
don't publish one, and Cloudflare email-obfuscation hides several of the
rest. Tier A's contact-path requirement will end up satisfied by verified
email OR the named person's LinkedIn OR an institutional submission path
that still names a specific person and their scope — not email alone.

**Migration 0042 decision**: added `entities.tier` (nullable, `A|B|C`) and
`tier_classified_at` (nullable) — purely additive, no function in 0042
reads either column. Explicitly NOT gating quota/visibility on tier in
0042: every row is unclassified today, so a hard gate would immediately
zero out new (non-sticky-unlocked) visibility for every org, and Tier A's
definition isn't finalized yet either — gating against a definition that's
still moving means rewriting the gate anyway. The actual gate is deferred
to its own migration (0044), applied only once the qualification pass has
real coverage over the catalog. Until then `catalog_is_visible`/
`plan_catalog_quota`/`catalog_blocked_count` are unchanged, exactly as
already reviewed — rank-based visibility, not tier-based.

**Consequence already agreed for when 0044 ships**: the plan quota will
count only Tier A/B rows (a "40 investors" plan promising 40 unusable rows
isn't actually delivering 40 of anything), and the matching engine
(whenever built) will rank only Tier A/B — a Tier C row never enters any
wave.

## `is_test` (orgs, catalog_entities) — never filters authorization; discovery is a COHORT, not a blanket exclusion (updated 07/08/2026)

**Decision, after a same-day production regression (778f1bf → reverted in
the following commit)**: `is_test` never filters *authorization*.
`activeGrantOrgIds()` is explicitly out of scope for this flag — it must
always return `[...ids]` unfiltered. This part is unchanged by the update
below.

**Why this needs writing down, not just fixing**: 100% of the platform's
`access_grants` rows point at the same org (`ablute_` — the backoffice's
investor-access-request approval route grants against a fixed
`ABLUTE_ORG_ID` for every approval). Marking that org `is_test = true` and
filtering it out of `activeGrantOrgIds()` made that function return `[]`
for every investor on the platform — Data Room, Today, Agenda, diligence
checklist, all blank, no exceptions. `is_ablute_developer()` doesn't
rescue this path either: it only recognizes `@ablute.pt` sessions, not the
gmail-style accounts real testers and even QA use day to day. A grant is a
deliberate human act (a founder, or the backoffice on their behalf,
choosing to let this specific person in); `is_test` marking an org for
statistics purposes must never retroactively revoke that.

**Update 07/08/2026 — discovery is now a COHORT filter, not unconditional
exclusion.** The original rule above — and the item #15 fix that shipped
in `ee34eaf` — excluded `is_test` content from discovery unconditionally,
for every viewer. That was wrong: it made the platform untestable, since
test accounts are the only accounts that exist today — a founder testing
their own product could no longer see their own seeded test data. The
corrected rule is symmetric: `(viewer.is_test) OR (NOT target.is_test)` —
a test-account viewer sees test + real; a real-account viewer sees real
only. `excludeTestOrgIds()` / `eligiblePipelineOrgIds()`
(`src/lib/portal-access.ts`) now take a `viewerIsTest` flag, resolved via
the new `resolveViewerIsTest()` from the caller's own
`catalog_entities.is_test` (unresolved → `false`, closed by default).

**`computeTrackingCountsByStage()` (aggregate cross-investor stats) is
UNCHANGED — it still excludes `is_test` unconditionally, with no
symmetry.** A business statistic (e.g. "N other investors are tracking
this") must never include test/internal activity, even for a test-account
viewer looking at their own dashboard — the number itself would misstate
real platform activity either way.

**`matchdeal_eligible_deck()` — the actual security hole, not a cosmetic
one.** Measured 07/08/2026: this RPC never joined `orgs` or
`catalog_entities` at all — no `is_test` awareness in either direction.
Every one of the 6 currently-published startup MatchDeal profiles is
`is_test=true` (no real startup has published yet); checked against the
two real, `is_test=false` investor profiles with representative_name/
website still null (the ones the acceptance criteria points at) that
today's "0 test cards shown" is incidental — a pre-existing country-casing
mismatch (`geographies: ['portugal']` vs `orgs.country: 'Portugal'`, the
same taxonomy gap flagged unfixed under item 3.3 below) happens to zero
the geo filter for every candidate, not any `is_test` protection, since
none existed. Migration `0144` (proposed, not applied) adds
`matchdeal_profile_is_test(profile_id)` — Option 1 from the spec, a helper
function resolving through the polymorphic `membership_id`, not a
denormalized column + sync triggers; today's scale (single-digit orgs)
doesn't justify the extra moving parts — and applies the same symmetric
predicate at both places inside `matchdeal_eligible_deck()` that test a
profile's eligibility: the `v_pool_count` calculation `deck_replay_mode`
uses to detect a full cycle, and the main return query. This is the one
explicitly authorized exception to the otherwise-permanent prohibition on
touching the matching engine (see
`0136_bind_matchdeal_rpcs_to_caller.sql`'s comment) — nothing else in the
function (ordering, quotas, cooldowns, replay logic) was touched.

`eligiblePipelineOrgIds()` (discovery — a startup's published MatchDeal
profile), `matchdeal_eligible_deck()` (the swipe deck, once 0144 lands),
and `computeTrackingCountsByStage()` (aggregate cross-investor stats,
unconditional, no symmetry) are the correct, and only correct, places for
this filter.

## Transactional email sender (item 12) — `reply_to`, not `from`

**Decision**: "send as `sherlockdeal.com@gmail.com`" was the request, but is
technically impossible — an ESP can't send FROM a domain it hasn't verified,
and `gmail.com` isn't ours to verify. Sending from it anyway either gets
rejected outright or delivers with broken SPF/DKIM and lands in spam.

`reply_to` solves the actual intent (replies reach the inbox Nuno reads)
without any domain verification, because `reply_to` isn't authenticated by
SPF/DKIM — it can point anywhere today. Sender display name changed to
`Sherlock Deal Support` in the fallback; the address stays Resend's
`onboarding@resend.dev` until `sherlockdeal.com` is verified.

**Two env vars, two different states:**
- `RESEND_FROM_EMAIL` — set to `Sherlock Deal Support <support@sherlockdeal.com>`
  the moment the domain is verified in Resend (SPF, DKIM, ideally DMARC).
  This is infra, not code, and is not done yet — the `from` address today
  must stay a verified one or delivery breaks.
- `RESEND_REPLY_TO` — can be set **today**, to `sherlockdeal.com@gmail.com`,
  with no domain verification required. This is the env var that actually
  gives Nuno the effect he asked for, without waiting on the DNS work above.

## Five orphan seed matchdeal_profiles (item 3.1) — unpublish, not delete; no FK yet

**Decision**: leave the 5 `e2000000-…` startup profiles (seed data whose
`membership_id` points at `orgs` rows that were never created,
`e1000000-…`) as `is_visible = false`, never delete them. Checked directly
against production: `matchdeal_swipes` has a real row targeting
`e2000000-…-0005`, and `matchdeal_exposures` has rows for `-0002` and
`-0005`. Deleting the profiles would orphan those historical rows instead
of the current (harmless, already-hidden) membership_id dangling
reference. Confirmed live: all 5 are already `is_visible = false` in
production as of 2026-08-06 — this decision matches the current state,
not a change from it.

**Not adding a `matchdeal_profiles.membership_id → orgs(id)` foreign key
in this pass.** These 5 rows would violate it today (their `membership_id`
matches no `orgs.id` at all), so `alter table ... add constraint` would
fail outright against current data — adding the FK requires a data
remediation step first (nulling or repointing the 5 rows' membership_id,
which itself has to account for the swipes/exposures above), and that's
a separate, more invasive migration than this pass's scope. The defensive
measure shipped instead: `getPipelineWaves()` now logs a `console.error`
naming any eligible org id that resolves to no row in `orgs`, so this
exact failure mode (a membership_id silently falling through a `.in()`)
can't hide again even without the hard constraint.

## `ablute_`'s missing MatchDeal photo — feature already exists, just unused

Investigated as part of item 3.2 (the report's option (a)/(b)/(c) choice
for reconciling `orgs.logo_url` — a signed data-room storage path — with
`matchdeal_profiles.photo_url` — a raw URL). **No code decision needed
here: option (a) is already built.** `ProfilePanel.tsx`'s
`applySherlockDealLogo()` ("Use your Sherlock Deal logo" button, Prompt
125 Block B) already signs the org's logo for a 10-year TTL and writes
that into `photo_url` — deliberately choosing "sign once, long-lived"
over "resolve at render time in 3+ places," with the documented,
accepted trade-off that it goes stale only if the founder re-uploads a
new logo afterward. `ablute_`'s `matchdeal_profiles.photo_url` is `null`
today simply because nobody has clicked that existing button for
`ablute_`'s own profile — not because the mechanism is missing.

Doesn't change the item 3 finding either way: `ablute_` is also `is_test
= true`, so even a fully-complete, published `ablute_` profile would
still be correctly excluded from a real investor's Pipeline by the item
15 filter. Fixing the photo doesn't fix "the Pipeline is empty of real
data" — only a real startup publishing does.

## `orgs.sectors`/`country` are canonical for startups (item 3.3)

**Decision**: `orgs.sectors`/`orgs.country` is the canonical source for a
startup's sectors/country; `matchdeal_profiles.sectors`/`country` is a
read-only mirror for `kind = 'startup'` rows, kept in sync by the
one-way trigger migration `0098` already added (`orgs` update →
`matchdeal_profiles`). This isn't a new design — `0098`'s own comment
already said the intent was for `ProfilePanel.tsx` to "stop offering a
second edit form" for these fields once the trigger existed; that step
just never happened, so founders had two independent editable copies
and only Settings saves flowed through the sync. `ProfilePanel.tsx` now
shows both as read-only for startup profiles ("edit in Settings"), same
treatment as `description`/`website`/`founded_year` already got in
Prompt 98. `matchdeal_eligible_deck()` is untouched — it keeps reading
`matchdeal_profiles.sectors`, never `orgs.sectors`; this fix makes that
column trustworthy again, it doesn't change what the matching engine
reads.

Migration `0142` backfills the divergence that already existed in
production before this fix (confirmed live: "Caramel Biscuit" had 1 org
sector vs 0 profile sectors; "Test & trial" 2 vs 0; "Sherlock Deal_
test" 0 org sectors vs 2 profile sectors) — the `0098` trigger only
fires on future `orgs` updates, not retroactively.

**Not in scope, flagged not decided**: sector *taxonomy* normalization.
Measured real casing/synonym mismatches between the two columns even
where content was semantically aligned ("Digital Health" vs "health",
"digital health" vs "health, wellness"). `matchdeal_eligible_deck`'s
sector filter is a Postgres array-overlap (`&&`), which is exact
per-element string equality — a real investor thesis of `["Digital
Health"]` will not overlap a startup's `["digital health"]`, silently,
even after this fix makes the two source columns internally consistent.
Deciding a canonical sector list (names, casing, synonyms) is a product
call, not a data-consistency fix, so it isn't attempted here.

## Startup vs investor plan-change-request models — kept separate, not converged (item 11)

**Decision**: `orgs.plan_change_requested` (startups) and
`matchdeal_profiles.plan_tier_requested` (investors, `kind='investor'`)
stay as two separate columns/mechanisms. Not converged into one shared
table or column as part of this fix.

**Why they're not actually the same thing wearing two names**: `orgs` is
one row per startup account, so a plan-change request is naturally
firm-level. Investor plan tier lives per
`matchdeal_investor_members` seat on `matchdeal_profiles` (`kind =
'investor'`) — a firm with 5 seats has 5 membership rows, each capable
of its own `plan_tier`/`plan_tier_requested` in principle, even though
today's UI (both the request route, which writes to the requesting
user's own membership, and the backoffice display fixed by this item,
which shows/sets one value per firm) treats plan as firm-wide in
practice. Converging onto one model means picking a side: either give
`catalog_entities` an org-style single request column (replicating the
firm-vs-seat mismatch `investorOrgRows()` already flags as a documented
simplification, not resolving it), or move `orgs.plan_change_requested`
down into `matchdeal_profiles` (`kind = 'startup'`) to match. The second
direction is the more defensible one long-term — `matchdeal_profiles.
plan_tier` is already the column `matchdeal_tier_limits()` actually
enforces for both kinds; `orgs.plan`/`plan_change_requested` are a
startup-only display copy kept in sync by `applyPlanChangeSideEffects()`
— but it's a real schema migration touching a request flow already live
in production, which is out of this Lote's "sem migração" scope and out
of proportion to the bug actually reported (the investor side's request
column existed and worked; only the backoffice read/apply side was
missing). Fixing the missing read/write side on investor's own existing
columns doesn't require resolving this first.

**Flagged, not fixed**: the org-side request encodes `{tier, period}`
(`encodePlanRequest`/`parsePlanRequest` — monthly vs annual); the
investor-side request (`/api/portal/plan/request`) only ever writes a
tier, even though `InvestorPlansPanel` itself has its own monthly/annual
toggle. An investor's chosen billing period is never captured anywhere
today — not a regression from this fix, a pre-existing gap this fix's
own reading surfaced. Left alone; adding period tracking is a product
decision (does per-seat billing period even make sense here) this Lote
wasn't asked to make.

## Vault guest access token storage — filled into access_grants, not a new table (item 1)

**Decision, confirmed by Nuno (2026-08-07)**: `guest_token`/
`guest_token_expires_at` are written directly onto `access_grants`
(migration 0114's own columns, added for exactly this and never used
until now) — the same row an invite already creates, in the same write.
Not a separate `data_room_guest_links` table.

The mini-prompt itself flagged this as needing explicit sign-off, not a
call this session makes alone, given the standing prohibition on
touching `access_grants`. Asked; Nuno chose "fill the existing columns."
The reasoning that made this the reasonable default in the first place:
an invite grant already represents exactly "these documents, this
person" (migration 0045's `invited_email`/`invited_name`/`confirmed_at`)
— a guest link is just another way to resolve the SAME row before a real
session exists, not a new access concept. The prohibition this session
otherwise honors is about the access *model* (who gets access to what,
how it's resolved) — filling two dormant columns on the row an invite
was already going to create doesn't touch that model.

**Token generation stays server-side** (`/api/data-room/guest-invite`),
reusing `generateRawToken()` from `matchdeal-pairing.ts` (crypto-random
32 bytes, base64url) rather than a new implementation — same standard
this app already holds pairing tokens to. Unlike MatchDeal's tokens,
`guest_token` is stored raw, not hashed — the column is a plain lookup
column on an existing table (no separate hash column exists to store),
and the threat model differs: a MatchDeal token is a bearer credential
straight into an authenticated session; a guest token only ever
unlocks a read-only preview of document *names* (see item 1's own "never
a signed URL" rule below) — a DB compromise that leaks `access_grants`
already exposes `invited_email` in the clear on the same row regardless.

**Expiry: 14 days** (`GUEST_TOKEN_TTL_MS`, `/api/data-room/guest-invite`)
— the mini-prompt asked for a number to be picked and recorded. Long
enough that "I'll look at this later" doesn't expire before the investor
gets to it, short enough that a stale, never-opened invite doesn't stay
guessable-and-valid indefinitely.

**Token consumption: at confirmation, not at first view** — per the
mini-prompt's own explicit instruction. `guest_token`/
`guest_token_expires_at` are cleared inside `/api/portal/confirm-identity`
(the pre-existing "Is this you?" flow, unchanged otherwise), in the same
update that sets `confirmed_at`, not in `GET /api/guest/[token]`. A guest
previewing a link, closing the tab, and opening it again later (or on a
different device) must keep working right up until they actually create
an account — a link that dies on first read would generate more support
tickets than it prevents.

## `access_requests` (item 1, step 5) — confirmed stalled, not folded into this fix

Per the mini-prompt's own instruction ("verifiquem se o ciclo está ligado
ponta a ponta... se estiver parada, digam-no claramente"): checked, and
it's in the same state `guest_token` was — the schema and one write path
exist, the rest doesn't.

What's real: `POST /api/portal/access-requests` (investor's "Request
again" on an expired grant) genuinely inserts into `access_requests` and
emails the founder. What isn't: `GET /api/portal/access-granted` — the
route the investor-side "Access requested" tab reads — still hard-codes
`requested: []` and never queries the table at all (its own header
comment already said this, dated to before migration 0114 was applied;
it was never revisited once the migration landed). An investor who
requests access again has no way to ever see that request was received.
On the founder side, `grep -rln "access_requests" src` turns up zero
consumers beyond the two write/probe files — no queue, no list, nothing
in `/documents` for a founder to review, grant, or decline a pending
request from. The notification email the investor's request sends
already points founders at `/documents`, which has nothing there to
find.

Not built here: a founder-facing review queue and the investor-side read
path are each their own real feature (a list, actions, wiring the
existing capability probe through to real data), not a one-line fix
alongside `guest_token`, and item 1's own critério de aceitação doesn't
ask for it. Flagged rather than silently expanded into this Lote's scope,
per the mini-prompt's own instruction not to do that.

**Update 07/08/2026 — built, on Nuno's explicit confirmation to bring it
into scope.** Both stalled halves now exist. Investor side:
`GET /api/portal/access-granted` queries `access_requests` for the caller
(`person_id` OR `requested_email`, matching the same OR-shape every other
portal route resolving "which rows are mine" already uses) and returns
`pending`/`declined` rows in the `requested` array; `AccessGrantedPanel`'s
"Access requested" tab renders them instead of a hardcoded empty message.
Granted rows aren't shown here — they've already become real
`access_grants` rows and surface on the Granted tab; showing the same
relationship in two tabs at once would be confusing, not thorough.

Founder side: new `GET /api/data-room/access-requests?orgId=` (org-member
auth, service-role for the name-resolution joins across `people`/
`folders`/`documents` the same way `/api/portal/access-granted` already
does) and `POST /api/data-room/access-requests/[id]/action` (`grant` |
`decline`). Auth reads org membership off the **request's own** `org_id`,
not a client-supplied one, so a caller can't point the action at an org
they don't belong to. `decline` just flips status; `grant` inserts real
`access_grants` rows — one per `folder_id`/`document_id` on the request,
same shape `documents/page.tsx`'s `submitGrantTree` already writes for a
manual grant — with **no expiry guessed**: a re-grant lands open-ended,
same as any grant does by default, and the founder can add an expiry
afterward through the existing per-grant UI exactly like any other grant.
A request with `person_id` null (no known person yet) grants onto
`invited_email` instead, landing `pending_confirmation` — the exact same
shape an external invite already produces, not a special case. Both
actions best-effort-notify the requester by email (reply_to per Lote A),
never blocking or reverting the decision that already committed. UI: a
"Pending requests" block in the `documents/page.tsx` Access grants card,
placed above the existing grants list for the same "reachable with zero
scroll" reason P120 Block B.1 already put Grant access itself first.

## "Claim this profile" via email-domain verification (2026-08-07, Nuno's decision B)

**Decision**: domain comparison is by registrable domain (eTLD+1) with
exact equality, using a real public-suffix-list library (`psl`) — never
`endsWith`/`includes` on raw hostnames. This is the entire security
property the prompt asked to be proven, not just implemented: a naive
`emailDomain.endsWith(entityDomain)` check (no dot prefix) would let
`x@evilnorthbridge.com` pass as a match for `northbridge.com` —
confirmed live in this repo's own test suite
(`"xnorthbridge.com".endsWith("northbridge.com")` is `true` in plain JS).
`src/lib/investor-entity-claims.ts`'s `registrableDomain()` resolves both
sides to their eTLD+1 via `psl.get()` first, then compares with plain
`===` — a subdomain (`mail.entity.com`) still matches because its eTLD+1
IS `entity.com`, not because of any prefix/suffix string check.

Deliberately a NEW, separate function from `investor-domain-match.ts`'s
existing `domainMatchesEntity()` (used by the unrelated
`investor_access_requests` lead-form flow), not a shared rewrite — that
function's own dot-prefixed `endsWith` check (`.endsWith('.' + entityDomain)`)
is a different, narrower call site this item wasn't asked to touch, and
IS already safe from the exact `evilnorthbridge` attack (the leading dot
requirement blocks it) — it just doesn't use a real public-suffix list,
so it can't distinguish `co.uk`-style multi-label suffixes correctly.
Left alone; not this item's scope to fix or unify.

**Storage**: a new `investor_entity_claims` table (migration 0145,
PROPOSED, NOT APPLIED), not an extension of the existing
`investor_access_requests` table — a profile claim and a platform-access
request are different concepts (which catalog_entities row someone
manages vs. whether they may sign in at all) that happen to share an
approve/reject queue *shape*, not underlying data. `matchdeal_investor_members.role`
was added too: the prompt's own §0 claimed this column already exists;
grepped every migration in this repo and confirmed it does not — added
here as a small additive column, since approving a claim needs somewhere
to record it (same place `domain_verified` already lives, per-seat).

**Snapshot, not live recomputation**: `claimant_email_domain`/
`entity_domain_at_claim`/`domain_match` are computed once, at claim time,
and stored — deliberately NOT recomputed when an admin approves later
(unlike `investor_access_requests`' own approve route, which recomputes
for audit provenance). Reasoning: a claim's evidence must reflect what it
was actually decided on; if the entity's `website` changes between claim
and review, recomputing would silently rewrite the historical record of
what the claimant's email was checked against.

**Dispute handling**: a second claim on an already-approved entity is
never auto-rejected — it's created as a normal `pending` row with
`evidence.isDispute = true`, and the current owner(s) get a best-effort
email right away (independent of whatever the backoffice later decides).
No new DB column for this; it's derived at claim-creation time from
whether `investor_entity_claims` already has an `approved` row for that
`catalog_entity_id`.

**Not built here, flagged**: the `/claim` page's entity search
(`GET /api/portal/claims/search-entities`) requires a signed-in session
before it will search at all — the full ~500-row catalog is not exposed
as an anonymous public search surface, even though the underlying data
(`catalog_entities.name`) isn't itself sensitive. This matches the
landing page's own existing copy ("Claiming requires a verified work
email") but is a product choice about search UX, not a security
requirement re-derived from the prompt — worth revisiting once real
claim volume exists and the friction of "sign in before you can even
search" is measured against real drop-off.

**Verification note**: migration 0145 has NOT been applied anywhere
(this session never applies its own migrations) — `investor_entity_claims`
does not exist in the shared Supabase project yet, so nothing that writes
to it could be live-tested end to end this session. What IS fully proven:
the domain-matching logic itself (`investor-entity-claims.test.ts`, 16
tests, including the exact `evilnorthbridge` scenario the prompt names as
decisive), `tsc`/`vitest`/`npm run build` all clean, and every new
surface degrading gracefully (not crashing) while the capability probe
reports the table unavailable — confirmed live for the backoffice queue
("Profile claims activates once migration 0145 is applied") and for
`POST /api/portal/claims` (`{ok:false, error:"Claiming a profile isn't
available yet."}`, no 500). `scripts/_verify_claim_domain_20260807.mjs`
is a complete, ready-to-run live-verification script (creates a test
catalog entity + 5 test users covering every acceptance criterion —
match, freemail, the endsWith attack, subdomain, dispute — asserts, then
cleans up after itself) for whoever applies 0145 next to run immediately
after.

---

## `/api/provision-org` is public at the middleware because the route authenticates itself (Prompt 538, 02/09/2026)

`/api/provision-org` is public at the middleware because the route
authenticates itself (BUG-SEG-1); it was unreachable without a session
from the day email confirmation was enabled (early August 2026) until this
fix, which is why every founder org of that period was created through
`OrphanAccountRepair`.

The mechanism, for whoever reads this next: with Supabase email
confirmation on, `signUp()` returns **no session**, so the signup form's
`POST /api/provision-org` carried no cookie. The route was not in
`PUBLIC` in `src/middleware.ts`, so the middleware answered first with a
`307` to `/login?next=%2Fapi%2Fprovision-org`; `fetch` followed it,
`res.json()` threw on the login page's HTML, and `attemptProvision`
reported *"we couldn't reach the server… check your connection"*. The
route never executed — production Supabase logs show no
`GET /auth/v1/admin/users/{id}` at signup time for any affected account.
Two consequences worth recording: the signup form's optional fields
(website, sector, stage, round target, country, one-liner, acquisition
source, newsletter consent) never reached the route on the real path,
because the repair screen only collects org name, full name and title —
so orgs created in that period started empty and acquisition-source
analytics for it are blank; and the route's own no-session branch
(BUG-SEG-1 case (b)) was dead code in production the whole time.

The route's gate is the real one and was written for exactly this, so it
is deliberately unchanged: with a session, `caller.id === user_id` or
`403`; without one, the target account must have been created less than
10 minutes ago or `403`; blocked emails `403`; the `@ablute.pt` domain
grant additionally requires `email_confirmed_at`. `OrphanAccountRepair`
(Prompt 152) stays — it is still the safety net for a provisioning call
that genuinely fails.

Deploy-order constraint, recorded because getting it backwards is a real
privilege-escalation window: Prompt 531 (removing
`sherlockdeal.com@gmail.com` from `OWNER_EMAILS`) must ship **with or
before** this change, never after. Before this fix, provisioning never
ran at signup time, so the address was inert; after it, a fresh signup
with that address would be provisioned straight into the ablute_ org as
owner and granted `platform_admins`. Both changes are on this branch,
531's commit first.

Client-side, `attemptProvision` now treats a non-JSON or redirected
response as its own named failure ("the server answered with a page
instead of a result") rather than letting it fall into the network
`catch`. That is what let a routing bug masquerade as a connectivity
problem for a month.

---

## `sherlockdeal.com@gmail.com` is no longer an OWNER_EMAIL — Sherlock Deal becomes a separate founder org (Prompt 531, 2026-09-01)

Supersedes **"Owner email became a LIST (`OWNER_EMAILS`), 2026-07-27"** and
the `OWNER_EMAILS` paragraph in the `@ablute.pt` confirmation entry. Both are
left as written — they record what was true and why, and the reasoning there
(a single constant silently produces an ordinary founder with an empty org)
was correct for its moment. What changed is that the "ordinary founder with
a fresh org" outcome is now the DESIRED one for this address, not the
failure mode.

Sherlock Deal, the company that builds this platform, becomes its own first
real customer: a separate startup org, a real use of the product rather than
a test, with `sherlockdeal.com@gmail.com` as its founder account. While that
address sat in `OWNER_EMAILS`, that was impossible — provisioning for it
linked the user into the seeded ablute_ org as owner, upserted
`platform_admins`, and discarded every startup field the signup form had
collected. So `OWNER_EMAILS` becomes `['ablutecompany@gmail.com']`.

Verified in production before removing it, not assumed:

- The address had no rows anywhere outside `auth.users` — all 41
  email-bearing columns in `public` (access_grants, entities,
  catalog_entities, people, company_people, orgs.sender_email/bcc_email,
  the investor_* tables, network_email_invites, support_tickets,
  terms_acceptances, …) plus every `public` function body: zero hits. No
  data migration step.
- Admin access does not depend on this constant. `nunomarujo@ablute.pt`
  holds the real `platform_admins` row and ownership of ablute_, granted by
  the `@ablute.pt` domain rule (`isAbluteTeamEmail`, migration 0050).
  Re-confirmed at removal time: 1 membership, 1 admin row.
- The list had never actually been exercised: `ablutecompany@gmail.com` is
  orphaned in production too (no org, no `platform_admins` row). It stays in
  the list, untouched and out of scope — no decision has been made about it.

Not changed, deliberately: the BUG-SEG-1 freshness check,
`isAbluteTeamEmail`, `resolveRole`, `OrphanAccountRepair`, and the signup
page. Those are what make the ordinary founder path work.

**Correction to the prompt's premise, found while verifying.** Prompt 531
described the recovery path as "sign in with the existing orphaned
`auth.users` row (`57840403-…`, created 2026-07-29) → `resolveRole` returns
`none` → `OrphanAccountRepair` provisions the new org", and instructed that
the row must not be deleted. At the time of this change **there is no
`auth.users` row for `sherlockdeal.com@gmail.com` at all** — neither
`57840403-…` nor the `ce3f8749…` that Prompt 538 later referenced; an
`ilike '%sherlockdeal%'` sweep of `auth.users` returns zero rows. Nothing in
this change deleted it. The practical consequence is an improvement, not a
loss: with no stale account in the way, the address goes through a plain
signup, which — now that Prompt 538 makes `/api/provision-org` reachable —
provisions the org at signup time WITH the startup fields (website, sector,
stage, round target, country, one-liner, acquisition source). The
`OrphanAccountRepair` path only ever collected org name, full name and
title.
## Prompt 537 — migration numbering, and the two things that were guessed at

**Migration numbers taken by this prompt: 0296 and 0297. 0293 and 0294 are
NOT free.** Checked with `git ls-remote --heads origin` before branching,
per the prompt's own instruction:

| number | file | branch |
|---|---|---|
| 0293 | `0293_guest_link_views.sql` | `claude/prompt-518-reconciled` |
| 0294 | `0294_round_blueprint_scenarios.sql` | `claude/prompt-534-round-blueprint` |
| 0295 | `0295_backfill_lost_catalog_deliveries.sql` | this branch (**renumbered from 0293**) |
| 0296 | `0296_email_send_log.sql` | this branch |
| 0297 | `0297_guest_token_hash_and_rate_limit.sql` | this branch |

Prompt 536 shipped its backfill as `0293` because `main` alone shows the
highest number as 0292 — the collision only exists on two unmerged
branches. **Reading `main` is not enough; `git ls-remote --heads origin`
is the check.** The renumber is a rename only: the statement is unchanged
and was already applied to production as
`backfill_lost_catalog_deliveries`.

**Sender policy (§3) is infra, and the code is deliberately incapable of
changing it.** Platform emails go out as Sherlock Deal, which requires
`sherlockdeal.com` verified in Resend (Domains → add → SPF/DKIM at the DNS
provider → Verified), then on Vercel `RESEND_FROM_EMAIL = Sherlock Deal
<noreply@sherlockdeal.com>` and `RESEND_REPLY_TO = sherlockdeal.com@gmail.com`,
then redeploy. Supabase Auth's own SMTP sender must be switched to the same
address or login/confirmation mail keeps going out under the old one. No
address is hard-coded in code, the configured sender is never replaced, and
no alternate sender exists to make a test pass —
`src/lib/email-sender-identity.ts` is the single resolution point and it
reads env only. Until the domain is verified there are exactly two states,
and `/backoffice/email-delivery` now says which one production is in.

**Why `email_send_log` exists.** For three weeks "the invite didn't arrive"
was answered by guessing, because `invite-by-email/route.ts` logged the
provider's own reason to `console.error` (Vercel only) and returned the
founder a generic sentence. Nobody in the loop can read Vercel logs. Every
send now writes one row — success or failure — with the exact `from` used
and the provider's verbatim response, readable by the founder on the
recipient's own People & Access row and by platform admins on the Email
delivery tab.

**Guest tokens are stored as sha256 (§4.1), with the raw column kept
temporarily.** Every link minted before 0297 exists only as the raw value
and some are already in recipients' inboxes, so the guest route accepts a
raw match as a fallback and *writes the hash onto the row when it does*.
That self-heal is not tidy-up: 0297's backfill is one-shot, and production
kept minting raw-only tokens after it ran (observed directly — invites at
17:10 and 17:15 UTC on 2026-09-02, from the deployed build that has no hash
write). Healing on read is what stops the raw column gaining new dependents,
so the later migration that drops it waits on a shrinking set rather than a
moving target. Drop `access_grants.guest_token` once the last pre-hash token
has expired (all current ones expire 2026-09-30).
