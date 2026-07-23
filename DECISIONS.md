# connectB — autonomous-mode decisions log

Non-critical product decisions made while working unattended through the
NEXT_STEPS/IRM_SPEC backlog, so they're visible instead of buried in commits.
Reversible; flag if any should change.

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
