'use client';
// Prompt 599 §2 — the back-office view of a startup's PRIVATE `people` row.
// Until now a person row with no catalog_person_id (1299 of 1782 — João
// Bandeira at Bright Pixel among them) had nowhere to open and nothing to
// edit: the only person editor was the catalog dossier, and these rows are
// not in the catalog. This page is the missing half:
//   - unlinked  → edit the private row directly (audited) and, when the
//                 catalog has a same-name person, link it — classified by
//                 the same rule §5's batch used (person-link.ts);
//   - linked    → the catalog is the source: say so, show the private
//                 fields read-only, send the developer to the dossier.
// Same shell as the catalog dossier (Prompt 581 §C): back arrow from
// ?from=/fromLabel=, Suspense around useSearchParams (CLAUDE.md rule 5).
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui';

interface PrivatePerson {
  id: string; fullName: string; role: string | null; seniorityRank: number;
  basedIn: string | null; linkedinUrl: string | null; linkedinVerified: boolean;
  emailGuess: string | null; emailGuessConfidence: string | null; emailVerified: string | null;
  phone: string | null; background: string | null; hook: string | null; hookStatus: string;
  watchOuts: string | null; introPath: string | null; killWords: string[];
  doNotContact: boolean; privacyNoticeSent: boolean; dataSource: string | null;
  catalogPersonId: string | null; createdAt: string; updatedAt: string;
}
interface Candidate { id: string; fullName: string; firmName: string | null; firmMatch: boolean }
interface Payload {
  person: PrivatePerson;
  org: { id: string; name: string; isTest: boolean } | null;
  entity: { id: string; name: string; catalogId: string | null; catalogName: string | null } | null;
  linked: { id: string; fullName: string; linkedinUrl: string | null; firmName: string | null } | null;
  proposal: { layer: 1 | 2 | 3; firmCatalogId: string | null; candidates: Candidate[] } | null;
}

// Mirrors the route's EDITABLE_FIELDS — the route is the authority; this
// list only decides what gets a widget.
const EDITABLE_FIELDS: { field: string; label: string; multiline?: boolean }[] = [
  { field: 'role', label: 'Role' },
  { field: 'linkedin_url', label: 'LinkedIn URL' },
  { field: 'based_in', label: 'Based in' },
  { field: 'email_guess', label: 'Email (guess)' },
  { field: 'phone', label: 'Phone' },
  { field: 'hook', label: 'Hook', multiline: true },
  { field: 'background', label: 'Background', multiline: true },
  { field: 'intro_path', label: 'Intro path', multiline: true },
  { field: 'watch_outs', label: 'Watch-outs', multiline: true },
];

function currentValue(field: string, p: PrivatePerson): string {
  const map: Record<string, string | null> = {
    role: p.role, linkedin_url: p.linkedinUrl, based_in: p.basedIn, email_guess: p.emailGuess, phone: p.phone,
    hook: p.hook, background: p.background, intro_path: p.introPath, watch_outs: p.watchOuts,
  };
  return map[field] ?? '';
}

function PrivatePersonContent({ id }: { id: string }) {
  const search = useSearchParams();
  const backHref = search.get('from') || '/backoffice/queue?tab=new_investors';
  const backLabel = search.get('fromLabel') || 'New investors';
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [savingField, setSavingField] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [linking, setLinking] = useState<string | null>(null);

  function load() {
    fetch(`/api/backoffice/people/${id}`).then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setData(body);
    }).catch(() => setErr('Failed to load.'));
  }
  useEffect(load, [id]);

  async function saveField(field: string) {
    setSavingField(field); setNotice('');
    try {
      const res = await fetch(`/api/backoffice/people/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field, value: draft }),
      });
      const body = await res.json();
      if (!body.ok) { setNotice(body.error ?? 'Could not save.'); return; }
      setEditingField(null);
      load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setSavingField(null);
    }
  }

  async function link(candidate: Candidate) {
    if (!candidate.firmMatch && !window.confirm(
      `${candidate.fullName} is at ${candidate.firmName ?? 'an unknown firm'} in the catalog, not at this row's firm. Link anyway?`,
    )) return;
    setLinking(candidate.id); setNotice('');
    try {
      const res = await fetch(`/api/backoffice/people/${id}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ catalogPersonId: candidate.id }),
      });
      const body = await res.json();
      if (!body.ok) { setNotice(body.error ?? 'Could not link.'); return; }
      load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setLinking(null);
    }
  }

  if (err) return <Card title="Private contact"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!data) return <Card title="Private contact"><p className="text-sm text-gray-400">Loading…</p></Card>;
  const { person, org, entity, linked, proposal } = data;
  const here = `/backoffice/people/${id}?from=${encodeURIComponent(backHref)}&fromLabel=${encodeURIComponent(backLabel)}`;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link href={backHref} className="text-xs text-gray-400 hover:underline">← {backLabel}</Link>
      </div>

      <Card title={person.fullName}>
        <p className="mb-3 text-xs text-gray-500">
          A startup&apos;s own contact record — <b>{org?.name ?? 'unknown org'}</b>{org?.isTest && ' (test org)'}&apos;s pipeline, not the shared catalog.
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-[11px] uppercase tracking-wide text-gray-400">Firm (their record)</span>
            <p className="text-gray-700">
              {entity?.name ?? '—'}
              {entity?.catalogId
                ? <span className="ml-1.5 text-xs text-gray-400">→ catalog: <Link href={`/backoffice/catalog?q=${encodeURIComponent(entity.catalogName ?? entity.name)}`} className="text-[#0E7490] hover:underline">{entity.catalogName ?? entity.name}</Link></span>
                : <span className="ml-1.5 text-xs text-amber-700">not linked to a catalog firm</span>}
            </p>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wide text-gray-400">LinkedIn</span>
            <p>{person.linkedinUrl
              ? <a href={person.linkedinUrl} target="_blank" rel="noreferrer" className="text-[#0E7490] hover:underline">{person.linkedinVerified ? 'Profile ✓ verified' : 'Profile (unverified)'}</a>
              : <span className="text-gray-400">—</span>}</p>
          </div>
          <div>
            <span className="text-[11px] uppercase tracking-wide text-gray-400">Email</span>
            <p className="text-gray-700">{person.emailGuess ? `On file, ${person.emailGuessConfidence ?? 'unknown'} confidence` : <span className="text-gray-400">None on file</span>}</p>
          </div>
          {person.dataSource && <div><span className="text-[11px] uppercase tracking-wide text-gray-400">Source</span><p className="text-gray-700">{person.dataSource}</p></div>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {person.doNotContact && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-[#B00000]">Do not contact</span>}
          {person.privacyNoticeSent && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">Privacy notice sent</span>}
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">Hook: {person.hookStatus.replace('_', ' ')}</span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">Rank {person.seniorityRank}</span>
        </div>
      </Card>

      {notice && <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">{notice}</p>}

      {linked ? (
        // Third case in the prompt, done rather than deferred: the catalog is
        // the source, so this page edits nothing and points at the dossier.
        <Card title="Linked to the catalog">
          <p className="text-sm text-gray-700">
            This row is linked to catalog person <b>{linked.fullName}</b>{linked.firmName && <> at {linked.firmName}</>}.
            The catalog is the source of truth for a linked person: the startup sees its confirmed fields as suggestions
            (Prompt 871 §E), so corrections belong there — this page does not edit a linked row.
          </p>
          <Link href={`/backoffice/catalog/people/${linked.id}?from=${encodeURIComponent(here)}&fromLabel=${encodeURIComponent(`${person.fullName} (private row)`)}`}
            className="mt-3 inline-block rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white">
            Open the catalog dossier →
          </Link>
          <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 text-xs text-gray-600 sm:grid-cols-2">
            {EDITABLE_FIELDS.map(({ field, label }) => (
              <div key={field}><dt className="text-[10px] uppercase tracking-wide text-gray-400">{label} (their record)</dt><dd className="whitespace-pre-wrap">{currentValue(field, person) || '—'}</dd></div>
            ))}
          </dl>
        </Card>
      ) : (
        <>
          <Card title="Catalog link">
            {proposal?.layer === 1 && (
              <div className="text-sm text-gray-700">
                <p>
                  Exactly one catalog person has this name <b>and</b> works at this row&apos;s firm:
                  {' '}<b>{proposal.candidates[0].fullName}</b> at {proposal.candidates[0].firmName ?? '(no firm)'}.
                  This is the case §5&apos;s batch links on its own; this row was created after it ran, or its firm was linked later.
                </p>
                <button disabled={linking !== null} onClick={() => void link(proposal.candidates[0])}
                  className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                  {linking ? 'Linking…' : 'Link to this catalog person'}
                </button>
              </div>
            )}
            {proposal?.layer === 2 && (
              <div className="text-sm text-gray-700">
                <p className="mb-2">
                  {proposal.candidates.length === 1 ? 'A catalog person has this name but' : `${proposal.candidates.length} catalog people have this name, and none is unambiguously`}
                  {' '}{proposal.firmCatalogId ? 'at this row’s firm' : 'comparable — this row’s firm is not linked to a catalog firm'}.
                  Nothing was linked automatically; a person decides, one row at a time.
                </p>
                <ul className="space-y-1.5">
                  {proposal.candidates.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 rounded border border-gray-100 bg-gray-50/60 p-2 text-xs">
                      <Link href={`/backoffice/catalog/people/${c.id}?from=${encodeURIComponent(here)}&fromLabel=${encodeURIComponent(`${person.fullName} (private row)`)}`} className="font-medium text-[#0E7490] hover:underline">{c.fullName}</Link>
                      <span className="text-gray-500">{c.firmName ?? '(no firm)'}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${c.firmMatch ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{c.firmMatch ? 'firm matches' : 'different firm'}</span>
                      <button disabled={linking !== null} onClick={() => void link(c)}
                        className="ml-auto rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-100 disabled:opacity-40">
                        {linking === c.id ? 'Linking…' : c.firmMatch ? 'Link' : 'Link anyway'}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {proposal?.layer === 3 && (
              <p className="text-sm text-gray-600">
                No catalog person has this name — there is nothing to link. If this contact should exist in the shared catalog,
                that is a promotion (Key people), which is a separate decision from editing this row.
              </p>
            )}
          </Card>

          {/* Same widget as the catalog dossier's "Edit as developer", but
              the write lands on the startup's own row — said plainly. */}
          <Card title="Edit as developer (private row)">
            <p className="mb-3 text-xs text-gray-500">
              This edits <b>{org?.name ?? 'the startup'}</b>&apos;s own record of this contact — not the catalog. Saved immediately;
              every save writes a before/after line to the audit log.
            </p>
            <dl className="space-y-2.5">
              {EDITABLE_FIELDS.map(({ field, label, multiline }) => {
                const value = currentValue(field, person);
                return (
                  <div key={field} className="border-b border-gray-50 pb-2.5 last:border-0">
                    <dt className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
                      {editingField !== field && (
                        <button onClick={() => { setEditingField(field); setDraft(value); setNotice(''); }}
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
        </>
      )}
    </div>
  );
}

export default function PrivatePersonPage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<Card title="Private contact"><p className="text-sm text-gray-400">Loading…</p></Card>}>
      <PrivatePersonContent id={params.id} />
    </Suspense>
  );
}
