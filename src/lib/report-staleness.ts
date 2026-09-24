// Prompt 729 §3.1 — generalizes computeMiniPitchInputSnapshot's own pattern
// (mini-pitch.ts) to every AI-generated report in Readiness & Training: a
// deterministic snapshot of exactly what the report was generated FROM,
// so a later load can say precisely what changed since — never "outdated"
// with no explanation, and never a fabricated diff for a run that predates
// this (see legacyRoundTargetHint below).
//
// Only `investability` is wired end-to-end in this pass (the route that
// receives `{ facts, pipeline, company }` and the ReviewPanel.tsx that
// builds them). The other Readiness & Training generators this prompt was
// asked to inventory (§3.1) — none of them save a snapshot yet, so none of
// them are safe to plug into diffReportInputs' rich per-kind labels until
// they do:
//   - action_plan (ai_reviews, kind='action_plan'): reads { context, draft,
//     documentId }, `context = { ...companyContext, facts: confirmedFacts }`
//     (ReviewPanel.tsx submitReview, ~line 332).
//   - market_data (ai_reviews, kind='market_data'): reads
//     { ...companyContext, facts: confirmedFacts } (ReviewPanel.tsx, ~line
//     346) — same shape as action_plan's context, different `kind`.
//   - coaching (coaching_runs): reads { ...companyContext, facts:
//     confirmedFacts } (ReviewPanel.tsx, ~line 361) — same shape again.
//   - Blueprint (/api/blueprint): reads knowledgeToAtoms(readKnowledgeSources())
//     server-side (company-knowledge.ts), not a client-built context object
//     at all — a different snapshot shape would be needed there, not this
//     one reused as-is.
export type ReportKind = 'investability' | 'action_plan' | 'coaching' | 'market_data';

export interface InvestabilitySnapshotInput {
  company: { name?: string | null; sector?: string | null; stage?: string | null; round_target_eur?: number | null; country?: string | null; one_liner?: string | null };
  facts: string[];
  pipeline: Record<string, unknown>;
}

// Recursive key-sort so two calls with the same DATA in a different
// insertion order (e.g. `by_status` built by iterating `db.entities`, whose
// own order isn't guaranteed stable) always produce byte-identical JSON.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) sorted[key] = canonicalize(obj[key]);
    return sorted;
  }
  return value;
}

export function computeReportInputSnapshot(kind: ReportKind, inputs: unknown): string {
  if (kind === 'investability') {
    const i = inputs as InvestabilitySnapshotInput;
    return JSON.stringify(canonicalize({
      company: {
        name: i.company.name ?? null, sector: i.company.sector ?? null, stage: i.company.stage ?? null,
        round_target_eur: i.company.round_target_eur ?? null, country: i.company.country ?? null, one_liner: i.company.one_liner ?? null,
      },
      facts: [...i.facts].sort(),
      pipeline: i.pipeline,
    }));
  }
  // Prompt 729 §3.1 — the other three kinds are inventoried above but not
  // wired: a generic canonical snapshot of whatever's passed in, so calling
  // this for them doesn't throw, but diffReportInputs (below) has no
  // per-kind readable labels for them yet — only a generic fallback.
  return JSON.stringify(canonicalize(inputs));
}

export interface ReportInputChange { label: string; from: string; to: string }
export interface ReportStalenessResult { stale: boolean; changes: ReportInputChange[] }

function fmtEurLabel(n: number | null | undefined): string {
  return n == null ? 'not set' : `€${n.toLocaleString('en-US')}`;
}

// Prompt 729 §3.1 — set-diff on the facts array: "+N / -M", never a full
// list (a confirmed-facts diff can be long; the count is what tells the
// founder whether to bother re-running, the banner isn't the place to
// relitigate which fact changed).
function factsChangeLabel(prevFacts: string[], currentFacts: string[]): ReportInputChange | null {
  const prevSet = new Set(prevFacts);
  const currentSet = new Set(currentFacts);
  const added = currentFacts.filter((f) => !prevSet.has(f)).length;
  const removed = prevFacts.filter((f) => !currentSet.has(f)).length;
  if (added === 0 && removed === 0) return null;
  const parts = [added > 0 ? `+${added}` : null, removed > 0 ? `-${removed}` : null].filter(Boolean).join(' / ');
  return { label: 'Confirmed facts', from: `${prevFacts.length}`, to: `${currentFacts.length} (${parts})` };
}

export function diffReportInputs(prevSnapshot: string | null | undefined, currentInputs: InvestabilitySnapshotInput): ReportStalenessResult {
  if (!prevSnapshot) return { stale: false, changes: [] };

  let prev: InvestabilitySnapshotInput;
  try {
    prev = JSON.parse(prevSnapshot);
  } catch {
    return { stale: false, changes: [] };
  }

  const changes: ReportInputChange[] = [];
  if ((prev.company?.round_target_eur ?? null) !== (currentInputs.company.round_target_eur ?? null)) {
    changes.push({ label: 'Round target', from: fmtEurLabel(prev.company?.round_target_eur), to: fmtEurLabel(currentInputs.company.round_target_eur) });
  }
  if ((prev.company?.sector ?? null) !== (currentInputs.company.sector ?? null)) {
    changes.push({ label: 'Sector', from: prev.company?.sector ?? 'not set', to: currentInputs.company.sector ?? 'not set' });
  }
  if ((prev.company?.stage ?? null) !== (currentInputs.company.stage ?? null)) {
    changes.push({ label: 'Stage', from: prev.company?.stage ?? 'not set', to: currentInputs.company.stage ?? 'not set' });
  }
  const factsChange = factsChangeLabel(prev.facts ?? [], currentInputs.facts);
  if (factsChange) changes.push(factsChange);

  const prevTotal = (prev.pipeline as { total_investors?: number } | undefined)?.total_investors;
  const currentTotal = (currentInputs.pipeline as { total_investors?: number } | undefined)?.total_investors;
  if (prevTotal !== currentTotal) {
    changes.push({ label: 'Pipeline', from: `${prevTotal ?? 0} investors`, to: `${currentTotal ?? 0} investors` });
  }

  return { stale: changes.length > 0, changes };
}

// Prompt 729 §3.1 — every run today (and for a while after this ships) has
// no input_snapshot at all — the migration is proposed, not applied, and
// even once it is, only NEW runs get one. legacyRoundTargetHint is the
// transitory bridge: scan the run's own report text for a € amount and
// compare it to the CURRENT round target, in the one shape this org's real
// production incident actually took ("The €400k target…" vs a since-
// updated €270,000). Marked as a heuristic in its own name and this
// comment — it disappears the moment a run has a real snapshot to diff
// instead (diffReportInputs takes priority whenever prevSnapshot exists).
const EUR_AMOUNT_PATTERN = /€\s?(\d[\d.,]*)\s?[kK]?\b/g;

function parseEurAmount(raw: string): number | null {
  const isK = /[kK]\b/.test(raw);
  const digits = raw.replace(/[€\skK]/g, '');
  // A dot or comma with exactly 3 trailing digits is a thousands
  // separator (400.000 / 400,000); otherwise treat it as a decimal point
  // (a €400.5k-style figure, unlikely here but not assumed impossible).
  const normalized = digits.replace(/[.,](?=\d{3}(\D|$))/g, '');
  const n = Number(normalized.replace(',', '.'));
  if (Number.isNaN(n)) return null;
  return isK ? n * 1000 : n;
}

export function legacyRoundTargetHint(reportText: string, currentTargetEur: number | null | undefined): ReportInputChange | null {
  if (currentTargetEur == null) return null;
  const matches = [...reportText.matchAll(EUR_AMOUNT_PATTERN)];
  for (const m of matches) {
    const amount = parseEurAmount(m[0]);
    if (amount == null) continue;
    // Only a MISMATCH is a hint worth showing — the same amount mentioned
    // is not staleness, it's confirmation.
    if (Math.abs(amount - currentTargetEur) > 0.5) {
      return { label: 'Round target mentioned in the report', from: m[0].trim(), to: fmtEurLabel(currentTargetEur) };
    }
  }
  return null;
}
