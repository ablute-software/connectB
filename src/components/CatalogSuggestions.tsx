'use client';
// Prompt 871 §E — Nuno's decision (2026-09-06): overlay at read time,
// never write to `people`. Shows the catalog's confirmed value for a
// field this person's own record leaves empty, annotated "from catalog",
// with a one-click way to accept it — which runs through the SAME
// updatePerson call a founder's own manual edit would (RLS-scoped,
// attributed to this org), not a silent background write. This is what
// replaced Prompt 581's reverse-sync: that wrote the catalog's value
// straight into `people.<field>`, which made it indistinguishable from
// the org's own declaration and meant a later catalog correction could
// never propagate once the field wasn't empty anymore.
import { useEffect, useState } from 'react';
import { authEnabled, browserClient } from '@/lib/supabase';
import { fetchCatalogOverlay, overlayForEmptyFields, CATALOG_OVERLAY_FIELDS, type CatalogOverlay } from '@/lib/catalog-person-overlay';

const FIELD_LABEL: Record<string, string> = {
  role: 'Role', based_in: 'Based in', linkedin_url: 'LinkedIn', background: 'Background',
  hook: 'Hook', watch_outs: 'Watch-outs', intro_path: 'Intro path', email_guess: 'Email (guess)', kill_words: 'Kill words',
};

function formatValue(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

export function CatalogSuggestions({ catalogPersonId, person, onApply }: {
  catalogPersonId: string;
  person: Record<string, unknown>;
  onApply: (field: string, value: unknown) => void;
}) {
  const [overlay, setOverlay] = useState<CatalogOverlay>({});

  useEffect(() => {
    if (!authEnabled) return;
    let cancelled = false;
    fetchCatalogOverlay(browserClient(), catalogPersonId).then((o) => { if (!cancelled) setOverlay(o); });
    return () => { cancelled = true; };
  }, [catalogPersonId]);

  const suggestions = overlayForEmptyFields(overlay, person);
  const fields = CATALOG_OVERLAY_FIELDS.filter((f) => suggestions[f]);
  if (fields.length === 0) return null;

  return (
    <div className="rounded-lg border border-cyan-200 bg-cyan-50/60 p-2.5 text-xs">
      <div className="mb-1.5 font-medium text-cyan-900">From the Sherlock catalog</div>
      <ul className="space-y-1">
        {fields.map((field) => {
          const s = suggestions[field];
          if (!s) return null;
          return (
            <li key={field} className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-gray-700">{FIELD_LABEL[field] ?? field}:</span>
              <span className="text-gray-700">{formatValue(s.value)}</span>
              <button onClick={() => onApply(field, s.value)}
                className="rounded bg-[#0E7490] px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-[#0c637b]">
                Use this
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
