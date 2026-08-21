'use client';
// Prompt 291 — profile page for a catalog-level person (catalog_people),
// showing every CURRENT affiliation across funds, not just the one the
// founder happened to click through from. Real people — Carlos Moreira da
// Silva, Ricardo Jacinto, João Coelho Borges, Maria Villas-Boas — hold
// several current affiliations; the product should show that, not hide it
// behind a single-entity view.
//
// Deliberately a separate system from /people/[id] (private, per-org
// pipeline contacts, db.people/AffiliationsCard) — no FK between the two
// (migration 0146 DESVIO 1). This page reads the shared catalog live via
// browserClient(), same pattern as EntityPeoplePanel.tsx, never the local
// store's `db` for the person/affiliation data itself (db.org.id is the
// one thing this page DOES read from the store, to resolve "my org's own
// catalog_deliveries" for the link rule below).
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { useStore } from '@/lib/store';
import { authEnabled, browserClient } from '@/lib/supabase';

type Affiliation = {
  id: string;
  title: string | null;
  kind: string;
  is_primary: boolean;
  entity_id: string; // catalog_entities.id — NOT a valid /entities/[id] route id, see the link rule below
  catalog_entities: { id: string; name: string; type: string } | { id: string; name: string; type: string }[] | null;
};

type PageState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'unavailable' } // demo mode — this page has nothing to read
  | { kind: 'error' }
  | {
      kind: 'ready';
      person: { id: string; full_name: string; linkedin_url: string | null; linkedin_verified: boolean };
      hook: string | null;
      background: string | null;
      affiliations: Affiliation[];
      // Prompt 291 §2 — the exact rule: catalog_deliveries.entity_id is
      // "the org-side copy" (0002_catalog.sql, literal comment). A fund's
      // catalog_id is not a valid /entities/[id] target — only the
      // DELIVERED org-side entity_id is. Map from catalog_id (=
      // affiliation.entity_id) to that org-side id, populated only for
      // funds THIS org has actually unlocked; every other affiliation
      // renders as plain text, never a guessed/dead link.
      orgEntityIdByCatalogId: Map<string, string>;
    };

export default function CatalogPersonPage() {
  const params = useParams<{ id: string }>();
  const personId = params.id;
  const router = useRouter();
  const { db } = useStore();
  const [state, setState] = useState<PageState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    if (!authEnabled) { setState({ kind: 'unavailable' }); return; }
    (async () => {
      const sb = browserClient();
      const { data: person, error: personErr } = await sb.from('catalog_people')
        .select('id, full_name, linkedin_url, linkedin_verified, hook_status')
        .eq('id', personId).maybeSingle();
      if (cancelled) return;
      if (personErr) { setState({ kind: 'error' }); return; }
      if (!person) { setState({ kind: 'not_found' }); return; }

      const [{ data: research }, { data: sources }, { data: affRows }] = await Promise.all([
        sb.from('catalog_people_research').select('hook, background').eq('person_id', personId).maybeSingle(),
        sb.from('catalog_entity_enrichment_sources').select('id').eq('person_id', personId).limit(1),
        sb.from('catalog_person_affiliations')
          .select('id, title, kind, is_primary, entity_id, catalog_entities ( id, name, type )')
          .eq('person_id', personId).eq('current', true)
          .order('is_primary', { ascending: false }),
      ]);
      if (cancelled) return;

      // Same no-hook-without-provenance discipline as EntityPeoplePanel.tsx
      // — never trust hook_status alone. background gets the same
      // provenance gate (it's the same research row, same sensitivity).
      const hasProvenance = (sources?.length ?? 0) > 0;
      const hook = person.hook_status === 'researched' && hasProvenance ? (research?.hook ?? null) : null;
      const background = hasProvenance ? (research?.background ?? null) : null;

      const affiliations = (affRows ?? []) as unknown as Affiliation[];
      const catalogIds = Array.from(new Set(affiliations.map((a) => a.entity_id)));
      const orgEntityIdByCatalogId = new Map<string, string>();
      if (catalogIds.length) {
        const { data: deliveries } = await sb.from('catalog_deliveries')
          .select('catalog_id, entity_id')
          .eq('org_id', db.org.id)
          .in('catalog_id', catalogIds);
        if (cancelled) return;
        for (const d of deliveries ?? []) {
          if (d.entity_id) orgEntityIdByCatalogId.set(d.catalog_id as string, d.entity_id as string);
        }
      }

      setState({ kind: 'ready', person, hook, background, affiliations, orgEntityIdByCatalogId });
    })();
    return () => { cancelled = true; };
  }, [personId, db.org.id]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-8">
      {/* Prompt 291 §3 — router.back(), not a fixed Link: this page can be
          reached from more than one place (a fund's dossier today, another
          person's profile via cross-affiliation later). */}
      <button onClick={() => router.back()} className="text-xs text-gray-400 hover:underline">← Back</button>

      {state.kind === 'loading' && <p className="text-sm text-gray-400">Loading…</p>}
      {state.kind === 'not_found' && <p className="text-sm text-gray-400">Person not found.</p>}
      {state.kind === 'unavailable' && <p className="text-sm text-gray-400">Not available in demo mode — this page reads the live shared catalog.</p>}
      {state.kind === 'error' && <p className="text-sm text-gray-400">Could not load this profile.</p>}

      {state.kind === 'ready' && (
        <>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{state.person.full_name}</h1>
            {state.person.linkedin_verified && state.person.linkedin_url && (
              <a href={state.person.linkedin_url} target="_blank" rel="noopener noreferrer"
                className="mt-1 inline-block text-sm text-[#0E7490] hover:underline">
                LinkedIn
              </a>
            )}
          </div>

          {state.hook && (
            <Card title="★ Hook" tint="blue"><p className="text-sm">{state.hook}</p></Card>
          )}
          {state.background && (
            <Card title="Background"><p className="text-sm text-gray-600">{state.background}</p></Card>
          )}

          <Card title="Affiliations">
            {state.affiliations.length === 0 ? (
              <p className="text-sm text-gray-400">No current affiliations on file.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {state.affiliations.map((a) => {
                  const fund = Array.isArray(a.catalog_entities) ? a.catalog_entities[0] : a.catalog_entities;
                  if (!fund) return null;
                  const orgEntityId = state.orgEntityIdByCatalogId.get(a.entity_id);
                  return (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {orgEntityId ? (
                          <Link href={`/entities/${orgEntityId}`} className="font-medium text-[#0E7490] hover:underline">{fund.name}</Link>
                        ) : (
                          <span className="font-medium text-gray-900">{fund.name}</span>
                        )}
                        {a.title && <span className="text-xs text-gray-500">{a.title}</span>}
                      </div>
                      {/* Prompt 291 §2 — never a dead/guessed link; a plain,
                          discreet note instead when this org hasn't
                          unlocked that fund. */}
                      {!orgEntityId && <span className="text-xs text-gray-400">not yet in your pipeline</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
