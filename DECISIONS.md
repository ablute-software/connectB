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
