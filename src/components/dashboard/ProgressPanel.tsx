'use client';
// Dashboard — Progress sub-tab (Prompt 314 §A, supersedes Prompt 312 before
// it shipped: Nuno moved this from a Readiness & Train sub-tab to the
// Dashboard). The investability-over-time chart is the app's clearest "this
// helps you improve with use" signal, so it belongs on the Dashboard, not
// buried in a Readiness sub-tab. Pure relocation from
// src/components/readiness/ActionPlanPanel.tsx — the review_runs query and
// InvestabilityChart itself are unchanged.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { authEnabled, browserClient } from '@/lib/supabase';

interface ReviewRunRow { id: string; score: number | null; created_at: string }

function InvestabilityChart({ runs }: { runs: ReviewRunRow[] }) {
  const points = runs.filter((r): r is ReviewRunRow & { score: number } => r.score != null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (points.length < 2) {
    return <p className="text-xs text-gray-400">Run at least 2 investability reviews (Readiness & Train → Review) to see a trend here.</p>;
  }
  const W = 560, H = 120, PAD = 24;
  const xStep = (W - 2 * PAD) / (points.length - 1);
  const xs = points.map((_, i) => PAD + i * xStep);
  const ys = points.map((p) => H - PAD - (p.score / 100) * (H - 2 * PAD));
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x},${ys[i]}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Investability score over time">
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#E5E7EB" strokeWidth={1} />
      <path d={path} fill="none" stroke="#0E7490" strokeWidth={2} />
      {xs.map((x, i) => (
        <g key={points[i].id}>
          <circle cx={x} cy={ys[i]} r={3} fill="#0E7490" />
          <text x={x} y={H - 6} fontSize={9} textAnchor="middle" fill="#9CA3AF">{points[i].created_at.slice(5, 10)}</text>
        </g>
      ))}
    </svg>
  );
}

export function ProgressPanel() {
  const { db } = useStore();
  const [runs, setRuns] = useState<ReviewRunRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authEnabled || !db.org.id) { setLoading(false); return; }
    browserClient().from('review_runs').select('id, score, created_at')
      .eq('org_id', db.org.id).order('created_at', { ascending: false }).limit(30)
      .then((runsRes) => {
        setRuns((runsRes.data as ReviewRunRow[] | null) ?? []);
        setLoading(false);
      });
  }, [db.org.id]);

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <Card title="Investability over time">
      <InvestabilityChart runs={runs} />
    </Card>
  );
}
