'use client';
// Readiness & Train — Review sub-tab. Moved from the former Dashboard
// panel's original Portuguese-named sub-tab component (Prompt 115 Block B):
// AI review of a draft, deck/one-pager/etc. review, market benchmarking, and
// an investability ranking (readiness vs round value) stored per run. The
// Data Room completeness checklist that used to live here moved to the
// Action plan sub-tab (Block C) — it belongs next to the priority list it
// feeds. Everything here is a report — nothing is sent, and nothing mutates
// CRM data.
//
// Prompt 99 — this sub-tab covers all 6 paste-text-and-review kinds with one
// dropdown, since /api/ai-review returns a structured report
// (score/strengths/weaknesses/risks/recommendations) for every one of them,
// not just investability.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { authEnabled, browserClient } from '@/lib/supabase';
import type { CompanyFactCategory } from '@/lib/types';
import type { Contradiction } from '@/lib/action-plan';

interface ReviewRun { id: string; score: number | null; summary: string | null; report: InvestabilityReport; created_at: string }
interface InvestabilityReport { score: number; summary: string; strengths: string[]; weaknesses: string[]; risks: string[]; recommendations: string[] }

interface Finding { text: string; category: CompanyFactCategory }
interface SeverityFinding extends Finding { severity: 'low' | 'medium' | 'high' }
interface StructuredReport {
  score: number; summary: string;
  strengths: string[]; weaknesses: SeverityFinding[]; risks: SeverityFinding[]; recommendations: Finding[];
}

const DOC_KINDS = [
  { value: 'deck_review', label: 'Pitch deck' },
  { value: 'one_pager_review', label: 'One-pager' },
  { value: 'business_plan_review', label: 'Business plan' },
  { value: 'financial_plan_review', label: 'Financial plan' },
  { value: 'marketing_plan_review', label: 'Commercial & marketing plan' },
  { value: 'cap_table_review', label: 'Cap table & terms (quick read)' },
] as const;
type DocKind = typeof DOC_KINDS[number]['value'];

const SEVERITY_COLOR: Record<string, string> = { high: 'text-[#B00000]', medium: 'text-amber-600', low: 'text-gray-500' };

function ComingSoon() {
  return <p className="rounded-lg bg-gray-50 px-4 py-3 text-center text-xs text-gray-400">Coming soon to your workspace.</p>;
}

function StructuredReportView({ report }: { report: StructuredReport }) {
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold text-[#0E7490]">{report.score}</span>
        <span className="text-xs text-gray-400">/ 10</span>
      </div>
      <p className="mt-1 text-gray-700">{report.summary}</p>
      {report.strengths.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Strengths</div>
          <ul className="ml-4 list-disc text-xs text-gray-700">{report.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
      {(['weaknesses', 'risks'] as const).map((k) => (
        report[k].length > 0 && (
          <div key={k} className="mt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k}</div>
            <ul className="ml-4 list-disc text-xs text-gray-700">
              {report[k].map((f, i) => (
                <li key={i}>
                  <span className={SEVERITY_COLOR[f.severity]}>[{f.severity}]</span> {f.text}
                  <span className="ml-1 text-gray-400">· {f.category}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      ))}
      {report.recommendations.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recommendations</div>
          <ul className="ml-4 list-disc text-xs text-gray-700">
            {report.recommendations.map((f, i) => <li key={i}>{f.text} <span className="text-gray-400">· {f.category}</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ReviewPanel() {
  const { db } = useStore();
  const [caps, setCaps] = useState<{ ai: boolean; reviewRuns: boolean; reviewOptimization: boolean } | null>(null);

  const [draft, setDraft] = useState('');
  const [personId, setPersonId] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const [docKind, setDocKind] = useState<DocKind>('deck_review');
  const [docText, setDocText] = useState('');
  const [docResult, setDocResult] = useState<StructuredReport | null>(null);
  const [docErr, setDocErr] = useState('');
  const [docLoading, setDocLoading] = useState(false);

  const [marketResult, setMarketResult] = useState('');
  const [marketLoading, setMarketLoading] = useState(false);

  const [crossKindA, setCrossKindA] = useState<DocKind>('deck_review');
  const [crossTextA, setCrossTextA] = useState('');
  const [crossKindB, setCrossKindB] = useState<DocKind>('financial_plan_review');
  const [crossTextB, setCrossTextB] = useState('');
  const [crossResult, setCrossResult] = useState<Contradiction[] | null>(null);
  const [crossErr, setCrossErr] = useState('');
  const [crossLoading, setCrossLoading] = useState(false);

  const [runs, setRuns] = useState<ReviewRun[]>([]);
  const [runLoading, setRunLoading] = useState(false);
  const [runErr, setRunErr] = useState('');

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json())
      .then((me) => setCaps({ ai: !!me.capabilities?.ai, reviewRuns: !!me.capabilities?.reviewRuns, reviewOptimization: !!me.entitlements?.reviewOptimization }))
      .catch(() => setCaps({ ai: false, reviewRuns: false, reviewOptimization: false }));
  }, []);

  useEffect(() => {
    if (!authEnabled || !caps?.reviewRuns || !db.org.id) return;
    browserClient().from('review_runs').select('id, score, summary, report, created_at')
      .eq('org_id', db.org.id).order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => setRuns((data as ReviewRun[] | null) ?? []));
  }, [caps?.reviewRuns, db.org.id]);

  const confirmedFacts = db.companyFacts.filter((f) => f.status === 'confirmed').map((f) => f.statement);
  const companyContext = {
    name: db.org.name, sector: db.org.sector, stage: db.org.stage,
    round_target_eur: db.org.round_target_eur, country: db.org.country, one_liner: db.org.one_liner,
  };

  function pipelineStats() {
    const byStatus: Record<string, number> = {};
    for (const e of db.entities) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    const passes = db.interactions.filter((i) => i.classification === 'pass').length;
    const interest = db.entities.reduce((s, e) => s + (e.interest_eur ?? 0), 0);
    return { total_investors: db.entities.length, by_status: byStatus, passes, soft_circled_eur: interest };
  }

  async function reviewMessage() {
    setAiLoading(true); setAiResult('');
    const person = db.people.find((p) => p.id === personId);
    const entity = person && db.entities.find((e) => e.id === person.entity_id);
    try {
      const res = await fetch('/api/ai-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'message_review', draft,
          context: person && entity ? {
            person: person.full_name, role: person.role, hook: person.hook,
            kill_words: person.kill_words, watch_outs: person.watch_outs,
            entity: entity.name, thesis: entity.thesis, the_ask: entity.the_ask,
          } : undefined,
        }),
      });
      const data = await res.json();
      setAiResult(data.review ?? data.error ?? 'No response');
    } catch (e) { setAiResult(`Error: ${(e as Error).message}`); } finally { setAiLoading(false); }
  }

  async function reviewDocument() {
    setDocLoading(true); setDocResult(null); setDocErr('');
    try {
      const res = await fetch('/api/ai-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: docKind, draft: docText, context: companyContext }),
      });
      const data = await res.json();
      if (data.error) { setDocErr(data.error); return; }
      if (data.review) { setDocErr(data.review); return; } // configured:false fallback text
      setDocResult(data.report as StructuredReport);
    } catch (e) { setDocErr((e as Error).message); } finally { setDocLoading(false); }
  }

  async function researchMarket() {
    setMarketLoading(true); setMarketResult('');
    try {
      const res = await fetch('/api/ai-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'market_data', context: { ...companyContext, facts: confirmedFacts } }),
      });
      const data = await res.json();
      setMarketResult(data.review ?? data.error ?? 'No response');
    } catch (e) { setMarketResult(`Error: ${(e as Error).message}`); } finally { setMarketLoading(false); }
  }

  async function checkCrossDocument() {
    setCrossLoading(true); setCrossResult(null); setCrossErr('');
    try {
      const res = await fetch('/api/ai-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'cross_document_review',
          kindA: crossKindA, draftA: crossTextA, kindB: crossKindB, draftB: crossTextB,
        }),
      });
      const data = await res.json();
      if (data.error) { setCrossErr(data.error); return; }
      if (data.review) { setCrossErr(data.review); return; } // configured:false fallback text
      setCrossResult(data.contradictions as Contradiction[]);
    } catch (e) { setCrossErr((e as Error).message); } finally { setCrossLoading(false); }
  }

  async function runInvestability() {
    setRunLoading(true); setRunErr('');
    try {
      const res = await fetch('/api/review/investability', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facts: confirmedFacts, pipeline: pipelineStats(), company: companyContext }),
      });
      const data = await res.json();
      if (!data.ok) { setRunErr(data.error ?? data.message ?? 'Failed'); return; }
      setRuns((prev) => [data.run, ...prev]);
    } catch (e) { setRunErr((e as Error).message); } finally { setRunLoading(false); }
  }

  const latest = runs[0];

  return (
    <>
      <Card title="Investability ranking — readiness vs round value">
        <p className="mb-2 text-xs text-gray-500">
          Consumes your confirmed canon facts + pipeline stats and returns a score with concrete strengths, weaknesses,
          risks and recommendations. Each run is stored so you can watch it improve as you add facts and close conversations.
        </p>
        {!caps ? <p className="text-sm text-gray-400">Loading…</p>
          : !caps.reviewRuns || !caps.ai ? <ComingSoon />
          : (
            <>
              <button disabled={runLoading} onClick={runInvestability}
                className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                {runLoading ? 'Running…' : 'Run review'}
              </button>
              {runErr && <p className="mt-2 text-xs text-[#B00000]">{runErr}</p>}
              {latest && (
                <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-[#0E7490]">{latest.score}</span>
                    <span className="text-xs text-gray-400">/ 100 · {latest.created_at.slice(0, 10)}</span>
                  </div>
                  {latest.summary && <p className="mt-1 text-gray-700">{latest.summary}</p>}
                  {(['strengths', 'weaknesses', 'risks', 'recommendations'] as const).map((k) => (
                    latest.report?.[k]?.length ? (
                      <div key={k} className="mt-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k}</div>
                        <ul className="ml-4 list-disc text-xs text-gray-700">{latest.report[k].map((x, i) => <li key={i}>{x}</li>)}</ul>
                      </div>
                    ) : null
                  ))}
                </div>
              )}
              {runs.length > 1 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-gray-400">History ({runs.length - 1} earlier)</summary>
                  <ul className="mt-1 space-y-1 text-xs text-gray-600">
                    {runs.slice(1).map((r) => <li key={r.id}>{r.created_at.slice(0, 10)} — score {r.score}{r.summary ? ` · ${r.summary}` : ''}</li>)}
                  </ul>
                </details>
              )}
            </>
          )}
      </Card>

      <Card title="AI Review — second opinion on a draft">
        <p className="mb-2 text-xs text-gray-500">
          Beyond the mechanical linter: tone, hook strength, investor fit — using your CRM context (thesis, kill words,
          watch-outs) as grounding. The AI never sends anything and never edits your data.
        </p>
        {!caps?.ai ? <ComingSoon /> : (
          <>
            <select value={personId} onChange={(e) => setPersonId(e.target.value)} className="mb-2 rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">Reviewing for… (person)</option>
              {db.people.map((p) => <option key={p.id} value={p.id}>{p.full_name} — {db.entities.find((e) => e.id === p.entity_id)?.name}</option>)}
            </select>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5}
              placeholder="Paste the draft to review…" className="w-full rounded border border-gray-300 p-2 text-sm font-mono" />
            <button disabled={!draft || aiLoading} onClick={reviewMessage}
              className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {aiLoading ? 'Reviewing…' : 'Review with AI'}
            </button>
            {aiResult && <pre className="mt-3 whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">{aiResult}</pre>}
          </>
        )}
      </Card>

      <Card title="Document reviews">
        <p className="mb-2 text-xs text-gray-500">
          Paste the text content of any of these for an investor-lens structured report, calibrated to your stage
          ({db.org.stage ?? 'stage not set'}). Review only — nothing is sent or changed.
        </p>
        {!caps?.ai ? <ComingSoon /> : (
          <>
            <select value={docKind} onChange={(e) => setDocKind(e.target.value as DocKind)} className="mb-2 rounded border border-gray-300 px-2 py-1.5 text-sm">
              {DOC_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <textarea value={docText} onChange={(e) => setDocText(e.target.value)} rows={6}
              placeholder="Paste the document text content…" className="w-full rounded border border-gray-300 p-2 text-sm font-mono" />
            <button disabled={!docText || docLoading} onClick={reviewDocument}
              className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {docLoading ? 'Reviewing…' : 'Review with AI'}
            </button>
            {docErr && <p className="mt-2 text-xs text-[#B00000]">{docErr}</p>}
            {docResult && <StructuredReportView report={docResult} />}
          </>
        )}
      </Card>

      <Card title="Cross-document check — find contradictions">
        <p className="mb-2 text-xs text-gray-500">
          Paste two different documents (e.g. your business plan and your financial plan) and the AI flags only genuine
          contradictions — each backed by an exact quote from both sides. Feeds the Contradictions section in Action plan.
        </p>
        {!caps?.ai ? <ComingSoon /> : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <select value={crossKindA} onChange={(e) => setCrossKindA(e.target.value as DocKind)}
                  className="mb-2 w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                  {DOC_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <textarea value={crossTextA} onChange={(e) => setCrossTextA(e.target.value)} rows={6}
                  placeholder="Paste Document A…" className="w-full rounded border border-gray-300 p-2 text-sm font-mono" />
              </div>
              <div>
                <select value={crossKindB} onChange={(e) => setCrossKindB(e.target.value as DocKind)}
                  className="mb-2 w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                  {DOC_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <textarea value={crossTextB} onChange={(e) => setCrossTextB(e.target.value)} rows={6}
                  placeholder="Paste Document B…" className="w-full rounded border border-gray-300 p-2 text-sm font-mono" />
              </div>
            </div>
            {crossKindA === crossKindB && (
              <p className="mt-2 text-xs text-amber-600">Pick two different document types — comparing a document to itself isn&apos;t a real contradiction.</p>
            )}
            <button disabled={!crossTextA || !crossTextB || crossKindA === crossKindB || crossLoading} onClick={checkCrossDocument}
              className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {crossLoading ? 'Checking…' : 'Check for contradictions'}
            </button>
            {crossErr && <p className="mt-2 text-xs text-[#B00000]">{crossErr}</p>}
            {crossResult && (
              crossResult.length === 0 ? (
                <p className="mt-3 text-xs text-gray-500">No genuine contradictions found between these two documents.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {crossResult.map((c, i) => (
                    <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-gray-800">{c.text}</p>
                        <span className={`shrink-0 text-xs font-semibold uppercase ${SEVERITY_COLOR[c.severity]}`}>{c.severity}</span>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div className="rounded border border-amber-200 bg-white p-2 text-xs text-gray-700">&ldquo;{c.sideA.quote}&rdquo;</div>
                        <div className="rounded border border-amber-200 bg-white p-2 text-xs text-gray-700">&ldquo;{c.sideB.quote}&rdquo;</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            )}
          </>
        )}
      </Card>

      <Card title="Market data — your sector">
        <p className="mb-2 text-xs text-gray-500">
          Benchmarks YOUR OWN market/sector: size and direction, where a company at your stage typically sits, the metrics
          investors in this space benchmark on, and comparable companies. Every item is marked for verification; specifics
          are never invented. Grounded on your company facts.
        </p>
        {!caps?.ai ? <ComingSoon /> : (
          <>
            <button disabled={marketLoading} onClick={researchMarket}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {marketLoading ? 'Researching…' : 'Benchmark my market'}
            </button>
            {marketResult && <pre className="mt-3 whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">{marketResult}</pre>}
          </>
        )}
      </Card>
    </>
  );
}
