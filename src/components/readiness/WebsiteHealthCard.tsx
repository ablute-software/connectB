'use client';
// Prompt 919 C — Readiness & Train › "Website health": Google's public PageSpeed / Lighthouse scores for the founder's own website, an
// optional plain-language summary (2 credits), every finding Google reported, and the founder's switch for showing the four scores to
// investors (OFF by default).
//
// What this card is NOT, and says so: a verdict on the startup. A pre-launch deeptech can have a weak site and an excellent team. It
// measures a web page; it is not part of how complete the company profile is, it opens no task and sends no notification.
//
// WebsiteHealthCardView is the presentational half (no fetching, no state beyond what it is given): it is what the tests render and what
// the screenshots are taken from. The container below it talks to /api/website-health/*.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Card } from '@/components/ui';
import { useConfirm } from '@/lib/confirm';
import { simpleSpendDialog } from '@/lib/ai-spend-confirm';
import { fetchWalletStatus } from '@/lib/ai-spend-confirm-client';
import {
  BAND_COLOR, CATEGORY_LABEL, formatCheckedDate, parseLighthouseText, scoreBand, websiteDomain,
  type TextSegment, type WebsiteFinding, type WebsiteStrategy,
} from '@/lib/website-health';
import type { WebsiteHealthState, WebsiteAnalysisView } from '@/lib/website-health-state';

export const WEBSITE_HEALTH_INTRO = "What Google's public PageSpeed check says about your website. It measures the site, not your company.";
export const SHARE_LABEL = 'Show my website health score to investors';
export const SHARE_HELP = 'Investors see only the four Google scores and the date — no summary, no findings. Off by default; this is not part of how Sherlock presents your company.';

/** Google's own text as readable text and real links (`code`, [label](https://…)). */
export function LighthouseText({ text }: { text: string }) {
  const nodes: ReactNode[] = parseLighthouseText(text).map((s: TextSegment, i) => {
    if (s.type === 'code') return <code key={i} className="rounded bg-gray-100 px-1 py-px font-mono text-[0.92em] text-gray-700">{s.value}</code>;
    if (s.type === 'link') return <a key={i} href={s.href} target="_blank" rel="noopener nofollow" className="text-[#0E7490] underline decoration-cyan-200 underline-offset-2 hover:decoration-[#0E7490]">{s.label}</a>;
    return <span key={i}>{s.value}</span>;
  });
  return <>{nodes}</>;
}

const SCORE_LABELS: { key: 'performance' | 'seo' | 'accessibility' | 'bestPractices'; label: string }[] = [
  { key: 'performance', label: 'Performance' }, { key: 'seo', label: 'SEO' }, { key: 'accessibility', label: 'Accessibility' }, { key: 'bestPractices', label: 'Best practices' },
];

/** One of the four arcs, coloured on Google's own scale (0–49 red, 50–89 orange, 90–100 green). */
export function ScoreArc({ label, score }: { label: string; score: number | null }) {
  const r = 28;
  const circumference = 2 * Math.PI * r;
  const band = score === null ? null : scoreBand(score);
  const color = band ? BAND_COLOR[band] : null;
  return (
    <div className="flex flex-col items-center gap-1" data-score-band={band ?? 'none'}>
      <svg viewBox="0 0 72 72" className="h-[72px] w-[72px]" role="img" aria-label={`${label}: ${score === null ? 'not available' : `${score} out of 100`}`}>
        <circle cx="36" cy="36" r={r} fill="none" stroke="#e5e7eb" strokeWidth="6" />
        {score !== null && color && (
          <circle cx="36" cy="36" r={r} fill="none" stroke={color.arc} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${(score / 100) * circumference} ${circumference}`} transform="rotate(-90 36 36)" />
        )}
        <text x="36" y="43" textAnchor="middle" fontSize="21" fontWeight="600" fill={color?.text ?? '#9ca3af'}>{score ?? '–'}</text>
      </svg>
      <span className="text-[11px] font-medium text-gray-600">{label}</span>
    </div>
  );
}

function Vitals({ a }: { a: WebsiteAnalysisView }) {
  const bits: string[] = [];
  if (a.metrics.lcpMs !== null) bits.push(`Main content appears after ${(a.metrics.lcpMs / 1000).toFixed(1)} s`);
  if (a.metrics.cls !== null) bits.push(`Layout shift ${a.metrics.cls}`);
  if (a.metrics.inpMs !== null) bits.push(`Response to taps ${a.metrics.inpMs} ms`);
  return bits.length ? <p className="text-center text-[11px] text-gray-400">{bits.join(' · ')}</p> : null;
}

function FindingRow({ f }: { f: WebsiteFinding }) {
  return (
    <li className="py-2" data-finding={f.id}>
      <p className="text-sm font-medium text-gray-900"><LighthouseText text={f.title} />{f.displayValue ? <span className="ml-1.5 font-normal text-gray-500">— {f.displayValue}</span> : null}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-1">
        {f.categories.map((c) => <span key={c} className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">{CATEGORY_LABEL[c]}</span>)}
      </p>
      {f.description && <p className="mt-1 text-xs text-gray-600"><LighthouseText text={f.description} /></p>}
    </li>
  );
}

export interface WebsiteHealthCardViewProps {
  state: WebsiteHealthState;
  strategy: WebsiteStrategy;
  onStrategy: (s: WebsiteStrategy) => void;
  /** "check" while Google is being asked, "summary" while the model is, "share" while the switch saves. */
  busy: 'check' | 'summary' | 'share' | null;
  error?: string;
  /** What one summary costs right now (from the wallet), when known. */
  summaryCost?: number | null;
  onCheck: () => void;
  onSummary: () => void;
  onShare: (visible: boolean) => void;
  now?: Date;
}

function SummaryBlock({ state, analysis, busy, summaryCost, onSummary }: Pick<WebsiteHealthCardViewProps, 'state' | 'busy' | 'summaryCost' | 'onSummary'> & { analysis: WebsiteAnalysisView | null }) {
  const s = state.summary;
  if (!s) {
    if (!state.summaryOffered) return null;
    return (
      <div className="rounded-lg border border-[#0E7490]/20 bg-[#E8F4F8] p-3">
        <p className="text-xs text-[#0E7490]">Want it in plain words? Sherlock can read these results for you and tell you what to fix first.</p>
        <button type="button" onClick={onSummary} disabled={busy !== null}
          className="mt-2 rounded-full bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {busy === 'summary' ? 'Reading the results…' : `Get the summary${summaryCost != null ? ` (${summaryCost} credit${summaryCost === 1 ? '' : 's'})` : ' (2 credits)'}`}
        </button>
      </div>
    );
  }
  const byId = new Map((analysis?.findings ?? []).map((f) => [f.id, f]));
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3" data-testid="website-summary">
      <p className="text-sm font-medium text-gray-900">{s.headline}</p>
      {state.summaryStrategy && <p className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400">Summary of the {state.summaryStrategy === 'mobile' ? 'phone' : 'desktop'} check</p>}
      {s.fixFirst.length > 0 && (
        <div className="mt-2.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Fix first</h4>
          <ol className="mt-1 space-y-2.5">
            {s.fixFirst.map((item, i) => (
              <li key={i} className="text-sm text-gray-800">
                <p className="font-medium">{i + 1}. {item.what}</p>
                <p className="mt-0.5 text-xs text-gray-600"><span className="font-semibold text-gray-500">Why it matters: </span>{item.whyItMatters}</p>
                <p className="mt-0.5 text-xs text-gray-600"><span className="font-semibold text-gray-500">How to start: </span>{item.how}</p>
                <p className="mt-0.5 text-[10px] text-gray-400">Google&apos;s finding: {item.auditIds.map((id) => byId.get(id)?.title ?? id).join(' · ')}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
      {s.doingWell.length > 0 && (
        <div className="mt-2.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Doing well</h4>
          <ul className="mt-1 space-y-1">
            {s.doingWell.map((d) => <li key={d.category} className="text-xs text-gray-700"><span className="font-medium text-emerald-700">{CATEGORY_LABEL[d.category]}.</span> {d.text}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export function WebsiteHealthCardView({ state, strategy, onStrategy, busy, error, summaryCost, onCheck, onSummary, onShare, now = new Date() }: WebsiteHealthCardViewProps) {
  const domain = websiteDomain(state.website);
  const chosen = state.analyses[strategy];
  const anyAnalysis = state.analyses.mobile ?? state.analyses.desktop;
  const next = state.allowance.nextCheckAt;
  const recheckLabel = !anyAnalysis ? 'Run the check' : 'Re-check';

  const checkButton = state.websiteProblem === 'none' && (
    <button type="button" onClick={onCheck} disabled={!state.allowance.allowed || busy !== null}
      title={!state.allowance.allowed ? (state.allowance.reason === 'too_soon' ? `Next check available ${formatCheckedDate(next, now)}` : 'Try again in a few minutes') : 'Free — Google runs it for you'}
      className="rounded-full border border-[#0E7490] px-3 py-1 text-xs font-semibold text-[#0E7490] hover:bg-cyan-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent">
      {busy === 'check' ? 'Checking… up to a minute' : recheckLabel}
    </button>
  );

  return (
    <Card title="Website health" right={checkButton || undefined}>
      {/* Without a usable website the card says one thing — where to add it — and nothing else (Prompt 919 A). */}
      {state.websiteProblem === 'none' && <p className="text-xs text-gray-500">{WEBSITE_HEALTH_INTRO}</p>}
      {error && <p className="mt-2 text-xs font-medium text-[#B00000]" role="alert">{error}</p>}

      {state.websiteProblem !== 'none' ? (
        <p className="text-sm text-gray-600">
          {state.websiteProblem === 'missing'
            ? <>Add your website in <a href="/settings?tab=about#identity.website" className="font-medium text-[#0E7490] underline">About › Company</a> to run this check</>
            : <>The website in <a href="/settings?tab=about#identity.website" className="font-medium text-[#0E7490] underline">About › Company</a> is not a public web address — fix it there to run this check</>}
        </p>
      ) : !anyAnalysis ? (
        <p className="mt-3 text-sm text-gray-600">
          Ready to check <b className="font-semibold text-gray-800">{domain}</b>. It is free, takes up to a minute, and runs on Google&apos;s side.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              <b className="font-semibold text-gray-700">{domain}</b>
              {chosen && !chosen.error ? <> · checked {formatCheckedDate(chosen.fetchedAt, now)}</> : null}
              {!state.allowance.allowed && state.allowance.reason === 'too_soon' && next ? <> · next check available {formatCheckedDate(next, now)}</> : null}
            </p>
            <div className="inline-flex rounded-full border border-gray-200 p-0.5" role="tablist" aria-label="Which check to show">
              {(['mobile', 'desktop'] as const).map((s) => (
                <button key={s} type="button" role="tab" aria-selected={strategy === s} onClick={() => onStrategy(s)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${strategy === s ? 'bg-[#0E7490] text-white' : 'text-gray-500 hover:text-gray-800'}`}>
                  {s === 'mobile' ? 'Mobile' : 'Desktop'}
                </button>
              ))}
            </div>
          </div>

          {!chosen ? (
            <p className="text-sm text-gray-500">No {strategy} check on file yet.</p>
          ) : chosen.error ? (
            <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700" data-testid="website-check-error">{chosen.error.copy}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 justify-items-center gap-3 sm:grid-cols-4">
                {SCORE_LABELS.map(({ key, label }) => <ScoreArc key={key} label={label} score={chosen.scores[key]} />)}
              </div>
              <Vitals a={chosen} />
            </>
          )}

          <SummaryBlock state={state} analysis={state.analyses[state.summaryStrategy ?? 'mobile']} busy={busy} summaryCost={summaryCost} onSummary={onSummary} />

          {chosen && !chosen.error && (
            <details className="rounded-lg border border-gray-200 p-3" data-testid="website-findings">
              <summary className="cursor-pointer text-sm font-medium text-gray-800">All findings ({chosen.findings.length})</summary>
              {chosen.findings.length === 0
                ? <p className="mt-2 text-xs text-gray-500">Google found nothing worth listing on this check.</p>
                : <ul className="mt-1 divide-y divide-gray-100">{chosen.findings.map((f) => <FindingRow key={f.id} f={f} />)}</ul>}
              <a href={chosen.reportUrl} target="_blank" rel="noopener nofollow" className="mt-2 inline-block text-xs font-medium text-[#0E7490] underline">Open Google&apos;s full report</a>
            </details>
          )}
        </div>
      )}

      {state.websiteProblem === 'none' && (
        <label className="mt-4 flex cursor-pointer items-start gap-2.5 border-t border-gray-100 pt-3">
          <input type="checkbox" role="switch" checked={state.visibleToInvestors} disabled={busy !== null} onChange={(e) => onShare(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#0E7490]" />
          <span>
            <span className="block text-sm font-medium text-gray-800">{SHARE_LABEL}</span>
            <span className="mt-0.5 block text-[11px] text-gray-500">{SHARE_HELP}</span>
          </span>
        </label>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------------------

type CardState = WebsiteHealthState | { ok: true; available: false } | null;

export function WebsiteHealthCard() {
  const confirm = useConfirm();
  const [state, setState] = useState<CardState>(null);
  const [strategy, setStrategy] = useState<WebsiteStrategy>('mobile');
  const [busy, setBusy] = useState<'check' | 'summary' | 'share' | null>(null);
  const [error, setError] = useState('');
  const [summaryCost, setSummaryCost] = useState<number | null>(null);

  const load = useCallback(() => {
    fetch('/api/website-health').then((r) => r.json()).then((b) => setState(b?.ok ? b : { ok: true, available: false })).catch(() => setState({ ok: true, available: false }));
  }, []);
  useEffect(load, [load]);

  const offered = state && 'summaryOffered' in state ? state.summaryOffered : false;
  useEffect(() => {
    if (!offered) return;
    let live = true;
    void fetchWalletStatus('website_summary').then((w) => { if (live && w && !w.isTest) setSummaryCost(w.actionCost); });
    return () => { live = false; };
  }, [offered]);

  async function post(path: string, body?: unknown) {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
  }

  async function check() {
    setError(''); setBusy('check');
    try {
      const { body } = await post('/api/website-health/check');
      if (body.ok === false) { setError(String(body.error ?? 'The check could not run.')); return; }
      setState(body as unknown as WebsiteHealthState);
    } catch { setError('The check could not run. Try again in a few minutes.'); } finally { setBusy(null); }
  }

  async function summary() {
    setError('');
    const wallet = await fetchWalletStatus('website_summary');
    if (!(await confirm(simpleSpendDialog({ actionLabel: 'the website summary', wallet })))) return;
    setBusy('summary');
    try {
      const { body } = await post('/api/website-health/summary');
      if (body.ok === false) { setError(String(body.error ?? 'The summary could not be produced.')); return; }
      if (body.configured === false) { setError(String(body.message)); return; }
      setState(body as unknown as WebsiteHealthState);
    } catch { setError('The summary could not be produced. Your scores are untouched.'); } finally { setBusy(null); }
  }

  async function share(visible: boolean) {
    setError(''); setBusy('share');
    try {
      const { body } = await post('/api/website-health/visibility', { visible });
      if (body.ok === false) { setError(String(body.error ?? 'Could not save that.')); return; }
      setState((s) => (s && 'visibleToInvestors' in s ? { ...s, visibleToInvestors: visible } : s));
    } catch { setError('Could not save that. Try again.'); } finally { setBusy(null); }
  }

  if (!state || !('analyses' in state)) return null; // loading, or the migration is not applied yet: no card
  return <WebsiteHealthCardView state={state} strategy={strategy} onStrategy={setStrategy} busy={busy} error={error} summaryCost={summaryCost}
    onCheck={() => { void check(); }} onSummary={() => { void summary(); }} onShare={(v) => { void share(v); }} />;
}
