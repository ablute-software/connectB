# Investor matching engine — spec for review (not yet built)

**Revision 2** — supersedes the scoring design in revision 1 (AI scoring investors at
recompute time). The elimination layer, the sticky-unlock interaction, the persisted-columns
idea, and the "why this is prioritized over Profile Strength" framing all carry over; what
changed is *where in the pipeline judgment lives*. See §9 for what's unchanged from revision 1.

Nothing in this document is implemented. Written for review before any of it is built.

## 1. Why the judgment moved to ingestion, not runtime

The question isn't "AI or no AI" — it's where in the pipeline judgment happens. Almost
everything a runtime AI call would score can instead be decided once, on the investor side, at
catalog ingestion. Once that's done, matching a startup against the catalog is arithmetic, not
inference. Concretely, moving judgment to ingestion buys:

- **Instant, free recompute.** The whole catalog re-ranks in milliseconds when a founder saves
  their profile — no debounce, no async job, no queue. The reclassification toast fires the
  moment the save completes.
- **Reproducibility.** Same input, same order, every time. "12 investors changed wave" is always
  attributable to a profile change, never to model variance — the thing `temperature: 0` in
  revision 1 only approximated, not guaranteed.
- **Real testability.** "This startup must have this investor in W1" becomes a unit test against
  fixtures, not a snapshot accepted because it looks plausible.
- **Auditability.** When a user disputes a score, the answer is arithmetic you can show them, not
  a model call you'd have to re-run and hope reproduces.
- **Profile Strength's weights stop being a separate, unresolved decision.** Onboarding spec §9.1
  was blocked because a bar that rewards fields the engine ignores lies to the user. With a
  deterministic engine, the weights ARE the same array the engine scores with — same file, not a
  parallel definition that can drift. That's the main reason to prefer this shape, not a side
  benefit.

## 2. Input fields — both sides (unchanged from revision 1; still the real schema)

### Startup side (`Org`, `src/lib/types.ts`, filled via `/settings` Company tab)

| Field | Type | Notes |
|---|---|---|
| `sectors` | `string[]` | Becomes taxonomy-backed once `prompt_sectors_taxonomy.md` ships — now a hard prerequisite, see §6 |
| `stage` | `Stage` (`pre_seed\|seed\|series_a\|later\|other`) | |
| `round_target_eur` | `number` | Ticket size sought |
| `round_secured_eur` / `round_valuation_eur` | `number` | |
| `round_instruments` | `string[]` | |
| `country` / `hq_city` | `string` | |
| `employee_count` | `number` | |
| `description` / `one_liner` | `string` | Not scoring inputs under the deterministic design — free text isn't a structured feature; kept for rationale-template context only |
| `founded_year` | `number` | |

Plus `company_facts` (category `traction\|team\|product\|positioning\|financing\|regulatory\|market\|metrics\|other`, `status='confirmed'`) — same grounded-fact store the AI composer already uses. Under the deterministic design these aren't scored directly (no weight in §3's formula); they remain available for rationale-template context if a future weight is added for them explicitly.

### Investor side (`Entity`, plus new structured fields from ingestion enrichment — §4)

| Field | Type | Notes |
|---|---|---|
| `sectors` | `string[]` | Needs taxonomy-normalization at ingestion (§4, §6) to be comparable |
| `stage_min` / `stage_max` | `Stage` | |
| `check_min_eur` / `check_max_eur` | `number` | |
| `invests_in_geographies` | `string[]` | |
| `hq_country` | `string` | |
| `thesis` | `string` | Raw material for ingestion enrichment (§4), not scored directly itself |
| `is_sector_agnostic` | `boolean` | |
| *(new)* portfolio signal | — | **Out of v1, deliberately** (decided — see §4). No structured data source exists today; `current_funds`/`latest_fund`/`last_investment_found`/`key_people` on `Entity` are free-text narrative (migration 0032), not queryable investment history. |

## 3. Layer 1 — deterministic eliminations (unchanged from revision 1)

Stage range, ticket-range overlap, elective geography. Missing data on either side never
eliminates (can't fail a hard filter on absence) — only an actual mismatch does. Runs first,
over every `catalog`-sourced entity for the org; a failure is recorded with reason and the
entity never reaches Layer 2.

## 4. Layer 2 — deterministic weighted scoring (replaces revision 1's AI scoring)

A weighted sum over structured fields on both sides, computed in plain SQL/TS — no model call at
match time.

**v1 weights are fixed over these four factors only** — sector, stage, ticket, geography all
have known coverage today. Portfolio signal is deliberately OUT of v1's weighted sum (decided):
if it were included now, every investor without portfolio data — which today is all of them —
would be penalized for a gap in our own data collection, and the ranking would end up measuring
data-collection completeness instead of startup fit. That's the textbook way a scoring engine
quietly lies. See the phased plan below the table.

| Factor | How it's computed | Weight (starting point, see §8 open item) |
|---|---|---|
| Sector overlap | Against the taxonomy's hierarchy + synonyms (§6) — NOT string equality | High |
| Stage adjacency | Not binary — a small explicit distance matrix (e.g. seed investor vs. pre-seed startup scores partial credit, not zero) | Medium |
| Ticket distance | Soft penalty curve between `round_target_eur` and `[check_min_eur, check_max_eur]` — the hard cutoff already happened in Layer 1, this is graded distance within the surviving set | Medium |
| Geography | Tiered: same country > same region > declared-global | Low–Medium |

**Portfolio signal — phased, additive, not in the v1 sum:**
1. **v1 ships without it.** Weights above are final over the four known-coverage factors — this
   unblocks fixing the weights table now instead of waiting on data that doesn't exist yet.
2. **Extracted during the ingestion enrichment pass** (§5) — `current_funds`/`latest_fund`/
   `last_investment_found` are already prose the enrichment pass reads; extracting portfolio
   mentions too is near-zero marginal cost. Destination: a new, sparse `investor_investments
   (investor_id, company_name, sector, stage, invested_at, source, confidence)` table — not
   another free-text column.
3. **Enters only once coverage is measurable**, as an ADDITIVE bonus applied only where data
   exists — absence is neutral, never a penalty. An investor with a demonstrably aligned
   portfolio scores higher; an investor with no portfolio data lands wherever the four v1 factors
   already put them.
4. **External data (Crunchbase, Dealroom) is a later hypothesis**, decided by cost against the
   gain actually measured in step 3 — not adopted speculatively ahead of that evidence.

**Persist the components, not just the total** — `match_components jsonb`, one entry per factor
with its contribution. This is what makes a contested score auditable, a rationale regenerable,
and a future weight change replayable without re-touching raw data.

**Rationale is template-generated from the components**, not model-generated prose — e.g.
*"invests in fintech at seed stage, ticket compatible, three investments in your sector in
2025."* Loses AI's fluent phrasing; gains consistency and verifiability. For the actual purpose
(giving the founder an argument for their first approach), the fact matters more than the
sentence.

## 5. Where AI still lives — catalog ingestion only

The one place AI remains: converting an investor's unstructured prose (thesis, site copy, fund
description) into the structured fields Layer 1/2 actually consume — normalized sectors against
the taxonomy, stage range, ticket range, geographies. A few hundred calls total, once per
investor, result persisted permanently. Not a runtime cost, not on the matching hot path.

Rules:
- Every AI-enriched field is tagged `enrichment_source: 'manual' | 'ai' | 'imported'` with a
  timestamp — never conflated with verified/founder-confirmed data.
- **Never invents.** If the source material doesn't say, the field stays empty — not filled with
  the most-plausible guess. The engine already knows how to treat an empty field (§3: absence
  never eliminates, and per the next rule, absence caps the wave); a wrong-but-confident field
  propagates silently and is far worse.
- **An investor with unfilled structured fields cannot reach Wave 1**, regardless of what score
  the filled fields alone would produce. Same rule as revision 1, carried into the new shape.

## 6. The sector taxonomy is now a hard prerequisite, not a nice-to-have

`prompt_sectors_taxonomy.md` (queued, not yet built) stops being a UI improvement and becomes a
build blocker. Without a taxonomy with hierarchy + synonyms, sector overlap isn't computable at
all, and it's the highest-weighted computable factor (pending §4's portfolio-signal question).
Build the taxonomy first.

## 7. Persistence & recompute

New columns on `entities`: `match_score int`, `match_rationale text`, `match_components jsonb`,
`scored_at timestamptz`, `scored_profile_hash text`, `match_formula_version text`, `prev_wave
int` (snapshotted immediately before a recompute overwrites `wave` — what makes "N investors
changed wave" a real diff).

Because scoring is now cheap arithmetic instead of a model call, recompute no longer needs
defensive triggers — it can simply run on profile save, on new catalog delivery, and on a
formula-version bump. `scored_profile_hash` stays, not for cost reasons anymore, but to know
whether a stored score is current. Backfill existing entities on ship, or the current pipeline
stays half-scored.

Wave bands derive from score exactly as in revision 1 — unchanged banding logic, just fed by a
deterministic score instead of a model's.

### Interaction with sticky unlock (migration 0042) — unchanged

A recompute changing `wave`/`match_score` never un-visibilizes an `unlocked_at`-stamped entity —
that invariant from 0042 holds regardless of what produces the new score. No schema change needed
here beyond what 0042 already has.

## 8. Measurement — the honest ground truth, and where AI can re-enter

Start recording, now, which investors a founder actually contacts and which reply. It's the only
real ground truth available, it's cheap to collect starting today, and it's what eventually
answers whether the deterministic ranking is wrong — and specifically where.

Without that baseline there's no way to know if AI would add anything. With it: if measurement
later shows the top of the ranking underperforms, AI can be added to re-rank just the top slice
(ten or twenty investors, not the whole catalog) and be measured against the same baseline. AI
earns its way back in by evidence, not by assumption.

## 9. What the spec deliverable must contain (updated list — supersedes revision 1's §10)

1. Exact input fields both sides, AND **current data coverage** for each on the real catalog —
   if coverage is low, that's the actual blocker, not the algorithm.
2. Eliminations, with defined behavior for missing fields (§3).
3. The formula: weights, the stage-adjacency matrix, the ticket-distance penalty curve.
4. Score → wave bands, and the reasoning behind the cutoffs.
5. Rationale templates per dominant-component combination.
6. Enrichment plan: how many investors need it, estimated cost, and how it's reviewed
   (`enrichment_source` audit trail).
7. Test cases: at least five startup profiles with expected ordering, fixed as fixtures.

## 10. Open questions before this can be built

1. ~~Portfolio signal has no data source today~~ — **resolved**: out of v1's weighted sum,
   phased in later as an additive bonus once `investor_investments` has measurable coverage
   (§4). No longer blocks fixing the v1 weights.
2. **Sector taxonomy build order** (§6) — now sequenced BEFORE the engine, not parallel to it.
3. **Enrichment coverage** — need the actual "how many of today's 694 catalog entities have
   enough source material (thesis, website copy) to enrich" number before estimating ingestion
   cost/effort for real, per §9 item 1 and item 6.
4. **`catalog_quota` payment-webhook increment** — unrelated to the engine, carried over from
   revision 1: a real Stripe webhook already exists (`src/app/api/stripe/webhook/route.ts`).
   Must be idempotent by Stripe's own event id (Stripe redelivers events by design) — a
   replayed event must never hand out catalog for free a second time, silently and
   irreversibly, since `catalog_quota` never decrements. Scoping this is a separate, smaller
   task whenever picked up.
