'use client';
// Prompt 117 Bloco B — History tab. The data has always persisted (every AI
// review since Prompt 99 §3.1 writes to ai_reviews; investability runs write
// to review_runs) but there was never a UI to browse past runs as one
// chronological archive — a founder could only ever see the single latest
// investability run and whatever was still on-screen from their last paste.
//
// input_text/title/created_by/source/input_meta (migration 0112) are
// propose-only — gated by aiReviewHistoryFieldsAvailable via /api/me. Until
// Nuno applies that migration (and for every row that predates it — no
// backfill), a row's original pasted text is shown as "not recorded" rather
// than guessed at. message_review is the one kind that already had
// somewhere to put its draft (interaction_draft, pre-dates this Bloco) —
// read via coalesce(input_text, interaction_draft).
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { authEnabled, browserClient } from '@/lib/supabase';
import type { CompanyFactCategory } from '@/lib/types';
import { ReportView, type StructuredReport } from './ReportView';

type Severity = 'low' | 'medium' | 'high';
const SEVERITY_COLOR: Record<string, string> = { high: 'text-[#B00000]', medium: 'text-amber-600', low: 'text-gray-500' };

interface AiReviewRow {
  id: string; kind: string; title: string | null; created_at: string;
  input_text: string | null; interaction_draft: string | null; result: unknown;
}
interface ReviewRunRow {
  id: string; score: number | null; summary: string | null; created_at: string;
  report: { strengths: string[]; weaknesses: string[]; risks: string[]; recommendations: string[] } | null;
}

interface HistoryItem {
  key: string; created_at: string; title: string; kindLabel: string;
  originalText: string | null;
  body: React.ReactNode;
}

const KIND_LABEL: Record<string, string> = {
  deck_review: 'Pitch deck', one_pager_review: 'One-pager', business_plan_review: 'Business plan',
  financial_plan_review: 'Financial plan', marketing_plan_review: 'Commercial & marketing plan',
  cap_table_review: 'Cap table & terms', message_review: 'Outreach draft review',
  market_data: 'Market benchmark', cross_document_review: 'Cross-document check',
};
const STRUCTURED_KINDS = new Set([
  'deck_review', 'one_pager_review', 'business_plan_review',
  'financial_plan_review', 'marketing_plan_review', 'cap_table_review',
]);

function OriginalText({ text }: { text: string | null }) {
  if (!text) {
    return <p className="mt-2 text-xs italic text-gray-400">Original text not recorded (this run predates history tracking).</p>;
  }
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-gray-400">Original text</summary>
      <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-gray-200 bg-white p-2 text-xs text-gray-600">{text}</pre>
    </details>
  );
}

// Defends against real malformed rows found while building this panel: the
// model's tool_use.input occasionally doesn't conform to its own declared
// array schema (e.g. `strengths` comes back as a markdown bullet string
// instead of string[]) and /api/ai-review persists it unvalidated. This was
// always possible — History is just the first surface that ever re-renders
// a PAST result instead of only the one just-returned from a live call, so
// it's the first place it could crash a render. Flagged, not fixed at the
// source (that's a route.ts validation gap, out of this Bloco's scope).
function isRenderableReport(r: unknown): r is StructuredReport {
  const x = r as Partial<StructuredReport> | null;
  return !!x && Array.isArray(x.strengths) && Array.isArray(x.weaknesses) && Array.isArray(x.risks) && Array.isArray(x.recommendations);
}

function aiReviewToItem(row: AiReviewRow): HistoryItem {
  const kindLabel = KIND_LABEL[row.kind] ?? row.kind;
  const originalText = row.input_text ?? row.interaction_draft ?? null;
  let body: React.ReactNode;

  if (STRUCTURED_KINDS.has(row.kind)) {
    body = isRenderableReport(row.result)
      ? <ReportView report={row.result} />
      : <p className="mt-2 text-xs italic text-gray-400">This report couldn&apos;t be displayed (unexpected format from that run).</p>;
  } else if (row.kind === 'cross_document_review') {
    const raw = (row.result as { contradictions?: unknown })?.contradictions;
    const contradictions = Array.isArray(raw)
      ? raw as { text: string; category: CompanyFactCategory; severity: Severity; sideA: { quote: string }; sideB: { quote: string } }[]
      : [];
    body = contradictions.length === 0
      ? <p className="mt-2 text-xs text-gray-500">No genuine contradictions found between these two documents.</p>
      : (
        <ul className="mt-2 space-y-2">
          {contradictions.map((c, i) => (
            <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <p className="text-gray-800">{c.text}</p>
                <span className={`shrink-0 font-semibold uppercase ${SEVERITY_COLOR[c.severity]}`}>{c.severity}</span>
              </div>
            </li>
          ))}
        </ul>
      );
  } else {
    const rawReview = (row.result as { review?: unknown })?.review;
    const review = typeof rawReview === 'string' ? rawReview : '';
    body = <pre className="mt-2 whitespace-pre-wrap rounded border border-gray-200 bg-white p-2 text-xs text-gray-700">{review}</pre>;
  }

  return { key: `ai_review:${row.id}`, created_at: row.created_at, title: row.title ?? kindLabel, kindLabel, originalText, body };
}

function reviewRunToItem(row: ReviewRunRow): HistoryItem {
  const r = row.report;
  const body = (
    <div className="mt-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-xl font-bold text-[#0E7490]">{row.score}</span>
        <span className="text-xs text-gray-400">/ 100</span>
      </div>
      {row.summary && <p className="mt-1 text-gray-700">{row.summary}</p>}
      {r && (['strengths', 'weaknesses', 'risks', 'recommendations'] as const).map((k) => (
        r[k]?.length ? (
          <div key={k} className="mt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k}</div>
            <ul className="ml-4 list-disc text-xs text-gray-700">{r[k].map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        ) : null
      ))}
    </div>
  );
  return { key: `review_run:${row.id}`, created_at: row.created_at, title: 'Investability ranking', kindLabel: 'Investability ranking', originalText: null, body };
}

export function HistoryPanel() {
  const { db } = useStore();
  const [caps, setCaps] = useState<{ ai: boolean; reviewRuns: boolean } | null>(null);
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json())
      .then((me) => setCaps({ ai: !!me.capabilities?.ai, reviewRuns: !!me.capabilities?.reviewRuns }))
      .catch(() => setCaps({ ai: false, reviewRuns: false }));
  }, []);

  useEffect(() => {
    if (!authEnabled || !caps?.ai || !db.org.id) { if (caps) setItems([]); return; }
    (async () => {
      const [aiReviews, runs] = await Promise.all([
        browserClient().from('ai_reviews').select('*').eq('org_id', db.org.id)
          .order('created_at', { ascending: false }).limit(30),
        caps.reviewRuns
          ? browserClient().from('review_runs').select('id, score, summary, report, created_at').eq('org_id', db.org.id)
            .order('created_at', { ascending: false }).limit(30)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (aiReviews.error || runs.error) { setErr(aiReviews.error?.message ?? runs.error?.message ?? 'Failed to load history'); setItems([]); return; }
      const merged = [
        ...((aiReviews.data as AiReviewRow[] | null) ?? []).map(aiReviewToItem),
        ...((runs.data as ReviewRunRow[] | null) ?? []).map(reviewRunToItem),
      ].sort((a, b) => b.created_at.localeCompare(a.created_at));
      setItems(merged);
    })();
  }, [caps, db.org.id]);

  return (
    <Card title="History — every past review, one archive">
      <p className="mb-2 text-xs text-gray-500">
        Every AI review and investability run you&apos;ve ever done, newest first. Nothing here can be edited or re-sent —
        it&apos;s a read-only record.
      </p>
      {!caps ? <p className="text-sm text-gray-400">Loading…</p>
        : !caps.ai ? <p className="rounded-lg bg-gray-50 px-4 py-3 text-center text-xs text-gray-400">Coming soon to your workspace.</p>
        : err ? <p className="text-xs text-[#B00000]">{err}</p>
        : items === null ? <p className="text-sm text-gray-400">Loading…</p>
        : items.length === 0 ? <p className="text-xs text-gray-500">No reviews yet — run one from the Review tab and it will show up here.</p>
        : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.key} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <details>
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium text-gray-800">{it.title}</span>
                    <span className="ml-2 text-xs text-gray-400">{it.kindLabel} · {it.created_at.slice(0, 10)}</span>
                  </summary>
                  {it.body}
                  <OriginalText text={it.originalText} />
                </details>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}
