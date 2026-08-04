'use client';
// Prompt 124 Block A (§2.3) — minimal real content: no vergonha showing a
// sample of 4 startups, mostly Portugal, pre-seed — that's the honest
// picture today. The fuller §3 doctrine (coverage vs. external universe,
// sensor-quality %s, declared biases) lands once the C1-C5 sensors exist
// (this tab's own follow-up, Prompt 124 Block B).
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface SampleCoverageData {
  startups: { total: number; byStage: Record<string, number>; bySector: Record<string, number>; byCountry: Record<string, number>; cohortByMonth: Record<string, number> };
  investors: { total: number; byType: Record<string, number>; cohortByMonth: Record<string, number> };
}

function BreakdownList({ counts, total }: { counts: Record<string, number>; total: number }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <p className="text-xs text-gray-400">No data.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {entries.map(([key, n]) => (
        <li key={key} className="flex items-center gap-2">
          <span className="w-32 truncate text-gray-600">{key}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full bg-[#0E7490]" style={{ width: `${total ? Math.round((n / total) * 100) : 0}%` }} />
          </div>
          <span className="w-8 text-right text-xs text-gray-500">{n}</span>
        </li>
      ))}
    </ul>
  );
}

export function SampleCoverageTab() {
  const [data, setData] = useState<SampleCoverageData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/metrics/sample-coverage').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error); return; }
      setData(body);
    }).catch(() => setErr('Failed to load.'));
  }, []);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">
        Sample composition, shown without editorializing — this is the honest size and shape of the population
        today. The fuller coverage-vs-universe estimate and sensor-quality tracking arrive once the underlying
        instrumentation (Prompt 124 §4) is built.
      </p>

      <Card title={`Startups (${data.startups.total})`}>
        <div className="grid gap-4 md:grid-cols-3">
          <div><h3 className="mb-1.5 text-xs font-semibold uppercase text-gray-400">By stage</h3><BreakdownList counts={data.startups.byStage} total={data.startups.total} /></div>
          <div><h3 className="mb-1.5 text-xs font-semibold uppercase text-gray-400">By sector</h3><BreakdownList counts={data.startups.bySector} total={data.startups.total} /></div>
          <div><h3 className="mb-1.5 text-xs font-semibold uppercase text-gray-400">By country</h3><BreakdownList counts={data.startups.byCountry} total={data.startups.total} /></div>
        </div>
      </Card>

      <Card title={`Registered investor accounts (${data.investors.total})`}>
        <div><h3 className="mb-1.5 text-xs font-semibold uppercase text-gray-400">By type</h3><BreakdownList counts={data.investors.byType} total={data.investors.total} /></div>
      </Card>

      <Card title="Adoption cohort — startups by sign-up month">
        <BreakdownList counts={data.startups.cohortByMonth} total={data.startups.total} />
      </Card>
      <Card title="Adoption cohort — investor accounts by registration month">
        <BreakdownList counts={data.investors.cohortByMonth} total={data.investors.total} />
      </Card>
    </div>
  );
}
