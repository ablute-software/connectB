'use client';
// Prompt 918 (follow-up to the I1 test) — the category list of a person. It used to show only the categories already created, so nobody found out that "Evaluator" had to be made first in
// another place. It now lists, in the person's own list: the categories that exist; the suggestions that do not exist yet (picking one creates it with sensible permissions and puts the
// person in it, see SUGGESTED_CATEGORY_PERMISSIONS); and "+ New category…", which asks for a name right there.
import { useState } from 'react';
import { SUGGESTED_CATEGORIES, sameCategoryName } from '@/lib/calls/permissions';

export type CategoryChoice = { kind: 'existing'; id: string } | { kind: 'suggest'; name: string } | { kind: 'new'; name: string };

const NEW_VALUE = '__new__';
const valueOf = (c: CategoryChoice): string => (c.kind === 'existing' ? c.id : c.kind === 'suggest' ? `suggest:${c.name}` : `new:${c.name}`);

/** The suggestions that are not yet categories of the organisation. */
export const missingSuggestions = (categories: { name: string }[]): string[] => SUGGESTED_CATEGORIES.filter((s) => !categories.some((c) => sameCategoryName(c.name, s)));

export function CategoryPicker({ id, label, categories, value, disabled, onPick, className }: {
  id: string; label: string; categories: { id: string; name: string }[]; value: CategoryChoice; disabled: boolean; className: string;
  onPick: (choice: CategoryChoice) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const suggestions = missingSuggestions(categories);
  const submit = () => { const clean = name.replace(/\s+/g, ' ').trim(); if (!clean) return; onPick({ kind: 'new', name: clean }); setCreating(false); setName(''); };

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <label className="sr-only" htmlFor={id}>{label}</label>
      <select id={id} value={valueOf(value)} disabled={disabled} className={className} data-testid={id}
        onChange={(e) => {
          const v = e.target.value;
          if (v === NEW_VALUE) { setCreating(true); return; }
          setCreating(false);
          if (v.startsWith('suggest:')) onPick({ kind: 'suggest', name: v.slice('suggest:'.length) });
          else if (!v.startsWith('new:')) onPick({ kind: 'existing', id: v });
        }}>
        {categories.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        {value.kind === 'new' && <option value={valueOf(value)}>{value.name} (new)</option>}
        {suggestions.length > 0 && (
          <optgroup label="Suggested — created when you pick one">
            {suggestions.map((s) => <option key={s} value={`suggest:${s}`}>{s}</option>)}
          </optgroup>
        )}
        <option value={NEW_VALUE}>+ New category…</option>
      </select>
      {creating && (
        <span className="flex flex-wrap items-center gap-1.5" data-testid={`${id}-new`}>
          <label className="sr-only" htmlFor={`${id}-name`}>Name of the new category</label>
          <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus placeholder="Name of the category" className={`${className} w-44`}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape') setCreating(false); }} />
          <button type="button" disabled={!name.trim()} onClick={submit} data-testid={`${id}-create`}
            className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">Create</button>
          <button type="button" onClick={() => setCreating(false)} className="text-xs text-gray-500 hover:underline">Cancel</button>
        </span>
      )}
    </span>
  );
}
