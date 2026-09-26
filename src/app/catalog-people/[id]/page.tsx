'use client';
// Prompt 291 — profile page for a catalog-level person (catalog_people),
// showing every CURRENT affiliation across funds, not just the one the
// founder happened to click through from. Real people — Carlos Moreira da
// Silva, Ricardo Jacinto, João Coelho Borges, Maria Villas-Boas — hold
// several current affiliations; the product should show that, not hide it
// behind a single-entity view.
//
// Prompt 737 §0B.1 — rebuilt from the old 3-field read-only view (hook,
// background, affiliations) into an evidence-first dossier: research
// state (§0B.1's own two-value rule — see research-state.ts), official
// bio, the evidence timeline itself, aggregated topics, full sources, and
// affiliations. Removed entirely: the "★ Hook" and "Background" cards,
// every read of hook/background/hook_status, and the old
// hasProvenance/limit(1) gate that used to decide whether to trust them.
// Also removed (Nuno's own amendment to the 737 file-reuse review,
// 26/09/2026): the manual research fields watch_outs/kill_words/intro_path
// — free text with no URL behind it, same "not a fact" rule as hook/
// background — those stay backoffice-only. No hook-suggestion entry point
// either (Fase 4) and no "propose evidence" form (Fase 1) — this page is
// read-only for now.
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
import { researchStateLabel } from '@/lib/research-state';
import { evidenceKindLabel, evidenceStatusLabel } from '@/lib/evidence-labels';

type Affiliation = {
  id: string;
  title: string | null;
  kind: string;
  is_primary: boolean;
  entity_id: string; // catalog_entities.id — NOT a valid /entities/[id] route id, see the link rule below
  catalog_entities: { id: string; name: string; type: string } | { id: string; name: string; type: string }[] | null;
};

type EvidenceTopic = { topicId: string; label: string | null; confidence: number };
type EvidenceItem = {
  id: string; kind: string; title: string; url: string; published_at: string | null;
  excerpt: string | null; language: string | null; strength: number | null;
  is_personal: boolean; status: string; origin: string; created_at: string;
  topics: EvidenceTopic[];
};
type SourceItem = {
  id: string; source_url: string | null; source_type: string | null; published_at: string | null;
  verified_at: string | null; supports: string | null; quality: string | null; notes: string | null;
  batch_id: string | null; created_at: string;
};
type TopicAgg = { topicId: string; label: string; count: number; avgConfidence: number };

type PageState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'unavailable' } // demo mode — this page has nothing to read
  | { kind: 'error' }
  | {
      kind: 'ready';
      person: { id: string; full_name: string; linkedin_url: string | null; linkedin_verified: boolean };
      researchState: string;
      bioRaw: string | null;
      bioSource: SourceItem | null;
      bioFallbackEvidence: EvidenceItem | null;
      evidence: EvidenceItem[];
      topics: TopicAgg[];
      sources: SourceItem[];
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

function aggregateTopics(evidence: EvidenceItem[]): TopicAgg[] {
  const byTopic = new Map<string, { label: string; confidences: number[] }>();
  for (const e of evidence) {
    for (const t of e.topics) {
      if (!t.label) continue;
      const entry = byTopic.get(t.topicId) ?? { label: t.label, confidences: [] };
      entry.confidences.push(t.confidence);
      byTopic.set(t.topicId, entry);
    }
  }
  return [...byTopic.entries()]
    .map(([topicId, v]) => ({
      topicId, label: v.label, count: v.confidences.length,
      avgConfidence: v.confidences.reduce((a, b) => a + b, 0) / v.confidences.length,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

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
        .select('id, full_name, linkedin_url, linkedin_verified, based_in, enrichment_status, enriched_at')
        .eq('id', personId).maybeSingle();
      if (cancelled) return;
      if (personErr) { setState({ kind: 'error' }); return; }
      if (!person) { setState({ kind: 'not_found' }); return; }

      const [{ data: research }, { data: evidenceRows }, { data: sourceRows }, { data: affRows }] = await Promise.all([
        // bio_raw is the only research field 0B.1 reads; updated_at is
        // added only as the enriched_at fallback timestamp (Nuno's
        // decision, 25/09/2026 — see research-state.ts's own comment).
        sb.from('catalog_people_research').select('bio_raw, updated_at').eq('person_id', personId).maybeSingle(),
        sb.from('catalog_evidence')
          .select(`
            id, kind, title, url, published_at, excerpt, language, strength, is_personal, status, origin, created_at,
            catalog_evidence_topics ( topic_id, confidence, topic_taxonomy ( label_en ) )
          `)
          .eq('person_id', personId).in('status', ['found', 'verified'])
          .order('published_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false }),
        sb.from('catalog_entity_enrichment_sources')
          .select('id, source_url, source_type, published_at, verified_at, supports, quality, notes, batch_id, created_at')
          .eq('person_id', personId)
          .order('created_at', { ascending: false }),
        sb.from('catalog_person_affiliations')
          .select('id, title, kind, is_primary, entity_id, catalog_entities ( id, name, type )')
          .eq('person_id', personId).eq('current', true)
          .order('is_primary', { ascending: false }),
      ]);
      if (cancelled) return;

      const evidence: EvidenceItem[] = (evidenceRows ?? []).map((e) => {
        const rawTopics = (e.catalog_evidence_topics ?? []) as unknown as {
          topic_id: string; confidence: number; topic_taxonomy: { label_en: string } | { label_en: string }[] | null;
        }[];
        const topics: EvidenceTopic[] = rawTopics.map((t) => {
          const tax = Array.isArray(t.topic_taxonomy) ? t.topic_taxonomy[0] : t.topic_taxonomy;
          return { topicId: t.topic_id, label: tax?.label_en ?? null, confidence: Number(t.confidence ?? 0) };
        });
        return {
          id: e.id, kind: e.kind, title: e.title, url: e.url, published_at: e.published_at,
          excerpt: e.excerpt, language: e.language, strength: e.strength, is_personal: e.is_personal,
          status: e.status, origin: e.origin, created_at: e.created_at, topics,
        };
      });

      const sources = (sourceRows ?? []) as unknown as SourceItem[];

      // §0B.1(2) — official bio: bio_raw with the source that supports it,
      // else the first bio-kind evidence row (only when bio_raw is empty).
      const bioRaw = research?.bio_raw ?? null;
      const bioSource = bioRaw ? sources.find((s) => s.supports === 'bio_raw') ?? null : null;
      const bioFallbackEvidence = !bioRaw ? evidence.find((e) => e.kind === 'bio') ?? null : null;

      const researchState = researchStateLabel(person.enrichment_status, person.enriched_at, research?.updated_at as string | null | undefined);

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

      setState({
        kind: 'ready', person, researchState, bioRaw, bioSource, bioFallbackEvidence,
        evidence, topics: aggregateTopics(evidence), sources, affiliations, orgEntityIdByCatalogId,
      });
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

      {state.kind === 'ready' && (() => {
        const s = state;
        return (
          <>
            {/* (1) Header + two-value research state. */}
            <div>
              <h1 className="text-xl font-bold text-gray-900">{s.person.full_name}</h1>
              {s.person.linkedin_verified && s.person.linkedin_url && (
                <a href={s.person.linkedin_url} target="_blank" rel="noopener noreferrer"
                  className="mt-1 inline-block text-sm text-[#0E7490] hover:underline">
                  LinkedIn
                </a>
              )}
              <p className="mt-1 text-xs text-gray-400">{s.researchState}</p>
            </div>

            {/* (2) Official bio. */}
            {(s.bioRaw || s.bioFallbackEvidence) && (
              <Card title="Biography">
                {s.bioRaw ? (
                  <>
                    <p className="text-sm text-gray-600">{s.bioRaw}</p>
                    {s.bioSource?.source_url && (
                      <p className="mt-1.5 text-xs text-gray-400">
                        Source:{' '}
                        <a href={s.bioSource.source_url} target="_blank" rel="noopener noreferrer" className="text-[#0E7490] hover:underline">
                          {s.bioSource.source_type ?? s.bioSource.source_url}
                        </a>
                      </p>
                    )}
                  </>
                ) : s.bioFallbackEvidence && (
                  <p className="text-sm text-gray-600">
                    <a href={s.bioFallbackEvidence.url} target="_blank" rel="noopener noreferrer" className="text-[#0E7490] hover:underline">
                      {s.bioFallbackEvidence.title}
                    </a>
                  </p>
                )}
              </Card>
            )}

            {/* (3) Evidence timeline. */}
            <Card title={`Evidence${s.evidence.length ? ` (${s.evidence.length})` : ''}`}>
              {s.evidence.length === 0 ? (
                <p className="text-sm text-gray-400">No evidence on file.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {s.evidence.map((e) => (
                    <li key={e.id} className="py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                          {evidenceKindLabel(e.kind)}
                        </span>
                        <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-medium text-[#0E7490] hover:underline">{e.title}</a>
                        <span className="text-xs text-gray-400">{e.published_at ?? 'no publication date'}</span>
                        {e.language && <span className="text-xs text-gray-400">· {e.language}</span>}
                      </div>
                      {e.excerpt && <p className="mt-1 text-sm italic text-gray-600">“{e.excerpt}”</p>}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
                        <span>{evidenceStatusLabel(e.status)}</span>
                        {e.strength != null && <span>· strength {e.strength}/4</span>}
                        {e.is_personal && <span className="font-medium text-amber-700">· personal statement</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* (4) Aggregated topics — from the evidence rows above, no
                separate call: never a section with nothing in it. */}
            {s.topics.length > 0 && (
              <Card title="Topics">
                <ul className="flex flex-wrap gap-1.5">
                  {s.topics.map((t) => (
                    <li key={t.topicId} className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs text-cyan-700">
                      {t.label} · {t.count} {t.count === 1 ? 'item' : 'items'} · {Math.round(t.avgConfidence * 100)}% avg. confidence
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* (5) Sources — the full enrichment-source trail, distinct from
                the evidence timeline above (a source is how the platform
                found something; evidence is the finding itself). */}
            {s.sources.length > 0 && (
              <Card title={`Sources (${s.sources.length})`}>
                <ul className="divide-y divide-gray-100">
                  {s.sources.map((src) => (
                    <li key={src.id} className="py-1.5 text-xs text-gray-500">
                      {src.source_url ? (
                        <a href={src.source_url} target="_blank" rel="noopener noreferrer" className="text-[#0E7490] hover:underline">
                          {src.source_type ?? src.source_url}
                        </a>
                      ) : (
                        <span>{src.source_type ?? 'unknown source'}</span>
                      )}
                      {src.supports && <span> · supports {src.supports}</span>}
                      {src.batch_id && <span> · batch {src.batch_id}</span>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* (6) Affiliations — unchanged. */}
            <Card title="Affiliations">
              {s.affiliations.length === 0 ? (
                <p className="text-sm text-gray-400">No current affiliations on file.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {s.affiliations.map((a) => {
                    const fund = Array.isArray(a.catalog_entities) ? a.catalog_entities[0] : a.catalog_entities;
                    if (!fund) return null;
                    const orgEntityId = s.orgEntityIdByCatalogId.get(a.entity_id);
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

            {/* (7) Legal footer — unchanged. Prompt 616 §B.2 / 626 §C — this
                page IS a catalogue person's record, shown to a customer. */}
            <p className="text-[11px] text-gray-400">
              Professional details gathered from public sources.{' '}
              <Link href="/legal/privacy-notice" className="underline hover:text-gray-600">How we hold them, and how a person can have them changed or removed</Link>.
            </p>
          </>
        );
      })()}
    </div>
  );
}
