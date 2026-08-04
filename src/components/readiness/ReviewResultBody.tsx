// Prompt 117 Bloco C — extracted from HistoryPanel's per-kind rendering so
// the standalone /readiness/report/[id] page (built for print/share) and
// the inline History list render the exact same body for the exact same
// row, instead of two copies drifting apart.
import type { CompanyFactCategory } from '@/lib/types';
import { ReportView, type StructuredReport } from './ReportView';

export type Severity = 'low' | 'medium' | 'high';
const SEVERITY_COLOR: Record<string, string> = { high: 'text-[#B00000]', medium: 'text-amber-600', low: 'text-gray-500' };

export const STRUCTURED_KINDS = new Set([
  'deck_review', 'one_pager_review', 'business_plan_review',
  'financial_plan_review', 'marketing_plan_review', 'cap_table_review',
]);

export interface Contradiction {
  text: string; category: CompanyFactCategory; severity: Severity;
  sideA: { quote: string }; sideB: { quote: string };
}

// Defends against real malformed rows found while building the History tab:
// the model's tool_use.input occasionally doesn't conform to its own
// declared array schema (e.g. `strengths` comes back as a markdown bullet
// string instead of string[]) and /api/ai-review persists it unvalidated.
// Flagged, not fixed at the source (a route.ts validation gap, out of this
// Bloco's scope).
export function isRenderableReport(r: unknown): r is StructuredReport {
  const x = r as Partial<StructuredReport> | null;
  return !!x && Array.isArray(x.strengths) && Array.isArray(x.weaknesses) && Array.isArray(x.risks) && Array.isArray(x.recommendations);
}

export function contradictionsOf(result: unknown): Contradiction[] {
  const raw = (result as { contradictions?: unknown })?.contradictions;
  return Array.isArray(raw) ? raw as Contradiction[] : [];
}

export function freeTextOf(result: unknown): string {
  const raw = (result as { review?: unknown })?.review;
  return typeof raw === 'string' ? raw : '';
}

export function ReviewResultBody({ kind, result }: { kind: string; result: unknown }) {
  if (STRUCTURED_KINDS.has(kind)) {
    return isRenderableReport(result)
      ? <ReportView report={result} />
      : <p className="mt-2 text-xs italic text-gray-400">This report couldn&apos;t be displayed (unexpected format from that run).</p>;
  }
  if (kind === 'cross_document_review') {
    const contradictions = contradictionsOf(result);
    return contradictions.length === 0
      ? <p className="mt-2 text-xs text-gray-500">No genuine contradictions found between these two documents.</p>
      : (
        <ul className="mt-2 space-y-2">
          {contradictions.map((c, i) => (
            <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <p className="text-gray-800">{c.text}</p>
                <span className={`shrink-0 font-semibold uppercase ${SEVERITY_COLOR[c.severity]}`}>{c.severity}</span>
              </div>
            </li>
          ))}
        </ul>
      );
  }
  return <pre className="mt-2 whitespace-pre-wrap rounded border border-gray-200 bg-white p-2 text-xs text-gray-700">{freeTextOf(result)}</pre>;
}
