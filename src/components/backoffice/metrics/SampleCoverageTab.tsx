'use client';
// Prompt 124 Block B (§3) — the full sample & coverage doctrine: sample
// composition (Block A), plus coverage-vs-known-universe, sensor-quality
// tracking (measures the C1-C5 sensors' own rollout), and declared biases.
// No vergonha showing a sample of 4 startups, mostly Portugal, pre-seed —
// that's the honest picture today.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface SampleCoverageData {
  startups: { total: number; byStage: Record<string, number>; bySector: Record<string, number>; byCountry: Record<string, number>; cohortByMonth: Record<string, number> };
  investors: { total: number; byType: Record<string, number>; cohortByMonth: Record<string, number> };
  coverage: { ptSampleCount: number; ptUniverseEstimate: number; ptUniverseSource: string; ptCoveragePct: number | null };
  sensorQuality: { acquisitionSourcePct: number | null; documentViewsPct: number | null; investorSourceCategoryPct: number | null };
  biases: { abluteDominancePct: number | null; realOrgsSampleSize: number };
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

function SensorBar({ label, pct, hint }: { label: string; pct: number | null; hint: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-gray-700">{label}</span>
        <span className="font-semibold text-[#0E7490]">{pct == null ? '—' : `${pct}%`}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full bg-[#0E7490]" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>
    </div>
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
        Sample composition, coverage, sensor quality, and declared biases — shown without editorializing. This is
        what a stakeholder needs before trusting any statistic on the other tabs: what we have, what we don&apos;t, and
        since when.
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

      <Card title="Estimated coverage — Portugal">
        <p className="text-sm text-gray-600">
          {data.coverage.ptSampleCount} of our startups are Portugal-based, against an estimated {data.coverage.ptUniverseEstimate.toLocaleString()} active
          startups nationally (<span className="text-gray-400">{data.coverage.ptUniverseSource}</span>).
        </p>
        <div className="mt-2 text-3xl font-bold text-[#0E7490]">
          {data.coverage.ptCoveragePct == null ? '—' : `~${data.coverage.ptCoveragePct}%`}
        </div>
        <p className="mt-1 text-[11px] text-amber-700">
          ⚠ An estimate, not a measurement — the external figure is a single published snapshot, not a live count, and
          only covers Portugal; no equivalent benchmark exists here for other countries in the sample.
        </p>
      </Card>

      <Card title="Sensor quality — instrumentation rollout (Prompt 124 M1/M3/M4)">
        <div className="space-y-3">
          <SensorBar label="Accounts with acquisition_source captured" pct={data.sensorQuality.acquisitionSourcePct}
            hint="M1 — only counts signups since migration 0122 is applied; never backfilled." />
          <SensorBar label="Confirmed grants with a document_view on file" pct={data.sensorQuality.documentViewsPct}
            hint="M3 — a real investor open, linked back to the grant that permitted it." />
          <SensorBar label="Pipeline relations with a specific origin (not the bare 'manual' default)" pct={data.sensorQuality.investorSourceCategoryPct}
            hint="M4 — bulk_import/known_contact/investor_invite/catalog/match_deal vs. the unattributed default." />
        </div>
      </Card>

      <Card title="Declared biases">
        <ul className="space-y-2 text-sm text-gray-600">
          <li>
            <b>Platform dominance:</b> ablute_ alone accounts for{' '}
            <span className="font-semibold text-gray-900">{data.biases.abluteDominancePct == null ? '—' : `${data.biases.abluteDominancePct}%`}</span>{' '}
            of all pipeline relations across {data.biases.realOrgsSampleSize} real orgs (demo/test entities excluded) — today&apos;s "platform" numbers are
            largely one org&apos;s imported CRM, not a broad base yet.
          </li>
          <li>
            <b>Self-selection:</b> every org and investor account here opted in by signing up — none were sampled at random
            from the wider ecosystem, so nothing here should be read as representative of startups or investors in general.
          </li>
          <li>
            <b>Geography:</b> the sample skews heavily Portuguese (see the country breakdown above) — conclusions about sectors,
            stages, or investor behavior may not transfer to other markets.
          </li>
        </ul>
      </Card>
    </div>
  );
}
