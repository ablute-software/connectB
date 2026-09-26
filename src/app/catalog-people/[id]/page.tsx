'use client';
// Prompt 291 — profile page for a catalog-level person (catalog_people),
// showing every CURRENT affiliation across funds, not just the one the
// founder happened to click through from. Real people — Carlos Moreira da
// Silva, Ricardo Jacinto, João Coelho Borges, Maria Villas-Boas — hold
// several current affiliations; the product should show that, not hide it
// behind a single-entity view.
//
// Prompt 737 §0B.1 — rebuilt from the old 3-field read-only view (hook,
// background, affiliations) into an evidence-first dossier. Removed
// entirely: the "★ Hook" and "Background" cards, every read of
// hook/background/hook_status, and the old hasProvenance/limit(1) gate.
// No hook-suggestion entry point (Fase 4) and no "propose evidence" form
// (Fase 1) — this page is read-only for now.
//
// Prompt 737 §9.A (26/09/2026, "dossier rico") — rebuilt again on top of
// the Passo 3 schema (role_history/role_type/period_*/catalog_person_
// research_log), per plano_definitivo_dossier_de_pessoa_pos_auditoria_
// v2_20260926.md's Bloco C/F. The single flat "Evidence" list is replaced
// by tabs for the content Passo 3 actually added — Percurso (career/board
// history), Educação, Na própria voz (direct quotes), Publicações &
// eventos (everything else) — shown only when they have content. Topics,
// Sources, and Affiliations stay as their own always-visible sections,
// unchanged from 0B.1: they already worked, and Bloco F's own wireframe
// predates 0B.1 shipping them this way. "Na própria voz" reads
// kind='statement', not is_personal=true as the plan's own C.7 literally
// says — checked directly against the real Portugal Ventures import: the
// importer (scripts/importers/pv_person_dossier_import/generate_sql.py)
// hardcodes is_personal=false on every row it writes, so the is_personal
// filter would leave this tab permanently empty despite Marco Neves alone
// having 10 real, attributed quotes on file. Flagged in DECISIONS.md as an
// importer gap, not fixed here (out of this prompt's scope).
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
import { evidenceKindLabel, evidenceStatusLabel, researchScopeLabel, roleTypeLabel } from '@/lib/evidence-labels';
import { buildFactualSummary } from '@/lib/person-summary';
import { formatPeriod, type DatePrecision } from '@/lib/period-format';

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
  roleType: string | null;
  periodFrom: string | null; periodFromPrecision: DatePrecision;
  periodTo: string | null; periodToPrecision: DatePrecision;
  periodIsCurrent: boolean | null;
};
type SourceItem = {
  id: string; source_url: string | null; source_type: string | null; published_at: string | null;
  verified_at: string | null; supports: string | null; quality: string | null; notes: string | null;
  batch_id: string | null; created_at: string;
};
type TopicAgg = { topicId: string; label: string; count: number; avgConfidence: number };
type ResearchLogRow = { scope: string; result: string; searchedAt: string };
type TabKey = 'career' | 'education' | 'quotes' | 'media';

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

// §9.A, Bloco D.4 — the current state of a research scope is the MOST
// RECENT log row for it, never an accumulation: a log is append-only, and
// a fresh "found" always supersedes an older "not_found" for the same
// scope. Rows the caller never fetches more than once per scope in
// practice today (one import pass), but this holds even if that changes.
function latestPerScope(rows: ResearchLogRow[]): ResearchLogRow[] {
  const byScope = new Map<string, ResearchLogRow>();
  for (const r of rows) {
    const existing = byScope.get(r.scope);
    if (!existing || r.searchedAt > existing.searchedAt) byScope.set(r.scope, r);
  }
  return [...byScope.values()];
}

export default function CatalogPersonPage() {
  const params = useParams<{ id: string }>();
  const personId = params.id;
  const router = useRouter();
  const { db } = useStore();
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'not_found' }
    | { kind: 'unavailable' }
    | { kind: 'error' }
    | {
        kind: 'ready';
        person: { id: string; full_name: string; linkedin_url: string | null; linkedin_verified: boolean };
        researchState: string;
        bioRaw: string | null;
        bioSource: SourceItem | null;
        bioFallbackEvidence: EvidenceItem | null;
        factualSummary: string | null;
        careerEvidence: EvidenceItem[];
        educationEvidence: EvidenceItem[];
        quoteEvidence: EvidenceItem[];
        mediaEvidence: EvidenceItem[];
        topics: TopicAgg[];
        sources: SourceItem[];
        affiliations: Affiliation[];
        notResearched: ResearchLogRow[];
        orgEntityIdByCatalogId: Map<string, string>;
      }
  >({ kind: 'loading' });
  const [activeTab, setActiveTab] = useState<TabKey | null>(null);

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

      const [{ data: research }, { data: evidenceRows }, { data: sourceRows }, { data: affRows }, { data: researchLogRows }] = await Promise.all([
        // bio_raw is the only research field 0B.1 reads; updated_at is
        // added only as the enriched_at fallback timestamp (Nuno's
        // decision, 25/09/2026 — see research-state.ts's own comment).
        sb.from('catalog_people_research').select('bio_raw, updated_at').eq('person_id', personId).maybeSingle(),
        sb.from('catalog_evidence')
          .select(`
            id, kind, title, url, published_at, excerpt, language, strength, is_personal, status, origin, created_at,
            role_type, period_from, period_from_precision, period_to, period_to_precision, period_is_current,
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
        // §9.A, Bloco D.4/E.1 — "pesquisado, sem resultado" has to be shown
        // as such, never silently omitted or invented as an empty evidence
        // row (that's exactly what this log exists to prevent).
        sb.from('catalog_person_research_log')
          .select('scope, result, searched_at')
          .eq('person_id', personId),
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
          roleType: e.role_type, periodFrom: e.period_from, periodFromPrecision: e.period_from_precision,
          periodTo: e.period_to, periodToPrecision: e.period_to_precision, periodIsCurrent: e.period_is_current,
        };
      });

      const sources = (sourceRows ?? []) as unknown as SourceItem[];

      // §0B.1(2) — official bio: bio_raw with the source that supports it,
      // else the first bio-kind evidence row (only when bio_raw is empty).
      const bioRaw = research?.bio_raw ?? null;
      const bioSource = bioRaw ? sources.find((s) => s.supports === 'bio_raw') ?? null : null;
      const bioFallbackEvidence = !bioRaw ? evidence.find((e) => e.kind === 'bio') ?? null : null;

      const researchState = researchStateLabel(person.enrichment_status, person.enriched_at, research?.updated_at as string | null | undefined);

      // §9.A — the four tabs. "quotes" is kind='statement' (see the file's
      // own header comment for why, not is_personal). "media" is every
      // remaining kind, so nothing real is ever silently dropped.
      const careerEvidence = evidence.filter((e) => e.kind === 'role_history')
        .sort((a, b) => (b.periodFrom ?? '9999').localeCompare(a.periodFrom ?? '9999'));
      const educationEvidence = evidence.filter((e) => e.kind === 'education');
      const quoteEvidence = evidence.filter((e) => e.kind === 'statement');
      const mediaEvidence = evidence.filter((e) => !['role_history', 'education', 'statement'].includes(e.kind));

      const topics = aggregateTopics(evidence);

      const affiliations = (affRows ?? []) as unknown as Affiliation[];
      const primary = affiliations[0]; // already ordered is_primary desc
      const primaryFirm = primary ? (Array.isArray(primary.catalog_entities) ? primary.catalog_entities[0] : primary.catalog_entities) : null;
      const factualSummary = buildFactualSummary({
        primaryTitle: primary?.title ?? null,
        primaryFirmName: primaryFirm?.name ?? null,
        strongEvidenceCount: evidence.filter((e) => (e.strength ?? 0) >= 3).length,
        topTopicLabel: topics[0]?.label ?? null,
      });

      const notResearched = latestPerScope(
        (researchLogRows ?? []).map((r) => ({ scope: r.scope as string, result: r.result as string, searchedAt: r.searched_at as string })),
      ).filter((r) => r.result !== 'found').sort((a, b) => researchScopeLabel(a.scope).localeCompare(researchScopeLabel(b.scope)));

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

      const firstTab: TabKey | null = careerEvidence.length ? 'career'
        : educationEvidence.length ? 'education'
        : quoteEvidence.length ? 'quotes'
        : mediaEvidence.length ? 'media' : null;
      setActiveTab(firstTab);

      setState({
        kind: 'ready', person, researchState, bioRaw, bioSource, bioFallbackEvidence, factualSummary,
        careerEvidence, educationEvidence, quoteEvidence, mediaEvidence,
        topics, sources, affiliations, notResearched, orgEntityIdByCatalogId,
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
        const allTabs: { key: TabKey; label: string; count: number }[] = [
          { key: 'career', label: 'Career', count: s.careerEvidence.length },
          { key: 'education', label: 'Education', count: s.educationEvidence.length },
          { key: 'quotes', label: 'In their own words', count: s.quoteEvidence.length },
          { key: 'media', label: 'Publications & events', count: s.mediaEvidence.length },
        ];
        const tabs = allTabs.filter((t) => t.count > 0);
        const activeItems = activeTab === 'career' ? s.careerEvidence
          : activeTab === 'education' ? s.educationEvidence
          : activeTab === 'quotes' ? s.quoteEvidence
          : activeTab === 'media' ? s.mediaEvidence : [];

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
              {/* (1b) §9.A Bloco C.2 — factual summary, template-built from
                  real fetched facts only (see person-summary.ts); never
                  rendered with nothing grounded behind it. */}
              {s.factualSummary && <p className="mt-2 text-sm text-gray-700">{s.factualSummary}</p>}
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

            {/* (3) §9.A — tabbed evidence: Career / Education / In their own
                words / Publications & events. Only tabs with real content
                ever render, per this page's own "never an empty card" rule
                extended to navigation (plano..._v2, Bloco F). */}
            {tabs.length > 0 && (
              <Card title="Evidence">
                <div className="flex flex-wrap gap-1.5 border-b border-gray-100 pb-2">
                  {tabs.map((t) => (
                    <button key={t.key} onClick={() => setActiveTab(t.key)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${activeTab === t.key ? 'bg-[#0E7490] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {t.label} ({t.count})
                    </button>
                  ))}
                </div>
                <ul className="mt-2 divide-y divide-gray-100">
                  {activeItems.map((e) => {
                    const period = activeTab === 'career' ? formatPeriod({
                      periodFrom: e.periodFrom, periodFromPrecision: e.periodFromPrecision,
                      periodTo: e.periodTo, periodToPrecision: e.periodToPrecision, periodIsCurrent: e.periodIsCurrent,
                    }) : null;
                    const roleTypeText = roleTypeLabel(e.roleType);
                    return (
                      <li key={e.id} className="py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            {evidenceKindLabel(e.kind)}
                          </span>
                          {roleTypeText && <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">{roleTypeText}</span>}
                          <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-medium text-[#0E7490] hover:underline">{e.title}</a>
                          {period ? (
                            <span className="text-xs text-gray-400">{period}</span>
                          ) : (
                            <span className="text-xs text-gray-400">{e.published_at ?? 'no publication date'}</span>
                          )}
                          {e.language && <span className="text-xs text-gray-400">· {e.language}</span>}
                        </div>
                        {e.excerpt && <p className="mt-1 text-sm italic text-gray-600">“{e.excerpt}”</p>}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
                          <span>{evidenceStatusLabel(e.status)}</span>
                          {e.strength != null && <span>· strength {e.strength}/4</span>}
                          {e.is_personal && <span className="font-medium text-amber-700">· personal statement</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}

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

            {/* (7) §9.A, Bloco D.4/E.1 — scopes genuinely researched with
                nothing found, stated as such rather than left silent or
                faked as evidence. Only ever the negative results — a
                'found' scope already speaks for itself via the sections
                above. */}
            {s.notResearched.length > 0 && (
              <Card title="Researched, nothing found">
                <ul className="flex flex-wrap gap-1.5">
                  {s.notResearched.map((r) => (
                    <li key={r.scope} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                      {researchScopeLabel(r.scope)}{r.result === 'not_public' ? ' — not public' : ''}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* (8) Legal footer — unchanged. Prompt 616 §B.2 / 626 §C — this
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
