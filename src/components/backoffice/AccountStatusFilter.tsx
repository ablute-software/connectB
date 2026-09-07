'use client';
// Prompt 576 Fase 3 — same pill-row shape as NetworkStrikesTab's own status
// filter (Startups → Strikes tab), reused rather than redrawn: active pill
// solid bg-[#0E7490], the rest ghost text buttons.
import { ACCOUNT_FILTER_LABEL, type AccountFilter } from '@/lib/account-filter';

export function AccountStatusFilter({ value, onChange }: { value: AccountFilter; onChange: (next: AccountFilter) => void }) {
  return (
    <div className="flex gap-1">
      {(Object.keys(ACCOUNT_FILTER_LABEL) as AccountFilter[]).map((f) => (
        <button key={f} onClick={() => onChange(f)}
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${value === f ? 'bg-[#0E7490] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
          {ACCOUNT_FILTER_LABEL[f]}
        </button>
      ))}
    </div>
  );
}
