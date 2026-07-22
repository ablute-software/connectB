# connectB — autonomous-mode decisions log

Non-critical product decisions made while working unattended through the
NEXT_STEPS/IRM_SPEC backlog, so they're visible instead of buried in commits.
Reversible; flag if any should change.

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
  the plan, wrote nothing) to produce the staging preview. Did NOT commit —
  waiting on explicit approval per instruction.
