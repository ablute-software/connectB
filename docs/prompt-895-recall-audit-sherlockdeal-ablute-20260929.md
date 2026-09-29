# Prompt 895 (v2) — §0 re-verification + §E recall audit (SherlockDeal, ablute_)

Generated 2026-09-29. Read-only against production (`wkjcaoqdvhykrfacsylr`) — every query below was a plain `select`; no `apply_migration`, no `insert`/`update`/`delete` was ever run. Nuno's own scope instruction for this pass: *"começa pelo §0 e pela auditoria de recall §E (SherlockDeal e ablute_, lista nominal) e pára aí"* — this document, `src/lib/catalog-fit.ts` and `src/lib/recall-audit.ts` are the entirety of what this branch does. No §A (real facts table), §C (UI) or §D (data repair) work was performed or applied to any database.

## 1. §0 re-verification — fresh numbers against production, today

The live production `catalog_match_score` was read directly (`pg_get_functiondef`), not assumed from a migration filename — this repo's own migration-ledger memory note ("apply order is the `version` column, not the file name") applies here: `0149`, `0165`, `0300` and `0345` all redefine this function, and file-number order does NOT match apply order. The definition actually live today is the one from migration `0345_catalog_topic_signal_and_person_priority.sql` (Prompt 585 Phase 2), confirmed byte-for-byte against production per this repo's own `DECISIONS.md`/Prompt 737 note, and independently reconfirmed here via `pg_get_functiondef('public.catalog_match_score(uuid,uuid)')`.

| # | §0 claim | Fresh verification (2026-09-29) | Verdict |
|---|---|---|---|
| Catalog size | "catálogo de 760 firmas verificadas" | `760` verified, non-test rows (763 verified total, 767 rows overall) | **Exact match** |
| 1. Sector normalization | Indico/Armilar/Portugal Ventures/Shilling given as raw-token examples | Confirmed: `sectors_normalized` for these firms is literally `["ai","consumer","deep tech",...]` etc. — lowercase raw tokens, not taxonomy labels | **Confirmed, still true** |
| 2. Unknown > wrong | "374 sem sectores, 357 sem stage, 609 sem ticket, 593 sem geografias" | Today: **377** / **360** / **612** / **595** — each up by 2–3 rows | **Confirmed, drifted +2/+3 rows** since 29/09 (consistent with normal catalog growth over the same day/days) |
| 2. Unknown > wrong | "370 enriched, 370 com extra_facts={}" | **370 enriched** (exact) but only **369** of those have `extra_facts = {}` — and catalog-wide, **759 of 760** verified rows have empty `extra_facts`, not just the enriched subset | **Partially stale, and understated**: the emptiness is catalog-wide, not enriched-specific; the one exception is DOMiNO itself (see below) |
| 3. Thesis never read | DOMiNO exclusion example, LINCE/BuenaVista Portugal-only theses | Thesis text for LINCE ("VC em empresas portuguesas...") and BuenaVista ("Portuguese fund...ANI...") confirmed unchanged. DOMiNO's thesis today literally states "strong origins in Eastern Europe, Central Asia and the Caucasus" | **Confirmed, still true**: no structured field reads any of this; a real `origin_constraints`/`exclusions` field does not exist |
| 3. Thesis never read | "Investors Portugal... 1.º com 90 — falso positivo" | Fresh score today: **90** for both SherlockDeal and ablute_; ranks **#1** of SherlockDeal's future top-matches (`catalog_top_matches`, live RPC) | **Confirmed, exact, still #1 today** |
| 4. Person gate | "46 com score≥75; 32 excluídas só por pessoa. Indico, Armilar, Portugal Ventures, Pathena sem pessoa." | Aggregate confirmed **exactly**: `ge_75=46`, `ge_75_no_person=32`. But **named examples are 3/4 stale**: Indico, Armilar and Portugal Ventures now all have a contactable person (LinkedIn or hook) — only **Pathena** (the fund, not "Pathena Family Office") still has none | **Aggregate exact; 3 of 4 named examples no longer illustrate this specific failure** — see §2 below |
| 4. Person gate, PT subset | "18 PT firmas: 11<55, 2 person-gate, 5 deliverable" | Recomputed live today: **18** total, **11** below 55, **2** person-gate-blocked (Angry Ventures, Pathena), **5** deliverable (score≥55 + person: COREangels Porto\*, Investors Portugal, Semapa Next, MAZE, Shilling VC) | **Exact match, every number** |
| 5. "enriched" means nothing | DOMiNO's thesis "truncated... AI, Deeptech, Cleantech and beyond", missing 9 offices/geographies | DOMiNO's `extra_facts` today is a **rich, sourced JSON** (9 office cities, 10-sector registry, founder-origin note with source URL, `loaded_at: 2026-09-29`), and `geographies` is populated (`Eastern Europe, Central Asia, Caucasus, Türkiye`) | **Stale — already fixed for this one row**, evidently the same day this diagnosis was written (see §2) |
| 6. hq_country not geographies | live score uses `hq_country` only | Confirmed via `pg_get_functiondef`: the live function normalizes `hq_country` on both sides (Prompt 627 fix, migration `20260909053000`) but never reads `geographies` at all | **Confirmed, still true** — and this is exactly why DOMiNO still scores 89 (SherlockDeal) / 93 (ablute_) live today despite its own data being fixed |

\* COREangels Porto and Portugal Ventures (and DOMiNO) are already in `catalog_deliveries` for SherlockDeal — 10 deliveries total, not just Portuguese ones (also Kaya VC, Mercia Ventures, K Fund, Entrée Capital, Specialist VC, Alpana Ventures, Frst). DOMiNO Ventures — the firm named in this prompt's own origin story — is confirmed among SherlockDeal's real deliveries.

### One omission in §0 itself, worth naming plainly

§0's own table says the live score "soma quatro critérios: sector / stage / ticket / país". That was true of the version 0300 shipped, but the version **actually live today** (0345, Prompt 585 Phase 2, shipped 2026-09-10) adds a fifth, additive **topic-signal bonus of +0..+8** (evidence-based, from `catalog_topic_signal`/`catalog_person_priority`). It does not change any of §0's conclusions (it is additive and capped low), but "soma quatro critérios" is no longer a complete description of what's live. This module does not replicate that bonus (see §3 below) — it is a separate, unrelated system.

## 2. Named-example corrections (the "catch the drift" ask)

Two concrete, verified corrections to §0's own illustrative examples, found by recomputing rather than trusting the prompt's text:

1. **Indico Capital Partners, Armilar Venture Partners and Portugal Ventures are NOT currently excluded by the person gate.** All three have at least one affiliated person with a LinkedIn URL or a written hook (`outreach_readiness` 70/65/100 respectively). Their real exclusion reason today is **score** (45/45/45 against SherlockDeal — confirmed by calling the live `catalog_match_score` RPC directly), which for Indico and Armilar is a direct instance of §0's failure #1 (raw sector tokens never overlapping the org's canonical sector names). Only **Pathena** (the fund; not "Pathena Family Office", a separate row) still has zero contactable people today and correctly illustrates the person-gate failure.
2. **DOMiNO Ventures' own data has already been repaired** since §0 was written (same day, per `extra_facts.loaded_at: "2026-09-29"`): its thesis, `geographies` and `extra_facts` are now complete and sourced. What has **not** changed is the live scoring function, which still only reads `hq_country` (NL → "Western Europe hub" bucket, +6) and never reads the now-populated `geographies` (Eastern Europe/Central Asia/Caucasus/Türkiye — none of which is Portugal or a broad "Europe/Iberia" term). So DOMiNO still scores 89 (SherlockDeal) / 93 (ablute_) live today, and would still be deliverable as a false "High fit" — the complaint that triggered this prompt is still fully live, just for a more specific reason than §0's text describes (a scoring-function gap, not a missing-data gap, for this one firm).

## 3. `src/lib/catalog-fit.ts` and `src/lib/recall-audit.ts` — what they actually do

Two pure TypeScript modules, zero I/O, not imported by any route or the live delivery path (`catalog_top_matches` is untouched). Their only caller in this branch is the one-off script `scripts/_run-prompt895-recall-audit.ts`, which reads a local JSON snapshot (pulled once via a read-only `select`) — no script in this branch holds live database credentials or makes a live query.

**Reads real, existing columns**: `catalog_entities.sectors_normalized`, `stage_min/max`, `check_min_eur/max_eur`, `geographies`, `hq_country`, `thesis`; `orgs.sectors`, `stage`, `round_min_ticket_eur`, `round_target_eur`, `country`.

**Can only ever return `unknown` (documented in code, surfaced as `warnings`), because the field does not exist yet**:
- `not_an_investor` — needs a structured `entity_kind` column (vc_fund / cvc / angel_network_association / accelerator / ...). Confirmed absent via `information_schema.columns`. A best-effort, **informational-only** thesis-keyword warning (`possible_non_investor_entity_kind`) flags the exact "coordinating body" shape named in the prompt (fires on Investors Portugal's real thesis) — it is explicitly never a hard exclusion, only a flag for a human to look at.
- `excluded_by_thesis` — needs a structured `exclusions` field ("no hardware", etc.). No such column exists. Always `unknown`.

**Sector normalization fix (§0 failure #1)**: no general free-text→taxonomy normalizer exists anywhere in this codebase to reuse — `src/lib/catalog-sector-fit.ts`'s own header comment documents this directly (the one real fix, migration `0148`, was a one-time manually-reviewed ~250-row SQL backfill, never made into reusable code). Per this task's own instruction, `catalog-fit.ts` adds a **minimal, explicitly-scoped** raw-token map (`RAW_SECTOR_TOKEN_MAP`, ~24 entries) covering only the tokens actually observed on the named example firms plus a handful more seen while pulling the audit data (`ai`, `saas`, `b2b`, `fintech`, `health`, `deep tech`, `robotics`, `cybersecurity`, `devtools`, `space`, `ocean`, `industry`, `tourism`, `marketplaces`, `consumer`, `iot`, `automation`, `infrastructure`, `dual use`, `ia`, `enterprise`, `life sciences`, `software`) plus a small generalist-token set (`tecnologia generalista`, `generalista`, `generalist`, `tech at the core`). **This is not a taxonomy engine.** It fixes exactly the named cases and a few more; it does not fix the other ~370 catalog rows carrying raw sector tokens — that is real §A/§D work Nuno has not authorized.

**Geography fix (§0 failure #6)**: the hard `geography_out` criterion and the score's geography component now read `geographies` (invest geographies) first, falling back to `hq_country` only when `geographies` is empty — exactly per §B.3's own instruction. Scoring weights for every criterion that exists in both replicas are kept **identical** to the live production function (sector 0/15/35, stage 12/25/10, ticket 10/20/10, geography 10/6/4/2) — the one deliberate behavioural change is the geography *basis*, not the weights. The Prompt 585 topic-signal bonus (+0..+8) is **not** included — it is a separate, unrelated evidence-matching system, left out entirely rather than half-replicated.

**Test results**: `24/24` unit tests pass (`src/lib/catalog-fit.test.ts`, `src/lib/recall-audit.test.ts`) — hard criteria (including a real geography-scoring bug this test suite itself caught and forced a fix for: an early draft gave "Eastern Europe" partial credit via a substring match against the broad term "Europe", which would have silently un-excluded the exact DOMiNO case this file exists to catch), scoring/confidence logic, the fixed sector normalizer against Indico/Armilar/Shilling, and the grouping logic in `recall-audit.ts`.

## 4. Recall audit results — full catalog (760 firms), both orgs

Computed with `src/lib/catalog-fit.ts`/`recall-audit.ts` — **not** the live production score (see caveats in §5). `below_threshold` uses the same ≥55 cut production uses today.

### SherlockDeal (`48a7c481-3946-4a06-a86f-6169bd382c76`, PT, pre-seed, AI/SaaS, €135k–270k ticket)

| Group | Count |
|---|---|
| below_threshold | 312 |
| hard_excluded: geography_out | 130 |
| research_pending (would be eligible, no contactable person yet) | 122 |
| hard_excluded: ticket_out | 80 |
| hard_excluded: stage_out | 65 |
| **eligible** | **51** |

### ablute_ (`bca54499-03c8-469b-a48d-b9f442e44f69`, PT, pre-seed, healthtech/deeptech, €100k–300k ticket)

| Group | Count |
|---|---|
| below_threshold | 306 |
| hard_excluded: geography_out | 130 |
| research_pending | 127 |
| hard_excluded: ticket_out | 88 |
| hard_excluded: stage_out | 65 |
| **eligible** | **44** |

**Caveat on ablute_'s numbers**: ablute_ already has **753 of 760** catalog firms in `catalog_deliveries` (it is the long-running internal seed org) — `recall_audit` scores every firm regardless of prior delivery (by design, for completeness), so ablute_'s breakdown above describes "if the pipeline started from zero today," not "what's newly missing."

### Nominal list — the firms §0 names, by name, both orgs

| Firm | SherlockDeal | ablute_ |
|---|---|---|
| **Investors Portugal** | eligible, score 90, conf 100% | eligible, score 90, conf 100% |
| **DOMiNO Ventures** | **hard_excluded: geography_out**, conf 100% | **hard_excluded: geography_out**, conf 100% |
| **Indico Capital Partners** | eligible, score 80, conf 100% (was 45 live) | hard_excluded: ticket_out (was 35 live) |
| **Armilar Venture Partners** | eligible, score 80, conf 100% (was 45 live) | eligible, score 80, conf 100% (was 45 live) |
| **Portugal Ventures** | below_threshold, score 45, conf 100% (unchanged — genuine sector mismatch, not a normalizer artifact) | below_threshold, score 45, conf 100% |
| **LINCE Capital** | below_threshold, score 45, conf 75% | hard_excluded: ticket_out (ablute_'s lower min ticket falls outside LINCE's 2x window) |
| **BuenaVista Equity** | below_threshold, score 45, conf 50% | below_threshold, score 45, conf 50% |
| **Pathena** | **hard_excluded: stage_out** (series_a→later fund, pre-seed org — a real mismatch, not just "no person") | hard_excluded: stage_out |
| **Iberis Capital** | below_threshold, score 47, conf 25% (almost nothing on file) | below_threshold, score 47, conf 25% |
| **Shilling VC** | eligible, score 90, conf 100% (was 55 live, "à tangente") | eligible, score 90, conf 100% |
| **COREangels Porto** | eligible, score 90 (already delivered) | eligible, score 55 (already delivered) |

### PT-only, before (live production) vs. after (this branch's fixed logic) — SherlockDeal

| | Live production today | This branch's `catalog_fit` |
|---|---|---|
| Eligible / deliverable | 5 (COREangels\*, Investors Portugal, Semapa Next, MAZE, Shilling) | **7** (+ Armilar, Indico) |
| Blocked only by missing person | 2 (Angry Ventures, Pathena) | **1** (Angry Ventures — Pathena now correctly hard-excluded on stage, a more specific and more honest reason) |
| Below threshold / no fit | 11 | 6 (BlueCrow, Portugal Ventures, LINCE, Iberis, BuenaVista, Faber) |
| Hard-excluded (new category — didn't exist before) | 0 | 4 (Pathena: stage_out; Bright Pixel Capital, HCapital Partners, Bynd VC: ticket_out) |

\* already delivered.

Full per-firm tables (all 18 PT firms both orgs; the ~85-row `research_pending`/`below_threshold` sample from the full 760-firm run) are in the script output reproduced under `tmp895/` locally during this session (not committed — see §5 deviation on this) and are reproducible at will via `node --experimental-strip-types scripts/_run-prompt895-recall-audit.ts <catalog.json>`.

## 5. Deviations from the literal Prompt 895 (v2) spec — exhaustive

1. **§A not built at all** (no `catalog_entity_facts` table, no coverage matrix, no extraction prompt, no migration of any kind) — explicitly out of scope per Nuno's own stop-instruction. `catalog-fit.ts` reads today's real columns directly instead.
2. **§B implemented only as much as §E needs**, as a pure TS function, never wired into `catalog_top_matches` (§B.6 untouched) or any delivery path.
3. **`not_an_investor` and `excluded_by_thesis` are always `unknown`** against real data — the structured fields §B.2 assumes (`entity_kind`, `exclusions`) do not exist. A heuristic, informational-only warning approximates the first for reporting purposes; nothing approximates the second (thesis text is not parsed for exclusions at all).
4. **Sector normalization is a minimal, ~24-token map**, not a taxonomy engine — fixes the named cases, not the whole catalog.
5. **Geography matching (`GEOGRAPHY_HOME_SPECIFIC_PHRASES`/`GEOGRAPHY_HOME_EXACT_BROAD_TERMS`) is a small, PT-keyed alias table**, not a geography ontology — every real org in production today is Portuguese, so only `PT` is populated; a non-Portuguese org would fall back to exact-country-name matching only.
6. **The Prompt 585 topic-signal bonus (+0..+8) is not replicated** — a separate, unrelated system, left out entirely.
7. **`§B.1`'s "≥10-pairs equality vs. the real SQL twin" is not literally applicable** — there is no real SQL twin in this restricted branch (a full §B SQL implementation is out of scope). Substituted with 24 unit tests covering hard criteria, scoring, confidence, and the two named real-world cases (DOMiNO, Indico) in isolation, using literal production data as fixtures.
8. **`research_pending`, per the task's own framing, is a reporting label only** — this branch does not touch `catalog_top_matches`'s real person gate; production keeps requiring a contactable person before delivery, unchanged.
9. **The ≥55 "below_threshold" cut is inherited from production's convention**, applied to a genuinely different scoring function (fixed sector normalizer, geography basis, no topic-signal bonus) — a firm's bucket under this branch's logic can and does differ from what `catalog_top_matches` says about it today (see §4's DOMiNO/Indico/Pathena examples). That is the audit's purpose, not an inconsistency to resolve.
10. **§C (UI), §D (data repair — renormalization, reenrichment, reclassifying Investors Portugal) and §F (superseded by the separately-shipped Prompt 896) were not touched at all.**
11. **No migration, no `apply_migration` call, no write of any kind was made to any database.** The one JSON snapshot pulled from production (760 rows, via a plain `select`) lives only in this session's local scratch directory and is not committed.
12. **§E's `catalog_recall_audits` table was not created** — the audit's output is this document plus the reproducible script, per the task's own explicit allowance ("optionally as a checked-in JSON/markdown artifact... so the founder has something durable to review").

## 6. Recommendation list — what real §A/§B/§C/§D work this would need (Nuno's decision, not pre-authorized by this branch)

- **§A, real facts table** (`catalog_entity_facts`, source/tier/status per fact, `project_catalog_entity()` projection): the only way `not_an_investor` and `excluded_by_thesis` become real hard criteria instead of permanent `unknown`s. Without it, this restricted module's "eligible" counts will always undercount real exclusions of the "association, not a fund" and "explicitly excludes this kind of startup" kind.
- **§A, extraction prompt** (`prompts/entity_facts_v0.1.md`) to backfill `sectors_normalized` with real taxonomy labels catalog-wide (today's 24-token minimal map covers a handful of firms; ~370 rows still carry raw or empty sector data) and to populate `geographies` beyond the ~22% coverage it has today.
- **§B, full SQL twin of `catalog_fit`** plus wiring `catalog_top_matches` to it (§B.6) — this is the step that would actually change what founders receive; this branch deliberately stops short of it.
- **§B.5, the person-research queue** — turning today's `research_pending` label (122–127 firms per org in this audit) into a real, visible "eligible — team research pending" state instead of a silent drop, exactly as this task's `research_pending` framing anticipates.
- **§C, "Why this investor"** — surfacing the real numbers (score, confidence, hard reasons) this module already computes; today they exist only in this document and the test suite.
- **§D, targeted data repair** — starting with DOMiNO specifically (its facts are already fixed; only the live scoring function's geography-blindness is left) and the ~370 rows with raw/empty `sectors_normalized`.
- **Decide the "below_threshold" cut deliberately** once a real §B ships — this audit inherited today's ≥55 as a reporting convenience; a genuinely different scoring function (no topic-signal bonus, different geography basis) may warrant a different number, and that's a product decision, not something this branch should have picked silently.
