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
