'use client';
// Prompt 707 §C.2 — printable "State of the Ecosystem" report for one
// X-Ray cohort. Deliberately its own standalone page rather than a modal
// on top of EcosystemTab, same reasoning as readiness/report/[id]/page.tsx:
// window.print() prints whatever's on the page, so isolating exactly this
// cohort (not the whole Metrics console around it) is what makes Print
// actually produce the right PDF. Reuses that exact print:hidden /
// window.print() pattern rather than introducing a PDF-generation library
// — per the mini-prompt's own instruction not to add one without need.
//
// Reads the SAME /api/backoffice/metrics/ecosystem route EcosystemTab.tsx
// calls (query params carried over in the URL), so this page can never show
// a different SRI/heatmap/withheld verdict than the tab it was opened from.
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui';
import { CATEGORY_LABEL, SEVERITY_ORDER, SEVERITY_LABEL, heatCellColor, segmentLabel, periodLabel } from '@/lib/ecosystem-cohort-view';

interface EcosystemResponse {
  available: boolean;
  cohortN?: number;
  withheld?: boolean;
  sri?: { score: number } | null;
  heatmap?: { category: string; severity: string; pctOfCohort: number }[];
  error?: string;
}

function EcosystemReportContent() {
  const search = useSearchParams();
  const country = search.get('country') ?? '';
  const sector = search.get('sector') ?? '';
  const stage = search.get('stage') ?? '';
  const sinceDays = search.get('sinceDays') ?? '';
  const [data, setData] = useState<EcosystemResponse | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (country) params.set('country', country);
    if (sector) params.set('sector', sector);
    if (stage) params.set('stage', stage);
    if (sinceDays) params.set('sinceDays', sinceDays);
    fetch(`/api/backoffice/metrics/ecosystem?${params}`).then((r) => r.json()).then(setData)
      .catch(() => setData({ available: false }));
  }, [country, sector, stage, sinceDays]);

  const title = `State of the Ecosystem — ${segmentLabel({ country, sector, stage })}, ${periodLabel(sinceDays)}`;
  const canExport = !!data?.available && !data?.withheld;

  if (!data) return <div className="mx-auto max-w-2xl p-6 text-sm text-gray-400">Loading…</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6 print:max-w-none print:p-0">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-lg font-bold">{title}</h1>
          <div className="text-xs text-gray-400">Cohort n = {data.cohortN ?? '—'}</div>
        </div>
        {canExport && (
          <button onClick={() => window.print()} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600">Print / PDF</button>
        )}
      </div>
      <div className="hidden print:block">
        <h1 className="text-lg font-bold">{title}</h1>
        <div className="text-xs text-gray-400">Cohort n = {data.cohortN ?? '—'}</div>
      </div>

      {/* Prompt 122 §C.3's disclaimer travels with the report, not just the
          screen — carried into the print output too, not print:hidden. */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 print:border print:border-black print:bg-white print:text-black">
        Internal sample — not representative
      </div>

      {!data.available ? (
        <p className="text-sm text-gray-500">Foundation not applied yet — nothing to report.</p>
      ) : data.withheld ? (
        <p className="text-sm text-gray-500">
          Segment below anonymity threshold (n&lt;8 distinct organizations, or one organization over 50% of the
          metric) — data withheld. Nothing to report for this cohort yet.
        </p>
      ) : (
        <>
          <Card title="SRI v0 — Startup Readiness Index">
            {data.sri ? (
              <div className="text-4xl font-bold text-[#0E7490]">{data.sri.score}<span className="text-base font-normal text-gray-400">/100</span></div>
            ) : (
              <p className="text-sm text-gray-400">No review_score facts in this cohort yet.</p>
            )}
          </Card>

          <Card title="Weakness map — category × severity">
            {(data.heatmap ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">No weakness/risk facts in this cohort yet.</p>
            ) : (
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
            )}
          </Card>
        </>
      )}

      <div className="pt-2 text-center text-[10px] text-gray-400 print:block">
        Sherlock Deal · report generated {new Date().toISOString().slice(0, 10)}
      </div>
    </div>
  );
}

export default function EcosystemReportPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-2xl p-6 text-sm text-gray-400">Loading…</div>}>
      <EcosystemReportContent />
    </Suspense>
  );
}
