'use client';
// Prompt 927 (D) — the currency of a call: a selector you can SEARCH, by code ("jpy") or by name ("dinar"), with the most used (EUR, USD, GBP) first. Opens a short list under the button (no overlay), closes
// with Escape or a click elsewhere; Enter picks the first match. The list itself lives in `currencies.ts`, the same one the server validates against.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { POPULAR_CURRENCIES, currencyName, searchCurrencies } from '@/lib/calls/currencies';

export function CurrencySelect({ id, value, disabled, onChange, className }: { id: string; value: string; disabled?: boolean; onChange: (code: string) => void; className: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const found = useMemo(() => searchCurrencies(query), [query]);
  const popular = query.trim() === '' ? found.filter((c) => (POPULAR_CURRENCIES as readonly string[]).includes(c.code)) : [];
  const rest = query.trim() === '' ? found.filter((c) => !(POPULAR_CURRENCIES as readonly string[]).includes(c.code)) : found;

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const pick = (code: string) => { onChange(code); setOpen(false); setQuery(''); };
  const row = (c: { code: string; name: string }) => (
    <li key={c.code} role="option" aria-selected={c.code === value}>
      <button type="button" onClick={() => pick(c.code)} data-testid={`currency-${c.code}`}
        className={`flex w-full min-w-0 items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${c.code === value ? 'bg-[#E8F4F8] font-semibold' : ''}`}>
        <span className="w-10 shrink-0 font-mono text-xs">{c.code}</span><span className="min-w-0 truncate text-gray-600">{c.name}</span>
      </button>
    </li>
  );

  return (
    <div className="relative min-w-0" ref={box} data-testid="currency-select">
      <button type="button" id={id} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((o) => !o)}
        className={`${className} flex items-center justify-between gap-2 text-left`} data-testid="currency-button">
        <span className="min-w-0 truncate"><span className="font-mono">{value}</span> <span className="text-gray-500">· {currencyName(value)}</span></span>
        <span aria-hidden="true" className="shrink-0 text-gray-400">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg" data-testid="currency-panel">
          <input ref={search} type="text" autoComplete="off" aria-label="Search currencies by code or name" placeholder="Search by code or name" value={query} data-testid="currency-search"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } else if (e.key === 'Enter') { e.preventDefault(); if (found[0]) pick(found[0].code); } }}
            className="block w-full rounded-t-lg border-b border-gray-200 px-3 py-2 text-sm outline-none" />
          <ul id={listId} role="listbox" aria-label="Currencies" className="max-h-64 overflow-y-auto py-1">
            {popular.map(row)}
            {popular.length > 0 && <li role="presentation" className="my-1 border-t border-gray-100" />}
            {rest.map(row)}
            {found.length === 0 && <li className="px-3 py-2 text-sm text-gray-500" data-testid="currency-none">No currency matches “{query}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
