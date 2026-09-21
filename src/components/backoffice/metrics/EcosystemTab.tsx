'use client';
// Prompt 122 Block C (F2) — the Observatory's first UI, the 6th tab on
// /metrics. Never hidden even when the foundation migration isn't applied
// (Nuno wants to see it exist) — gated purely on ecosystemFactsAvailable's
// value, read from this route's own `available` field.
//
// D6 (from the discussão doc): SRI v0 + weakness heatmap only — both
// implemented below. Prompt 707 confirmed via live production audit that
// they'd simply never been SEEN yet: every real cohort today has too few
// distinct orgs to clear the K=8 threshold, so `withheld` was always true.
// Prompt 707 also added the CSV/PDF export in this same tab.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
// Prompt 176 §A.4 — was investor-sector-taxonomy.ts's 22-value list; this
// filter's own query (`/api/backoffice/metrics/ecosystem`) does
// `.contains('sectors', [sector])` against `orgs.sectors` directly, which
// has used the canonical sector-taxonomy.ts vocabulary (via
// SectorPicker.tsx/IdentityCard.tsx) all along — this dropdown was silently
// offering options that could never match real org data, same bug class as
// the investor thesis picker.
import { ALL_SECTOR_NAMES } from '@/lib/sector-taxonomy';
import {
  STAGE_OPTIONS, PERIOD_OPTIONS, SEVERITY_ORDER, SEVERITY_LABEL, CATEGORY_LABEL, heatCellColor,
} from '@/lib/ecosystem-cohort-view';

interface EcosystemResponse {
  available: boolean;
  cohortN?: number;
  withheld?: boolean;
  sri?: { score: number } | null;
  heatmap?: { category: string; severity: string; pctOfCohort: number }[];
  error?: string;
}

export function EcosystemTab() {
  const [country, setCountry] = useState('');
  const [sector, setSector] = useState('');
  const [stage, setStage] = useState('');
  const [sinceDays, setSinceDays] = useState('');
  const [data, setData] = useState<EcosystemResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Shared by the live query and both export buttons below, so "what's on
  // screen" and "what gets exported" are always the same cohort.
  function currentParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (country.trim()) params.set('country', country.trim());
    if (sector) params.set('sector', sector);
    if (stage) params.set('stage', stage);
    if (sinceDays) params.set('sinceDays', sinceDays);
    return params;
  }

  function load() {
    setLoading(true);
    fetch(`/api/backoffice/metrics/ecosystem?${currentParams()}`).then((r) => r.json()).then((body) => {
      setData(body); setLoading(false);
    }).catch(() => setLoading(false));
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Prompt 707 §C.3 — disabled, not silently broken, while a cohort is
  // below the anonymity threshold (or the foundation isn't applied, or a
  // query is in flight): never let a click reach a route that would have
  // to refuse it. The route refuses it anyway (never trust a disabled
  // attribute alone for an anonymity guarantee), but this is the honest
  // first line — no misleading "nothing happened" click.
  const exportDisabled = loading || !data?.available || !!data?.withheld;

  if (data && !data.available) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
        <p className="text-sm font-medium text-gray-600">Foundation not applied yet</p>
        <p className="mt-1 text-xs text-gray-400">
          This tab reads from ecosystem_facts / ecosystem_snapshots, proposed in migration 0116 — not applied to this
          database yet. Once applied, this same tab starts showing real data with no further code change.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Prompt 122 §C.3 — permanent while no segment on the platform
          passes K=8: an honest label on every number this tab shows,
          not a footnote easy to miss. */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
        Internal sample — not representative
      </div>

      <Card title="Cohort builder">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-500">
            Country
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. Portugal"
              className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1 text-sm" />
          </label>
          <label className="text-xs text-gray-500">
            Sector
            <select value={sector} onChange={(e) => setSector(e.target.value)} className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1 text-sm">
              <option value="">All sectors</option>
              {ALL_SECTOR_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            Stage
            <select value={stage} onChange={(e) => setStage(e.target.value)} className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1 text-sm">
              <option value="">All stages</option>
              {STAGE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            Period
            <select value={sinceDays} onChange={(e) => setSinceDays(e.target.value)} className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1 text-sm">
              {PERIOD_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <button onClick={load} disabled={loading} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
            {loading ? 'Loading…' : 'Apply'}
          </button>
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => { window.location.href = `/api/backoffice/metrics/ecosystem?${currentParams()}&format=csv`; }}
              disabled={exportDisabled}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Export CSV
            </button>
            <button
              onClick={() => { window.open(`/metrics/ecosystem-report?${currentParams()}`, '_blank'); }}
              disabled={exportDisabled}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Export PDF
            </button>
          </div>
        </div>
        {/* Always shown, regardless of anonymity — the cohort's own size is
            not itself sensitive; it's the metric AGGREGATES that get
            withheld below. */}
        <p className="mt-3 text-xs text-gray-500">
          Cohort: <span className="font-semibold text-gray-800">n = {data?.cohortN ?? '—'}</span>
          {exportDisabled && data?.available && (
            <span className="ml-2 text-gray-400">Export needs a segment at or above the anonymity threshold.</span>
          )}
        </p>
      </Card>

      {data?.withheld ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
          <p className="text-sm font-medium text-gray-600">Segment below anonymity threshold (n&lt;8) — data withheld</p>
          <p className="mt-1 text-xs text-gray-400">
            Fewer than 8 distinct startups contributed to this metric for the current cohort, or one startup accounts
            for more than half the rows. With today&apos;s real data, this is the expected, normal state for almost every
            segment — not an error.
          </p>
        </div>
      ) : data?.available && !loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="SRI v0 — Startup Readiness Index">
            {data.sri ? (
              <div className="text-4xl font-bold text-[#0E7490]">{data.sri.score}<span className="text-base font-normal text-gray-400">/100</span></div>
            ) : (
              <p className="text-sm text-gray-400">No review_score facts in this cohort yet.</p>
            )}
            <p className="mt-2 text-xs text-gray-400">
              Simple average of AI-review scores across the cohort, normalized 0–100. Weighted composite is
              methodology_version 2 — this is v0.
            </p>
          </Card>

          <Card title="Weakness map — category × severity">
            {(data.heatmap ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">No weakness/risk facts in this cohort yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="pb-1 text-left font-medium text-gray-400">Category</th>
                      {SEVERITY_ORDER.map((s) => <th key={s} className="pb-1 text-center font-medium text-gray-400">{SEVERITY_LABEL[s]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(CATEGORY_LABEL).map((cat) => (
                      <tr key={cat}>
                        <td className="py-0.5 pr-2 text-gray-600">{CATEGORY_LABEL[cat]}</td>
                        {SEVERITY_ORDER.map((sev) => {
                          const cell = (data.heatmap ?? []).find((h) => h.category === cat && h.severity === sev);
                          return (
                            <td key={sev} className="p-0.5">
                              <div className={`rounded px-1.5 py-1 text-center font-semibold ${cell ? heatCellColor(cell.pctOfCohort) : 'bg-gray-50 text-gray-300'}`}>
                                {cell ? `${cell.pctOfCohort}%` : '—'}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-gray-400">% of cohort startups with at least one finding in that category and severity.</p>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
