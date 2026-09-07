# Sherlock Deal (connectB) — next steps, measured

Rewritten on 2026-09-07 (Prompt 599 §6) from production numbers, replacing the
July build plan. That plan's Phases 0–2 are history: the CRM content layer runs
on Supabase (1 real org with 1782 people and 827 entities in Postgres under
RLS; demo/localStorage remains only as the no-env fallback). Read `CLAUDE.md`
first for architecture and the verification rules.

Every figure below was measured on 2026-09-07 between 00:30 and 02:00 UTC
unless a date says otherwise. Re-measure before acting on one — the catalog
grows by itself overnight (§4, item 6).

---

## 1. Machinery that exists and has never run

| Mechanism | Evidence (2026-09-07) | Why it matters |
|---|---|---|
| Field verification levels — `catalog_people_research.verified_fields` (0322/0325, 595 §D) | **0 of 1680** research rows carry any level | The founder-side overlay (871 §E, `catalog-person-overlay.ts`) only surfaces a catalog field that HAS a level. So the catalog's 1780 LinkedIn URLs and 13 hooks reach **no pipeline**, linked or not. `catalog_people.linkedin_verified = true` (all 1780) is a different flag the overlay does not read. This is the single decision that unlocks the overlay — see §4 item 4. |
| Team-page discovery — `catalog_entities.team_page_url` (581 §C.5) | **0 of 762** | The dossier's HEAD check has never persisted a hit. Out of scope until asked (599 out-of-scope list). |
| Investor entity claims — `investor_entity_claims` | **0 rows** | The queue and its review route exist; nothing has ever entered. |
| Community consensus — `catalog_field_consensus` (0328) | **0 rows**; 12 contributions pending, **0** of them about people | 3-org consensus is unreachable while one org has linked people. 599 §4 made the *blocked* branch write an audit row (migration 0336, applied) — also 0 rows, by construction, until a developer's edit meets three disagreeing startups. |
| Affiliation history — `catalog_person_affiliations.started_at/ended_at`, `current=false` | **0 of 3329** dated, **0** past | The columns and the "past" state exist; no writer fills them. 599 §3 renders "no dates recorded" as the honest state. |

## 2. Real field coverage

**Private pipeline (`people`, one org):** 1782 rows · linked to the catalog **527** (30%; 483 before 599 §5) · LinkedIn 23 · email 11 · hook 26 · role 1775.

**Catalog people (`catalog_people`):** 3297 (3230 at the start of the night — §4 item 6) · LinkedIn **1780** (54%) · enriched 1493 · without a firm 0 · research rows 1680 · hook **13** · bio without hook **1477** (the hook-from-bio queue, ≈€6, not run — money) · email guess 5.

**Catalog entities:** 762 · verified 357 · **492 with zero people (65%)** · team page 0. Private entities 827, linked to the catalog 749 (91%).

## 3. Linking private contacts to the catalog — what 599 §5 established

The "1299 unlinked people" figure was never a linking backlog. One rule
(`src/lib/person-link.ts`, unit-tested; the same SQL ran the batch), three layers:

- **Layer 1** — same normalized name, the private row's firm points (via `entities.catalog_id`) at the catalog person's firm, exactly one candidate: **43 in the dry-run, 44 written** (one candidate appeared between the two — the overnight worker, §4 item 6). Audit row `private_person_catalog_link_batch` holds all 44 pairs; reversible by clearing those `catalog_person_id`s.
- **Layer 2** — same name, different firm or ambiguous: **15**, untouched. Includes the three Draycott ↔ Shilling VC people (Ricardo Jacinto, João Coelho Borges, Maria Villas-Boas), which Nuno said not to touch. Each opens in `/backoffice/people/[id]` with the candidates side by side and a per-row decision.
- **Layer 3** — no same-name person in the catalog: **≈1241**, of which **≈1117 sit at a firm whose catalog entity has zero people**. The catalog simply does not have them. The path is promotion (Key people → catalog), not linking — and Key people "Apply selected" is still unvalidated after the 596 fix.

LinkedIn readable through the catalog after linking: **22** rows. Visible pipeline-side: **0** — §1, first row.

## 4. The pending-decision queue (needs Nuno)

1. **Key people → "Apply selected"**: validate the 596 fix on a small selection before any batch (596 §A: the queue was 105× wrong from PostgREST's silent 1000-row cap).
2. **Hook-from-bio**: 1477 people with a bio and no hook, ≈€6. Prepared, not fired (money).
3. **Draycott / Ricardo Jacinto contributions** (`bc2949b1…`): Shilling VC facts on the Draycott row — not approved; reads as a re-affiliation/merge question, not a field approval.
4. **`verified_fields` bootstrap** — whether `linkedin_verified` should count as a level for `linkedin_url`, or an admin marks a set. Either is a mass write and needs a gate like §5's; nothing was marked overnight.
5. **Retroactive duplicate cleanup in `people`** — depends on more linking than §5 could do (layer 3 is a catalog gap, not a matching gap).
6. **The enrichment cron adds catalog people every night, unattended and unaudited.** On 2026-09-07 between 00:15 and 01:30 UTC, 67 `catalog_people` + 67 affiliations of kind `other` appeared in five batches (Active Cap 16, Vala Capital 11, Giant Ventures 29, SMOK Ventures 8, Omnes Capital 3), team-page-style titles, 20 already `enriched`, no `admin_audit_log` row. The writer is pg_cron job 3 `enrichment_worker_sweep` (`*/15 * * * *` → `invoke_enrichment_worker()`), fed by job 4 `enrichment_cold_seed_sweep` (03:20 UTC daily → `enqueue_cold_enrichment_batch(50)`); the same pattern ran on the nights of 09-05 and 09-06. Spend from `enrichment_jobs.cost_eur`: 18 jobs / **€0.07** in the 8 h to 02:00 UTC, 110 jobs / **€2.33** since 2026-09-05, 6 jobs still open. Left running (it is Nuno's schedule, and stopping it is a config change, not a night decision) — but decide whether unattended is intended, and give it an audit line so a night's 67 rows are attributable without forensics.
7. **Deploys are slow, not broken — and unreadable from a Claude session.** On 2026-09-07 production (`www.sherlockdeal.com`) kept buildId `CyKXxPkBLVkhrKSM_FgVm` for roughly 30 minutes after the first push (`a0f86b4`), with `Age: 0` / `X-Vercel-Cache: MISS`, then moved to `kLAr1x8hrlncV3PktxM5c` (a build without the third push's CSS marker) and, a few minutes later, to `1wcr93ce32eA85JSy1vAT` with it. Budget 45 minutes for the buildId check, not six, and confirm *which* commit with a marker string, not the buildId alone. The Vercel login available to Claude (`ablutecompany`, team `ablutecompanys-projects`) sees only a project named `connectb` with **no deployments**; the production project lives in a team that login cannot read, so a failed or queued build cannot be diagnosed from a session. `CLAUDE.md`'s project/team names (`connect-b`, "info-ablute projects") could not be confirmed either way.
8. **31 catalog people** whose `entity_id` pointer disagrees with their primary affiliation — shown in the dossier (599 §3), not rewritten: which side is right is a data decision.

## 5. Still-valid deferred items (unchanged from before)

- **Malware scanning — real external analysis.** Prompt 375 (25/08/2026) moved this app to hash-only VirusTotal lookups permanently: Vault documents are confidential, and VT's public API shares submitted content. No file content leaves the app; a private document's honest status is `local_only`. The two real options remain VirusTotal Private Scanning (paid, no sharing) or a self-hosted scanner (ClamAV). Both are Nuno's business/cost decision — do not add a submission call to any external scanner without that decision being made explicitly again.
- **Investor plan limits — the three still unenforced (Prompt 497 measured; do NOT re-guess).** Seats are enforced (`plans.ts` `checkInvestorSeatLimit` + migration 0285) and qualified opportunities were (`monthlyCap`, Prompt 153). As of 2026-08-31: qualified opportunities 6 admissions across 3 firms, all `tier_a` (cap 10/month, never bitten); Vault Data Room access has **no counter** (109 `access_grants`, 5 distinct grantee emails, 1 granting org); DD access has **no counter** (3 `due_diligence` documents, 1 checklist row). Build the counter and the message together; block at the moment of use, never revoke or reclassify what exists.
- **My Network growth** (Prompt 335 §D3c, registered not implemented): peer-matching between discoverable founders; Pathfinder-suggested intros between two of your own connections; sector+geography suggestions during onboarding.
- Keep every deploy Hobby-safe (crons ≤ daily) until/unless the Vercel plan changes.

---

### Quick reference
- Live: https://www.sherlockdeal.com (never `.vercel.app` for verification — see `CLAUDE.md`) · Repo: https://github.com/ablute-software/connectB
- Supabase: https://supabase.com/dashboard/project/wkjcaoqdvhykrfacsylr
- ablute_ org id: `bca54499-03c8-469b-a48d-b9f442e44f69`
