'use client';
// Prompt 534 Phase 1 — Round Blueprint: "Sherlock deduces your round terms
// from your own numbers." The founder's mirror of the investor's evaluation
// tools.
//
// EVERY NUMBER ON SCREEN COMES FROM src/lib/round-blueprint.ts. This file
// gathers inputs, formats, and renders; it computes nothing. That is what makes
// "no AI in the math" a structural fact rather than a promise — there is no
// arithmetic here for a model to have influenced.
//
// SEEDING IS LABELLED AND NEVER INVENTED. A lever seeded from the org profile
// carries a "from your profile" tag; a lever with no real source starts EMPTY
// with a one-line ask. An empty chart is honest; a plausible chart is a lie.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { authEnabled } from '@/lib/supabase';
import { Card } from '@/components/ui';
import { RunwayChart } from './RunwayChart';
import {
  DEFAULT_HORIZON_MONTHS, DEFAULT_SEED_LEAD_MONTHS, DEFAULT_YES_RATE_PCT,
  applyDrag, minimumMaturityMonths, outreachPlan, simulateRunway, solveRaiseForRunway,
  type DragKind, type RunwayInputs,
} from '@/lib/round-blueprint';

const DISCLAIMER =
  'A planning tool, not a certified valuation and not financial or legal advice — have the final terms '
  + 'checked by a lawyer before they leave this workspace.';

function eur(n: number): string {
  return `€${Math.round(n).toLocaleString('en-US')}`;
}

function FromProfile() {
  return <span className="ml-1.5 rounded-full bg-[#E8F4F8] px-1.5 py-0.5 text-[10px] font-medium text-[#0E7490]">from your profile</span>;
}

function Field({ label, value, onChange, suffix, hint, seeded, ask }: {
  label: string; value: number | ''; onChange: (v: number | '') => void;
  suffix?: string; hint?: string; seeded?: boolean; ask?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-center text-xs font-medium text-gray-600">
        {label}{seeded && <FromProfile />}
      </span>
      <span className="mt-1 flex items-center gap-1.5">
        <input type="number" value={value} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm" />
        {suffix && <span className="shrink-0 text-xs text-gray-400">{suffix}</span>}
      </span>
      {/* An empty required lever states what to do about it rather than
          quietly rendering a chart built on a default nobody chose. */}
      {value === '' && ask
        ? <span className="mt-0.5 block text-[11px] text-amber-700">{ask}</span>
        : hint && <span className="mt-0.5 block text-[11px] text-gray-400">{hint}</span>}
    </label>
  );
}

export function RoundBlueprintPanel() {
  const { db, updateOrg } = useStore();
  const org = db.org;

  const [available, setAvailable] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  // Seeded strictly from real org fields. revenue_eur is annual, so the /12 is
  // stated on the field itself rather than silently applied.
  const seededMrr = org.revenue_eur != null && org.revenue_eur > 0 ? org.revenue_eur / 12 : '';
  const seededRaise = org.round_target_eur ?? '';
  const seededRunway = org.round_runway_months ?? '';

  const [startingCash, setStartingCash] = useState<number | ''>('');
  const [raiseTotal, setRaiseTotal] = useState<number | ''>(seededRaise);
  const [secondTranche, setSecondTranche] = useState<number | ''>('');
  const [secondTrancheMonth, setSecondTrancheMonth] = useState<number | ''>(7);
  const [burnStart, setBurnStart] = useState<number | ''>('');
  const [startMrr, setStartMrr] = useState<number | ''>(seededMrr);
  const [growthPct, setGrowthPct] = useState<number | ''>('');
  const [marginPct, setMarginPct] = useState<number | ''>('');
  const [horizon, setHorizon] = useState<number>(DEFAULT_HORIZON_MONTHS);
  const [seedLead, setSeedLead] = useState<number>(DEFAULT_SEED_LEAD_MONTHS);
  const [burnSteps, setBurnSteps] = useState<{ month: number; eur: number; label?: string }[]>([]);

  const [solveFor, setSolveFor] = useState<'runway' | 'raise'>('raise');
  const [targetRunway, setTargetRunway] = useState<number | ''>(seededRunway === '' ? 18 : seededRunway);

  const [avgTicket, setAvgTicket] = useState<number | ''>(org.round_min_ticket_eur ?? '');
  const [yesRate, setYesRate] = useState<number>(DEFAULT_YES_RATE_PCT);

  const [edit, setEdit] = useState<{ month: number; kind: DragKind; value: string } | null>(null);

  useEffect(() => {
    fetch('/api/round-blueprint/scenarios').then((r) => r.json())
      .then((b) => setAvailable(!!b.available)).catch(() => setAvailable(false));
  }, []);

  // The one required lever with no possible source in the profile: burn. Until
  // it exists there is nothing honest to draw.
  const ready = burnStart !== '' && burnStart > 0;

  const inputs: RunwayInputs = useMemo(() => {
    const tranches = [
      { month: 0, eur: Number(raiseTotal || 0) - Number(secondTranche || 0) },
      ...(secondTranche !== '' && secondTranche > 0
        ? [{ month: Number(secondTrancheMonth || 0), eur: Number(secondTranche) }] : []),
    ].filter((t) => t.eur > 0);
    return {
      startingCashEur: Number(startingCash || 0),
      raise: { totalEur: tranches.reduce((s, t) => s + t.eur, 0), tranches },
      burn: { startEur: Number(burnStart || 0), steps: burnSteps },
      revenue: {
        startMrrEur: Number(startMrr || 0),
        monthlyGrowthPct: Number(growthPct || 0),
        grossMarginPct: Number(marginPct || 0),
      },
      horizonMonths: horizon,
      seedLeadMonths: seedLead,
    };
  }, [startingCash, raiseTotal, secondTranche, secondTrancheMonth, burnStart, burnSteps, startMrr, growthPct, marginPct, horizon, seedLead]);

  const { points, markers } = useMemo(() => simulateRunway(inputs), [inputs]);
  const solvedRaise = useMemo(
    () => (solveFor === 'raise' && targetRunway !== '' ? solveRaiseForRunway(inputs, Number(targetRunway)) : null),
    [inputs, solveFor, targetRunway]);
  const plan = outreachPlan(inputs.raise.totalEur, Number(avgTicket || 0), org.weekly_cap ?? 20, yesRate);

  function commitEdit() {
    if (!edit) return;
    const next = applyDrag(inputs, edit.kind, edit.month, Number(edit.value || 0));
    if (edit.kind === 'burn') setBurnSteps(next.burn.steps);
    if (edit.kind === 'revenue') { setStartMrr(next.revenue.startMrrEur); setGrowthPct(next.revenue.monthlyGrowthPct); }
    if (edit.kind === 'cash') {
      setRaiseTotal(Math.round(next.raise.totalEur));
      const later = next.raise.tranches.find((t) => t.month > 0);
      if (later) setSecondTranche(Math.round(later.eur));
    }
    setEdit(null);
  }

  async function applyToRound() {
    setSaving(true);
    const runwayMonths = markers.runwayEndMonth == null ? horizon : markers.runwayEndMonth - 1;
    updateOrg({ round_target_eur: Math.round(inputs.raise.totalEur), round_runway_months: runwayMonths });
    setSaving(false);
    setNote('Applied to your round. Investors see the new Ask.');
  }

  // Only a REAL workspace missing migration 0294 is 'not available'. In demo
  // mode there is no database to gate on and the simulator is pure client-side
  // arithmetic, so it runs exactly as it will in production — scenarios simply
  // are not persisted. Blanking the tab here would also make the feature
  // unverifiable under dev:verify, which is where it gets checked.
  if (authEnabled && available === false) {
    return (
      <Card>
        <h2 className="text-sm font-semibold text-gray-900">Round Blueprint</h2>
        <p className="mt-1 text-sm text-gray-500">Not available in this workspace yet.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">Round Blueprint</h1>
        <p className="text-sm text-gray-500">Sherlock deduces your round terms from your own numbers.</p>
        {/* Persistent, in the header, not tucked into a footer. */}
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800">{DISCLAIMER}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1"><Card>
          <h2 className="text-sm font-semibold text-gray-900">Your levers</h2>

          <div className="mt-3 space-y-3">
            <Field label="Starting cash" value={startingCash} onChange={setStartingCash} suffix="€"
              ask="How much is in the bank today?" hint="Not stored on your profile — it lives in this scenario." />
            <Field label="Monthly burn" value={burnStart} onChange={setBurnStart} suffix="€"
              ask="Required — without your burn there is nothing honest to draw." />
            <Field label="Raise" value={raiseTotal} onChange={setRaiseTotal} suffix="€"
              seeded={seededRaise !== '' && raiseTotal === seededRaise} ask="How much are you raising?" />
            <Field label="Second tranche (optional)" value={secondTranche} onChange={setSecondTranche} suffix="€"
              hint="Split the round to see the dip before the second close." />
            {secondTranche !== '' && secondTranche > 0 && (
              <Field label="Second tranche lands at month" value={secondTrancheMonth} onChange={setSecondTrancheMonth} />
            )}
            <Field label="Starting MRR" value={startMrr} onChange={setStartMrr} suffix="€"
              seeded={seededMrr !== '' && startMrr === seededMrr}
              hint="Seeded as your annual revenue ÷ 12." ask="Leave empty if you have no revenue yet — that is a real answer." />
            <Field label="Monthly revenue growth" value={growthPct} onChange={setGrowthPct} suffix="%"
              ask="Your own plan's growth rate — not a benchmark." />
            <Field label="Gross margin" value={marginPct} onChange={setMarginPct} suffix="%"
              ask="What share of revenue reaches cash?" />
            <Field label="Horizon" value={horizon} onChange={(v) => setHorizon(Number(v || DEFAULT_HORIZON_MONTHS))} suffix="months" />
            <Field label="Seed takes" value={seedLead} onChange={(v) => setSeedLead(Number(v || DEFAULT_SEED_LEAD_MONTHS))} suffix="months"
              hint="How long raising actually takes — drives “start raising by”." />
          </div>

          <div className="mt-4 rounded-lg border border-gray-200 p-2">
            <p className="text-xs font-medium text-gray-600">Solve for</p>
            <div className="mt-1.5 flex gap-1.5">
              {(['raise', 'runway'] as const).map((k) => (
                <button key={k} onClick={() => setSolveFor(k)}
                  className={`rounded-lg px-2 py-1 text-xs ${solveFor === k ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600'}`}>
                  {k === 'raise' ? 'How much to raise?' : 'How long will it last?'}
                </button>
              ))}
            </div>
            {solveFor === 'raise' && (
              <div className="mt-2">
                <Field label="I want this much runway" value={targetRunway} onChange={setTargetRunway} suffix="months" />
                {ready && solvedRaise != null && (
                  <p className="mt-1.5 text-xs text-gray-700">
                    You would need <b>{eur(solvedRaise)}</b> for {targetRunway} months.
                  </p>
                )}
              </div>
            )}
          </div>
        </Card></div>

        <div className="lg:col-span-2"><Card>
          {!ready ? (
            <div className="flex h-[320px] items-center justify-center text-center">
              <p className="max-w-xs text-sm text-gray-400">
                Add your monthly burn and the chart appears. Nothing is drawn from numbers you haven&apos;t given.
              </p>
            </div>
          ) : (
            <>
              <RunwayChart points={points} markers={markers} tranches={inputs.raise.tranches}
                onPickMonth={(month) => setEdit({ month, kind: 'cash', value: '' })} />
              {edit && (
                // MVP editing: a popover on the clicked month. Full mouse-drag
                // of the series is Phase 1b — see the report.
                <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                  <p className="text-xs font-medium text-gray-700">Month {edit.month} — change which lever?</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {(['cash', 'burn', 'revenue'] as DragKind[]).map((k) => (
                      <button key={k} onClick={() => setEdit({ ...edit, kind: k })}
                        className={`rounded px-2 py-1 text-xs ${edit.kind === k ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600'}`}>
                        {k}
                      </button>
                    ))}
                    <input type="number" value={edit.value} placeholder="new value"
                      onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                      className="w-32 rounded border border-gray-300 px-2 py-1 text-xs" />
                    <button onClick={commitEdit} className="rounded bg-[#0E7490] px-2 py-1 text-xs font-medium text-white">Apply</button>
                    <button onClick={() => setEdit(null)} className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600">Cancel</button>
                  </div>
                  <p className="mt-1 text-[11px] text-gray-500">
                    A cash figure can come from the raise, the burn or revenue — you choose which one moves, so nothing is guessed for you.
                  </p>
                </div>
              )}
            </>
          )}
        </Card></div>
      </div>

      {ready && (
        <Card>
          <h2 className="text-sm font-semibold text-gray-900">The Ask</h2>
          <div className="mt-2 grid gap-2 text-sm text-gray-700 sm:grid-cols-2 lg:grid-cols-4">
            <div><span className="text-xs text-gray-400">Raising</span><div className="font-medium">{eur(inputs.raise.totalEur)}</div></div>
            <div>
              <span className="text-xs text-gray-400">Runway</span>
              <div className="font-medium">{markers.runwayEndMonth == null ? `beyond ${horizon} months` : `${markers.runwayEndMonth - 1} months`}</div>
            </div>
            <div><span className="text-xs text-gray-400">Average monthly burn</span><div className="font-medium">{eur(inputs.burn.startEur)}</div></div>
            <div>
              <span className="text-xs text-gray-400">Break-even</span>
              <div className="font-medium">{markers.breakEvenMonth == null ? `not within ${horizon} months` : `month ${markers.breakEvenMonth}`}</div>
            </div>
          </div>

          {markers.startRaisingMonth != null && (
            <p className="mt-2 rounded-lg bg-[#E8F4F8] p-2 text-sm text-[#0E7490]">
              Seed fundraising must start by <b>month {markers.startRaisingMonth}</b> — raising takes about {seedLead} months and your
              money runs out in month {markers.runwayEndMonth}.
            </p>
          )}

          <p className="mt-2 text-xs text-gray-500">
            A convertible here should mature no earlier than <b>month {minimumMaturityMonths(markers, horizon)}</b> — runway plus six
            months, so the note cannot come due before there is a round to convert into.
          </p>

          <div className="mt-3 rounded-lg border border-gray-200 p-2">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Average ticket" value={avgTicket} onChange={setAvgTicket} suffix="€"
                seeded={org.round_min_ticket_eur != null && avgTicket === org.round_min_ticket_eur}
                ask="What is a typical cheque for this round?" />
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Assumed yes-rate</span>
                <span className="mt-1 flex items-center gap-1.5">
                  <input type="number" value={yesRate} onChange={(e) => setYesRate(Number(e.target.value))}
                    className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
                  <span className="text-xs text-gray-400">% · assumption, not measured</span>
                </span>
              </label>
            </div>
            {plan.ticketsNeeded > 0 && (
              <p className="mt-2 text-sm text-gray-700">
                {eur(inputs.raise.totalEur)} at {eur(Number(avgTicket))} tickets ≈ <b>{plan.ticketsNeeded} yes</b> →
                {' '}~<b>{plan.conversationsNeeded} conversations</b> → at your {org.weekly_cap ?? 20}/week cap,
                {' '}<b>{plan.weeksOfOutreach}+ weeks</b> of outreach alone.
              </p>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={applyToRound} disabled={saving}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              {saving ? 'Applying…' : 'Apply to my round'}
            </button>
            <span className="text-[11px] text-amber-700">
              Changes what investors see as The Ask: round_target_eur {org.round_target_eur != null ? eur(org.round_target_eur) : '—'} →
              {' '}{eur(inputs.raise.totalEur)}
              {markers.runwayEndMonth != null && <> · runway {org.round_runway_months ?? '—'} → {markers.runwayEndMonth - 1}</>}
            </span>
          </div>
          {note && <p className="mt-1.5 text-xs text-[#059669]">{note}</p>}
        </Card>
      )}
    </div>
  );
}
