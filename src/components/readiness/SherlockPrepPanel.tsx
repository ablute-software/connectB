'use client';
// Prompt 440 — Sherlock Prep, Phase 2: the tab. The most literal application
// of CLAUDE.md's Sherlock golden rule (439 §0) in the product: this screen
// always opens with what Sherlock already found, never a wall of empty
// fields. No new forms live here — every action below is a single link to
// the EXISTING editor that question's evidence already comes from
// (prepActionForQuestion, sherlock-prep.ts §D.1); duplicating those editors
// here would be weight, not a shortcut.
//
// State is 100% recomputed from the engine on every load — self-healing.
// There is no "mark done"/dismiss here (that's Phase 4, 442): resolve the
// evidence anywhere in the product, hit Refresh (or come back later), and
// the question moves itself into "Already covered". No checkbox to lie to.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { prepActionForQuestion, WHY_COVERED, type PrepReport, type PrepQuestionResult, type PrepSession, type PrepEvidenceMatch } from '@/lib/sherlock-prep';
import type { BarsAxis } from '@/lib/bars-types';

const AXIS_LABEL: Record<BarsAxis, string> = { team: 'Team', market: 'Market', product: 'Product', technology: 'Technology' };
const AXIS_ORDER: BarsAxis[] = ['team', 'market', 'product', 'technology'];
type AxisStats = PrepReport['byAxis'][BarsAxis];

// §D.4 — one context line per action destination, constant per GROUP (not
// per question) — matches prepActionForQuestion's own grouping.
const ACTION_CONTEXT: Record<string, string> = {
  '/documents': 'Any format works — a PDF, a photo of a signed page, a spreadsheet. Sherlock re-checks automatically.',
  '/readiness?tab=market_data': 'Whatever you add there, Sherlock reads on its next pass.',
  '/settings#settings-traction': 'One number is enough to start — Sherlock re-checks on your next visit.',
  '/settings#settings-facts': 'A confirmed fact becomes shareable evidence the moment you save it.',
  '/settings#settings-team': 'A distinct title per founder is enough for Sherlock to re-check this.',
  '/settings?tab=roadmap': 'One dated milestone is enough for Sherlock to re-check this.',
};

const SOURCE_NOUN: Record<string, string> = {
  document: 'document', claim: 'accepted claim', traction: 'traction metric', roadmap: 'roadmap item',
  people: 'team member', market: 'market data point', funding: 'funding round', cap_table: 'cap table entry', clarification: 'clarification',
};

// "Covered by: Investment Dossier.docx · 2 accepted claims" — document
// names are short and real, so up to 2 show verbatim; everything else
// (and any overflow) collapses to a count so this never turns back into
// the "80 chips in a row" problem 437/438 already fixed on the BARS side.
function summarizeMatches(matches: PrepEvidenceMatch[]): string {
  const bySource = new Map<string, PrepEvidenceMatch[]>();
  for (const m of matches) {
    if (!bySource.has(m.source)) bySource.set(m.source, []);
    bySource.get(m.source)!.push(m);
  }
  const parts: string[] = [];
  for (const [source, ms] of bySource) {
    if (source === 'document') {
      parts.push(...ms.slice(0, 2).map((m) => m.label));
      if (ms.length > 2) parts.push(`+${ms.length - 2} more document${ms.length - 2 === 1 ? '' : 's'}`);
    } else {
      const noun = SOURCE_NOUN[source] ?? source;
      parts.push(`${ms.length} ${noun}${ms.length === 1 ? '' : 's'}`);
    }
  }
  return parts.join(' · ');
}

function AxisBar({ axis, stats }: { axis: BarsAxis; stats: AxisStats }) {
  const pct = (n: number) => (stats.total > 0 ? (n / stats.total) * 100 : 0);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-gray-500">
        <span className="font-medium text-gray-700">{AXIS_LABEL[axis]}</span>
        <span>{stats.covered + stats.weak}/{stats.total}</span>
      </div>
      <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-gray-100">
        {stats.covered > 0 && <div className="bg-emerald-500" style={{ width: `${pct(stats.covered)}%` }} />}
        {stats.weak > 0 && <div className="bg-amber-400" style={{ width: `${pct(stats.weak)}%` }} />}
        {stats.missing > 0 && <div className="bg-gray-300" style={{ width: `${pct(stats.missing)}%` }} />}
      </div>
    </div>
  );
}

// Prompt 452 §C — one icon per question, expands to the full evidence list
// and the criterion it satisfied. sherlockPrep is deliberately
// deterministic (no AI/semantic matching this phase) — WHY_COVERED is the
// mechanical rule already encoded in MATCHER_TABLE, in plain language, not
// a model's reasoning. Never opens the document itself — expand/collapse
// only.
function CoveredQuestionRow({ q }: { q: PrepQuestionResult }) {
  const [expanded, setExpanded] = useState(false);
  const why = WHY_COVERED[q.questionId];
  const strongTier = q.matches.filter((m) => m.tier === 'strong' || m.tier === 'transversal');
  const weakTier = q.matches.filter((m) => m.tier === 'weak');
  return (
    <div>
      <button type="button" onClick={() => setExpanded((e) => !e)} className="flex w-full items-start justify-between gap-2 text-left">
        <p className="text-xs text-gray-700">{q.question}</p>
        <span className="shrink-0 text-gray-400">{expanded ? '▴' : '▾'}</span>
      </button>
      {!expanded && <p className="mt-0.5 text-[11px] text-gray-400">Covered by: {summarizeMatches(q.matches)}</p>}
      {expanded && (
        <div className="mt-1.5 space-y-2 rounded-lg bg-gray-50 p-2.5">
          {strongTier.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-emerald-700">
                {strongTier[0].tier === 'transversal' && !why?.strong.startsWith('No dedicated') ? 'Directly answers this:' : why?.strong ?? 'Directly answers this:'}
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {strongTier.map((m) => <li key={`${m.source}:${m.id}`} className="text-[11px] text-gray-600">· {SOURCE_NOUN[m.source] ?? m.source}: {m.label}</li>)}
              </ul>
            </div>
          )}
          {weakTier.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-gray-500">{why?.weak ?? 'Also on file:'}</p>
              <ul className="mt-0.5 space-y-0.5">
                {weakTier.map((m) => <li key={`${m.source}:${m.id}`} className="text-[11px] text-gray-600">· {SOURCE_NOUN[m.source] ?? m.source}: {m.label}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CoveredSection({ covered }: { covered: PrepQuestionResult[] }) {
  const [open, setOpen] = useState(false);
  if (covered.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-emerald-700">✓ Already covered ({covered.length})</span>
        <span className="text-gray-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-gray-100 px-4 py-3">
          {covered.map((q) => <CoveredQuestionRow key={q.questionId} q={q} />)}
        </div>
      )}
    </div>
  );
}

function QuestionItem({ q }: { q: PrepQuestionResult }) {
  const action = prepActionForQuestion(q.questionId);
  const context = ACTION_CONTEXT[action.href];
  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-gray-800">{q.question}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          q.state === 'weak' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'}`}>
          {q.state === 'weak' ? '🟡 Weak' : '🔴 Missing'}
        </span>
      </div>
      {/* Missing shows nothing pretending there's evidence — only weak,
          which genuinely has something, gets a "what you have" line. */}
      {q.state === 'weak' && q.matches.length > 0 && (
        <p className="mt-1 text-[11px] text-gray-500">What you have: {summarizeMatches(q.matches)}</p>
      )}
      <p className="mt-1.5 text-[11px] italic text-gray-400">Investors rate this highest when: {q.whatGreatLooksLike}</p>
      <Link href={action.href}
        className="mt-2 inline-block rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0c637b]">
        {action.label}
      </Link>
      {context && <p className="mt-1.5 text-[10px] text-gray-400">{context}</p>}
    </div>
  );
}

function SessionCard({ session, questionsById, defaultOpen }: {
  session: PrepSession; questionsById: Map<string, PrepQuestionResult>; defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold text-gray-800">
          Session {session.index + 1} · {AXIS_LABEL[session.axis]} · {session.questionIds.length} question{session.questionIds.length === 1 ? '' : 's'} · ~{session.estMinutes} min
        </span>
        <span className="text-gray-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="space-y-2.5 border-t border-gray-100 px-4 py-3">
          {session.questionIds.map((id) => {
            const q = questionsById.get(id);
            return q ? <QuestionItem key={id} q={q} /> : null;
          })}
        </div>
      )}
    </div>
  );
}

export function SherlockPrepPanel() {
  const [status, setStatus] = useState<'loading' | 'unavailable' | 'ready'>('loading');
  const [report, setReport] = useState<PrepReport | null>(null);

  function load() {
    setStatus('loading');
    fetch('/api/company/sherlock-prep').then((r) => r.json())
      .then((body: { available: boolean; report?: PrepReport }) => {
        if (!body.available) { setStatus('unavailable'); return; }
        setReport(body.report ?? null);
        setStatus('ready');
      })
      .catch(() => setStatus('unavailable'));
  }
  useEffect(load, []);

  if (status === 'unavailable') {
    return (
      <div className="max-w-2xl space-y-2">
        <h2 className="text-base font-semibold text-gray-900">Sherlock Prep</h2>
        <p className="text-sm text-gray-500">
          Sherlock Prep needs a live connection — it reads your Vault, facts and metrics to find what already answers investors&apos; questions.
        </p>
      </div>
    );
  }

  if (status === 'loading' || !report) {
    return (
      <div className="max-w-2xl space-y-2">
        <h2 className="text-base font-semibold text-gray-900">Sherlock Prep</h2>
        <p className="text-sm text-gray-400">Sherlock is going through what you already have…</p>
      </div>
    );
  }

  const totals = AXIS_ORDER.reduce<{ covered: number; weak: number; missing: number; total: number }>((acc, axis) => {
    const s = report.byAxis[axis];
    return { covered: acc.covered + s.covered, weak: acc.weak + s.weak, missing: acc.missing + s.missing, total: acc.total + s.total };
  }, { covered: 0, weak: 0, missing: 0, total: 0 });
  const questionsById = new Map(report.perQuestion.map((q) => [q.questionId, q]));
  const coveredQuestions = report.perQuestion.filter((q) => q.state === 'covered');

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">Sherlock Prep</h2>
        <button type="button" onClick={load} className="text-[11px] font-medium text-gray-400 hover:text-[#0E7490]">Refresh</button>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4">
        {totals.missing === 0 ? (
          <p className="text-sm text-gray-800">
            <b>Every investor question already has evidence behind it.</b> Nothing needs you here right now.
          </p>
        ) : (
          <p className="text-sm text-gray-800">
            <b>Sherlock already found evidence for {totals.covered + totals.weak} of the {totals.total} questions investors ask.</b>{' '}
            {totals.missing} still {totals.missing === 1 ? 'needs' : 'need'} something from you — about {report.sessions.length} short session{report.sessions.length === 1 ? '' : 's'} (~10 min each).
          </p>
        )}
        <div className="mt-3 space-y-2">
          {AXIS_ORDER.map((axis) => <AxisBar key={axis} axis={axis} stats={report.byAxis[axis]} />)}
        </div>
      </div>

      <CoveredSection covered={coveredQuestions} />

      {report.sessions.length > 0 && (
        <div className="space-y-2">
          {report.sessions.map((session, i) => (
            <SessionCard key={session.index} session={session} questionsById={questionsById} defaultOpen={i === 0} />
          ))}
        </div>
      )}

      <p className="border-t border-gray-100 pt-3 text-[11px] text-gray-400">
        Why this matters: these are the exact {totals.total} questions Sherlock puts in front of investors evaluating startups like yours —
        every one you cover here is one an investor answers in your favour without asking you.
      </p>
    </div>
  );
}
