'use client';
// Prompt 907 (I1) — the header of a call as an applicant sees it at the top of its link (spec §13.1): who promotes it, its title, the
// deadline with its time zone, the summary, the eligibility in sentences (none until Etapa 2 configures eligibility), the regulation PDF
// when the team made one public, and — while applications cannot be made — one sentence saying so ("Opens on …", "Applications closed on …").
import { formatInZone } from '@/lib/calls/tz';

export interface PublicCallInfo {
  name: string; description: string | null; promoter: string;
  opensAt: string | null; closesAt: string | null; timezone: string;
  phase: 'open' | 'scheduled' | 'closed'; message: string | null;
  eligibility: string[]; regulation: { fileName: string; url: string } | null;
}

export function CallHeader({ call }: { call: PublicCallInfo }) {
  return (
    <header data-testid="call-header">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400" data-testid="call-promoter">{call.promoter}</p>
      <h1 className="mt-1 text-xl font-bold text-gray-900" data-testid="call-name">{call.name}</h1>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-gray-400">Opens</dt><dd className="text-gray-800">{formatInZone(call.opensAt, call.timezone)}</dd>
        <dt className="text-gray-400">Deadline</dt><dd className="font-medium text-gray-900" data-testid="call-deadline">{formatInZone(call.closesAt, call.timezone)}</dd>
      </dl>
      {call.description && <p className="mt-4 whitespace-pre-line text-sm text-gray-600" data-testid="call-summary">{call.description}</p>}
      {call.eligibility.length > 0 && (
        <div className="mt-4" data-testid="call-eligibility">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Who can apply</h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">{call.eligibility.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {call.regulation && (
        <p className="mt-4 text-sm">
          <a href={call.regulation.url} target="_blank" rel="noreferrer" className="font-medium text-[#0E7490] hover:underline" data-testid="regulation-link">
            Read the regulation (PDF)
          </a>
          <span className="ml-1 text-xs text-gray-400">{call.regulation.fileName}</span>
        </p>
      )}
      {call.message && (
        <p className="mt-5 rounded-lg bg-[#E8F4F8] px-4 py-3 text-sm font-medium text-[#0E7490]" data-testid="call-message">{call.message}</p>
      )}
    </header>
  );
}
