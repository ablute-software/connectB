'use client';
// Prompt AL759 §D (as replaced by its Adenda 1) — ONE small search box above
// the table. While you type it suggests values grouped by field (Company,
// Country, Sector, Contact), computed on the client from the active tab's own
// rows; choosing one filters by exactly that field and shows as a small tag
// inside the box; Enter without choosing runs a general text search. No chips
// row, no filter panel — the tag lives inside the one box.
//
// SearchView is the drawing (all state arrives as props), so the ARIA
// combobox markup can be rendered and asserted without a DOM; PortfolioSearch
// owns the typing/keyboard state around it.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  comboKeyAction, filterLabel, FILTER_FIELD_LABELS, highlightParts, showSuggestionCount, suggest,
  type PortfolioCompany, type PortfolioQuery, type Suggestion, type TaggedFilter,
} from '@/lib/portfolio-table';

export const SEARCH_PLACEHOLDER = 'Search company, sector, country or contact';

function Mark({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((p, i) => (p.match
        ? <mark key={i} className="rounded-sm bg-yellow-100 px-0 font-semibold text-gray-900">{p.text}</mark>
        : <span key={i}>{p.text}</span>))}
    </>
  );
}

export function optionId(listboxId: string, index: number): string {
  return `${listboxId}-opt-${index}`;
}

export function SearchView({
  listboxId, text, open, activeIndex, suggestions, filter, hasCommittedText,
  onTextChange, onKeyDown, onFocus, onChoose, onHover, onClearFilter, onClearText,
}: {
  listboxId: string;
  text: string;
  open: boolean;
  activeIndex: number;
  suggestions: Suggestion[];
  filter: TaggedFilter | null;
  hasCommittedText: boolean;
  onTextChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onChoose: (index: number) => void;
  onHover: (index: number) => void;
  onClearFilter: () => void;
  onClearText: () => void;
}) {
  const expanded = open && suggestions.length > 0;
  // Group boundaries (the list is already in group order): a thin divider
  // between groups, and each group is its own labelled role="group".
  const groups: { field: Suggestion['field']; items: { s: Suggestion; index: number }[] }[] = [];
  suggestions.forEach((s, index) => {
    const last = groups[groups.length - 1];
    if (last && last.field === s.field) last.items.push({ s, index });
    else groups.push({ field: s.field, items: [{ s, index }] });
  });

  return (
    <div className="relative w-full max-w-md">
      <div className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs focus-within:border-[#0E7490]">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" strokeLinecap="round" />
        </svg>
        {filter && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-[#0E7490]/10 px-1.5 py-0.5 text-[11px] text-[#0E7490]" data-testid="filter-tag">
            {filterLabel(filter)}
            <button type="button" aria-label={`Clear filter ${filterLabel(filter)}`} onClick={onClearFilter}
              className="leading-none text-[#0E7490] hover:text-[#B00000]">×</button>
          </span>
        )}
        <input
          type="text" role="combobox" aria-label="Search companies" aria-autocomplete="list"
          aria-expanded={expanded} aria-controls={listboxId}
          aria-activedescendant={expanded && activeIndex >= 0 ? optionId(listboxId, activeIndex) : undefined}
          autoComplete="off" name="portfolio-search" data-1p-ignore data-lpignore="true"
          placeholder={SEARCH_PLACEHOLDER} value={text}
          onChange={(e) => onTextChange(e.target.value)} onKeyDown={onKeyDown} onFocus={onFocus}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-gray-400"
        />
        {(text !== '' || hasCommittedText) && (
          <button type="button" aria-label="Clear search text" onClick={onClearText}
            className="shrink-0 leading-none text-gray-400 hover:text-gray-700">×</button>
        )}
      </div>
      {expanded && (
        <ul id={listboxId} role="listbox" aria-label="Suggestions"
          className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-xs shadow-lg">
          {groups.map((g) => (
            <li key={g.field} role="presentation" className="border-t border-gray-100 first:border-t-0">
              <ul role="group" aria-label={FILTER_FIELD_LABELS[g.field]}>
                {g.items.map(({ s, index }) => (
                  <li key={s.id} id={optionId(listboxId, index)} role="option" aria-selected={index === activeIndex}
                    // mouseDown, not click: the input must not lose focus first.
                    onMouseDown={(e) => { e.preventDefault(); onChoose(index); }}
                    onMouseEnter={() => onHover(index)}
                    className={`cursor-pointer px-3 py-1.5 ${index === activeIndex ? 'bg-gray-100' : ''}`}>
                    <span className="text-gray-400">{FILTER_FIELD_LABELS[s.field]} · </span>
                    <span className="text-gray-700"><Mark text={s.value} query={text} /></span>
                    {showSuggestionCount(s) && <span className="text-gray-400"> ({s.count})</span>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PortfolioSearch({ rows, query, onSubmitText, onChooseFilter, onClearFilter }: {
  /** The ACTIVE tab's rows, unfiltered — suggestions come from these, on the client. */
  rows: PortfolioCompany[];
  query: PortfolioQuery;
  onSubmitText: (text: string) => void;
  onChooseFilter: (filter: TaggedFilter) => void;
  onClearFilter: () => void;
}) {
  const listboxId = useId();
  const [text, setText] = useState(query.q);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  // A shared link, Back, or "Clear search" changes the URL's text — follow it.
  useEffect(() => { setText(query.q); }, [query.q]);

  const suggestions = useMemo(() => suggest(rows, text), [rows, text]);

  // Click outside closes. (Tab leaving the box needs nothing: focus moves on
  // and the next mousedown or Esc closes it; the list never traps focus.)
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function choose(index: number) {
    const s = suggestions[index];
    if (!s) return;
    onChooseFilter({ field: s.field, value: s.value });
    setText(query.q);
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && text === '' && query.filter) { onClearFilter(); return; }
    const action = comboKeyAction({ open: open && suggestions.length > 0, activeIndex, count: suggestions.length }, e.key);
    switch (action.type) {
      case 'move': e.preventDefault(); setActiveIndex(action.activeIndex); break;
      case 'open': e.preventDefault(); setOpen(true); break;
      case 'choose': e.preventDefault(); choose(action.index); break;
      case 'submit': e.preventDefault(); onSubmitText(text.trim()); setOpen(false); setActiveIndex(-1); break;
      case 'close': setOpen(false); setActiveIndex(-1); break;
      case 'none': break;
    }
  }

  return (
    <div ref={wrapRef}>
      <SearchView
        listboxId={listboxId} text={text} open={open} activeIndex={activeIndex} suggestions={suggestions}
        filter={query.filter} hasCommittedText={query.q !== ''}
        onTextChange={(v) => { setText(v); setOpen(true); setActiveIndex(-1); }}
        onKeyDown={onKeyDown} onFocus={() => setOpen(true)}
        onChoose={choose} onHover={setActiveIndex} onClearFilter={onClearFilter}
        onClearText={() => { setText(''); onSubmitText(''); setOpen(false); setActiveIndex(-1); }}
      />
    </div>
  );
}
