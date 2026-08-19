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
import { authEnabled, browserClient } from '@/lib/supabase';
import { Card } from '@/components/ui';
import { useStore } from '@/lib/store';
import { parseKeyPeopleText } from '@/lib/key-people-parse';

function normalizePersonName(s: string): string {
  return s.trim().toLowerCase();
}

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

export function EntityPeoplePanel({ entityId, onShowsKeyPeopleFallback, onPersonAdded }: {
  entityId: string;
  // Prompt 275 §1 — lets the parent page know whether THIS panel is about
  // to show the key_people fallback list, so it can suppress ContributionBox's
  // own "Key people: ... verified" line for the same field on the same
  // render pass — same underlying data (a verified key_people contribution),
  // shown once instead of twice. Fired from an effect (see below), not
  // computed by the parent independently: the parent has no way to know
  // showCatalogPeople (a live Supabase read this component alone owns)
  // without duplicating this component's fetch.
  onShowsKeyPeopleFallback?: (shows: boolean) => void;
  // Prompt 275 §3 — the parent scrolls to and briefly highlights the new
  // row in the "People" card once this fires with the newly created
  // person's id (addPerson returns the row synchronously).
  onPersonAdded?: (personId: string) => void;
}) {
  const { db, addPerson } = useStore();
  const entity = db.entities.find((e) => e.id === entityId);
  const [state, setState] = useState<PanelState>({ kind: 'loading' });
  // Prompt 262 — entities.key_people (free-text research, e.g. Karista.vc's
  // "Olivier Dubuisson (Managing Partner); ...") already went through the
  // SAME contributions review queue as every other confidence-routed
  // research field, and gets a real 'verified' status once a human
  // confirmed it. That confirmation was never read anywhere except this raw
  // ContributionBox line — including here, where it matters most, because
  // this Card was telling the founder "Still preparing data" about a team
  // it already had verified names for. Demo mode has no `contributions`
  // table at all (ContributionBox itself falls back to a plain
  // AddInfoButton there) — presence of entity.key_people alone stands in
  // for "verified" in that mode, since demo data has no submitted/pending
  // state to model in the first place.
  const [keyPeopleVerified, setKeyPeopleVerified] = useState(!authEnabled);

  useEffect(() => {
    if (!authEnabled) return;
    let cancelled = false;
    browserClient().from('contributions').select('id')
      .eq('subject_type', 'entity').eq('subject_id', entityId).eq('field', 'key_people').eq('status', 'verified')
      .limit(1)
      .then(({ data }) => { if (!cancelled) setKeyPeopleVerified(!!data && data.length > 0); });
    return () => { cancelled = true; };
  }, [entityId]);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    // Prompt 262 — found while verifying live: this effect called
    // browserClient() unconditionally, with no `authEnabled` guard (every
    // other Supabase-calling component in this app checks it first —
    // ContributionBox falls back to a plain button, the contributions
    // fetch above returns early). @supabase/ssr throws synchronously when
    // constructed with the empty URL/key demo mode forces, inside an
    // unawaited async IIFE — so `state` never left 'loading', and this
    // whole Card silently never rendered in demo mode, for any entity,
    // catalog-linked or not. Demo mode has no real catalog_deliveries to
    // query anyway, so 'no_catalog_link' is the correct state to settle on.
    if (!authEnabled) { setState({ kind: 'no_catalog_link' }); return; }
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

  const showCatalogPeople = state.kind === 'ready' && state.people.length > 0;
  // Prompt 262 §3 — the catalog (live, more reliable) always wins when it
  // has anything at all; key_people only ever fills the gap when the
  // catalog genuinely has nothing (pending, no link, an error, or an empty
  // ready list) — never overlaid or merged with real catalog rows.
  const keyPeopleFallback = !showCatalogPeople && keyPeopleVerified && entity?.key_people
    ? parseKeyPeopleText(entity.key_people) : [];
  const showKeyPeopleFallback = keyPeopleFallback.length > 0;

  // Prompt 275 §1 — declared before any early return (Rules of Hooks: every
  // hook must run on every render, including the 'loading' one below) so
  // the parent always learns the current value, not just the ones that
  // happen to reach the JSX return.
  useEffect(() => {
    onShowsKeyPeopleFallback?.(showKeyPeopleFallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showKeyPeopleFallback]);

  if (state.kind === 'loading') return null; // avoids a layout flash on every page visit

  // Unchanged from before this prompt: truly nothing to show at all stays
  // invisible rather than an empty Card.
  if (!showCatalogPeople && !showKeyPeopleFallback && (state.kind === 'no_catalog_link' || state.kind === 'error')) return null;

  return (
    <Card title="Team">
      {showKeyPeopleFallback ? (
        <div>
          {/* Prompt 262 — distinct from the catalog cards below: this is
              submitted research a human verified, not a live catalog match.
              Prompt 263 — "Add as contact" turns a parsed name into a real
              db.people row (pre-flight/contact-order/messaging all read
              from there, never from this text). Idempotent by construction:
              it re-checks db.people on every render rather than tracking
              its own "added" flag, so a person who's already there (from a
              previous click, or added some other way entirely) always shows
              "Added as contact" with no button, never a duplicate. */}
          <p className="mb-1 text-xs text-gray-400">From submitted research — verified, not yet a live catalog match.</p>
          {/* Prompt 275 §2 — the Northzone case: a founder saw this list,
              then the same names again in ContributionBox above, then a
              THIRD, unrelated-looking list ("People — one at a time…")
              with a name from neither. This line names what the button
              actually does and where it goes, read before the click
              instead of guessed after. */}
          <p className="mb-2 text-xs text-gray-400">Add as contact to include them in your outreach order below.</p>
          <ul className="divide-y divide-gray-100">
            {keyPeopleFallback.map((p, i) => {
              const already = db.people.some((x) => x.entity_id === entityId && normalizePersonName(x.full_name) === normalizePersonName(p.fullName));
              return (
                <li key={`${p.fullName}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{p.fullName}</span>
                    {p.role && <span className="text-xs text-gray-500">{p.role}</span>}
                  </div>
                  {already ? (
                    <span className="text-xs text-gray-400">Added as contact</span>
                  ) : (
                    <button
                      onClick={() => {
                        const newPerson = addPerson({ entity_id: entityId, full_name: p.fullName, role: p.role ?? undefined });
                        onPersonAdded?.(newPerson.id);
                      }}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                      Add as contact
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : state.kind === 'pending' ? (
        <p className="text-sm text-gray-400">Still preparing data on this team.</p>
      ) : state.kind === 'ready' && state.people.length === 0 ? (
        <p className="text-sm text-gray-400">No team members found yet.</p>
      ) : state.kind !== 'ready' ? (
        // Unreachable in practice: !showKeyPeopleFallback + this state.kind
        // would already have returned null above. Kept only so TypeScript
        // can narrow state.people below without a cast.
        null
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
