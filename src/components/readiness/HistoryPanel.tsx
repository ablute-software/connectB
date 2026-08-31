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
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { can, type OrgRole } from '@/lib/permissions';
import { Card } from '@/components/ui';
import { authEnabled, browserClient } from '@/lib/supabase';
import { ReviewResultBody } from './ReviewResultBody';
import { ClarificationBullet } from './ClarificationBullet';
import { clarificationsByKey, clarificationKey, upsertClarification, type ReviewCategory, type ReviewClarification } from '@/lib/review-clarifications';
import { splitFundraisingExecution } from '@/lib/founder-report-split';

interface AiReviewRow {
  id: string; kind: string; title: string | null; created_at: string;
  input_text: string | null; interaction_draft: string | null; result: unknown;
}
interface ReviewRunRow {
  id: string; score: number | null; summary: string | null; created_at: string;
  // Prompt 166 §A — opportunities/threats added; optional since runs from
  // before that prompt won't have them (report[k]?.length below already
  // handles absence the same way it always has for any empty/missing key).
  report: { strengths: string[]; weaknesses: string[]; opportunities?: string[]; threats?: string[]; risks: string[]; recommendations: string[] } | null;
}

interface HistoryItem {
  key: string; reportHref: string; created_at: string; title: string; kindLabel: string;
  originalText: string | null;
  body: React.ReactNode;
  // Prompt 503 §2 — de onde a linha veio, para o Delete saber o que apagar.
  table: 'ai_reviews' | 'review_runs'; id: string;
}

export const KIND_LABEL: Record<string, string> = {
  deck_review: 'Pitch deck', one_pager_review: 'One-pager', business_plan_review: 'Business plan',
  financial_plan_review: 'Financial plan', marketing_plan_review: 'Commercial & marketing plan',
  cap_table_review: 'Cap table & terms', message_review: 'Outreach draft review',
  market_data: 'Market benchmark', cross_document_review: 'Cross-document check',
};

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

function aiReviewToItem(row: AiReviewRow): HistoryItem {
  const kindLabel = KIND_LABEL[row.kind] ?? row.kind;
  const originalText = row.input_text ?? row.interaction_draft ?? null;
  return {
    key: `ai_review:${row.id}`, table: 'ai_reviews', id: row.id, reportHref: `/readiness/report/${row.id}?type=ai_review`,
    created_at: row.created_at, title: row.title ?? kindLabel, kindLabel, originalText,
    body: <ReviewResultBody kind={row.kind} result={row.result} />,
  };
}

// Prompt 168 §B — "any visible run" includes every row History renders, not
// just the latest — orgId/clarifications/onSaved come from the panel below
// so the same lookup + local-state update ClarificationBullet relies on
// stays in one place, not duplicated per row.
function reviewRunToItem(
  row: ReviewRunRow, orgId: string,
  clarifications: Map<string, ReviewClarification> | null, onSaved: (c: ReviewClarification) => void,
): HistoryItem {
  const r = row.report;
  const body = (
    <div className="mt-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-xl font-bold text-[#0E7490]">{row.score}</span>
        <span className="text-xs text-gray-400">/ 100</span>
      </div>
      {row.summary && <p className="mt-1 text-gray-700">{row.summary}</p>}
      {r && (['strengths', 'weaknesses', 'opportunities', 'threats', 'risks', 'recommendations'] as const).flatMap((k) => {
        // Prompt 220 §D — o mesmo split do ReviewPanel, aplicado ao arquivo:
        // bullets de execução de angariação saem das weaknesses para uma
        // secção própria. Índices ORIGINAIS preservados — as clarifications
        // são keyed por item_index no array completo, e a chave não muda
        // por o bullet mudar de secção.
        if (k === 'weaknesses') {
          const { business, execution } = splitFundraisingExecution(r.weaknesses ?? []);
          return [
            { key: 'weaknesses', label: 'weaknesses', category: 'weaknesses' as ReviewCategory, items: business },
            { key: 'fundraising-execution', label: 'fundraising execution (internal)', category: 'weaknesses' as ReviewCategory, items: execution },
          ];
        }
        return [{ key: k, label: k, category: k as ReviewCategory, items: (r[k] ?? []).map((text, index) => ({ text, index })) }];
      }).map((sec) => (
        sec.items.length ? (
          <div key={sec.key} className="mt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{sec.label}</div>
            <ul className="ml-4 list-disc text-xs text-gray-700">
              {sec.items.map((b) => (
                <li key={b.index}>
                  {b.text}
                  {clarifications && (
                    <ClarificationBullet
                      orgId={orgId} reviewRunId={row.id} category={sec.category} itemIndex={b.index} itemText={b.text}
                      existing={clarifications.get(clarificationKey(row.id, sec.category, b.index)) ?? null}
                      onSaved={onSaved}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null
      ))}
    </div>
  );
  return {
    key: `review_run:${row.id}`, table: 'review_runs', id: row.id, reportHref: `/readiness/report/${row.id}?type=review_run`,
    created_at: row.created_at, title: 'Investability ranking', kindLabel: 'Investability ranking', originalText: null, body,
  };
}

export function HistoryPanel() {
  const { db } = useStore();
  const [caps, setCaps] = useState<{ ai: boolean; reviewRuns: boolean; reviewClarifications: boolean } | null>(null);
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [err, setErr] = useState('');
  const [clarifications, setClarifications] = useState<ReviewClarification[]>([]);
  // Prompt 503 §2 — o mesmo `orgRole` que /api/me já devolve e que outros
  // gates deste código já lêem; a decisão de quem pode vive na matriz de
  // permissions.ts, não num literal aqui.
  const [orgRole, setOrgRole] = useState<OrgRole | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [delErr, setDelErr] = useState('');

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json())
      .then((me) => {
        setCaps({ ai: !!me.capabilities?.ai, reviewRuns: !!me.capabilities?.reviewRuns, reviewClarifications: !!me.capabilities?.reviewClarifications });
        setOrgRole((me.orgRole as OrgRole | null) ?? null);
      })
      .catch(() => setCaps({ ai: false, reviewRuns: false, reviewClarifications: false }));
  }, []);

  const canDelete = can(orgRole, 'delete_review_history');

  async function deleteEntry(it: HistoryItem) {
    // Apagar é permanente (hard delete — ver a rota) e não há undo, por isso
    // uma confirmação explícita antes, não um clique só.
    if (!window.confirm(`Delete “${it.title}” permanently? This cannot be undone.`)) return;
    setDelErr(''); setDeleting(it.key);
    try {
      const res = await fetch('/api/readiness/history', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ table: it.table, id: it.id }),
      });
      const body = await res.json().catch(() => null);
      if (!body?.ok) { setDelErr(body?.error ?? 'Could not delete this entry.'); return; }
      // Removido localmente em vez de refazer as duas queries: a linha já não
      // existe, e um refetch aqui recarregaria 60 linhas para tirar uma.
      setItems((prev) => (prev ?? []).filter((x) => x.key !== it.key));
    } catch {
      setDelErr('Could not delete this entry — check your connection and try again.');
    } finally { setDeleting(null); }
  }

  useEffect(() => {
    if (!authEnabled || !caps?.reviewClarifications || !db.org.id) return;
    browserClient().from('review_clarifications').select('*')
      .eq('org_id', db.org.id).order('created_at', { ascending: false })
      .then(({ data }) => setClarifications((data as ReviewClarification[] | null) ?? []));
  }, [caps?.reviewClarifications, db.org.id]);

  function handleClarificationSaved(c: ReviewClarification) {
    setClarifications((prev) => upsertClarification(prev, c));
  }

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
      // Rebuilt from the `clarifications` array (a stable reference until a
      // save updates it), never from a freshly-allocated Map in a dep array
      // — that would re-run this fetch on every render.
      const clarificationMap = caps.reviewClarifications ? clarificationsByKey(clarifications) : null;
      const merged = [
        ...((aiReviews.data as AiReviewRow[] | null) ?? []).map(aiReviewToItem),
        ...((runs.data as ReviewRunRow[] | null) ?? []).map((row) => reviewRunToItem(row, db.org.id, clarificationMap, handleClarificationSaved)),
      ].sort((a, b) => b.created_at.localeCompare(a.created_at));
      setItems(merged);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caps, db.org.id, clarifications]);

  return (
    <Card title="History — every past review, one archive">
      <p className="mb-2 text-xs text-gray-500">
        Every AI review and investability run you&apos;ve ever done, newest first. Nothing here can be edited or re-sent.
        {canDelete && ' As the account owner or an admin, you can delete an entry — that is permanent.'}
      </p>
      {delErr && <p className="mb-2 text-xs text-[#B00000]">{delErr}</p>}
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
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <Link href={it.reportHref} target="_blank" className="text-xs font-medium text-[#0E7490] hover:underline">
                      Open full report (print / share) ↗
                    </Link>
                    {/* §2 — só visível a owner/admin, mas o gate a sério é
                        server-side (/api/readiness/history): esconder o botão
                        é conveniência, não segurança. */}
                    {canDelete && (
                      <button onClick={() => deleteEntry(it)} disabled={deleting === it.key}
                        className="text-xs text-gray-400 hover:text-[#B00000] hover:underline disabled:opacity-40">
                        {deleting === it.key ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}
