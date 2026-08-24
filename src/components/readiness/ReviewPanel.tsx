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
import { Card, Toggle } from '@/components/ui';
import { softCircledThisRound } from '@/lib/round-capital';
import { authEnabled, browserClient } from '@/lib/supabase';
import type { Contradiction } from '@/lib/action-plan';
import { ReportView, type StructuredReport } from './ReportView';
import { GapInterrogation, type GapView } from './GapInterrogation';
import { KnowledgeHealthPanel } from './KnowledgeHealthPanel';
import { StrengthenClaimsPanel } from './StrengthenClaimsPanel';
import { pickCurrentGap } from '@/lib/gap-rotation';
import { GAP_QUESTION_BUDGET } from '@/lib/company-gaps';
import { PlanBadge } from '@/components/PlanBadge';
import { planName, REVIEW_OPTIMIZATION_PREVIEW_COPY } from '@/lib/plans';
import { can, type OrgRole } from '@/lib/permissions';
import { SwotVisualCard } from './SwotVisualCard';
import { ClarificationBullet } from './ClarificationBullet';
import type { SwotData, CompanyClaim } from '@/lib/types';
import { clarificationsByKey, clarificationKey, upsertClarification, type ReviewClarification } from '@/lib/review-clarifications';
import { splitFundraisingExecution } from '@/lib/founder-report-split';
import { InvestorFeedbackCard } from './InvestorFeedbackCard';

interface ReviewRun { id: string; score: number | null; summary: string | null; report: InvestabilityReport; created_at: string }
interface InvestabilityReport extends SwotData { score: number; summary: string; risks: string[]; recommendations: string[] }

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

// Prompt 117 Bloco D — parked, not deleted: this card reviews a message
// draft against one specific person's CRM context (kill words, watch-outs),
// which doesn't fit the founder-facing Readiness surface it currently sits
// on. State/handler/API branch (message_review) stay intact for a future
// networking/advisor-facing surface where reviewing a draft against a
// specific person is the right shape again.
const SHOW_DRAFT_REVIEW_CARD = false;

function ComingSoon() {
  return <p className="rounded-lg bg-gray-50 px-4 py-3 text-center text-xs text-gray-400">Coming soon to your workspace.</p>;
}

// Prompt 117 Bloco G — UI half of the gate; /api/ai-review enforces the same
// check server-side with a real 403, so this is display-truth, not the
// enforcement point.
function TopTierLocked() {
  return (
    <p className="rounded-lg bg-gray-50 px-4 py-3 text-center text-xs text-gray-400">
      Available on the {planName('motherfunding')} plan.
    </p>
  );
}

interface ReviewQuota { quota: number; used: number; remaining: number; resetsAt: string }

export function ReviewPanel() {
  const { db, updateOrg } = useStore();
  const [caps, setCaps] = useState<{
    ai: boolean; reviewRuns: boolean; reviewOptimization: boolean; reviewTopTierTools: boolean; reviewClarifications: boolean;
    orgRole: OrgRole | null; reviewQuota: ReviewQuota | null;
  } | null>(null);

  const [draft, setDraft] = useState('');
  const [personId, setPersonId] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const [docKind, setDocKind] = useState<DocKind>('deck_review');
  const [docText, setDocText] = useState('');
  const [docResult, setDocResult] = useState<StructuredReport | null>(null);
  const [docErr, setDocErr] = useState('');
  const [docLoading, setDocLoading] = useState(false);
  // Prompt 302 §2 — which real Vault document this review is about, so the
  // Action Plan can later point back at it. Optional: a founder can still
  // paste text with no file picked, same as before this prompt.
  const [docVaultId, setDocVaultId] = useState('');

  const [marketResult, setMarketResult] = useState('');
  const [marketLoading, setMarketLoading] = useState(false);

  // Prompt 360 Part B — two real Vault documents, never pasted text; the
  // "kind" concept is gone from this card entirely (the document's own name
  // is the label now).
  const [crossDocA, setCrossDocA] = useState('');
  const [crossDocB, setCrossDocB] = useState('');
  const [crossResult, setCrossResult] = useState<Contradiction[] | null>(null);
  const [crossErr, setCrossErr] = useState('');
  const [crossLoading, setCrossLoading] = useState(false);

  const [runs, setRuns] = useState<ReviewRun[]>([]);
  const [runLoading, setRunLoading] = useState(false);
  const [runErr, setRunErr] = useState('');

  // Prompt 298 §1/§2 — the SAME gap-detection engine Pitch Blueprint already
  // uses (company-gaps.ts, via /api/blueprint), wired here so Review warns
  // before running on thin data instead of silently producing an imprecise
  // report. gapAnalysisId lets a Review-flow answer register against the
  // same blueprint_analyses row Blueprint itself would use, if one exists.
  const [gaps, setGaps] = useState<GapView[]>([]);
  const [gapAnalysisId, setGapAnalysisId] = useState<string | undefined>(undefined);
  // Prompt 298 §3 — accepted claims (including gap answers, source_kind
  // 'founder_answer') merged into what Run review actually sends, alongside
  // db.companyFacts. Without this, answering a gap here would satisfy the
  // alert but never reach the report itself — the exact "no extra friction"
  // requirement the prompt asks to confirm, which direct reading showed did
  // NOT already hold (company_claims and company_facts are separate tables;
  // /api/review/investability only ever received the latter).
  const [acceptedClaimStatements, setAcceptedClaimStatements] = useState<string[]>([]);
  // Prompt 358 Phase 3.1 — the Knowledge Health panel needs the full claims
  // (documentRefs, status), not just accepted statements.
  const [claims, setClaims] = useState<CompanyClaim[]>([]);
  const [showInterrogation, setShowInterrogation] = useState(false);
  const [gapBusy, setGapBusy] = useState(false);
  // Prompt 358 Phase 3.2 — "perguntar é caro": the interrogation flow only
  // ever pulls from the top GAP_QUESTION_BUDGET-ranked gaps by default; the
  // founder has to explicitly ask for more.
  const [showAllGaps, setShowAllGaps] = useState(false);
  // Prompt 358 Phase 2.3 — "the founder sees this happening, never silent":
  // when a free-text answer got merged into the existing claim instead of
  // becoming a new one, this says so, once, right after it happens.
  const [routingNote, setRoutingNote] = useState<string | null>(null);
  // Prompt 309 — "Skip this one" bug: dismissing never writes a claim (by
  // design, per blueprint/answer/route.ts's own comment — not answering
  // isn't new knowledge), so the exact same gap came right back as gaps[0]
  // on the next loadGaps(), reading as "Skip did nothing." This is
  // presentation-only rotation for THIS screen visit, never a persisted
  // dismissal — reloading the page (or a later visit) starts empty again,
  // and a skipped gap is still real and comes back once the others are
  // dealt with, exactly as the product decision requires.
  const [skippedKeys, setSkippedKeys] = useState<Set<string>>(new Set());

  function loadGaps() {
    fetch('/api/blueprint').then((r) => r.json()).then((body) => {
      if (body.available) {
        setGaps(body.gaps ?? []);
        setGapAnalysisId(body.analysis?.id);
        setClaims((body.claims ?? []) as CompanyClaim[]);
        setAcceptedClaimStatements(
          ((body.claims ?? []) as { status: string; statement: string }[])
            .filter((c) => c.status === 'accepted').map((c) => c.statement),
        );
      }
    }).catch(() => {});
  }
  useEffect(loadGaps, []);

  // Prompt 358 Phase 3.2 — the interrogation flow only ever pulls from the
  // budgeted pool by default; "Ask me more" (below) lifts the cap for this
  // session view, never persisted.
  const budgetedGaps = showAllGaps ? gaps : gaps.slice(0, GAP_QUESTION_BUDGET);
  const currentGap = pickCurrentGap(budgetedGaps, skippedKeys);

  async function submitGapAnswer(opts: { option?: string; answer?: string; dismissed: boolean; category?: string }) {
    const gap = currentGap;
    if (!gap) return;
    if (opts.dismissed) setSkippedKeys((prev) => new Set(prev).add(gap.key));
    setGapBusy(true);
    setRoutingNote(null);
    try {
      const res = await fetch('/api/blueprint/answer', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gapKey: gap.key, rule: gap.rule, option: opts.option, answer: opts.answer, category: opts.category,
          analysisId: gapAnalysisId, dismissed: opts.dismissed, relatedClaimIds: gap.relatedClaimIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok === false) throw new Error(data.error ?? 'Something went wrong.');
      if (data.routedAs === 'amend_target_claim') {
        setRoutingNote('Added to the existing claim rather than creating a new one.');
      }
      loadGaps();
      // Prompt 363 — see BlueprintPanel.tsx's submitAnswer for why.
      return { stillOpen: data.stillOpen as boolean | undefined, reason: data.reason as string | undefined };
    } finally { setGapBusy(false); }
  }

  // Prompt 358 Phase 1 — G4's "Yes — I will attach it" never becomes a text
  // claim: the real answer is the document itself, linked via the SAME
  // atomic RPC document-extraction-linking.ts already uses.
  async function attachDocument(claimId: string, documentId: string) {
    const gap = currentGap;
    if (!gap) return;
    setGapBusy(true);
    try {
      await fetch('/api/blueprint/link-document', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claimId, documentId, gapKey: gap.key, analysisId: gapAnalysisId }),
      });
      loadGaps();
    } finally { setGapBusy(false); }
  }

  // Prompt 358 Phase 2.1 — the founder's one-click reply to a reconciliation
  // suggestion: confirm links the document (same as attachDocument above,
  // just already found by the engine); dismiss tells reconciliation.ts to
  // never re-suggest that same match.
  async function reconcileConfirm(claimId: string, confirm: boolean) {
    setGapBusy(true);
    try {
      await fetch('/api/blueprint/reconcile-confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ claimId, confirm }),
      });
      loadGaps();
    } finally { setGapBusy(false); }
  }

  // Prompt 168 §B — org-wide, not per-run: the same lookup covers the latest
  // run's inline risks/recommendations below AND SwotVisualCard's four
  // categories, without a second fetch.
  const [clarifications, setClarifications] = useState<ReviewClarification[]>([]);

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json())
      .then((me) => setCaps({
        ai: !!me.capabilities?.ai, reviewRuns: !!me.capabilities?.reviewRuns,
        reviewOptimization: !!me.entitlements?.reviewOptimization, reviewTopTierTools: !!me.entitlements?.reviewTopTierTools,
        reviewClarifications: !!me.capabilities?.reviewClarifications,
        orgRole: (me.orgRole ?? null) as OrgRole | null, reviewQuota: (me.reviewQuota ?? null) as ReviewQuota | null,
      }))
      .catch(() => setCaps({
        ai: false, reviewRuns: false, reviewOptimization: false, reviewTopTierTools: false, reviewClarifications: false,
        orgRole: null, reviewQuota: null,
      }));
  }, []);

  useEffect(() => {
    if (!authEnabled || !caps?.reviewRuns || !db.org.id) return;
    browserClient().from('review_runs').select('id, score, summary, report, created_at')
      .eq('org_id', db.org.id).order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => setRuns((data as ReviewRun[] | null) ?? []));
  }, [caps?.reviewRuns, db.org.id]);

  useEffect(() => {
    if (!authEnabled || !caps?.reviewClarifications || !db.org.id) return;
    browserClient().from('review_clarifications').select('*')
      .eq('org_id', db.org.id).order('created_at', { ascending: false })
      .then(({ data }) => setClarifications((data as ReviewClarification[] | null) ?? []));
  }, [caps?.reviewClarifications, db.org.id]);

  // Prompt 298 §3 — merges db.companyFacts (existing) with accepted
  // company_claims (Blueprint's engine, incl. this tab's own gap answers)
  // so resolving a gap here changes the very next Run review, not just the
  // alert above. Deduped by exact text — a claim can restate a fact.
  const confirmedFacts = [...new Set([
    ...db.companyFacts.filter((f) => f.status === 'confirmed').map((f) => f.statement),
    ...acceptedClaimStatements,
  ])];
  const companyContext = {
    name: db.org.name, sector: db.org.sector, stage: db.org.stage,
    round_target_eur: db.org.round_target_eur, country: db.org.country, one_liner: db.org.one_liner,
  };

  // Prompt 212 §B.2 — o nome importa tanto como o numero. Isto ia para o
  // modelo como `soft_circled_eur`, sem qualificar, e o modelo tratava-o
  // como progresso DESTA ronda -- que foi como os €100k de uma ronda antiga
  // (registados como interest_eur de uma entrada not_contacted, por nao
  // haver outro sitio) viraram "so €100k de €300k fechados" no SWOT.
  //
  // A soma agora e so de relacoes vivas (round-capital.ts, whitelist). Nos
  // dados reais da ablute_ a soma cega dava €400k contra um alvo de €300k,
  // incluindo €300k da Adara -- que tinha recusado.
  function pipelineStats() {
    const byStatus: Record<string, number> = {};
    for (const e of db.entities) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    const passes = db.interactions.filter((i) => i.classification === 'pass').length;
    return {
      total_investors: db.entities.length, by_status: byStatus, passes,
      soft_circled_this_round_eur: softCircledThisRound(db.entities),
    };
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
        body: JSON.stringify({ kind: docKind, draft: docText, context: { ...companyContext, facts: confirmedFacts }, documentId: docVaultId || undefined }),
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
          documentIdA: crossDocA, documentIdB: crossDocB,
          context: { ...companyContext, facts: confirmedFacts },
        }),
      });
      const data = await res.json();
      if (data.error) { setCrossErr(data.error); return; }
      if (data.review) { setCrossErr(data.review); return; } // configured:false fallback text
      setCrossResult(data.contradictions as Contradiction[]);
    } catch (e) { setCrossErr((e as Error).message); } finally { setCrossLoading(false); }
  }

  // Prompt 360 Part B — "Check another pair" immediately after a result:
  // clears the picked documents and result, never the loading/error UI
  // pattern used elsewhere, so the founder can start over in one click.
  function resetCrossDocument() {
    setCrossDocA(''); setCrossDocB(''); setCrossResult(null); setCrossErr('');
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

  // Prompt 166 §B/§C — a new review can start only with feature access AND
  // quota left; reviewQuota is null either while /api/me hasn't resolved yet
  // (treated as "can't start" until it has) or for an unlimited plan (never
  // blocks). Kept as one derivation so the button, the quota line, and
  // SwotVisualCard's own empty/lock state can never disagree with each other.
  const quotaExhausted = !!caps?.reviewQuota && caps.reviewQuota.remaining <= 0;
  const canRunReview = !!caps && caps.ai && caps.reviewRuns && !quotaExhausted;
  const swotLockedReason = caps && !canRunReview && !latest
    ? (!caps.ai || !caps.reviewRuns
      ? REVIEW_OPTIMIZATION_PREVIEW_COPY
      : `You've used your ${caps.reviewQuota?.quota} review${caps.reviewQuota?.quota === 1 ? '' : 's'} this month — resets on the 1st.`)
    : null;

  // Prompt 168 §B — one lookup shared by SwotVisualCard's four categories and
  // the risks/recommendations list below; a save in either place appends/
  // replaces locally so both stay in sync without a refetch.
  const clarificationMap = clarificationsByKey(clarifications);
  function handleClarificationSaved(c: ReviewClarification) {
    setClarifications((prev) => upsertClarification(prev, c));
  }

  // Prompt 220 §D — o SWOT é do PROJETO; métricas de pipeline/outreach são
  // diagnóstico de execução da angariação, não fraqueza do negócio. O split
  // é só framing dentro do relatório founder-only (a regra raiz continua a
  // aplicar-se por inteiro: nada disto sai do servidor para investidores —
  // o dossier deles usa investor_safe, gerado sem estes dados de todo).
  // Índices originais preservados: clarifications são keyed por item_index
  // no array completo de weaknesses.
  const weaknessSplit = splitFundraisingExecution(latest?.report?.weaknesses ?? []);

  const criticalGaps = gaps.filter((g) => g.severity === 'critical' || g.severity === 'high');

  return (
    <>
      {/* Prompt 298 §1 — critical/high gaps block review PRECISION, not
          access: the founder can still run a review on thin data if they
          choose, but not without knowing what it'll cost them. */}
      {criticalGaps.length > 0 && !showInterrogation && (
        <Card title={<span className="text-[#B00000]">Missing information will make this review imprecise</span>}>
          <p className="text-sm text-gray-700">
            {criticalGaps.length} crucial question{criticalGaps.length === 1 ? ' is' : 's are'} still unanswered about your
            company. Without {criticalGaps.length === 1 ? 'it' : 'them'}, the Action Plan will be imprecise, Train will
            drill the wrong questions, this dossier may reach the wrong (or less-precise) investors, and your History
            won&apos;t reflect the truth.
          </p>
          <button onClick={() => setShowInterrogation(true)}
            className="mt-2 rounded-lg bg-[#B00000] px-3 py-1.5 text-sm font-medium text-white">
            Start now
          </button>
        </Card>
      )}
      {showInterrogation && (
        <Card title={<span className="text-[#0E7490]">Knowledge health</span>}>
          <KnowledgeHealthPanel claims={claims} gaps={gaps} />
          {currentGap && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              {routingNote && <p className="mb-2 text-xs text-[#0E7490]">{routingNote}</p>}
              <GapInterrogation key={currentGap.key} gap={currentGap} remaining={budgetedGaps.length} busy={gapBusy}
                onSubmit={submitGapAnswer} onAttachDocument={attachDocument} onReconcileConfirm={reconcileConfirm} />
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {!showAllGaps && gaps.length > budgetedGaps.length && (
              <button onClick={() => setShowAllGaps(true)} className="text-xs text-[#0E7490] hover:underline">
                Ask me more ({gaps.length - budgetedGaps.length} more available)
              </button>
            )}
            <button onClick={() => setShowInterrogation(false)} className="text-xs text-gray-400 hover:underline">
              Close — I&apos;ll finish this later
            </button>
          </div>
        </Card>
      )}
      {claims.length > 0 && (
        <Card title={<span className="text-[#0E7490]">Strengthen your claims</span>}>
          <StrengthenClaimsPanel claims={claims} onApplied={loadGaps} />
        </Card>
      )}
      {showInterrogation && !currentGap && gaps.length === 0 && (
        <Card title={<span className="text-emerald-700">All caught up</span>}>
          <p className="text-sm text-gray-600">No pending questions right now. Run review below to see the updated result.</p>
          <button onClick={() => setShowInterrogation(false)} className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
            Close
          </button>
        </Card>
      )}

      <InvestorFeedbackCard />

      <SwotVisualCard
        data={latest?.report ? {
          strengths: latest.report.strengths ?? [], weaknesses: weaknessSplit.business.map((b) => b.text),
          opportunities: latest.report.opportunities ?? [], threats: latest.report.threats ?? [],
        } : null}
        weaknessIndices={weaknessSplit.business.map((b) => b.index)}
        canRun={canRunReview} lockedReason={swotLockedReason} running={runLoading} onRun={runInvestability}
        clarify={caps?.reviewClarifications && latest ? {
          orgId: db.org.id, reviewRunId: latest.id, clarifications: clarificationMap, onSaved: handleClarificationSaved,
        } : undefined}
      />

      {/* Prompt 220 §D — a secção própria para onde os bullets de execução
          se mudam. Visualmente separada do SWOT e com a natureza escrita no
          próprio card: interno, sobre a angariação, nunca dos investidores.
          As clarifications continuam a funcionar aqui com a MESMA chave
          (category 'weaknesses' + índice original) — mover o bullet de
          secção não muda onde ele vive nos dados. */}
      {latest && weaknessSplit.execution.length > 0 && (
        <Card title={<span className="text-gray-700">Fundraising execution</span>}>
          <p className="mb-2 text-xs text-gray-500">
            How the raise itself is going — outreach and pipeline diagnostics from your CRM activity.
            Internal only, never shown to investors. These are not weaknesses of the business.
          </p>
          <ul className="space-y-2">
            {weaknessSplit.execution.map((b) => (
              <li key={b.index} className="flex items-center gap-3 rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-800">
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-600" />
                <span className="flex-1">{b.text}</span>
                {caps?.reviewClarifications && (
                  <ClarificationBullet
                    orgId={db.org.id} reviewRunId={latest.id} category="weaknesses" itemIndex={b.index} itemText={b.text}
                    existing={clarificationMap.get(clarificationKey(latest.id, 'weaknesses', b.index)) ?? null}
                    onSaved={handleClarificationSaved}
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Prompt 166 §D.2 — owner/admin only, mirroring manage_org_settings'
          gate elsewhere (promo code redemption, org settings). Non-owner/
          admin members simply don't see the control — same pattern as every
          other settings toggle in this codebase, not a disabled checkbox.
          Prompt 175 §C — real Toggle now, matching RoadmapCard.tsx's own
          swap (both were plain checkboxes; no reusable toggle existed
          anywhere in the app before that prompt built one). */}
      {caps?.orgRole && can(caps.orgRole, 'manage_org_settings') && (
        // id targeted by the "Turn on →" link on the founder-only dossier
        // preview page (Prompt 306) when this toggle is off.
        <div id="swot-visibility-toggle" className="-mt-2 scroll-mt-16 px-1">
          <Toggle checked={db.org.swot_visible_to_investors ?? true}
            onChange={(v) => updateOrg({ swot_visible_to_investors: v })}
            label={<span className="text-xs text-gray-500">Let investors you&apos;re in contact with see this SWOT</span>} />
          {/* Prompt 212 §A — progresso DECLARADO pelo founder (o valor que
              ele escreveu + os soft commits que confirmou) e dele para dar,
              ao contrario da performance derivada da plataforma, que nao tem
              toggle nenhum porque nunca sai. */}
          <Toggle checked={db.org.round_progress_visible_to_investors ?? true}
            onChange={(v) => updateOrg({ round_progress_visible_to_investors: v })}
            label={<span className="text-xs text-gray-500">Show round progress (amount committed vs target) to investors</span>} />
        </div>
      )}

      <Card title="Investability ranking — readiness vs round value">
        <p className="mb-2 text-xs text-gray-500">
          Consumes your confirmed canon facts + pipeline stats and returns a score with concrete strengths, weaknesses,
          opportunities, threats, risks and recommendations. Each run is stored so you can watch it improve as you add
          facts and close conversations.
        </p>
        {!caps ? <p className="text-sm text-gray-400">Loading…</p>
          : !caps.reviewRuns || !caps.ai ? <ComingSoon />
          : (
            <>
              <button disabled={runLoading || !canRunReview} onClick={runInvestability}
                className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                {runLoading ? 'Running…' : 'Run review'}
              </button>
              {caps.reviewQuota && (
                <p className="mt-1 text-xs text-gray-400">
                  {caps.reviewQuota.quota === 0
                    ? REVIEW_OPTIMIZATION_PREVIEW_COPY
                    : `${caps.reviewQuota.used} of ${caps.reviewQuota.quota} review${caps.reviewQuota.quota === 1 ? '' : 's'} used this month`}
                </p>
              )}
              {runErr && <p className="mt-2 text-xs text-[#B00000]">{runErr}</p>}
              {latest && (
                <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-[#0E7490]">{latest.score}</span>
                    <span className="text-xs text-gray-400">/ 100 · {latest.created_at.slice(0, 10)}</span>
                  </div>
                  {latest.summary && <p className="mt-1 text-gray-700">{latest.summary}</p>}
                  {/* strengths/weaknesses/opportunities/threats now live in
                      SwotVisualCard above — only the two categories it
                      doesn't cover stay in this plain list, so nothing is
                      shown twice. */}
                  {(['risks', 'recommendations'] as const).map((k) => (
                    latest.report?.[k]?.length ? (
                      <div key={k} className="mt-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k}</div>
                        <ul className="ml-4 list-disc text-xs text-gray-700">
                          {latest.report[k].map((x, i) => (
                            <li key={i}>
                              {x}
                              {caps?.reviewClarifications && (
                                <ClarificationBullet
                                  orgId={db.org.id} reviewRunId={latest.id} category={k} itemIndex={i} itemText={x}
                                  existing={clarificationMap.get(clarificationKey(latest.id, k, i)) ?? null}
                                  onSaved={handleClarificationSaved}
                                />
                              )}
                            </li>
                          ))}
                        </ul>
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

      {SHOW_DRAFT_REVIEW_CARD && (
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
      )}

      <Card title="Document reviews">
        <p className="mb-2 text-xs text-gray-500">
          Paste the text content of any of these for an investor-lens structured report, calibrated to your stage
          ({db.org.stage ?? 'stage not set'}). Review only — nothing is sent or changed.
        </p>
        {!caps?.ai ? <ComingSoon /> : (
          <>
            <div className="mb-2 flex flex-wrap gap-2">
              <select value={docKind} onChange={(e) => setDocKind(e.target.value as DocKind)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
                {DOC_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              {/* Prompt 302 §2 — optional: which real Vault file this text was
                  pasted from, so the review can point back at it later. */}
              <select value={docVaultId} onChange={(e) => setDocVaultId(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
                <option value="">Not linked to a Vault document</option>
                {db.documents.filter((d) => d.storage_path || d.external_url).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}{d.version ? ` (${d.version})` : ''}</option>
                ))}
              </select>
            </div>
            <textarea value={docText} onChange={(e) => setDocText(e.target.value)} rows={6}
              placeholder="Paste the document text content…" className="w-full rounded border border-gray-300 p-2 text-sm font-mono" />
            <button disabled={!docText || docLoading} onClick={reviewDocument}
              className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {docLoading ? 'Reviewing…' : 'Review with AI'}
            </button>
            {docErr && <p className="mt-2 text-xs text-[#B00000]">{docErr}</p>}
            {docResult && <ReportView report={docResult} />}
          </>
        )}
      </Card>

      <Card title={<span className="inline-flex items-center gap-2">Cross-document check — find contradictions {caps && !caps.reviewTopTierTools && <PlanBadge tier="motherfunding" />}</span>}>
        <p className="mb-2 text-xs text-gray-500">
          Pick two documents from your Vault and the AI flags only genuine contradictions — each backed by an exact quote
          from both sides. Feeds the Contradictions section in Action plan.
        </p>
        {!caps?.ai ? <ComingSoon /> : !caps.reviewTopTierTools ? <TopTierLocked /> : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <select value={crossDocA} onChange={(e) => setCrossDocA(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                <option value="">Document A…</option>
                {db.documents.filter((d) => d.storage_path && /\.pdf$/i.test(d.name)).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}{d.version ? ` (${d.version})` : ''}</option>
                ))}
              </select>
              <select value={crossDocB} onChange={(e) => setCrossDocB(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                <option value="">Document B…</option>
                {db.documents.filter((d) => d.storage_path && /\.pdf$/i.test(d.name)).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}{d.version ? ` (${d.version})` : ''}</option>
                ))}
              </select>
            </div>
            {crossDocA && crossDocA === crossDocB && (
              <p className="mt-2 text-xs text-amber-600">Pick two different documents — comparing a document to itself isn&apos;t a real contradiction.</p>
            )}
            <button disabled={!crossDocA || !crossDocB || crossDocA === crossDocB || crossLoading} onClick={checkCrossDocument}
              className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {crossLoading ? 'Checking…' : 'Find contradictions'}
            </button>
            {crossErr && <p className="mt-2 text-xs text-[#B00000]">{crossErr}</p>}
            {crossResult && (
              <>
                {crossResult.length === 0 ? (
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
                          <div className="rounded border border-amber-200 bg-white p-2 text-xs text-gray-700">
                            <p className="mb-1 font-medium text-gray-500">{c.sideA.kind}</p>&ldquo;{c.sideA.quote}&rdquo;
                          </div>
                          <div className="rounded border border-amber-200 bg-white p-2 text-xs text-gray-700">
                            <p className="mb-1 font-medium text-gray-500">{c.sideB.kind}</p>&ldquo;{c.sideB.quote}&rdquo;
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <button onClick={resetCrossDocument} className="mt-3 text-xs font-medium text-[#0E7490] hover:underline">
                  Check another pair
                </button>
              </>
            )}
          </>
        )}
      </Card>

      {/* Prompt 360 Part A — the full "Market data — your sector" experience
          (three sources, curation, Sherlock research) moved to its own
          top-level tab (ReadinessPanel.tsx). This card is a quick, one-shot
          AI benchmark — kept, renamed to avoid the title collision, since
          it's a genuinely different, cheaper tool than the new tab's
          curated canvas, not a duplicate of it. */}
      <Card title={<span className="inline-flex items-center gap-2">Quick market benchmark (AI report) {caps && !caps.reviewTopTierTools && <PlanBadge tier="motherfunding" />}</span>}>
        <p className="mb-2 text-xs text-gray-500">
          A one-shot AI report on your market/sector — size and direction, where a company at your stage typically sits, the
          metrics investors in this space benchmark on, and comparable companies. For sourced, curated research you can
          build on over time, see the <a href="/readiness?tab=market_data" className="text-[#0E7490] underline">Market data — your sector</a> tab.
        </p>
        {!caps?.ai ? <ComingSoon /> : !caps.reviewTopTierTools ? <TopTierLocked /> : (
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
