// Pure functions behind the Readiness & Train Action plan sub-tab (Prompt
// 115 Block C) — kept separate from the component so the clustering/priority
// logic has direct unit coverage, same convention as rules.ts/plans.ts.
import type { CompanyFactCategory } from './types';

export type Severity = 'low' | 'medium' | 'high';
export interface Finding { text: string; category: CompanyFactCategory }
export interface SeverityFinding extends Finding { severity: Severity }
export interface StructuredReport {
  score: number; summary: string;
  strengths: string[]; weaknesses: SeverityFinding[]; risks: SeverityFinding[]; recommendations: Finding[];
}
export interface AiReviewRow { id: string; kind: string; result: StructuredReport | null; created_at: string }

export interface Contradiction {
  text: string; category: CompanyFactCategory; severity: Severity;
  sideA: { kind: string; quote: string }; sideB: { kind: string; quote: string };
}
// Two independent reads of the SAME document kind are not a genuine
// cross-document contradiction — they're the same content re-verbalized
// (the exact failure mode the Block C recurrence-ranking bug hit). The API
// route already rejects kindA===kindB server-side; this is defense-in-depth
// for any row that predates that check or was written some other way.
export function genuineContradictions(contradictions: Contradiction[]): Contradiction[] {
  return contradictions.filter((c) => c.sideA.kind !== c.sideB.kind);
}

export type ActionType = 'weakness' | 'risk' | 'recommendation';
export interface Action {
  text: string; category: CompanyFactCategory; type: ActionType; severity: Severity | null;
  sourceKind: string; sourceReviewId: string; createdAt: string;
}
export interface ActionCluster { items: Action[] }

export const DOC_KIND_LABEL: Record<string, string> = {
  deck_review: 'Pitch deck', one_pager_review: 'One-pager', business_plan_review: 'Business plan',
  financial_plan_review: 'Financial plan', marketing_plan_review: 'Commercial & marketing plan',
  cap_table_review: 'Cap table & terms',
};
export const SEVERITY_WEIGHT: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

// Prompt 99 §2.6 — zero AI cost, pure structural check against what already
// exists in documents/folders vs a standard DD checklist.
export function dataroomChecklist(folders: { name: string }[], documents: { name: string }[]) {
  const folderNames = folders.map((f) => f.name.toLowerCase());
  const docNames = documents.map((d) => d.name.toLowerCase());
  const hasFolder = (kw: string) => folderNames.some((n) => n.includes(kw));
  const hasDoc = (kw: string) => docNames.some((n) => n.includes(kw));
  return [
    { label: 'Pitch deck', present: hasDoc('pitch deck') || hasDoc('investor deck') },
    { label: 'One-pager', present: hasDoc('one-pager') || hasDoc('one pager') },
    { label: 'Cap table', present: hasDoc('cap table') || hasDoc('capitalization') },
    { label: 'Financial model / projections', present: hasDoc('financial model') || hasDoc('projection') || hasFolder('financial') },
    { label: 'Corporate / governance documents', present: hasFolder('corporate') || hasFolder('governance') },
    { label: 'Team bios / org chart', present: hasFolder('team') || hasDoc('org chart') || hasDoc('cv') },
    { label: 'IP (patents / trademarks)', present: hasDoc('patent') || hasDoc('trademark') },
    { label: 'Commercial evidence (LOIs, pilots, contracts)', present: hasFolder('commercial') || hasDoc('loi') || hasDoc('pilot') || hasDoc('agreement') },
    { label: 'Regulatory & compliance', present: hasFolder('regulatory') || hasFolder('compliance') },
  ];
}

export function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
}
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Greedy single-link clustering: an item joins the first cluster any of
// whose members it's ≥0.6-similar to. Not globally optimal, but stable and
// cheap for the handful of findings a founder's reviews realistically produce.
export function clusterActions(actions: Action[]): ActionCluster[] {
  const tokens = actions.map((a) => tokenize(a.text));
  const clusters: ActionCluster[] = [];
  for (let i = 0; i < actions.length; i++) {
    let placed = false;
    for (const cluster of clusters) {
      const matchesAny = cluster.items.some((item) => {
        const j = actions.indexOf(item);
        return item.type === actions[i].type && jaccard(tokens[i], tokens[j]) >= 0.6;
      });
      if (matchesAny) { cluster.items.push(actions[i]); placed = true; break; }
    }
    if (!placed) clusters.push({ items: [actions[i]] });
  }
  return clusters;
}

export function clusterPriority(cluster: ActionCluster): number {
  const distinctDocs = new Set(cluster.items.map((i) => i.sourceReviewId)).size;
  const maxSeverity = Math.max(...cluster.items.map((i) => (i.severity ? SEVERITY_WEIGHT[i.severity] : 1)));
  const mostRecentMs = Math.max(...cluster.items.map((i) => new Date(i.createdAt).getTime()));
  // recurrence dominates, then severity, then recency as a tiny tiebreaker
  return distinctDocs * 1_000_000 + maxSeverity * 1_000 + mostRecentMs / 1e13;
}

// ai_reviews.document_id is never written (the review flow takes pasted
// text, not a picked file — see ReviewPanel.tsx), so `kind` is the only
// document identity available today. Without this, re-analyzing the same
// deck twice would count as "2 documents" in the recurrence signal below —
// exactly backwards, since re-running a review is the workflow this whole
// tab exists to encourage. Keeping only the latest row per kind means a
// re-analysis replaces the previous one in the ranking rather than
// double-counting it; the older row stays in the table, it just stops
// contributing here.
export function latestPerKind(reviews: AiReviewRow[]): AiReviewRow[] {
  const latest = new Map<string, AiReviewRow>();
  for (const row of reviews) {
    const existing = latest.get(row.kind);
    if (!existing || row.created_at > existing.created_at) latest.set(row.kind, row);
  }
  return Array.from(latest.values());
}

export function joinNatural(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

export function extractActions(reviews: AiReviewRow[]): Action[] {
  const out: Action[] = [];
  for (const row of reviews) {
    if (!row.result) continue;
    const kindLabel = DOC_KIND_LABEL[row.kind] ?? row.kind;
    for (const w of row.result.weaknesses ?? []) {
      out.push({ text: w.text, category: w.category, type: 'weakness', severity: w.severity, sourceKind: kindLabel, sourceReviewId: row.id, createdAt: row.created_at });
    }
    for (const r of row.result.risks ?? []) {
      out.push({ text: r.text, category: r.category, type: 'risk', severity: r.severity, sourceKind: kindLabel, sourceReviewId: row.id, createdAt: row.created_at });
    }
    for (const r of row.result.recommendations ?? []) {
      out.push({ text: r.text, category: r.category, type: 'recommendation', severity: null, sourceKind: kindLabel, sourceReviewId: row.id, createdAt: row.created_at });
    }
  }
  return out;
}
