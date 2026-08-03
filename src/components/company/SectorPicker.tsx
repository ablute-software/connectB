'use client';
// P104 #7 — startup-side sector picker, replacing IdentityCard's free-text
// comma-separated field. Investor-side (unlimited, category-level
// selection, "All sectors") is explicitly out of scope for this pass —
// P104 #7's target was IdentityCard.tsx specifically; the investor
// profile rebuild is flagged as a separate follow-up.
import { useMemo, useState } from 'react';
import { SECTOR_TAXONOMY, STARTUP_SECTOR_MAX, SECTOR_OTHER_MAX_CHARS } from '@/lib/sector-taxonomy';

export interface SectorValue {
  sectors: string[];
  other: string | null;
}

function highlight(text: string, query: string) {
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) return text;
  return <>{text.slice(0, i)}<mark className="bg-amber-200">{text.slice(i, i + query.length)}</mark>{text.slice(i + query.length)}</>;
}

export function SectorPicker({ value, onChange, disabled }: { value: SectorValue; onChange: (v: SectorValue) => void; disabled?: boolean }) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [preSearchExpanded, setPreSearchExpanded] = useState<Set<string> | null>(null);

  const otherOn = value.other !== null;
  const count = value.sectors.length + (otherOn ? 1 : 0);
  const atMax = count >= STARTUP_SECTOR_MAX;

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return SECTOR_TAXONOMY;
    return SECTOR_TAXONOMY
      .map((cat) => ({
        name: cat.name,
        sectors: cat.sectors
          .filter((s) => s.toLowerCase().includes(q))
          .sort((a, b) => {
            const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
            const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
            return aStarts - bStarts || a.localeCompare(b);
          }),
      }))
      .filter((cat) => cat.sectors.length > 0);
  }, [q]);

  function onQueryChange(next: string) {
    if (next && !query) setPreSearchExpanded(new Set(expanded));
    setQuery(next);
  }
  function clearSearch() {
    setQuery('');
    if (preSearchExpanded) { setExpanded(preSearchExpanded); setPreSearchExpanded(null); }
  }
  function toggleCategory(name: string) {
    const next = new Set(expanded);
    next.has(name) ? next.delete(name) : next.add(name);
    setExpanded(next);
  }
  function toggleSector(name: string) {
    if (disabled) return;
    const has = value.sectors.includes(name);
    if (!has && atMax) return;
    onChange({ ...value, sectors: has ? value.sectors.filter((s) => s !== name) : [...value.sectors, name] });
  }
  function toggleOther() {
    if (disabled) return;
    if (!otherOn && atMax) return;
    onChange({ ...value, other: otherOn ? null : '' });
  }
  function removeTag(name: string) {
    onChange({ ...value, sectors: value.sectors.filter((s) => s !== name) });
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <input value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder="Search sectors..."
          disabled={disabled}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
        {query && (
          <button type="button" onClick={clearSearch} title="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600">×</button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
        <span>Selected sectors · {count} of {STARTUP_SECTOR_MAX}</span>
        {value.sectors.map((s) => (
          <span key={s} className="flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-cyan-800">
            {s}
            {!disabled && <button type="button" onClick={() => removeTag(s)} className="text-cyan-600 hover:text-cyan-900">×</button>}
          </span>
        ))}
        {otherOn && value.other && (
          <span className="flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-cyan-800">
            {value.other}
            {!disabled && <button type="button" onClick={toggleOther} className="text-cyan-600 hover:text-cyan-900">×</button>}
          </span>
        )}
      </div>
      {atMax && (
        <p className="text-[11px] text-amber-700">You can select up to {STARTUP_SECTOR_MAX} sectors. Remove one to add another.</p>
      )}

      <div className="max-h-64 space-y-1 overflow-y-auto rounded border border-gray-200 p-2">
        {filtered.map((cat) => {
          const isExpanded = q ? true : expanded.has(cat.name);
          const selectedInCat = cat.sectors.filter((s) => value.sectors.includes(s)).length;
          return (
            <div key={cat.name}>
              <button type="button" onClick={() => !q && toggleCategory(cat.name)}
                className="flex w-full items-center justify-between rounded px-1 py-1 text-left text-xs font-medium text-gray-600 hover:bg-gray-50">
                <span>{isExpanded ? '⌄' : '›'} {cat.name}</span>
                {selectedInCat > 0 && <span className="text-[10px] text-cyan-700">{selectedInCat} selected</span>}
              </button>
              {isExpanded && (
                <div className="ml-3 space-y-0.5">
                  {cat.sectors.map((s) => {
                    const checked = value.sectors.includes(s);
                    const rowDisabled = disabled || (!checked && atMax);
                    return (
                      <label key={s} className={`flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-gray-50 ${rowDisabled ? 'opacity-40' : ''}`}>
                        <input type="checkbox" checked={checked} disabled={rowDisabled} onChange={() => toggleSector(s)} />
                        <span>{highlight(s, q)}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <div>
          <label className={`flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-gray-50 ${disabled || (!otherOn && atMax) ? 'opacity-40' : ''}`}>
            <input type="checkbox" checked={otherOn} disabled={disabled || (!otherOn && atMax)} onChange={toggleOther} />
            <span>Other</span>
          </label>
          {otherOn && (
            <div className="ml-3 mt-1">
              <input value={value.other ?? ''} maxLength={SECTOR_OTHER_MAX_CHARS} disabled={disabled}
                onChange={(e) => onChange({ ...value, other: e.target.value.slice(0, SECTOR_OTHER_MAX_CHARS) })}
                placeholder="Specify sector..." className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
              <span className="text-[10px] text-gray-400">{(value.other ?? '').length}/{SECTOR_OTHER_MAX_CHARS}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
