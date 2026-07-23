'use client';
// Batch 3 A — Review & Optimization (was "Company"). The Company Canon
// management moved to Settings ("Company facts"); this page CONSUMES the
// confirmed facts to help the founder improve the company: AI review of a
// draft, deck/one-pager review, the startup's own market benchmarking, and
// an investability ranking (readiness vs round value) stored per run so the
// evolution is visible. Everything here is a report — nothing is sent, and
// nothing mutates CRM data.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { authEnabled, browserClient } from '@/lib/supabase';
import { REVIEW_OPTIMIZATION_PREVIEW_COPY } from '@/lib/plans';

interface ReviewRun { id: string; score: number | null; summary: string | null; report: InvestabilityReport; created_at: string }
interface InvestabilityReport { score: number; summary: string; strengths: string[]; weaknesses: string[]; risks: string[]; recommendations: string[] }

function ComingSoon() {
  return <p className="rounded-lg bg-gray-50 px-4 py-3 text-center text-xs text-gray-400">Coming soon to your workspace.</p>;
}

export default function ReviewOptimizationPage() {
  const { db } = useStore();
  // reviewOptimization is the plan entitlement (batch A). It's false for every
  // org today (premium preview parked behind the frost) — so `locked` below is
  // effectively always true; kept entitlement-driven so lifting it later is a
  // one-line change in plans.ts with no edit here.
  const [caps, setCaps] = useState<{ ai: boolean; reviewRuns: boolean; reviewOptimization: boolean } | null>(null);

  const [draft, setDraft] = useState('');
  const [personId, setPersonId] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const [docKind, setDocKind] = useState<'deck_review' | 'one_pager_review'>('deck_review');
  const [docText, setDocText] = useState('');
  const [docResult, setDocResult] = useState('');
  const [docLoading, setDocLoading] = useState(false);

  const [marketResult, setMarketResult] = useState('');
  const [marketLoading, setMarketLoading] = useState(false);

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
    setDocLoading(true); setDocResult('');
    try {
      const res = await fetch('/api/ai-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: docKind, draft: docText }),
      });
      const data = await res.json();
      setDocResult(data.review ?? data.error ?? 'No response');
    } catch (e) { setDocResult(`Error: ${(e as Error).message}`); } finally { setDocLoading(false); }
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

  // Premium preview (batch A): default to locked until /api/me answers, so the
  // frost never flashes off for a beat on load.
  const locked = !caps || !caps.reviewOptimization;

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-bold">Review & Optimization</h1>
      <p className="text-xs text-gray-400">
        Feeds on your confirmed <b>Company facts</b> (Settings) and pipeline to help improve the company itself —
        every output is a report, never an action.
      </p>

      {/* Batch A — premium preview. `locked` is entitlement-driven (currently
          false for all plans), so the frost is shown to everyone; the built
          tool underneath stays intact for when the entitlement lifts. The
          overlay captures pointer events, so the Run action can't fire. */}
      <div className="relative">
        {locked && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/55 px-4 text-center backdrop-blur-[3px]">
            <span className="rounded-full border border-cyan-200 bg-white/90 px-4 py-1.5 text-sm font-semibold text-[#0E7490] shadow-sm">
              {REVIEW_OPTIMIZATION_PREVIEW_COPY}
            </span>
            <span className="max-w-xs text-[11px] text-gray-500">
              A leitura de investabilidade e as revisões com AI da tua empresa vão viver aqui.
            </span>
          </div>
        )}
        <div className={locked ? 'pointer-events-none select-none space-y-4 blur-[2px]' : 'space-y-4'} aria-hidden={locked}>
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

      <Card title="Deck / one-pager review">
        <p className="mb-2 text-xs text-gray-500">
          Paste the text content for a per-dimension report: problem clarity, traction evidence, number credibility,
          narrative — plus issues with severity and top rewrite suggestions. Review only.
        </p>
        {!caps?.ai ? <ComingSoon /> : (
          <>
            <select value={docKind} onChange={(e) => setDocKind(e.target.value as typeof docKind)} className="mb-2 rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="deck_review">Deck</option>
              <option value="one_pager_review">One-pager</option>
            </select>
            <textarea value={docText} onChange={(e) => setDocText(e.target.value)} rows={6}
              placeholder="Paste the deck/one-pager text content…" className="w-full rounded border border-gray-300 p-2 text-sm font-mono" />
            <button disabled={!docText || docLoading} onClick={reviewDocument}
              className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {docLoading ? 'Reviewing…' : 'Review with AI'}
            </button>
            {docResult && <pre className="mt-3 whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">{docResult}</pre>}
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
        </div>
      </div>
    </div>
  );
}
