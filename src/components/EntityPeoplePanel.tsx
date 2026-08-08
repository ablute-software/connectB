'use client';
// Prompt 138 D1 — surfaces catalog_people enrichment (Prompt 137) on the
// entity detail page. This is a LIVE read against the shared catalog, never
// copied into the frozen per-org `entities` snapshot — an entity's team can
// improve after a founder already unlocked it, and this must reflect that.
//
// entities.id (private, per-org) -> catalog_deliveries.entity_id -> catalog_id
//   -> catalog_person_affiliations.entity_id = catalog_id -> catalog_people
//   (+ catalog_people_research for the hook)
//
// RLS (0146) already covers this read for any org that has the entity in
// catalog_deliveries — no policy change needed. The hook is still only
// rendered when hook_status = 'researched' AND catalog_entity_enrichment_sources
// has at least one row for the person — the same no-hook-without-provenance
// rule the worker itself enforces, checked again here rather than trusted
// blindly from hook_status alone.
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase';
import { Card } from '@/components/ui';

type PersonRow = {
  title: string | null;
  kind: string;
  is_primary: boolean;
  catalog_people: {
    id: string;
    full_name: string;
    linkedin_url: string | null;
    linkedin_verified: boolean;
    hook_status: string;
    catalog_people_research: { hook: string | null } | { hook: string | null }[] | null;
    catalog_entity_enrichment_sources: { id: string }[] | null;
  } | null;
};

type PanelState =
  | { kind: 'loading' }
  | { kind: 'no_catalog_link' }
  | { kind: 'pending' }
  | { kind: 'ready'; people: PersonRow[] }
  | { kind: 'error' };

export function EntityPeoplePanel({ entityId }: { entityId: string }) {
  const [state, setState] = useState<PanelState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      const sb = browserClient();
      const { data: delivery, error: deliveryErr } = await sb
        .from('catalog_deliveries').select('catalog_id').eq('entity_id', entityId).maybeSingle();
      if (cancelled) return;
      if (deliveryErr || !delivery) { setState({ kind: 'no_catalog_link' }); return; }
      const catalogId = delivery.catalog_id as string;

      const { data: catalogEntity, error: catalogErr } = await sb
        .from('catalog_entities').select('enrichment_status').eq('id', catalogId).maybeSingle();
      if (cancelled) return;
      if (catalogErr) { setState({ kind: 'error' }); return; }
      if (!catalogEntity || catalogEntity.enrichment_status === 'pending') { setState({ kind: 'pending' }); return; }

      const { data: rows, error: rowsErr } = await sb
        .from('catalog_person_affiliations')
        .select(`
          title, kind, is_primary,
          catalog_people (
            id, full_name, linkedin_url, linkedin_verified, hook_status,
            catalog_people_research ( hook ),
            catalog_entity_enrichment_sources ( id )
          )
        `)
        .eq('entity_id', catalogId)
        .eq('current', true);
      if (cancelled) return;
      if (rowsErr) { setState({ kind: 'error' }); return; }
      setState({ kind: 'ready', people: (rows ?? []) as unknown as PersonRow[] });
    })();
    return () => { cancelled = true; };
  }, [entityId]);

  if (state.kind === 'loading') return null; // avoids a layout flash on every page visit
  if (state.kind === 'no_catalog_link' || state.kind === 'error') return null;

  return (
    <Card title="Team">
      {state.kind === 'pending' ? (
        <p className="text-sm text-gray-400">Still preparing data on this team.</p>
      ) : state.people.length === 0 ? (
        <p className="text-sm text-gray-400">No team members found yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {state.people.map((row) => {
            const p = row.catalog_people;
            if (!p) return null;
            const research = Array.isArray(p.catalog_people_research) ? p.catalog_people_research[0] : p.catalog_people_research;
            const sourceCount = p.catalog_entity_enrichment_sources?.length ?? 0;
            const hook = p.hook_status === 'researched' && sourceCount > 0 ? research?.hook ?? null : null;
            return (
              <li key={p.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900">{p.full_name}</span>
                  {row.title && <span className="text-xs text-gray-500">{row.title}</span>}
                  {p.linkedin_verified && p.linkedin_url && (
                    <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#0E7490] hover:underline">
                      LinkedIn
                    </a>
                  )}
                </div>
                {hook && <p className="mt-1 text-sm italic text-gray-600">“{hook}”</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
