'use client';
// Company tab redesign — wraps one labelled field so the completeness bar
// can find it (id) and flash it (the `flashing` ring/fade), and so a
// still-missing field can carry its own small "needed for 100%" tag.
export function CompletenessField({ id, label, missing, flashing, className, children }: {
  id: string; label: string; missing: boolean; flashing: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <label id={id}
      className={`flex flex-col gap-0.5 rounded-lg p-1 text-xs transition-colors duration-700 ${flashing ? 'bg-amber-50 ring-2 ring-amber-300' : ''} ${className ?? ''}`}>
      <span className="flex flex-wrap items-center gap-1.5 text-gray-500">
        {label}
        {missing && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">needed for 100%</span>
        )}
      </span>
      {children}
    </label>
  );
}
