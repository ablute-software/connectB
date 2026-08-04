// Prompt 117 Bloco B — extracted from ReviewPanel's former local
// StructuredReportView so History can render the same structured-report
// shape (score/summary/strengths/weaknesses/risks/recommendations) that
// deck/one-pager/business-plan/financial-plan/marketing-plan/cap-table
// reviews persist to ai_reviews.result.
import type { CompanyFactCategory } from '@/lib/types';

interface Finding { text: string; category: CompanyFactCategory }
interface SeverityFinding extends Finding { severity: 'low' | 'medium' | 'high' }
export interface StructuredReport {
  score: number; summary: string;
  strengths: string[]; weaknesses: SeverityFinding[]; risks: SeverityFinding[]; recommendations: Finding[];
}

const SEVERITY_COLOR: Record<string, string> = { high: 'text-[#B00000]', medium: 'text-amber-600', low: 'text-gray-500' };

export function ReportView({ report }: { report: StructuredReport }) {
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold text-[#0E7490]">{report.score}</span>
        <span className="text-xs text-gray-400">/ 10</span>
      </div>
      <p className="mt-1 text-gray-700">{report.summary}</p>
      {report.strengths.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Strengths</div>
          <ul className="ml-4 list-disc text-xs text-gray-700">{report.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
      {(['weaknesses', 'risks'] as const).map((k) => (
        report[k].length > 0 && (
          <div key={k} className="mt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k}</div>
            <ul className="ml-4 list-disc text-xs text-gray-700">
              {report[k].map((f, i) => (
                <li key={i}>
                  <span className={SEVERITY_COLOR[f.severity]}>[{f.severity}]</span> {f.text}
                  <span className="ml-1 text-gray-400">· {f.category}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      ))}
      {report.recommendations.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recommendations</div>
          <ul className="ml-4 list-disc text-xs text-gray-700">
            {report.recommendations.map((f, i) => <li key={i}>{f.text} <span className="text-gray-400">· {f.category}</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
