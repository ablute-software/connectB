'use client';
// Prompt 80 §1 — one ticket-amount handle (min or max), log-scale drag over
// the exact stop table in lib/ticket-range.ts. Two of these side by side
// replace the investor profile's old plain min/max number inputs.
import { POSITION_MAX, formatTicketEur, positionToTicket, ticketToPosition } from '@/lib/ticket-range';

export function TicketAmountSlider({
  label, value, onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  const position = value != null ? ticketToPosition(value) : 0;
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-gray-500">{label}</label>
        <span className="text-xs font-semibold text-[#0E7490]">{value != null ? formatTicketEur(value) : '—'}</span>
      </div>
      <input
        type="range" min={0} max={POSITION_MAX} step={1} value={position}
        onChange={(e) => onChange(positionToTicket(Number(e.target.value)))}
        className="mt-1 w-full accent-[#0E7490]"
        aria-label={label}
      />
    </div>
  );
}
