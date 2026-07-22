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
