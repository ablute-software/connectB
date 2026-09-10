'use client';
// Prompt 291 — profile page for a catalog-level person (catalog_people),
// showing every CURRENT affiliation across funds, not just the one the
// founder happened to click through from. Real people — Carlos Moreira da
// Silva, Ricardo Jacinto, João Coelho Borges, Maria Villas-Boas — hold
// several current affiliations; the product should show that, not hide it
// behind a single-entity view.
//
// Prompt 585 §D — rebuilt from a plain 3-field read-only view into the
// full evidence page: why this person (topic signal, §C.5), the evidence
// timeline itself (§A), background/affiliations (kept from 291),
// attention (watch-outs/kill-words), contact & path, and a "propose
// evidence" flow for founders (§D.3, quarantined until 3-org consensus or
// an admin decides — see migration 0347). The hook-suggestion button §D's
// own text puts in the header is Phase 4's — not built here; this phase
// only ships what §H's own ordering allows before it ("não mesclar a
// fase 4 sem a 3").
//
// Deliberately a separate system from /people/[id] (private, per-org
// pipeline contacts, db.people/AffiliationsCard) — no FK between the two
// (migration 0146 DESVIO 1). This page reads the shared catalog live via
// browserClient(), same pattern as EntityPeoplePanel.tsx, never the local
// store's `db` for the person/affiliation data itself (db.org.id is the
// one thing this page DOES read from the store, to resolve "my org's own
// catalog_deliveries" for the link rule below and for the topic-signal/
// contact-context RPCs, which are scoped per org).
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { useStore } from '@/lib/store';
import { authEnabled, browserClient } from '@/lib/supabase';
import { seniorityRankLabel } from '@/lib/seniority-rank-label';
import { FOUNDER_EVIDENCE_KINDS, validateEvidenceProposal } from '@/lib/catalog-evidence-propose';
import { HookSuggestionCard } from '@/components/HookSuggestionCard';
import type { HookChannel } from '@/lib/hook-pack';

type Affiliation = {
  id: string;
  title: string | null;
  kind: string;
  is_primary: boolean;
  seniority_rank: number | null;
  entity_id: string; // catalog_entities.id — NOT a valid /entities/[id] route id, see the link rule below
  catalog_entities: { id: string; name: string; type: string } | { id: string; name: string; type: string }[] | null;
};

type EvidenceItem = {
  id: string; kind: string; title: string; url: string; excerpt: string | null;
  published_at: string | null; status: string; created_by_org_id: string | null;
  source_domain: string | null;
  topics: { topicId: string; label: string | null }[];
};

type TopicSignal = {
  score: number;
  meetsThreshold: boolean;
  watchOuts: { evidence_id: string; title: string; url: string; topic_id: string }[];
  topEvidence: { evidence_id: string; title: string; url: string; topic_id: string; contribution: number }[];
};

type ContactContext = { acceptsColdContact: boolean | null };

type PageState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'unavailable' } // demo mode — this page has nothing to read
  | { kind: 'error' }
  | {
      kind: 'ready';
      person: { id: string; full_name: string; linkedin_url: string | null; linkedin_verified: boolean };
      research: { watchOuts: string | null; killWords: string[] | null; introPath: string | null; bioRaw: string | null } | null;
      hook: string | null;
      background: string | null;
      affiliations: Affiliation[];
      evidence: EvidenceItem[];
      signal: TopicSignal | null;
      topicLabelById: Map<string, string>;
      // Prompt 291 §2 — the exact rule: catalog_deliveries.entity_id is
      // "the org-side copy" (0002_catalog.sql, literal comment). A fund's
      // catalog_id is not a valid /entities/[id] target — only the
      // DELIVERED org-side entity_id is. Map from catalog_id (=
      // affiliation.entity_id) to that org-side id, populated only for
      // funds THIS org has actually unlocked; every other affiliation
      // renders as plain text, never a guessed/dead link.
      orgEntityIdByCatalogId: Map<string, string>;
      // Prompt 585 §D — contact-and-path context for the one current
      // affiliation (if any) this org has actually delivered, "reuse only
      // what's real": submission_channel_type from the org's own private
      // entities row, accepts_cold_contact via the narrow RPC Phase 2 built.
      contactEntity: { orgEntityId: string; catalogEntityId: string; name: string; submissionChannelType: string } | null;
      contactContext: ContactContext | null;
    };

const STATUS_LABEL: Record<string, string> = {
  found: 'Found by the engine',
  verified: 'Verified',
  quarantined: 'Proposed by you — under review',
};

function evidenceStatusLabel(status: string, isOwnProposal: boolean): string {
  if (status === 'quarantined') return isOwnProposal ? 'Proposed by you — under review' : 'Under review';
  return STATUS_LABEL[status] ?? status;
}

export default function CatalogPersonPage() {
  const params = useParams<{ id: string }>();
  const personId = params.id;
  const router = useRouter();
  const { db } = useStore();
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [reloadNonce, setReloadNonce] = useState(0);

  // Propose-evidence form state.
  const [proposing, setProposing] = useState(false);
  const [proposeDraft, setProposeDraft] = useState({ url: '', kind: '', title: '', excerpt: '', publishedAt: '' });
  const [proposeError, setProposeError] = useState('');
  const [proposeBusy, setProposeBusy] = useState(false);

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

      const [{ data: research }, { data: sources }, { data: affRows }, { data: evidenceRows }, { data: signalRaw }] = await Promise.all([
        sb.from('catalog_people_research').select('hook, background, watch_outs, kill_words, intro_path, bio_raw').eq('person_id', personId).maybeSingle(),
        sb.from('catalog_entity_enrichment_sources').select('id').eq('person_id', personId).limit(1),
        sb.from('catalog_person_affiliations')
          .select('id, title, kind, is_primary, seniority_rank, entity_id, catalog_entities ( id, name, type )')
          .eq('person_id', personId).eq('current', true)
          .order('is_primary', { ascending: false }),
        sb.from('catalog_evidence')
          .select('id, kind, title, url, excerpt, published_at, status, created_by_org_id, source_domain, catalog_evidence_topics ( topic_id, topic_taxonomy ( label_en ) )')
          .eq('person_id', personId)
          .order('published_at', { ascending: false, nullsFirst: false }),
        sb.rpc('catalog_topic_signal', { p_org_id: db.org.id, p_person_id: personId, p_entity_id: null }),
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

      const topicLabelById = new Map<string, string>();
      const evidence: EvidenceItem[] = (evidenceRows ?? []).map((e) => {
        const rawTopics = (e.catalog_evidence_topics ?? []) as unknown as { topic_id: string; topic_taxonomy: { label_en: string } | { label_en: string }[] | null }[];
        const topics = rawTopics.map((t) => {
          const tax = Array.isArray(t.topic_taxonomy) ? t.topic_taxonomy[0] : t.topic_taxonomy;
          if (tax?.label_en) topicLabelById.set(t.topic_id, tax.label_en);
          return { topicId: t.topic_id, label: tax?.label_en ?? null };
        });
        return {
          id: e.id, kind: e.kind, title: e.title, url: e.url, excerpt: e.excerpt,
          published_at: e.published_at, status: e.status, created_by_org_id: e.created_by_org_id,
          source_domain: e.source_domain, topics,
        };
      });

      const signalObj = signalRaw as { score?: number; meets_threshold?: boolean; watch_outs?: unknown; top_evidence?: unknown } | null;
      const signal: TopicSignal | null = signalObj ? {
        score: Number(signalObj.score ?? 0),
        meetsThreshold: !!signalObj.meets_threshold,
        watchOuts: (signalObj.watch_outs ?? []) as TopicSignal['watchOuts'],
        topEvidence: (signalObj.top_evidence ?? []) as TopicSignal['topEvidence'],
      } : null;

      // Contact & path — only for a current affiliation this org has
      // actually delivered (never a guessed channel for a fund the
      // founder hasn't unlocked). First one is fine: multiple delivered
      // affiliations for one person is a rare edge case, not worth a
      // picker on a page whose job is "who is this and why".
      let contactEntity: { orgEntityId: string; catalogEntityId: string; name: string; submissionChannelType: string } | null = null;
      let contactContext: ContactContext | null = null;
      const deliveredAffiliation = affiliations.find((a) => orgEntityIdByCatalogId.has(a.entity_id));
      if (deliveredAffiliation) {
        const orgEntityId = orgEntityIdByCatalogId.get(deliveredAffiliation.entity_id)!;
        const fund = Array.isArray(deliveredAffiliation.catalog_entities) ? deliveredAffiliation.catalog_entities[0] : deliveredAffiliation.catalog_entities;
        const { data: orgEntity } = await sb.from('entities').select('submission_channel_type').eq('id', orgEntityId).maybeSingle();
        if (cancelled) return;
        contactEntity = { orgEntityId, catalogEntityId: deliveredAffiliation.entity_id, name: fund?.name ?? 'this firm', submissionChannelType: orgEntity?.submission_channel_type ?? 'unknown' };
        const { data: contextRaw } = await sb.rpc('catalog_entity_contact_context', { p_org_id: db.org.id, p_catalog_id: deliveredAffiliation.entity_id });
        if (cancelled) return;
        const ctx = contextRaw as { accepts_cold_contact?: boolean | null } | null;
        contactContext = { acceptsColdContact: ctx?.accepts_cold_contact ?? null };
      }

      setState({
        kind: 'ready', person, hook, background, affiliations, evidence, signal, topicLabelById,
        research: research ? { watchOuts: research.watch_outs, killWords: research.kill_words, introPath: research.intro_path, bioRaw: research.bio_raw } : null,
        orgEntityIdByCatalogId, contactEntity, contactContext,
      });
    })();
    return () => { cancelled = true; };
  }, [personId, db.org.id, reloadNonce]);

  async function submitProposal() {
    setProposeError('');
    const validation = validateEvidenceProposal(proposeDraft);
    if (!validation.ok) { setProposeError(validation.errors.join(' ')); return; }
    setProposeBusy(true);
    try {
      const res = await fetch(`/api/catalog-people/${personId}/evidence/propose`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validation.normalized),
      });
      const body = await res.json();
      if (!body.ok) { setProposeError(body.error ?? 'Could not save.'); return; }
      setProposing(false);
      setProposeDraft({ url: '', kind: '', title: '', excerpt: '', publishedAt: '' });
      setReloadNonce((n) => n + 1);
    } catch (e) {
      setProposeError((e as Error).message);
    } finally {
      setProposeBusy(false);
    }
  }

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
        const primary = s.affiliations.find((a) => a.is_primary) ?? s.affiliations[0];
        const primaryFund = primary ? (Array.isArray(primary.catalog_entities) ? primary.catalog_entities[0] : primary.catalog_entities) : null;
        const rankLabel = seniorityRankLabel(primary?.seniority_rank);
        const verdict: 'interest' | 'mention' | 'none' = !s.signal ? 'none'
          : s.signal.score > 0 ? 'interest' : s.signal.topEvidence.length > 0 ? 'mention' : 'none';

        return (
          <>
            {/* Header — §D: name, title, firm, LinkedIn, seniority label.
                No "On Sherlock Deal" badge: that signal doesn't exist yet
                (confirmed against the live schema — platform_member_id
                isn't a real column on catalog_people) and this page
                doesn't fabricate a proxy for it. */}
            <div>
              <h1 className="text-xl font-bold text-gray-900">{s.person.full_name}</h1>
              <p className="mt-0.5 text-sm text-gray-500">
                {primary?.title ?? rankLabel ?? 'Role unknown'}{primaryFund ? ` at ${primaryFund.name}` : ''}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {s.person.linkedin_verified && s.person.linkedin_url && (
                  <a href={s.person.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-sm text-[#0E7490] hover:underline">LinkedIn</a>
                )}
                {rankLabel && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">{rankLabel}</span>}
              </div>
              {/* Prompt 585 §F.8 — one of the hook service's three entry
                  points. Only offered when this org has actually
                  delivered one of this person's current affiliations
                  (same "in your pipeline" barrier the propose-evidence
                  route enforces) — no entity context, no pack to build. */}
              {s.contactEntity && (
                <div className="mt-2">
                  <HookSuggestionCard
                    targetKind="person" targetId={s.person.id} entityId={s.contactEntity.catalogEntityId}
                    channel={s.person.linkedin_verified ? 'linkedin' : (s.contactEntity.submissionChannelType === 'form' ? 'form' : 'email') as HookChannel}
                    label={`Suggest hook for ${s.person.full_name}`}
                    onUseInDraft={(text) => router.push(`/entities/${s.contactEntity!.orgEntityId}?hookDraft=${encodeURIComponent(text)}`)}
                  />
                </div>
              )}
            </div>

            {/* §D — "Porquê esta pessoa": the topic-signal verdict + up to
                3 justifying evidence lines, all from real, linked evidence
                (§C.5 — template-generated, never a model). */}
            {s.signal && (
              <Card title="Why this person" tint={verdict === 'interest' ? 'blue' : undefined}>
                {verdict === 'interest' && (
                  <>
                    <p className="text-sm font-medium text-gray-800">Real interest for your profile.</p>
                    <ul className="mt-2 space-y-1.5 text-sm text-gray-700">
                      {s.signal.topEvidence.slice(0, 3).map((te) => (
                        <li key={te.evidence_id}>
                          {s.topicLabelById.get(te.topic_id) ?? 'Topic'} — <a href={te.url} target="_blank" rel="noopener noreferrer" className="text-[#0E7490] hover:underline">{te.title}</a>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {verdict === 'mention' && <p className="text-sm text-gray-600">Mentioned in evidence related to your topics, but not enough yet to call it real interest.</p>}
                {verdict === 'none' && <p className="text-sm text-gray-400">No signal yet for your profile — that doesn’t mean no, just no evidence to go on.</p>}
                {s.signal.watchOuts.length > 0 && (
                  <div className="mt-3 border-t border-gray-100 pt-2">
                    <p className="text-xs font-semibold text-amber-700">Watch out</p>
                    <ul className="mt-1 space-y-1 text-xs text-amber-800">
                      {s.signal.watchOuts.map((w) => (
                        <li key={w.evidence_id}><a href={w.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{w.title}</a></li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            )}

            {/* §D — Evidence timeline. */}
            <Card title={`Evidence (${s.evidence.length})`}>
              {s.evidence.length === 0 && !s.hook ? (
                <div>
                  <p className="text-sm text-gray-400">Still no public evidence on file for this person.</p>
                  <button onClick={() => setProposing(true)} className="mt-2 rounded-lg border border-cyan-200 px-2.5 py-1.5 text-xs font-medium text-cyan-800 hover:bg-cyan-50">
                    Add evidence
                  </button>
                </div>
              ) : (
                <>
                  <ul className="divide-y divide-gray-100">
                    {s.evidence.map((e) => (
                      <li key={e.id} className="py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{e.kind.replace('_', ' ')}</span>
                          <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-medium text-[#0E7490] hover:underline">{e.title}</a>
                          {e.published_at && <span className="text-xs text-gray-400">{e.published_at}</span>}
                        </div>
                        {e.excerpt && <p className="mt-1 text-sm italic text-gray-600">“{e.excerpt}”</p>}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-gray-400">
                            {evidenceStatusLabel(e.status, e.created_by_org_id === db.org.id)}
                            {e.source_domain && ` · ${e.source_domain}`}
                          </span>
                          {e.topics.map((t) => t.label && (
                            <span key={t.topicId} className="rounded-full bg-cyan-50 px-1.5 py-0.5 text-[10px] text-cyan-700">{t.label}</span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {!proposing && (
                    <button onClick={() => setProposing(true)} className="mt-3 text-xs font-medium text-cyan-700 hover:underline">
                      + Add evidence
                    </button>
                  )}
                </>
              )}
              {proposing && (
                <div className="mt-3 space-y-2 rounded-lg border border-gray-200 p-3">
                  <input value={proposeDraft.url} onChange={(e) => setProposeDraft((d) => ({ ...d, url: e.target.value }))}
                    placeholder="https://… (link to the public source)" autoComplete="off"
                    className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
                  <div className="flex flex-wrap gap-2">
                    <select value={proposeDraft.kind} onChange={(e) => setProposeDraft((d) => ({ ...d, kind: e.target.value }))}
                      className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm">
                      <option value="">What kind of evidence?</option>
                      {FOUNDER_EVIDENCE_KINDS.map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
                    </select>
                    <input type="date" value={proposeDraft.publishedAt} onChange={(e) => setProposeDraft((d) => ({ ...d, publishedAt: e.target.value }))}
                      autoComplete="off"
                      className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
                  </div>
                  <input value={proposeDraft.title} onChange={(e) => setProposeDraft((d) => ({ ...d, title: e.target.value }))}
                    placeholder="Short title" autoComplete="off"
                    className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
                  <textarea value={proposeDraft.excerpt} onChange={(e) => setProposeDraft((d) => ({ ...d, excerpt: e.target.value }))}
                    placeholder="Verbatim quote from the source (optional, up to 600 characters)" rows={2}
                    className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
                  {proposeError && <p className="text-xs text-[#B00000]">{proposeError}</p>}
                  <div className="flex gap-2">
                    <button disabled={proposeBusy} onClick={submitProposal} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                      {proposeBusy ? 'Saving…' : 'Submit for review'}
                    </button>
                    <button onClick={() => { setProposing(false); setProposeError(''); }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </Card>

            {s.background && (
              <Card title="Background"><p className="text-sm text-gray-600">{s.background}</p></Card>
            )}

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

            {/* §D — Attention: kill words + research-level watch-outs
                (distinct from the evidence-derived watch_outs shown in
                "Why this person" above — this is the worker's own list). */}
            {(s.research?.watchOuts || (s.research?.killWords && s.research.killWords.length > 0)) && (
              <Card title="Attention" tint="amber">
                {s.research?.killWords && s.research.killWords.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {s.research.killWords.map((w) => (
                      <span key={w} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">{w}</span>
                    ))}
                  </div>
                )}
                {s.research?.watchOuts && <p className="text-sm text-amber-900">{s.research.watchOuts}</p>}
              </Card>
            )}

            {/* §D — Contact and path. Reuses only real signals (Phase 2's
                own decision): LinkedIn, accepts_cold_contact via the
                narrow RPC, and the org's own submission_channel_type —
                never an invented email or grant system. */}
            <Card title="Contact and path">
              <ul className="space-y-1.5 text-sm text-gray-700">
                {s.person.linkedin_verified && s.person.linkedin_url && (
                  <li><a href={s.person.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-[#0E7490] hover:underline">Message on LinkedIn</a></li>
                )}
                {s.contactContext?.acceptsColdContact && (
                  <li>{s.contactEntity?.name ?? 'This firm'} is open to being contacted directly.</li>
                )}
                {s.contactEntity?.submissionChannelType === 'form' && (
                  <li>{s.contactEntity.name} has an official submission form — see the Approach tab on their entity page.</li>
                )}
                {s.contactEntity?.submissionChannelType === 'email' && (
                  <li>{s.contactEntity.name} has an official email channel — see the Approach tab on their entity page.</li>
                )}
                {!s.person.linkedin_url && !s.contactContext?.acceptsColdContact && (!s.contactEntity || s.contactEntity.submissionChannelType === 'unknown' || s.contactEntity.submissionChannelType === 'none') && (
                  <li className="text-gray-400">No direct channel on file yet.</li>
                )}
              </ul>
            </Card>
          </>
        );
      })()}
    </div>
  );
}
