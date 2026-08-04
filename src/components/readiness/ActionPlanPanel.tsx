'use client';
// Readiness & Train — Action plan sub-tab (Prompt 115 Block C). Read-only
// aggregation over ai_reviews: every weakness/risk/recommendation from every
// structured document review, clustered by text similarity (Jaccard ≥0.6)
// so the same underlying issue raised by two different documents shows once
// with an "appears in your Deck and your Financial plan" note instead of
// twice. Ordered by recurrence-across-documents first, then severity, then
// recency — the point is "what to fix first", not a raw dump of every AI
// review.
//
// Recurrence is measured per document TYPE (`kind`), not per review row —
// see the note on latestPerKind() in lib/action-plan.ts. ai_reviews has no
// document_id (the review flow takes pasted text, not a picked file), so
// `kind` is the only document identity available until documents are linked
// to reviews; re-analyzing the same deck replaces its prior contribution to
// the ranking instead of counting as a second document.
//
// Contradictions come from Block D's cross_document_review kind (dual
// citation: sideA/sideB, each a {kind, quote}) — that kind doesn't exist
// yet, so the section renders empty rather than fabricated until Block D
// wires it in. Nothing here mutates CRM data or sends anything; every
// output is a report, same guardrail as the Review tab.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { authEnabled, browserClient } from '@/lib/supabase';
import type { CompanyFactCategory } from '@/lib/types';
import {
  DOC_KIND_LABEL, SEVERITY_WEIGHT, dataroomChecklist, clusterActions, clusterPriority, extractActions, latestPerKind, joinNatural,
  type Severity, type AiReviewRow, type ActionCluster,
} from '@/lib/action-plan';

interface ReviewRunRow { id: string; score: number | null; created_at: string }

interface Contradiction {
  text: string; category: CompanyFactCategory; severity: Severity;
  sideA: { kind: string; quote: string }; sideB: { kind: string; quote: string };
}

const TYPE_LABEL: Record<'weakness' | 'risk' | 'recommendation', string> = { weakness: 'Weakness', risk: 'Risk', recommendation: 'Recommendation' };
const SEVERITY_COLOR: Record<Severity, string> = { high: 'text-[#B00000]', medium: 'text-amber-600', low: 'text-gray-500' };

function ClusterRow({ cluster }: { cluster: ActionCluster }) {
  const lead = cluster.items[0];
  const distinctDocs = Array.from(new Set(cluster.items.map((i) => i.sourceKind)));
  const worstSeverity = cluster.items.reduce<Severity | null>((worst, i) => {
    if (!i.severity) return worst;
    if (!worst || SEVERITY_WEIGHT[i.severity] > SEVERITY_WEIGHT[worst]) return i.severity;
    return worst;
  }, null);
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-gray-800">{lead.text}</p>
        {worstSeverity && <span className={`shrink-0 text-xs font-semibold uppercase ${SEVERITY_COLOR[worstSeverity]}`}>{worstSeverity}</span>}
      </div>
      <p className="mt-1 text-xs text-gray-400">
        {TYPE_LABEL[lead.type]} · {lead.category}
        {distinctDocs.length > 1 ? ` · appears in ${joinNatural(distinctDocs)}` : ` · from ${distinctDocs[0]}`}
      </p>
    </li>
  );
}

function InvestabilityChart({ runs }: { runs: ReviewRunRow[] }) {
  const points = runs.filter((r): r is ReviewRunRow & { score: number } => r.score != null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (points.length < 2) {
    return <p className="text-xs text-gray-400">Run at least 2 investability reviews (Review tab) to see a trend here.</p>;
  }
  const W = 560, H = 120, PAD = 24;
  const xStep = (W - 2 * PAD) / (points.length - 1);
  const xs = points.map((_, i) => PAD + i * xStep);
  const ys = points.map((p) => H - PAD - (p.score / 100) * (H - 2 * PAD));
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x},${ys[i]}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Investability score over time">
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#E5E7EB" strokeWidth={1} />
      <path d={path} fill="none" stroke="#0E7490" strokeWidth={2} />
      {xs.map((x, i) => (
        <g key={points[i].id}>
          <circle cx={x} cy={ys[i]} r={3} fill="#0E7490" />
          <text x={x} y={H - 6} fontSize={9} textAnchor="middle" fill="#9CA3AF">{points[i].created_at.slice(5, 10)}</text>
        </g>
      ))}
    </svg>
  );
}

export function ActionPlanPanel() {
  const { db } = useStore();
  const [reviews, setReviews] = useState<AiReviewRow[]>([]);
  const [runs, setRuns] = useState<ReviewRunRow[]>([]);
  // Block D populates this once cross_document_review exists — see the note
  // in the effect below.
  const contradictions: Contradiction[] = [];
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authEnabled || !db.org.id) { setLoading(false); return; }
    // `cross_document_review` isn't a valid ai_review_kind value yet — that
    // enum member is Block D's migration. Filtering on it before Block D
    // lands would 400 (invalid enum literal), so contradictions stays empty
    // here on purpose; Block D adds the query alongside the schema change.
    Promise.all([
      browserClient().from('ai_reviews').select('id, kind, result, created_at')
        .eq('org_id', db.org.id).eq('status', 'completed')
        .in('kind', Object.keys(DOC_KIND_LABEL))
        .order('created_at', { ascending: false }),
      browserClient().from('review_runs').select('id, score, created_at')
        .eq('org_id', db.org.id).order('created_at', { ascending: false }).limit(30),
    ]).then(([reviewsRes, runsRes]) => {
      setReviews(latestPerKind((reviewsRes.data as AiReviewRow[] | null) ?? []));
      setRuns((runsRes.data as ReviewRunRow[] | null) ?? []);
      setLoading(false);
    });
  }, [db.org.id]);

  const actions = extractActions(reviews);
  const clusters = clusterActions(actions).sort((a, b) => clusterPriority(b) - clusterPriority(a));
  const top5 = clusters.slice(0, 5);
  const rest = clusters.slice(5);

  const checklist = dataroomChecklist(db.folders, db.documents);
  const missingCount = checklist.filter((c) => !c.present).length;

  if (loading) return <Card title="Action plan"><p className="text-sm text-gray-400">Loading…</p></Card>;

  return (
    <>
      <Card title="Action plan">
        {clusters.length === 0 ? (
          <p className="text-xs text-gray-500">
            No document reviews yet — run one or two in the Review tab and the priority actions that come out of them
            will show up here as a single ranked list, deduplicated across documents.
          </p>
        ) : (
          <>
            <p className="text-xs text-gray-500">
              {clusters.length} distinct {clusters.length === 1 ? 'item' : 'items'} from {reviews.length} document{reviews.length === 1 ? '' : 's'}{' '}
              reviewed, ranked by how often the same issue shows up across documents, then by severity.
            </p>
            <p className="mt-1 text-[11px] text-gray-400">
              Recurrence is measured per document type today (e.g. your Deck vs your Financial plan) — re-analyzing
              the same document type replaces its previous run here rather than counting as a second document. This
              becomes per-document once reviews are linked to a specific file in the Vault.
            </p>
          </>
        )}
      </Card>

      {contradictions.length > 0 && (
        <Card title="Contradictions between documents">
          <ul className="space-y-3">
            {contradictions.map((c, i) => (
              <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-gray-800">{c.text}</p>
                  <span className={`shrink-0 text-xs font-semibold uppercase ${SEVERITY_COLOR[c.severity]}`}>{c.severity}</span>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="rounded border border-amber-200 bg-white p-2 text-xs">
                    <div className="font-semibold text-gray-500">{DOC_KIND_LABEL[c.sideA.kind] ?? c.sideA.kind}</div>
                    <div className="mt-0.5 text-gray-700">&ldquo;{c.sideA.quote}&rdquo;</div>
                  </div>
                  <div className="rounded border border-amber-200 bg-white p-2 text-xs">
                    <div className="font-semibold text-gray-500">{DOC_KIND_LABEL[c.sideB.kind] ?? c.sideB.kind}</div>
                    <div className="mt-0.5 text-gray-700">&ldquo;{c.sideB.quote}&rdquo;</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {top5.length > 0 && (
        <Card title="Top priorities">
          <ul className="space-y-2">
            {top5.map((cluster, i) => <ClusterRow key={i} cluster={cluster} />)}
          </ul>
          {rest.length > 0 && (
            <details className="mt-2" open={showAll} onToggle={(e) => setShowAll((e.target as HTMLDetailsElement).open)}>
              <summary className="cursor-pointer text-xs text-gray-400">Show all {clusters.length} ({rest.length} more)</summary>
              <ul className="mt-2 space-y-2">
                {rest.map((cluster, i) => <ClusterRow key={i} cluster={cluster} />)}
              </ul>
            </details>
          )}
        </Card>
      )}

      <Card title="Data Room completeness">
        <p className="mb-2 text-xs text-gray-500">
          No AI, just a structural check against a standard due-diligence checklist — the same "how complete is your
          profile/data room" signal the Hype Startup formula uses, but with the concrete list of what to add.
        </p>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">{checklist.length - missingCount} of {checklist.length} present</p>
        </div>
        <ul className="mt-2 space-y-1">
          {checklist.map((c) => (
            <li key={c.label} className={`text-xs ${c.present ? 'text-emerald-700' : 'text-gray-400'}`}>
              {c.present ? '✓' : '·'} {c.label}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Investability over time">
        <InvestabilityChart runs={runs} />
      </Card>
    </>
  );
}
