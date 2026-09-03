// Prompt 548 Part 3 — the placeholder furniture every frosted body is built
// from.
//
// These are NOT the real panels. The real ones read the store and would need
// a session; rendering one here would either crash or, worse, show a guest
// something real. What a guest sees is the SHAPE of the screen — its header,
// its sub-tab names, the rough furniture — with nothing behind it, blurred.
//
// The sub-tab names themselves are imported from the real panels wherever
// the panel exports them (see EVALUATION_TOOLS), never retyped: retyping a
// label is precisely how the old guest sidebar came to advertise "Access
// granted" two prompts after that entry was renamed.

export function PreviewSubTabs({ tabs }: { tabs: readonly { label: string; subtitle?: string }[] }) {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {tabs.map((t, i) => (
        <span key={t.label}
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            i === 0 ? 'bg-[#0E7490] text-white' : 'bg-gray-100 text-gray-600'}`}
          title={t.subtitle}>
          {t.label}
        </span>
      ))}
    </div>
  );
}

export function PreviewCard({ title, lines = 3, wide }: { title?: string; lines?: number; wide?: boolean }) {
  return (
    <div className={`rounded-xl border border-gray-100 bg-white p-4 ${wide ? 'col-span-2' : ''}`}>
      {title && <p className="mb-2 text-sm font-semibold text-gray-800">{title}</p>}
      <div className="space-y-1.5">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-2.5 rounded bg-gray-100" style={{ width: `${92 - i * 13}%` }} />
        ))}
      </div>
    </div>
  );
}

export function PreviewRows({ count = 5 }: { count?: number }) {
  return (
    <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <div className="h-8 w-8 shrink-0 rounded-full bg-gray-100" />
          <div className="flex-1 space-y-1.5">
            <div className="h-2.5 rounded bg-gray-100" style={{ width: `${70 - i * 7}%` }} />
            <div className="h-2 rounded bg-gray-50" style={{ width: `${45 - i * 5}%` }} />
          </div>
          <div className="h-6 w-16 shrink-0 rounded-full bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

export function PreviewStats({ labels }: { labels: string[] }) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {labels.map((l) => (
        <div key={l} className="rounded-xl border border-gray-100 bg-white p-3">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">{l}</p>
          <div className="mt-2 h-5 w-12 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}
