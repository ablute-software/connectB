'use client';
// IRM_SPEC §9 — interaction history import. Upload → AI extraction → staging
// review (nothing lands unreviewed) → commit (reconciliation + post-import
// analysis). Generic version: only .txt/.csv parse today (see DECISIONS.md);
// the extraction shape is intentionally loose (jsonb) until real example
// files arrive to tune the field mapping.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { authEnabled, browserClient } from '@/lib/supabase';
import { Card } from '@/components/ui';

type Batch = { id: string; file_name: string; status: string; error?: string | null; extraction?: Extraction | null; created_at: string };
type ExtractedEntity = { name: string; website?: string; confidence: number; note?: string };
type ExtractedPerson = { name: string; role?: string; entity_name?: string; phones?: string[]; emails?: string[]; linkedin_url?: string; confidence: number; note?: string };
type ExtractedInteraction = { date?: string; channel?: string; direction: 'out' | 'in'; person_name?: string; entity_name?: string; summary: string; outcome?: string; followup_marker?: string; confidence: number };
type Extraction = { entities: ExtractedEntity[]; people: ExtractedPerson[]; interactions: ExtractedInteraction[] };
type Sel = { include: boolean; matchId: string | null };

const STATUS_LABEL: Record<string, string> = {
  uploaded: 'Uploaded', extracting: 'Extracting…', staged: 'Ready for review', committed: 'Imported', failed: 'Failed',
};

function ConfidenceDot({ c }: { c: number }) {
  const color = c >= 0.75 ? 'bg-green-600' : c >= 0.4 ? 'bg-amber-500' : 'bg-red-500';
  return <span title={`confidence ${Math.round(c * 100)}%`} className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

export default function ImportPage() {
  const { db } = useStore();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeBatch, setActiveBatch] = useState<Batch | null>(null);
  const [entitySel, setEntitySel] = useState<Record<number, Sel>>({});
  const [personSel, setPersonSel] = useState<Record<number, Sel>>({});
  const [interactionSel, setInteractionSel] = useState<Record<number, boolean>>({});
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<{ entitiesCreated: number; peopleCreated: number; interactionsImported: number } | null>(null);

  function refresh() {
    if (!authEnabled || !db.org.id) return;
    browserClient().from('import_batches').select('*').eq('org_id', db.org.id)
      .order('created_at', { ascending: false }).then(({ data }) => setBatches((data as Batch[]) ?? []));
  }
  useEffect(refresh, [db.org.id]);

  function findEntityMatch(name: string) {
    return db.entities.find((e) => e.name.trim().toLowerCase() === name.trim().toLowerCase())?.id ?? null;
  }
  function findPersonMatch(name: string, emails?: string[]) {
    const byEmail = emails?.length ? db.people.find((p) => p.email_verified && emails.some((em) => em.toLowerCase() === p.email_verified!.toLowerCase())) : undefined;
    const byName = !byEmail ? db.people.find((p) => p.full_name.trim().toLowerCase() === name.trim().toLowerCase()) : undefined;
    return (byEmail ?? byName)?.id ?? null;
  }

  function openStaging(batch: Batch, extraction: Extraction) {
    setActiveBatch({ ...batch, extraction });
    setEntitySel(Object.fromEntries(extraction.entities.map((e, i) => [i, { include: true, matchId: findEntityMatch(e.name) }])));
    setPersonSel(Object.fromEntries(extraction.people.map((p, i) => [i, { include: true, matchId: findPersonMatch(p.name, p.emails) }])));
    setInteractionSel(Object.fromEntries(extraction.interactions.map((_, i) => [i, true])));
    setCommitResult(null);
  }

  async function extract(batchId: string, batch: Batch) {
    const res = await fetch('/api/import/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId }) });
    const body = await res.json();
    refresh();
    if (body.ok && body.extraction) openStaging(batch, body.extraction);
    else if (body.configured === false) setUploadErr(body.message);
    else if (body.error) setUploadErr(body.error);
  }

  async function upload(file: File) {
    setUploadErr(''); setUploading(true);
    try {
      const sb = browserClient();
      const path = `${db.org.id}/imports/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await sb.storage.from('data-room').upload(path, file);
      if (upErr) throw upErr;
      const { data: batch, error: insErr } = await sb.from('import_batches')
        .insert({ org_id: db.org.id, file_name: file.name, storage_path: path, status: 'uploaded' })
        .select().single();
      if (insErr) throw insErr;
      if (fileInputRef.current) fileInputRef.current.value = '';
      refresh();
      await extract(batch.id, batch as Batch);
    } catch (e) {
      setUploadErr((e as Error).message);
    } finally { setUploading(false); }
  }

  async function commit() {
    if (!activeBatch?.extraction) return;
    setCommitting(true);
    const approved = {
      entities: activeBatch.extraction.entities.map((e, i) => ({ ...e, matchId: entitySel[i]?.matchId ?? null })).filter((_, i) => entitySel[i]?.include),
      people: activeBatch.extraction.people.map((p, i) => ({ ...p, matchId: personSel[i]?.matchId ?? null })).filter((_, i) => personSel[i]?.include),
      interactions: activeBatch.extraction.interactions.filter((_, i) => interactionSel[i]),
    };
    try {
      const res = await fetch('/api/import/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: activeBatch.id, approved }),
      });
      const body = await res.json();
      if (body.ok) { setCommitResult(body); refresh(); }
      else setUploadErr(body.error);
    } finally { setCommitting(false); }
  }

  if (!authEnabled) return <Card title="Import history"><p className="text-sm text-gray-400">Available once connected to Supabase.</p></Card>;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Import interaction history</h1>
      <p className="max-w-2xl text-sm text-gray-500">
        Upload spreadsheets or notes of past investor outreach. AI extracts people, funds, and interactions — you
        review and approve every item before anything lands in the pipeline. Only .txt/.csv today; export other
        formats to plain text or CSV for now.
      </p>
      <p className="text-xs text-gray-400">
        Already have a structured pack matching the entities.csv/people.csv/interactions.csv shape?{' '}
        <Link href="/import/structured" className="text-[#0E7490] hover:underline">Use the structured import (§9b)</Link> — no AI extraction needed.
      </p>

      <Card title="Upload a file">
        <input ref={fileInputRef} type="file" accept=".txt,.csv" disabled={uploading}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} className="text-sm" />
        {uploading && <p className="mt-1 text-xs text-gray-400">Uploading & extracting…</p>}
        {uploadErr && <p className="mt-1 text-xs text-[#B00000]">{uploadErr}</p>}
      </Card>

      {activeBatch?.extraction && (
        <Card title={`Staging review — ${activeBatch.file_name}`} tint="blue">
          {commitResult ? (
            <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-800">
              Imported: {commitResult.entitiesCreated} new entit{commitResult.entitiesCreated === 1 ? 'y' : 'ies'} ·
              {' '}{commitResult.peopleCreated} new person/people · {commitResult.interactionsImported} interaction(s).
              New entities were also queued to the back-office review; new people were flagged for duplicate-checking.
            </div>
          ) : (
            <>
              <section className="mb-4">
                <h3 className="mb-1.5 text-sm font-semibold">Entities ({activeBatch.extraction.entities.length})</h3>
                <ul className="space-y-1.5">
                  {activeBatch.extraction.entities.map((e, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                      <input type="checkbox" checked={entitySel[i]?.include ?? true}
                        onChange={(ev) => setEntitySel({ ...entitySel, [i]: { ...entitySel[i], include: ev.target.checked } })} />
                      <ConfidenceDot c={e.confidence} />
                      <span className="font-medium">{e.name}</span>
                      {e.website && <span className="text-xs text-gray-400">{e.website}</span>}
                      <select value={entitySel[i]?.matchId ?? ''} onChange={(ev) => setEntitySel({ ...entitySel, [i]: { ...entitySel[i], matchId: ev.target.value || null } })}
                        className="ml-auto rounded border border-gray-300 px-1.5 py-0.5 text-xs">
                        <option value="">Create new</option>
                        {db.entities.map((ex) => <option key={ex.id} value={ex.id}>Link: {ex.name}</option>)}
                      </select>
                      {e.note && <span className="w-full text-xs text-amber-700">⚠ {e.note}</span>}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="mb-4">
                <h3 className="mb-1.5 text-sm font-semibold">People ({activeBatch.extraction.people.length})</h3>
                <ul className="space-y-1.5">
                  {activeBatch.extraction.people.map((p, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                      <input type="checkbox" checked={personSel[i]?.include ?? true}
                        onChange={(ev) => setPersonSel({ ...personSel, [i]: { ...personSel[i], include: ev.target.checked } })} />
                      <ConfidenceDot c={p.confidence} />
                      <span className="font-medium">{p.name}</span>
                      {p.role && <span className="text-xs text-gray-500">{p.role}</span>}
                      {p.entity_name && <span className="text-xs text-gray-400">@ {p.entity_name}</span>}
                      <select value={personSel[i]?.matchId ?? ''} onChange={(ev) => setPersonSel({ ...personSel, [i]: { ...personSel[i], matchId: ev.target.value || null } })}
                        className="ml-auto rounded border border-gray-300 px-1.5 py-0.5 text-xs">
                        <option value="">Create new</option>
                        {db.people.map((px) => <option key={px.id} value={px.id}>Link: {px.full_name}</option>)}
                      </select>
                      {p.note && <span className="w-full text-xs text-amber-700">⚠ {p.note}</span>}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="mb-4">
                <h3 className="mb-1.5 text-sm font-semibold">Interactions ({activeBatch.extraction.interactions.length})</h3>
                <ul className="space-y-1.5">
                  {activeBatch.extraction.interactions.map((it, i) => (
                    <li key={i} className="flex flex-wrap items-start gap-2 text-sm">
                      <input type="checkbox" checked={interactionSel[i] ?? true}
                        onChange={(ev) => setInteractionSel({ ...interactionSel, [i]: ev.target.checked })} className="mt-0.5" />
                      <ConfidenceDot c={it.confidence} />
                      <span className={it.direction === 'out' ? 'font-bold text-[#0E7490]' : 'font-bold text-green-700'}>
                        {it.direction === 'out' ? '→' : '←'}
                      </span>
                      <span className="text-xs text-gray-400">{it.date?.slice(0, 10) ?? '?'} · {it.channel ?? 'email'} · {it.person_name ?? '?'} @ {it.entity_name ?? '?'}</span>
                      <span className="w-full pl-6 text-gray-700">{it.summary}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <div className="flex gap-2">
                <button disabled={committing} onClick={commit}
                  className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                  {committing ? 'Importing…' : 'Commit import'}
                </button>
                <button onClick={() => setActiveBatch(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">Cancel</button>
              </div>
            </>
          )}
        </Card>
      )}

      <Card title="Past imports">
        {batches.length === 0 ? <p className="text-sm text-gray-400">No imports yet.</p> : (
          <ul className="space-y-1.5 text-sm">
            {batches.map((b) => (
              <li key={b.id} className="flex items-center gap-2">
                <span className="font-medium">{b.file_name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  b.status === 'committed' ? 'bg-green-50 text-green-700' : b.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                  {STATUS_LABEL[b.status] ?? b.status}
                </span>
                <span className="text-xs text-gray-400">{b.created_at?.slice(0, 10)}</span>
                {b.error && <span className="text-xs text-[#B00000]">— {b.error}</span>}
                {b.status === 'staged' && b.extraction && !activeBatch && (
                  <button onClick={() => openStaging(b, b.extraction!)} className="ml-auto text-xs text-[#0E7490] hover:underline">Review</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
