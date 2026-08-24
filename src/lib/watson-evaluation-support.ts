// Prompt 349 — Chamber 1 (investor ↔ Watson, private). Pure prompt-assembly
// only — this is the audit surface: every field that reaches the model is
// listed right here, nothing else. No DB/network I/O in this file.
export interface EvaluationSupportInput {
  orgName: string;
  // Already visible to this investor regardless of anything private — the
  // same minimal Level-1 fields the compact Pipeline card shows.
  visibleSummary: { oneLiner: string | null; stage: string | null; sectors: string[]; roundTargetEur: number | null };
  // This investor's OWN scorecard (investor_scorecard_scores/criteria) —
  // never a colleague's, never another investor's.
  scorecard: { label: string; weight: number; score: number | null; note: string | null }[];
  // This investor's OWN per-document scores (investor_doc_scores).
  docScores: { documentName: string; score: number; note: string | null }[];
  // This investor's OWN watch state, if watching — deltas already computed
  // server-side against THEIR OWN baseline, never another investor's.
  watching?: { changedFieldLabels: string[]; newClass1Statements: string[]; newClass2Statements: string[] };
}

export const WATSON_EVALUATION_SUPPORT_SYSTEM =
  'You are Watson, an assistant that helps a venture investor read their OWN private evaluation of one startup — '
  + 'their own scorecard scores/notes, their own per-document ratings, and (if they are watching this startup) what '
  + 'has changed since their last visit. You NEVER see anything about other investors, and you never invent a fact '
  + 'not present in what you were given. Produce up to 3 short insights, each one of: '
  + '"reading" (point out something notable in how they scored — e.g. a gap between two related scores their own '
  + 'notes might explain), "threshold_suggestion" (suggest ONE mechanical watch alert from the fixed menu: '
  + 'class1_evidence, class2_evidence, round_opened_or_changed, roadmap_milestone, match_score_above — only if the '
  + 'investor is watching this startup), or "alert_reason" (if a change already happened, phrase why it might '
  + 'matter to THIS investor specifically, citing the actual fact, never inventing one). Every insight must be your '
  + 'own analysis of the investor\'s own inputs — never a claim about the startup that wasn\'t already given to you.';

export function buildEvaluationSupportPrompt(input: EvaluationSupportInput): string {
  const parts: string[] = [
    `Startup: ${input.orgName}`,
    `What you (the investor) already see: ${[
      input.visibleSummary.oneLiner, input.visibleSummary.stage,
      input.visibleSummary.sectors.length ? input.visibleSummary.sectors.join(', ') : null,
      input.visibleSummary.roundTargetEur ? `raising €${input.visibleSummary.roundTargetEur.toLocaleString()}` : null,
    ].filter(Boolean).join(' · ') || '(nothing on file yet)'}`,
  ];
  if (input.scorecard.length > 0) {
    parts.push(`Your own scorecard:\n${input.scorecard.map((s) => `- ${s.label} (weight ${s.weight}): ${s.score ?? 'not scored'}${s.note ? ` — note: "${s.note}"` : ''}`).join('\n')}`);
  }
  if (input.docScores.length > 0) {
    parts.push(`Your own document ratings:\n${input.docScores.map((d) => `- ${d.documentName}: ${d.score}/10${d.note ? ` — note: "${d.note}"` : ''}`).join('\n')}`);
  }
  if (input.watching) {
    const w = input.watching;
    const lines = [
      ...w.changedFieldLabels.map((l) => `- ${l} changed`),
      ...w.newClass1Statements.map((s) => `- New class-1 evidence: ${s}`),
      ...w.newClass2Statements.map((s) => `- New class-2 evidence: ${s}`),
    ];
    parts.push(lines.length > 0
      ? `You are watching this startup. Since your last visit:\n${lines.join('\n')}`
      : 'You are watching this startup. Nothing has changed since your last visit.');
  }
  return parts.join('\n\n');
}

export type WatsonInsightKind = 'reading' | 'threshold_suggestion' | 'alert_reason';
export interface WatsonInsight { kind: WatsonInsightKind; text: string }

const VALID_KINDS: WatsonInsightKind[] = ['reading', 'threshold_suggestion', 'alert_reason'];
const MAX_INSIGHTS = 3;
const MAX_INSIGHT_LEN = 500;

// Defensive parsing of the tool_use input — never trusts the model's shape
// blindly; anything malformed is dropped rather than crashing the route.
export function parseWatsonInsights(raw: unknown): WatsonInsight[] {
  const arr = (raw && typeof raw === 'object' && Array.isArray((raw as { insights?: unknown }).insights))
    ? (raw as { insights: unknown[] }).insights : [];
  return arr
    .filter((i): i is { kind: string; text: string } =>
      !!i && typeof i === 'object' && typeof (i as { text?: unknown }).text === 'string'
      && VALID_KINDS.includes((i as { kind?: string }).kind as WatsonInsightKind))
    .slice(0, MAX_INSIGHTS)
    .map((i) => ({ kind: i.kind as WatsonInsightKind, text: i.text.trim().slice(0, MAX_INSIGHT_LEN) }))
    .filter((i) => i.text.length > 0);
}
