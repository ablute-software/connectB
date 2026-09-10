'use client';
// Prompt 581 §C — the back-office's own person dossier. No equivalent
// existed before this (confirmed by reading the codebase first — the only
// per-catalog-person UI anywhere was inline <li> rows inside
// EnrichmentCampaignPanel.tsx's buckets); the founder-side /people/[id]
// page is the structural reference this mirrors, adapted to the catalog's
// own fields and an admin's needs rather than a founder's.
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui';
import { browserClient } from '@/lib/supabase';
import { postJson, invokeUntilTerminal } from '@/lib/enrichment-worker-client';

interface Affiliation {
  entityId: string; entityName: string; entityVerified: boolean;
  title: string | null; kind: string; isPrimary: boolean; current: boolean;
  startedAt: string | null; endedAt: string | null;
}
interface QuarantineEntry { id: string; org: string; isTest: boolean; value: unknown; status: string; createdAt: string }
interface QuarantineValue { value: unknown; realOrgCount: number; entries: QuarantineEntry[] }
interface QuarantineField { field: string; verifiedCount: number; entries: QuarantineEntry[]; values: QuarantineValue[] }
interface EvidenceRow {
  id: string; kind: string; title: string; url: string; excerpt: string | null; publishedAt: string | null;
  polarity: string; strength: number; status: string; origin: string; proposedByOrg: string | null;
  verifiedAt: string | null; createdAt: string;
}
interface Dossier {
  person: {
    id: string; fullName: string; entityId: string | null; linkedinUrl: string | null; linkedinVerified: boolean;
    basedIn: string | null; doNotContact: boolean; privacyNoticeSent: boolean; hookStatus: string;
  };
  research: {
    bioRaw: string | null; hook: string | null; introPath: string | null; watchOuts: string | null;
    killWords: string[] | null; background: string | null;
    emailGuess: string | null; emailGuessConfidence: string | null;
    verifiedFields: Record<string, string>; updatedAt: string;
  } | null;
  affiliations: Affiliation[];
  quarantine: QuarantineField[];
  evidence: EvidenceRow[];
  manualLinks: { linkedin: string; google: string; teamPage: string | null; crunchbase: string; dealroom: string };
  activity: { totalInteractions: number; orgsInteracted: number; lastContactedAt: string | null; repliesReceived: number };
}

const LEVEL_LABEL: Record<string, string> = {
  unverified: 'unverified (AI research)', verified_by_startups: 'verified by startups',
  verified_by_admin: 'verified by admin', verified_by_person: 'verified by the person',
};
const LEVEL_STYLE: Record<string, string> = {
  unverified: 'bg-gray-100 text-gray-500', verified_by_startups: 'bg-cyan-50 text-cyan-700',
  verified_by_admin: 'bg-green-50 text-green-700', verified_by_person: 'bg-purple-50 text-purple-700',
};

// Prompt 595 §D — mirrors catalog_person_apply_field's own accepted field
// list (migrations 0322/0325). Anything outside it that function silently
// ignores, so offering it here would promise a write that never happens.
const EDITABLE_FIELDS: { field: string; label: string; multiline?: boolean }[] = [
  { field: 'role', label: 'Role (primary affiliation title)' },
  { field: 'linkedin_url', label: 'LinkedIn URL' },
  { field: 'based_in', label: 'Based in' },
  { field: 'hook', label: 'Hook', multiline: true },
  { field: 'background', label: 'Background', multiline: true },
  { field: 'intro_path', label: 'Intro path', multiline: true },
  { field: 'watch_outs', label: 'Watch-outs', multiline: true },
  { field: 'email_guess', label: 'Email (guess)' },
];

function currentFieldValue(
  field: string,
  person: Dossier['person'],
  research: Dossier['research'],
  affiliations: Affiliation[],
): string {
  if (field === 'role') return affiliations.find((a) => a.isPrimary)?.title ?? '';
  if (field === 'linkedin_url') return person.linkedinUrl ?? '';
  if (field === 'based_in') return person.basedIn ?? '';
  if (!research) return '';
  const map: Record<string, string | null | undefined> = {
    hook: research.hook, background: research.background,
    intro_path: research.introPath, watch_outs: research.watchOuts, email_guess: research.emailGuess,
  };
  return map[field] ?? '';
}

function ResearchField({ label, value, level }: { label: string; value: string | null | undefined; level?: string }) {
  if (!value) return null;
  const lvl = level ?? 'unverified';
  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${LEVEL_STYLE[lvl] ?? LEVEL_STYLE.unverified}`}>{LEVEL_LABEL[lvl] ?? lvl}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-gray-700">{value}</p>
    </div>
  );
}

// Prompt 595 §B.2 — "seta de voltar atrás, para o ecrã de onde se partiu —
// não um 'voltar' genérico que atira para o índice". The origin travels in
// the URL (?from=&fromLabel=), the same mechanism 576 §3a uses for the
// back-office exit button and for the same reason: nothing here can
// re-derive where you came from. Falls back to the enrichment campaign,
// which is where this link always used to go.
//
// useSearchParams needs its own Suspense boundary or `next build` fails at
// prerender — this repo has already paid for that once (CLAUDE.md rule 5).
function PersonDossierContent({ id }: { id: string }) {
  const search = useSearchParams();
  const backHref = search.get('from') || '/backoffice/catalog?tab=campaign';
  const backLabel = search.get('fromLabel') || 'Enrichment campaign';
  const [data, setData] = useState<Dossier | null>(null);
  const [err, setErr] = useState('');
  const [researching, setResearching] = useState(false);
  const [researchState, setResearchState] = useState<{ state: string; detail?: string } | null>(null);
  const [decidingKey, setDecidingKey] = useState<string | null>(null);
  const [decidingEvidenceId, setDecidingEvidenceId] = useState<string | null>(null);
  // Prompt 595 §D — developer field editing.
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [savingField, setSavingField] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState('');

  function load() {
    fetch(`/api/backoffice/catalog/people/${id}`).then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setData(body);
    }).catch(() => setErr('Failed to load.'));
  }
  useEffect(load, [id]);

  async function researchNow() {
    setResearching(true); setResearchState({ state: 'queued' });
    const { data: { session } } = await browserClient().auth.getSession();
    if (!session) { setResearchState({ state: 'failed', detail: 'Session expired — sign in again.' }); setResearching(false); return; }
    const enq = await postJson('/api/backoffice/catalog/enrichment-campaign/enqueue-person-layer2', { catalogPersonId: id });
    if (!enq.ok || enq.skip) { setResearchState({ state: 'failed', detail: enq.reason ?? enq.error ?? 'Could not enqueue.' }); setResearching(false); return; }
    setResearchState({ state: 'researching' });
    const result = await invokeUntilTerminal(session.access_token, 2, () =>
      postJson('/api/backoffice/catalog/enrichment-campaign/collect-person-layer2-result', { catalogPersonId: id, jobId: enq.jobId }));
    if (result.kind === 'abort' || result.kind === 'error') setResearchState({ state: 'failed', detail: result.message });
    else if (result.kind === 'stuck') setResearchState({ state: 'stuck', detail: 'Queued but the worker never claimed it — try again.' });
    else {
      const collected = result.collected;
      setResearchState({ state: collected.hookWritten ? 'researched' : 'none_found', detail: collected.hookWritten ? 'Hook found.' : 'No usable hook found.' });
      load();
    }
    setResearching(false);
  }

  // Prompt 595 §D / 597 — writes through catalog_person_apply_field at
  // verified_by_admin (see the route). `applied: false` comes back when the
  // function found nothing to write (role with no primary affiliation), and
  // is surfaced rather than swallowed as a success.
  async function saveField(field: string) {
    setSavingField(field);
    setEditNotice('');
    try {
      const res = await fetch(`/api/backoffice/catalog/people/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field, value: draft }),
      });
      const body = await res.json();
      if (!body.ok) { setEditNotice(body.error ?? 'Could not save.'); return; }
      if (!body.applied) setEditNotice(body.message ?? 'Nothing was written.');
      setEditingField(null);
      load();
    } catch (e) {
      setEditNotice((e as Error).message);
    } finally {
      setSavingField(null);
    }
  }

  async function decide(field: string, value: unknown, decision: 'approve' | 'reject') {
    const key = `${field}:${JSON.stringify(value)}`;
    setDecidingKey(key);
    try {
      const reviewerNotes = decision === 'reject' ? window.prompt('Reason for rejecting (optional):') ?? undefined : undefined;
      const res = await fetch(`/api/backoffice/catalog/people/${id}/quarantine`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field, value, decision, reviewerNotes }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? 'Could not save the decision.');
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDecidingKey(null);
    }
  }

  async function decideEvidence(evidenceId: string, decision: 'approve' | 'reject') {
    setDecidingEvidenceId(evidenceId);
    try {
      const reviewerNotes = decision === 'reject' ? window.prompt('Reason for rejecting (optional):') ?? undefined : undefined;
      const res = await fetch(`/api/backoffice/catalog/people/${id}/evidence/${evidenceId}/decide`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, reviewerNotes }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? 'Could not save the decision.');
      load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDecidingEvidenceId(null);
    }
  }

  if (err) return <Card title="Person"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!data) return <Card title="Person"><p className="text-sm text-gray-400">Loading…</p></Card>;
  const { person, research, affiliations, quarantine, evidence, manualLinks, activity } = data;
  const pendingEvidence = evidence.filter((e) => e.status === 'quarantined');
  const reviewedEvidence = evidence.filter((e) => e.status !== 'quarantined');
  const primary = affiliations.find((a) => a.isPrimary) ?? affiliations[0];
  // Prompt 599 §3 — counts the affiliations card states plainly.
  const currentCount = affiliations.filter((a) => a.current).length;
  const pastCount = affiliations.length - currentCount;
  const datedCount = affiliations.filter((a) => a.startedAt || a.endedAt).length;
  const pointerDisagrees = !!person.entityId && !!primary && primary.entityId !== person.entityId;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link href={backHref} className="text-xs text-gray-400 hover:underline">← {backLabel}</Link>
      </div>

      {/* §C.1 — Identity */}
      <Card title={person.fullName}>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-[11px] uppercase tracking-wide text-gray-400">LinkedIn</span>
            <p>{person.linkedinUrl ? (
              <a href={person.linkedinUrl} target="_blank" rel="noreferrer" className="text-[#0E7490] hover:underline">
                {person.linkedinVerified ? 'Profile ✓ verified' : 'Profile (unverified)'}
              </a>
            ) : <span className="text-gray-400">—</span>}</p>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wide text-gray-400">Email</span>
            <p className="text-gray-700">
              {research?.emailGuess ? `Estimated, ${research.emailGuessConfidence ?? 'unknown'} confidence` : <span className="text-gray-400">None on file</span>}
            </p>
          </div>
          {person.basedIn && <div><span className="text-[11px] uppercase tracking-wide text-gray-400">Based in</span><p className="text-gray-700">{person.basedIn}</p></div>}
          {primary?.entityName && (
            <div>
              <span className="text-[11px] uppercase tracking-wide text-gray-400">Firm</span>
              <p><Link href={`/backoffice/catalog?q=${encodeURIComponent(primary.entityName)}`} className="text-[#0E7490] hover:underline">{primary.entityName}</Link></p>
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {person.doNotContact && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-[#B00000]">Do not contact</span>}
          {person.privacyNoticeSent && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">Privacy notice sent</span>}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">Hook: {person.hookStatus.replace('_', ' ')}</span>
        </div>
      </Card>

      {/* §C.2 — Affiliations. Prompt 599 §3: current AND past, with entry/
          exit dates, read from catalog_person_affiliations — the real join
          table. catalog_people.entity_id is only the current/primary
          convenience pointer (nullable, ON DELETE SET NULL): a person with
          no firm keeps its record, and this card says so instead of
          rendering nothing. Dates are reported honestly: the columns exist
          but 0 of 3326 rows carried one on 2026-09-07, so "no dates
          recorded" is the true state of the data, not a rendering gap. */}
      <Card title={`Affiliations (${affiliations.length})`}>
        {affiliations.length === 0 ? (
          <p className="text-sm text-gray-400">
            None on file — this person has no current firm. The record stays: nothing deletes a person as a side effect of losing a firm.
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-gray-500">
              {currentCount} current · {pastCount} past · {datedCount === 0 ? 'no dates recorded' : `dates recorded for ${datedCount} of ${affiliations.length}`}
            </p>
            {pointerDisagrees && (
              <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-800">
                The current-firm pointer on this person (catalog_people.entity_id) points at a different firm than the primary
                affiliation below. The affiliations are the truth shown here; the pointer is stale.
              </p>
            )}
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400"><th className="py-1">Firm</th><th>Title</th><th>Kind</th><th>Status</th><th>Dates</th></tr></thead>
              <tbody>
                {affiliations.map((a) => (
                  <tr key={`${a.entityId}:${a.kind}`} className={`border-t border-gray-50 ${a.current ? '' : 'text-gray-400'}`}>
                    <td className="py-1.5"><Link href={`/backoffice/catalog?q=${encodeURIComponent(a.entityName)}`} className="text-[#0E7490] hover:underline">{a.entityName}</Link></td>
                    <td className={a.current ? 'text-gray-600' : ''}>{a.title ?? '—'}</td>
                    <td className={a.current ? 'text-gray-500' : ''}>{a.kind}</td>
                    <td className={a.current ? 'text-gray-500' : ''}>{a.isPrimary && 'primary'}{a.isPrimary && !a.current ? ', ' : ''}{!a.current && 'past'}{a.isPrimary || !a.current ? '' : 'current'}</td>
                    <td className={a.current ? 'text-gray-500' : ''}>
                      {a.startedAt || a.endedAt
                        ? `${a.startedAt ?? '?'} → ${a.endedAt ?? (a.current ? 'present' : '?')}`
                        : <span className="text-gray-300">no dates recorded</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>

      {/* §C.3 — Research */}
      <Card title="Research">
        <div className="mb-3 flex items-center gap-2">
          <button disabled={researching} onClick={() => void researchNow()}
            className="rounded-lg bg-[#0E7490] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
            {researching ? (researchState?.state === 'queued' ? 'Queued…' : 'Researching…') : 'Research now'}
          </button>
          {researchState && !researching && (
            <span className={`text-xs ${researchState.state === 'researched' ? 'text-green-700' : researchState.state === 'failed' || researchState.state === 'stuck' ? 'text-[#B00000]' : 'text-gray-500'}`}>
              {researchState.detail}
            </span>
          )}
          {research?.updatedAt && <span className="ml-auto text-[11px] text-gray-400">Last updated {research.updatedAt.slice(0, 10)}</span>}
        </div>
        {!research ? <p className="text-sm text-gray-400">No research on file yet.</p> : (
          <div className="grid gap-2 sm:grid-cols-2">
            <ResearchField label="Bio" value={research.bioRaw} />
            <ResearchField label="Hook" value={research.hook} level={research.verifiedFields.hook} />
            <ResearchField label="Intro path" value={research.introPath} level={research.verifiedFields.intro_path} />
            <ResearchField label="Background" value={research.background} level={research.verifiedFields.background} />
            <ResearchField label="Watch-outs" value={research.watchOuts} level={research.verifiedFields.watch_outs} />
            <ResearchField label="Kill words" value={research.killWords?.join(', ')} level={research.verifiedFields.kill_words} />
          </div>
        )}
      </Card>

      {/* Prompt 595 §D / 597 — developers edit people the way 584 let them
          edit entities: straight to live, no quarantine, and marked
          verified_by_admin so the automatic consensus won't quietly
          overwrite it later (597's own argument for this option, and Nuno's
          choice when asked). */}
      <Card title="Edit as developer">
        <p className="mb-3 text-xs text-gray-500">
          Saved immediately — no quarantine, no consensus wait. Each field is recorded as{' '}
          <span className="font-mono text-[11px]">verified_by_admin</span>, which is what stops three agreeing startups from
          overwriting it later. Every save writes a before/after line to the audit log.
        </p>
        {editNotice && <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-800">{editNotice}</p>}
        <dl className="space-y-2.5">
          {EDITABLE_FIELDS.map(({ field, label, multiline }) => {
            const value = currentFieldValue(field, person, research, affiliations);
            return (
              <div key={field} className="border-b border-gray-50 pb-2.5 last:border-0">
                <dt className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    {label}
                    {research?.verifiedFields?.[field] && (
                      <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${LEVEL_STYLE[research.verifiedFields[field]] ?? LEVEL_STYLE.unverified}`}>
                        {LEVEL_LABEL[research.verifiedFields[field]] ?? research.verifiedFields[field]}
                      </span>
                    )}
                  </span>
                  {editingField !== field && (
                    <button onClick={() => { setEditingField(field); setDraft(value); setEditNotice(''); }}
                      className="text-[11px] text-[#0E7490] hover:underline">Edit</button>
                  )}
                </dt>
                {editingField === field ? (
                  <dd className="mt-1.5 space-y-1.5">
                    {multiline
                      ? <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} autoComplete="off"
                          className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[13px]" />
                      : <input value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off"
                          className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[13px]" />}
                    <div className="flex gap-2">
                      <button onClick={() => void saveField(field)} disabled={savingField === field}
                        className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                        {savingField === field ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => setEditingField(null)}
                        className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600">Cancel</button>
                    </div>
                  </dd>
                ) : (
                  <dd className="mt-0.5 whitespace-pre-wrap text-[13px] text-gray-700">{value || <span className="text-gray-300">—</span>}</dd>
                )}
              </div>
            );
          })}
        </dl>
      </Card>

      {/* §C.4 — What startups know. Prompt 871 §D — grouped by the exact
          claim (field + normalized value), each with its own Approve/Reject:
          before this, catalog_person_apply_field had no caller in this repo
          at all, and 3-org auto-consensus is unreachable in practice (only
          1 org has any linked people) — every contribution sat in
          'submitted' forever with no way out. */}
      <Card title="What startups know">
        {quarantine.length === 0 ? <p className="text-sm text-gray-400">No startup-contributed facts yet.</p> : (
          <ul className="space-y-3">
            {quarantine.map((q) => (
              <li key={q.field} className="rounded-lg border border-gray-100 p-2.5 text-sm">
                <div className="mb-1.5 font-medium text-gray-700">{q.field.replace('_', ' ')}</div>
                <ul className="space-y-1.5">
                  {q.values.map((v) => {
                    const key = `${q.field}:${JSON.stringify(v.value)}`;
                    const pending = v.entries.some((e) => e.status === 'submitted');
                    const busy = decidingKey === key;
                    return (
                      <li key={key} className="rounded border border-gray-100 bg-gray-50/60 p-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-gray-700">{String(v.value)}</span>
                          {v.realOrgCount >= 3 && <span className="rounded-full bg-cyan-50 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">verified by {v.realOrgCount} startups</span>}
                          {pending && v.realOrgCount < 3 && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{v.realOrgCount}/3 real orgs</span>}
                          {pending && (
                            <div className="ml-auto flex gap-1.5">
                              <button disabled={busy} onClick={() => decide(q.field, v.value, 'approve')}
                                className="rounded bg-[#0E7490] px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-40">Approve → catalog</button>
                              <button disabled={busy} onClick={() => decide(q.field, v.value, 'reject')}
                                className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100 disabled:opacity-40">Reject</button>
                            </div>
                          )}
                        </div>
                        <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
                          {v.entries.map((e) => (
                            <li key={e.id}>
                              <span className={e.status === 'verified' ? 'text-green-700' : e.status === 'rejected' ? 'text-gray-400 line-through' : 'text-amber-700'}>{e.status}</span>
                              {' · '}{e.org}{e.isTest && ' (test)'}{' · '}{e.createdAt.slice(0, 10)}
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* §G.1 — Evidence quarantine. Its own queue, not folded into "What
          startups know" above: each row is already a complete claim (a
          catalog_evidence row), not a (field, value) needing grouping —
          see migration 0347's header comment for why this doesn't reuse
          the generic contributions/consensus machinery. */}
      <Card title={`Evidence (${evidence.length})`}>
        {evidence.length === 0 ? <p className="text-sm text-gray-400">No evidence on file yet.</p> : (
          <div className="space-y-4">
            {pendingEvidence.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Pending review ({pendingEvidence.length})</p>
                <ul className="space-y-2">
                  {pendingEvidence.map((e) => {
                    const busy = decidingEvidenceId === e.id;
                    return (
                      <li key={e.id} className="rounded-lg border border-amber-100 bg-amber-50/50 p-2.5 text-sm">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <a href={e.url} target="_blank" rel="noreferrer" className="font-medium text-[#0E7490] hover:underline">{e.title}</a>
                            <p className="text-[11px] text-gray-500">
                              {e.kind.replace('_', ' ')} · proposed by {e.proposedByOrg ?? '(unknown org)'} · {e.createdAt.slice(0, 10)}
                            </p>
                            {e.excerpt && <p className="mt-1 text-xs italic text-gray-600">“{e.excerpt}”</p>}
                          </div>
                          <div className="flex shrink-0 gap-1.5">
                            <button disabled={busy} onClick={() => decideEvidence(e.id, 'approve')}
                              className="rounded bg-[#0E7490] px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-40">Approve → catalog</button>
                            <button disabled={busy} onClick={() => decideEvidence(e.id, 'reject')}
                              className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100 disabled:opacity-40">Reject</button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {reviewedEvidence.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Reviewed ({reviewedEvidence.length})</p>
                <ul className="space-y-1 text-xs text-gray-500">
                  {reviewedEvidence.map((e) => (
                    <li key={e.id}>
                      <span className={e.status === 'verified' || e.status === 'found' ? 'text-green-700' : e.status === 'rejected' ? 'text-gray-400 line-through' : 'text-gray-400'}>{e.status}</span>
                      {' · '}<a href={e.url} target="_blank" rel="noreferrer" className="text-[#0E7490] hover:underline">{e.title}</a>
                      {' · '}{e.origin}{e.proposedByOrg ? ` (${e.proposedByOrg})` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* §C.5 — Manual research */}
      <Card title="Manual research">
        <div className="flex flex-wrap gap-2 text-xs">
          <a href={manualLinks.linkedin} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-gray-600 hover:bg-gray-50">LinkedIn</a>
          <a href={manualLinks.google} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-gray-600 hover:bg-gray-50">Google</a>
          {manualLinks.teamPage && <a href={manualLinks.teamPage} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-gray-600 hover:bg-gray-50">Firm team page</a>}
          <a href={manualLinks.crunchbase} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-gray-600 hover:bg-gray-50">Crunchbase</a>
          <a href={manualLinks.dealroom} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-gray-600 hover:bg-gray-50">Dealroom</a>
        </div>
      </Card>

      {/* §C.6 — Activity */}
      <Card title="Activity">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div><span className="text-[11px] uppercase tracking-wide text-gray-400">Interactions</span><p className="font-semibold text-gray-800">{activity.totalInteractions}</p></div>
          <div><span className="text-[11px] uppercase tracking-wide text-gray-400">Orgs</span><p className="font-semibold text-gray-800">{activity.orgsInteracted}</p></div>
          <div><span className="text-[11px] uppercase tracking-wide text-gray-400">Replies</span><p className="font-semibold text-gray-800">{activity.repliesReceived}</p></div>
          <div><span className="text-[11px] uppercase tracking-wide text-gray-400">Last contacted</span><p className="text-gray-700">{activity.lastContactedAt ? activity.lastContactedAt.slice(0, 10) : '—'}</p></div>
        </div>
      </Card>
    </div>
  );
}

export default function PersonDossierPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<Card title="Person"><p className="text-sm text-gray-400">Loading…</p></Card>}>
      <PersonDossierContent id={params.id} />
    </Suspense>
  );
}
