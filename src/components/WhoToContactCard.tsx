'use client';
// Prompt 585 §E — the entity-header "who to contact and why" block. Reads
// catalog_person_priority (Phase 2's deterministic ranking, computed from
// real evidence-backed topic signal + seniority — see migration 0345) for
// the person Sherlock already worked out is the best one to approach at
// this entity, with a plain-language reason. Falls back to entity-level
// reachability signals when no eligible, ranked person exists yet
// (enrichment still pending, or nobody senior enough on file) — per Nuno's
// "reuse only what's real" decision: matchdeal_profiles.accepts_cold_contact
// (via the narrow catalog_entity_contact_context RPC, migration 0346 —
// direct client reads are blocked by matchdeal_investor_members' own RLS)
// and entities.submission_channel_type, never an invented signal.
//
// Demo mode has no catalog evidence/priority data to reason from, so this
// stays hidden there — same "no_catalog_link" pattern EntityPeoplePanel
// already uses.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authEnabled, browserClient } from '@/lib/supabase';
import { useStore } from '@/lib/store';
import type { Entity } from '@/lib/types';

type PriorityPerson = {
  full_name: string;
  linkedin_url: string | null;
  linkedin_verified: boolean;
};

type CardState =
  | { kind: 'loading' }
  | { kind: 'hidden' }
  | { kind: 'person'; person: PriorityPerson; reason: string | null }
  | { kind: 'fallback'; reason: string };

export function WhoToContactCard({ entity }: { entity: Entity }) {
  const { db } = useStore();
  const [state, setState] = useState<CardState>({ kind: 'loading' });

  useEffect(() => {
    if (!authEnabled) { setState({ kind: 'hidden' }); return; }
    let cancelled = false;
    setState({ kind: 'loading' });
    (async () => {
      const sb = browserClient();
      const { data: delivery } = await sb
        .from('catalog_deliveries').select('catalog_id').eq('entity_id', entity.id).maybeSingle();
      if (cancelled) return;
      if (!delivery) { setState({ kind: 'hidden' }); return; }
      const catalogId = delivery.catalog_id as string;

      const { data: top } = await sb
        .from('catalog_person_priority')
        .select('score, justification, catalog_people(full_name, linkedin_url, linkedin_verified)')
        .eq('org_id', db.org.id).eq('entity_id', catalogId)
        .order('rank_position', { ascending: true }).limit(1).maybeSingle();
      if (cancelled) return;

      if (top) {
        const person = (Array.isArray(top.catalog_people) ? top.catalog_people[0] : top.catalog_people) as PriorityPerson | null;
        if (person) {
          const score = Number(top.score ?? 0);
          const reason = score > 0 && top.justification ? (top.justification as string) : null;
          setState({ kind: 'person', person, reason });
          return;
        }
      }

      // No eligible ranked person yet — fall back to entity-level reachability.
      const { data: context } = await sb
        .rpc('catalog_entity_contact_context', { p_org_id: db.org.id, p_catalog_id: catalogId });
      if (cancelled) return;
      const acceptsCold = (context as { accepts_cold_contact?: boolean | null } | null)?.accepts_cold_contact;

      if (acceptsCold) {
        setState({ kind: 'fallback', reason: `${entity.name} is open to being contacted directly — see the Approach tab for the channel.` });
      } else if (entity.submission_channel_type === 'form') {
        setState({ kind: 'fallback', reason: `No specific contact identified yet — use ${entity.name}'s official submission form (Approach tab).` });
      } else if (entity.submission_channel_type === 'email') {
        setState({ kind: 'fallback', reason: `No specific contact identified yet — use ${entity.name}'s official email channel (Approach tab).` });
      } else {
        setState({ kind: 'hidden' });
      }
    })();
    return () => { cancelled = true; };
  }, [entity.id, entity.name, entity.submission_channel_type, db.org.id]);

  if (state.kind === 'loading' || state.kind === 'hidden') return null;

  return (
    <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2.5">
      <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-[11px] font-semibold text-cyan-800">Who to contact</span>
      {state.kind === 'person' ? (
        <p className="mt-1 text-sm text-cyan-900">
          Talk to <span className="font-medium">{state.person.full_name}</span>
          {state.person.linkedin_verified && state.person.linkedin_url && (
            <>
              {' '}(<a href={state.person.linkedin_url} target="_blank" rel="noopener noreferrer" className="underline">LinkedIn</a>)
            </>
          )}
          {state.reason ? <> — {state.reason}</> : <> — the most senior contact on file for this company.</>}
        </p>
      ) : (
        <p className="mt-1 text-sm text-cyan-900">{state.reason}</p>
      )}
    </div>
  );
}
