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
// state, official bio, the evidence timeline itself, aggregated topics,
// full sources, and affiliations.
//
// "Dossier de pessoa — passo 4 (UI)", 26/09/2026 — rebuilt again on top of
// the real schema landed by the two "passo 3" migrations
// (20260926172005/20260926172020) and the real Portugal Ventures import
// (301 catalog_evidence rows, 241 catalog_person_research_log rows, 36
// people). This is the rich dossier itself, not another card bolted onto
// the old evidence-first list: a header with no hook, a compact "quick
// view" derived entirely from real rows, a period-aware timeline
// (role_history split into employment/board_advisory, respecting
// period_*_precision), a "their own words" section that only shows
// genuine excerpts, experience/topics annotated with relation_kind so a
// professional-affiliation tag is never presented as a personal
// declaration, portfolio relationships phrased at exactly the strength the
// source supports, grouped publications with progressive disclosure,
// education, and a research-coverage panel driven only by real
// catalog_person_research_log rows (an absent scope is never rendered as
// "not found"). Nothing here is invented: every section is hidden when its
// backing data is empty, per Nuno's own UI rules for this prompt.
//
// Deliberately a separate system from /people/[id] (private, per-org
// pipeline contacts, db.people/AffiliationsCard) — no FK between the two
// (migration 0146 DESVIO 1). This page reads the shared catalog live via
// browserClient(), same pattern as EntityPeoplePanel.tsx, never the local
// store's `db` for the person/affiliation data itself (db.org.id is the
// one thing this page DOES read from the store, to resolve "my org's own
// catalog_deliveries" for the link rule below).
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { useStore } from '@/lib/store';
import { authEnabled, browserClient } from '@/lib/supabase';
import { researchStateLabel } from '@/lib/research-state';
import { evidenceKindLabel, evidenceStatusLabel } from '@/lib/evidence-labels';
import {
  RESEARCH_SCOPE_ORDER,
  formatEvidenceDate,
  formatPeriodRange,
  portfolioRelationshipPhrase,
  relationKindLabel,
  researchResultLabel,
  researchScopeLabel,
  roleTypeLabel,
} from '@/lib/dossier-labels';

type Affiliation = {
  id: string;
  title: string | null;
  kind: string;
  is_primary: boolean;
  entity_id: string; // catalog_entities.id — NOT a valid /entities/[id] route id, see the link rule below
  catalog_entities: { id: string; name: string; type: string } | { id: string; name: string; type: string }[] | null;
};

type EvidenceTopic = { topicId: string; label: string | null; confidence: number; relationKind: string | null };
type EvidenceItem = {
  id: string; kind: string; title: string; url: string; published_at: string | null;
  excerpt: string | null; language: string | null; strength: number | null;
  is_personal: boolean; status: string; origin: string; created_at: string;
  role_type: string | null;
  period_from: string | null; period_from_precision: string | null;
  period_to: string | null; period_to_precision: string | null; period_is_current: boolean | null;
  provenance: Record<string, unknown> | null;
  topics: EvidenceTopic[];
};

// The importer marks a career mention it refused to force into
// role_history (a composite entry mixing several roles/companies in one
// text block, or an un-decomposed free-text career summary) with one of
// these two provenance_source values. Real history — must stay visible
// somewhere, just never asserted as classified employment/board_advisory.
const UNCLASSIFIED_ROLE_PROVENANCE_SOURCES = new Set(['showcase_structured_ambiguous_role', 'excel_dossier_fallback']);
function isUnclassifiedCareerMention(e: EvidenceItem): boolean {
  return e.kind === 'other' && UNCLASSIFIED_ROLE_PROVENANCE_SOURCES.has(String(e.provenance?.provenance_source ?? ''));
}
type SourceItem = {
  id: string; source_url: string | null; source_type: string | null; published_at: string | null;
  verified_at: string | null; supports: string | null; quality: string | null; notes: string | null;
  batch_id: string | null; created_at: string;
};
type TopicAgg = { topicId: string; label: string; count: number; avgConfidence: number; relationKinds: Set<string> };
type ResearchLogRow = { scope: string; result: string; searched_at: string };

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
      researchLog: ResearchLogRow[];
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
  const byTopic = new Map<string, { label: string; confidences: number[]; relationKinds: Set<string> }>();
  for (const e of evidence) {
    for (const t of e.topics) {
      if (!t.label) continue;
      const entry = byTopic.get(t.topicId) ?? { label: t.label, confidences: [], relationKinds: new Set<string>() };
      entry.confidences.push(t.confidence);
      if (t.relationKind) entry.relationKinds.add(t.relationKind);
      byTopic.set(t.topicId, entry);
    }
  }
  return [...byTopic.entries()]
    .map(([topicId, v]) => ({
      topicId, label: v.label, count: v.confidences.length,
      avgConfidence: v.confidences.reduce((a, b) => a + b, 0) / v.confidences.length,
      relationKinds: v.relationKinds,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// A topic's chip shows a single relation-nature qualifier when every
// evidence row tagging it agrees; when the evidence disagrees (e.g. both a
// professional-experience mention AND the person's own direct statement),
// it is left unqualified rather than picking one side — the chip must
// never assert a personality trait, only what kind of evidence backs it.
function topicRelationQualifier(t: TopicAgg): string | null {
  if (t.relationKinds.size !== 1) return null;
  const [only] = t.relationKinds;
  return relationKindLabel(only) ?? null;
}

// Reusable progressive-disclosure list — collapses to `limit` items with a
// "show N more" toggle. Local component so every grouped section (career
// timeline, publications-by-kind, their-own-words) gets the same behaviour
// instead of one section growing into an unbounded wall of cards.
function ExpandableList<T>({ items, limit, renderItem, keyOf }: {
  items: T[]; limit: number; renderItem: (item: T) => React.ReactNode; keyOf: (item: T) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, limit);
  const hidden = items.length - visible.length;
  return (
    <>
      <ul className="divide-y divide-gray-100">
        {visible.map((item) => <li key={keyOf(item)} className="py-2.5">{renderItem(item)}</li>)}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-xs font-medium text-[#0E7490] hover:underline"
        >
          Show {hidden} more
        </button>
      )}
    </>
  );
}

// kinds treated as the person's own voice — a real quote/excerpt in their
// name, never a third-party writeup about them (article_about explicitly
// excluded: that belongs in Publications, not "in their own words").
const OWN_VOICE_KINDS = new Set(['statement', 'interview', 'podcast', 'social_post', 'article_authored']);
// Grouping + display order for the Publications & appearances section.
const PUBLICATION_GROUPS: { kind: string; label: string }[] = [
  { kind: 'interview', label: 'Interviews' },
  { kind: 'podcast', label: 'Podcasts' },
  { kind: 'article_authored', label: 'Articles authored' },
  { kind: 'article_about', label: 'Articles about them' },
  { kind: 'talk_event', label: 'Talks / events' },
  { kind: 'social_post', label: 'Social posts' },
  { kind: 'press_release', label: 'Press releases' },
];

function EvidenceLine({ e }: { e: EvidenceItem }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          {evidenceKindLabel(e.kind)}
        </span>
        <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-medium text-[#0E7490] hover:underline">{e.title}</a>
        {formatEvidenceDate(e.published_at) && <span className="text-xs text-gray-400">{formatEvidenceDate(e.published_at)}</span>}
        {e.language && <span className="text-xs text-gray-400">· {e.language}</span>}
      </div>
      {e.excerpt && <p className="mt-1 text-sm italic text-gray-600">&ldquo;{e.excerpt}&rdquo;</p>}
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
        <span>{evidenceStatusLabel(e.status)}</span>
        {e.is_personal && <span className="font-medium text-amber-700">· personal statement</span>}
      </div>
    </>
  );
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

      const [{ data: research }, { data: evidenceRows }, { data: sourceRows }, { data: affRows }, { data: researchLogRows }] = await Promise.all([
        // bio_raw is the only research field 0B.1 reads; updated_at is
        // added only as the enriched_at fallback timestamp (Nuno's
        // decision, 25/09/2026 — see research-state.ts's own comment).
        sb.from('catalog_people_research').select('bio_raw, updated_at').eq('person_id', personId).maybeSingle(),
        sb.from('catalog_evidence')
          .select(`
            id, kind, title, url, published_at, excerpt, language, strength, is_personal, status, origin, created_at,
            role_type, period_from, period_from_precision, period_to, period_to_precision, period_is_current, provenance,
            catalog_evidence_topics ( topic_id, confidence, relation_kind, topic_taxonomy ( label_en ) )
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
        // Passo 3 (20260926172020) — research coverage. An absent scope
        // here is NOT "not found": it is "never searched", and the UI
        // below must render that distinction, not paper over it.
        sb.from('catalog_person_research_log')
          .select('scope, result, searched_at')
          .eq('person_id', personId)
          .order('searched_at', { ascending: false }),
      ]);
      if (cancelled) return;

      const evidence: EvidenceItem[] = (evidenceRows ?? []).map((e) => {
        const rawTopics = (e.catalog_evidence_topics ?? []) as unknown as {
          topic_id: string; confidence: number; relation_kind: string | null;
          topic_taxonomy: { label_en: string } | { label_en: string }[] | null;
        }[];
        const topics: EvidenceTopic[] = rawTopics.map((t) => {
          const tax = Array.isArray(t.topic_taxonomy) ? t.topic_taxonomy[0] : t.topic_taxonomy;
          return { topicId: t.topic_id, label: tax?.label_en ?? null, confidence: Number(t.confidence ?? 0), relationKind: t.relation_kind };
        });
        return {
          id: e.id, kind: e.kind, title: e.title, url: e.url, published_at: e.published_at,
          excerpt: e.excerpt, language: e.language, strength: e.strength, is_personal: e.is_personal,
          status: e.status, origin: e.origin, created_at: e.created_at,
          role_type: e.role_type ?? null,
          period_from: e.period_from ?? null, period_from_precision: e.period_from_precision ?? null,
          period_to: e.period_to ?? null, period_to_precision: e.period_to_precision ?? null,
          period_is_current: e.period_is_current ?? null,
          provenance: (e.provenance as Record<string, unknown> | null) ?? null,
          topics,
        };
      });

      const sources = (sourceRows ?? []) as unknown as SourceItem[];
      const researchLog = (researchLogRows ?? []) as unknown as ResearchLogRow[];

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
        evidence, topics: aggregateTopics(evidence), sources, affiliations, researchLog, orgEntityIdByCatalogId,
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

        const primaryAffiliation = s.affiliations.find((a) => a.is_primary) ?? s.affiliations[0] ?? null;
        const primaryFund = primaryAffiliation
          ? (Array.isArray(primaryAffiliation.catalog_entities) ? primaryAffiliation.catalog_entities[0] : primaryAffiliation.catalog_entities)
          : null;

        const roleHistory = s.evidence
          .filter((e) => e.kind === 'role_history')
          .slice()
          .sort((a, b) => (b.period_from ?? '').localeCompare(a.period_from ?? ''));
        const employment = roleHistory.filter((e) => e.role_type === 'employment');
        const boardRoles = roleHistory.filter((e) => e.role_type === 'board_advisory');
        const education = s.evidence.filter((e) => e.kind === 'education');
        const portfolio = s.evidence.filter((e) => e.kind === 'portfolio_relationship');
        const ownVoice = s.evidence.filter((e) => OWN_VOICE_KINDS.has(e.kind) && e.excerpt);
        const unclassifiedRoles = s.evidence.filter(isUnclassifiedCareerMention);

        // Timeline: career + board history, plus education rows that carry
        // a real period — never an undated row asserted into a
        // chronology it can't actually support.
        const timelineItems = [...roleHistory, ...education.filter((e) => e.period_from || e.period_to)]
          .slice()
          .sort((a, b) => (b.period_from ?? b.published_at ?? '').localeCompare(a.period_from ?? a.published_at ?? ''));

        const lastEvidenceDate = s.evidence.reduce<string | null>((max, e) => {
          if (!e.published_at) return max;
          return !max || e.published_at > max ? e.published_at : max;
        }, null);

        // Research coverage — only scopes with a real row; latest row wins
        // when a scope was searched more than once.
        const latestByScope = new Map<string, ResearchLogRow>();
        for (const row of s.researchLog) {
          const existing = latestByScope.get(row.scope);
          if (!existing || row.searched_at > existing.searched_at) latestByScope.set(row.scope, row);
        }
        const coverageRows = RESEARCH_SCOPE_ORDER
          .map((scope) => latestByScope.get(scope))
          .filter((r): r is ResearchLogRow => !!r);

        return (
          <>
            {/* (1) Header — identity, current role, official link, research
                state one-liner. No hook, no invented framing. */}
            <div>
              <h1 className="text-xl font-bold text-gray-900">{s.person.full_name}</h1>
              {primaryAffiliation && primaryFund && (
                <p className="mt-0.5 text-sm text-gray-600">
                  {primaryAffiliation.title ? `${primaryAffiliation.title} · ` : ''}{primaryFund.name}
                </p>
              )}
              {s.person.linkedin_verified && s.person.linkedin_url && (
                <a href={s.person.linkedin_url} target="_blank" rel="noopener noreferrer"
                  className="mt-1 inline-block text-sm text-[#0E7490] hover:underline">
                  LinkedIn
                </a>
              )}
              <p className="mt-1 text-xs text-gray-400">{s.researchState}</p>
            </div>

            {/* (2) Quick view — a compact, fully-derived summary. Every
                number here comes straight from the arrays below; nothing
                is written as prose here. */}
            <Card title="At a glance">
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-gray-600">
                {employment.length > 0 && <li>{employment.length} career {employment.length === 1 ? 'role' : 'roles'}</li>}
                {boardRoles.length > 0 && <li>{boardRoles.length} board / advisory {boardRoles.length === 1 ? 'seat' : 'seats'}</li>}
                {education.length > 0 && <li>{education.length} education {education.length === 1 ? 'entry' : 'entries'}</li>}
                {s.topics.length > 0 && <li>{s.topics.length} main {s.topics.length === 1 ? 'topic' : 'topics'}</li>}
                {ownVoice.length > 0 && <li>{ownVoice.length} statement{ownVoice.length === 1 ? '' : 's'} / media</li>}
                {portfolio.length > 0 && <li>{portfolio.length} portfolio {portfolio.length === 1 ? 'relationship' : 'relationships'}</li>}
                {lastEvidenceDate && <li>Last public evidence: {formatEvidenceDate(lastEvidenceDate)}</li>}
              </ul>
            </Card>

            {/* (3) Biography. */}
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

            {/* (4) Timeline — career + board + dated education, newest
                first, each end respecting its own precision. Employment
                and board/advisory rows are visually distinguished by
                badge, never merged into one undifferentiated "role". */}
            {timelineItems.length > 0 && (
              <Card title="Timeline">
                <ul className="divide-y divide-gray-100">
                  {timelineItems.map((e) => (
                    <li key={e.id} className="py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          e.kind === 'education' ? 'bg-purple-50 text-purple-700'
                          : e.role_type === 'board_advisory' ? 'bg-amber-50 text-amber-700'
                          : 'bg-cyan-50 text-cyan-700'
                        }`}>
                          {e.kind === 'education' ? 'Education' : (roleTypeLabel(e.role_type) ?? 'Role')}
                        </span>
                        <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-medium text-[#0E7490] hover:underline">{e.title}</a>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {formatPeriodRange(e.period_from, e.period_from_precision, e.period_to, e.period_to_precision, e.period_is_current)}
                      </p>
                      {e.excerpt && <p className="mt-1 text-sm text-gray-600">{e.excerpt}</p>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* (4b) Other career mentions the importer found but could not
                classify with confidence between employment/board_advisory
                (a composite text block naming several roles/companies at
                once, or a free-text career summary that was never
                decomposed) — real history, but never asserted into the
                Timeline as a specific role type. */}
            {unclassifiedRoles.length > 0 && (
              <Card title="Other career mentions (not classified)">
                <ul className="divide-y divide-gray-100">
                  {unclassifiedRoles.map((e) => (
                    <li key={e.id} className="py-2.5">
                      <p className="text-sm font-medium text-gray-700">{e.title}</p>
                      <p className="mt-1 text-xs text-gray-500">{e.excerpt}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* (5) In their own words — real excerpts only; a quote is
                distinguished visually from a paraphrase/summary by kind
                (statement/social_post = the person's own written words;
                interview/podcast/article_authored = a public appearance,
                the excerpt is the platform's summary of it, not verbatim). */}
            {ownVoice.length > 0 && (
              <Card title="In their own words">
                <ExpandableList
                  items={ownVoice}
                  limit={4}
                  keyOf={(e) => e.id}
                  renderItem={(e) => {
                    const isDirectQuote = e.kind === 'statement' || e.kind === 'social_post';
                    return (
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            {evidenceKindLabel(e.kind)}
                          </span>
                          {formatEvidenceDate(e.published_at) && <span className="text-xs text-gray-400">{formatEvidenceDate(e.published_at)}</span>}
                          <span className="text-[10px] uppercase tracking-wide text-gray-400">{isDirectQuote ? 'direct quote' : 'summary of appearance'}</span>
                        </div>
                        <p className="mt-1 text-sm text-gray-700">
                          {isDirectQuote ? <>&ldquo;{e.excerpt}&rdquo;</> : e.excerpt}
                        </p>
                        <a href={e.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-[#0E7490] hover:underline">{e.title}</a>
                      </div>
                    );
                  }}
                />
              </Card>
            )}

            {/* (6) Experience & topics — aggregated from evidence, each
                chip annotated with the nature of the evidence behind it
                when every tag agrees; never presented as a personality
                trait. */}
            {s.topics.length > 0 && (
              <Card title="Experience & topics">
                <ul className="flex flex-wrap gap-1.5">
                  {s.topics.map((t) => {
                    const qualifier = topicRelationQualifier(t);
                    return (
                      <li key={t.topicId} className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs text-cyan-700">
                        {t.label}{qualifier ? ` — ${qualifier}` : ''} · {t.count} {t.count === 1 ? 'item' : 'items'}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}

            {/* (7) Portfolio relationships — phrased at exactly the
                strength the source supports, never inferred ("invested
                in"). */}
            {portfolio.length > 0 && (
              <Card title={`Portfolio relationships (${portfolio.length})`}>
                <ExpandableList
                  items={portfolio}
                  limit={5}
                  keyOf={(e) => e.id}
                  renderItem={(e) => (
                    <div>
                      <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-medium text-[#0E7490] hover:underline">
                        {portfolioRelationshipPhrase(e.title, e.strength)}
                      </a>
                      {e.excerpt && <p className="mt-1 text-sm text-gray-600">{e.excerpt}</p>}
                    </div>
                  )}
                />
              </Card>
            )}

            {/* (8) Publications & appearances — grouped by kind, each
                group with its own progressive disclosure so this never
                turns into dozens of identical cards. */}
            {PUBLICATION_GROUPS.some((g) => s.evidence.some((e) => e.kind === g.kind)) && (
              <Card title="Publications & appearances">
                <div className="space-y-4">
                  {PUBLICATION_GROUPS.map((g) => {
                    const items = s.evidence.filter((e) => e.kind === g.kind);
                    if (items.length === 0) return null;
                    return (
                      <div key={g.kind}>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{g.label} ({items.length})</h3>
                        <ExpandableList items={items} limit={3} keyOf={(e) => e.id} renderItem={(e) => <EvidenceLine e={e} />} />
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* (9) Education — its own section (also surfaced with dates
                in the Timeline above when a period is known). */}
            {education.length > 0 && (
              <Card title="Education">
                <ul className="divide-y divide-gray-100">
                  {education.map((e) => (
                    <li key={e.id} className="py-2.5">
                      <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-medium text-[#0E7490] hover:underline">{e.title}</a>
                      {(e.period_from || e.period_to) && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          {formatPeriodRange(e.period_from, e.period_from_precision, e.period_to, e.period_to_precision, e.period_is_current)}
                        </p>
                      )}
                      {e.excerpt && <p className="mt-1 text-sm text-gray-600">{e.excerpt}</p>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* (10) Research coverage — only real catalog_person_research_log
                rows. An absent scope is simply absent from this list, never
                rendered as "not found". */}
            {coverageRows.length > 0 && (
              <Card title="Research coverage">
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
                  {coverageRows.map((r) => (
                    <li key={r.scope}>
                      {researchScopeLabel(r.scope)}: <span className={r.result === 'found' ? 'text-emerald-700' : 'text-gray-400'}>{researchResultLabel(r.result)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {/* (11) Sources — collapsed by default once there are more than
                a handful, so this never becomes a wall of URLs. */}
            {s.sources.length > 0 && (
              <Card title={`Sources (${s.sources.length})`}>
                <details open={s.sources.length <= 6}>
                  <summary className="cursor-pointer text-xs font-medium text-gray-500">
                    {s.sources.length <= 6 ? 'All sources' : `Show all ${s.sources.length} sources`}
                  </summary>
                  <ul className="mt-1.5 divide-y divide-gray-100">
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
                </details>
              </Card>
            )}

            {/* (12) Affiliations — unchanged. */}
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

            {/* (13) Legal footer — unchanged. Prompt 616 §B.2 / 626 §C — this
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
