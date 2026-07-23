'use client';
// IRM_SPEC §9b — structured pack import (entities.csv/people.csv/
// interactions.csv, the exact shape documented in the pack's own README).
// Distinct from the generic AI-extraction /import: this is parsed and
// matched deterministically, no LLM call needed, since the shape is known.
import { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';

type Status = 'new' | 'matched' | 'conflict' | 'duplicate' | 'unresolved';

interface Candidate { id: string; name: string; score: number }
interface FieldDiff { field: string; existing: unknown; incoming: unknown }
interface EntityItem { key: string; status: Status; candidates: Candidate[]; chosenId?: string; csvRow: { name: string }; patch: Record<string, unknown>; conflicts: FieldDiff[]; include: boolean; derived?: boolean; looksLikePerson?: boolean }
interface PersonItem { key: string; status: Status; candidates: Candidate[]; chosenId?: string; entityKey: string; csvRow: { full_name: string }; patch: Record<string, unknown>; conflicts: FieldDiff[]; include: boolean }
interface InteractionItem { key: string; status: Status; entityKey: string; personKey?: string; csvRow: { occurred_at?: string; direction: string; channel?: string; content: string }; include: boolean }
interface AffiliationItem { personKey: string; entityKey?: string; kind: string; title?: string; isPrimary: boolean; notes: string; include: boolean }
interface Plan { entities: EntityItem[]; people: PersonItem[]; interactions: InteractionItem[]; affiliations: AffiliationItem[] }

const STATUS_STYLE: Record<Status, string> = {
  new: 'bg-cyan-100 text-cyan-800', matched: 'bg-green-50 text-green-700',
  conflict: 'bg-amber-50 text-amber-700', duplicate: 'bg-gray-100 text-gray-500', unresolved: 'bg-red-50 text-[#B00000]',
};

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export default function StructuredImportPage() {
  const [files, setFiles] = useState<{ entities?: File; people?: File; interactions?: File }>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [committing, setCommitting] = useState(false);

  async function runDryRun() {
    if (!files.entities || !files.people || !files.interactions) return;
    setLoading(true); setErr(''); setResult(null);
    try {
      const [entitiesCsv, peopleCsv, interactionsCsv] = await Promise.all([
        readFile(files.entities), readFile(files.people), readFile(files.interactions),
      ]);
      const res = await fetch('/api/import/structured/dry-run', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entitiesCsv, peopleCsv, interactionsCsv }),
      });
      const body = await res.json();
      if (body.ok === false) { setErr(body.error); return; }
      setPlan(body.plan);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    if (!plan) return;
    setCommitting(true); setErr('');
    try {
      const res = await fetch('/api/import/structured/commit', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan }),
      });
      const body = await res.json();
      if (body.ok === false) { setErr(body.error); return; }
      setResult(body);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCommitting(false);
    }
  }

  function toggleEntity(key: string) {
    if (!plan) return;
    setPlan({ ...plan, entities: plan.entities.map((e) => e.key === key ? { ...e, include: !e.include } : e) });
  }
  function toggleEntityChoice(key: string, chosenId: string | undefined) {
    if (!plan) return;
    setPlan({ ...plan, entities: plan.entities.map((e) => e.key === key ? { ...e, chosenId, status: chosenId ? 'matched' : 'new' } : e) });
  }
  function togglePerson(key: string) {
    if (!plan) return;
    setPlan({ ...plan, people: plan.people.map((p) => p.key === key ? { ...p, include: !p.include } : p) });
  }
  function toggleInteraction(key: string) {
    if (!plan) return;
    setPlan({ ...plan, interactions: plan.interactions.map((i) => i.key === key ? { ...i, include: !i.include } : i) });
  }
  function toggleAffiliation(personKey: string, entityKey: string | undefined) {
    if (!plan) return;
    setPlan({ ...plan, affiliations: plan.affiliations.map((a) => (a.personKey === personKey && a.entityKey === entityKey) ? { ...a, include: !a.include } : a) });
  }

  if (result) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-lg font-bold">Import complete</h1>
        <Card>
          <ul className="space-y-1 text-sm">
            <li>Entities: {result.entitiesCreated} created, {result.entitiesUpdated} updated</li>
            <li>People: {result.peopleCreated} created, {result.peopleUpdated} updated, {result.peopleSkipped} skipped</li>
            <li>Interactions: {result.interactionsCreated} created, {result.interactionsSkipped} skipped (duplicates/unresolved)</li>
            <li>Affiliations: {result.affiliationsCreated} created</li>
            <li>Conflicts queued for review: {result.conflictsQueued} (Fila → Contributions in back-office)</li>
          </ul>
          <Link href="/pipeline" className="mt-3 inline-block text-sm text-[#0E7490] hover:underline">Back to pipeline →</Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-5">
      <h1 className="text-lg font-bold">Structured pack import</h1>
      <p className="text-sm text-gray-500">Upload entities.csv, people.csv, and interactions.csv (in that link order). Nothing is written until you approve and click Commit.</p>

      <Card title="1 · Files">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            entities.csv
            <input type="file" accept=".csv" className="mt-1 block w-full text-xs" onChange={(e) => setFiles({ ...files, entities: e.target.files?.[0] })} />
          </label>
          <label className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            people.csv
            <input type="file" accept=".csv" className="mt-1 block w-full text-xs" onChange={(e) => setFiles({ ...files, people: e.target.files?.[0] })} />
          </label>
          <label className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            interactions.csv
            <input type="file" accept=".csv" className="mt-1 block w-full text-xs" onChange={(e) => setFiles({ ...files, interactions: e.target.files?.[0] })} />
          </label>
        </div>
        <button disabled={!files.entities || !files.people || !files.interactions || loading} onClick={runDryRun}
          className="mt-3 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          {loading ? 'Matching…' : 'Run dry-run'}
        </button>
        {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
      </Card>

      {plan && (
        <>
          <Card title={`2 · Entities (${plan.entities.filter((e) => e.include).length}/${plan.entities.length})`}>
            <ul className="space-y-2 text-sm">
              {plan.entities.map((e) => (
                <li key={e.key} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="checkbox" checked={e.include} onChange={() => toggleEntity(e.key)} />
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[e.status]}`}>{e.status}</span>
                    <span className="font-medium">{e.csvRow.name}</span>
                    {e.derived && <span className="text-xs text-gray-400">(derived — not in entities.csv, from an affiliation upgrade)</span>}
                    {e.looksLikePerson && (
                      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-800">
                        looks like a person, not a fund — review after import
                      </span>
                    )}
                    {e.candidates.length > 0 && (
                      <select value={e.chosenId ?? ''} onChange={(ev) => toggleEntityChoice(e.key, ev.target.value || undefined)}
                        className="ml-auto rounded border border-gray-300 px-2 py-1 text-xs">
                        <option value="">Create new instead</option>
                        {e.candidates.map((c) => <option key={c.id} value={c.id}>{c.name} (score {c.score})</option>)}
                      </select>
                    )}
                  </div>
                  {Object.keys(e.patch).length > 0 && <p className="mt-1 text-xs text-gray-500">Will fill: {Object.keys(e.patch).join(', ')}</p>}
                  {e.conflicts.length > 0 && (
                    <p className="mt-1 text-xs text-amber-700">Conflicts (kept existing, queued for review): {e.conflicts.map((c) => c.field).join(', ')}</p>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card title={`3 · People (${plan.people.filter((p) => p.include).length}/${plan.people.length})`}>
            <ul className="space-y-1.5 text-sm">
              {plan.people.map((p) => (
                <li key={p.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <input type="checkbox" checked={p.include} onChange={() => togglePerson(p.key)} />
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[p.status]}`}>{p.status}</span>
                  <span className="font-medium">{p.csvRow.full_name}</span>
                  <span className="text-xs text-gray-400">at {p.entityKey}</span>
                  {p.conflicts.length > 0 && <span className="text-xs text-amber-700">conflicts: {p.conflicts.map((c) => c.field).join(', ')}</span>}
                </li>
              ))}
            </ul>
          </Card>

          <Card title={`4 · Interactions (${plan.interactions.filter((i) => i.include).length}/${plan.interactions.length})`}>
            <ul className="space-y-1.5 text-sm">
              {plan.interactions.map((i) => (
                <li key={i.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <input type="checkbox" checked={i.include} disabled={i.status === 'unresolved'} onChange={() => toggleInteraction(i.key)} />
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[i.status]}`}>{i.status}</span>
                  <span className="text-xs text-gray-400">{i.csvRow.occurred_at ?? '?'} · {i.csvRow.direction} · {i.csvRow.channel}</span>
                  <span className="max-w-md truncate text-xs text-gray-600">{i.csvRow.content}</span>
                </li>
              ))}
            </ul>
          </Card>

          {plan.affiliations.length > 0 && (
            <Card title={`5 · Affiliation upgrades (${plan.affiliations.filter((a) => a.include).length}/${plan.affiliations.length})`}>
              <ul className="space-y-1.5 text-sm">
                {plan.affiliations.map((a) => (
                  <li key={`${a.personKey}::${a.entityKey ?? 'independent'}`} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <input type="checkbox" checked={a.include} onChange={() => toggleAffiliation(a.personKey, a.entityKey)} />
                      <span className="font-medium">{a.personKey.split('::')[1]}</span>
                      <span className="text-xs text-gray-400">→ {a.entityKey ?? 'independent'} ({a.kind}{a.title ? `, ${a.title}` : ''}){a.isPrimary ? ' · primary' : ''}</span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{a.notes}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <button disabled={committing} onClick={commit} className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-40">
            {committing ? 'Committing…' : 'Commit import'}
          </button>
        </>
      )}
    </div>
  );
}
