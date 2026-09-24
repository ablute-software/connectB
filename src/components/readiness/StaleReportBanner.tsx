'use client';
// Prompt 729 §3.4 — one shared banner for every AI-generated report in
// Readiness & Training that tracks staleness (only investability today —
// see report-staleness.ts's own header for the others' inventory). Shows
// WHAT changed, never just "outdated" with no explanation.
import type { ReportInputChange } from '@/lib/report-staleness';

export function StaleReportBanner({ generatedAt, changes }: { generatedAt: string; changes: ReportInputChange[] }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <p className="font-medium">Outdated — generated on {generatedAt.slice(0, 10)}.</p>
      {changes.length > 0 && (
        <p className="mt-1">
          Since then: {changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join('; ')}.
        </p>
      )}
    </div>
  );
}
