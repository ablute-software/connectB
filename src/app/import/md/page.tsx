'use client';
// Real interaction-history import (ablute_historico_fundos.md). The file
// itself is uploaded straight to the org's private Storage bucket and
// NEVER committed to git — see DECISIONS.md. TEMA A (contact facts) and
// TEMA B (private negotiation history) are shown as separate counts per
// the instruction; TEMA B never leaves this org, never becomes a
// contribution, never reaches the shared catalog.
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { authEnabled, browserClient } from '@/lib/supabase';
import { Card } from '@/components/ui';

interface Candidate { id: string; name: string; score: number }
interface FieldDiff { field: string; existing: unknown; incoming: unknown }
interface EntityItem {
  key: string; aliases: string[]; status: 'new' | 'matched' | 'conflict'; candidates: Candidate[]; chosenId?: string;
  desfecho: string; reopenTrigger?: string; patch: Record<string, unknown>;
  temaAConflicts: FieldDiff[]; temaBConflicts: FieldDiff[]; recentCampaign: boolean; include: boolean;
  looksLikePerson?: boolean;
}
interface InteractionItem {
  key: string; entityKey: string; status: 'new' | 'duplicate'; estado: string; occurredAt?: string;
  text: string; needsReview: boolean; include: boolean;
}
interface Plan { entities: EntityItem[]; interactions: InteractionItem[] }
interface ProposedPerson { name: string; role?: string; confidence: number; evidence: string }
interface Section { name: string; interactions: { text: string }[]; proposedPeople?: ProposedPerson[] }

export default function MdHistoryImportPage() {
  const { db } = useStore();
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[] | null>(null);
  const [peopleProgress, setPeopleProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmedPeople, setConfirmedPeople] = useState<Record<string, boolean>>({}); // key: `${entityKey}::${name}`
  const [plan, setPlan] = useState<Plan | null>(null);
  const [dryRunning, setDryRunning] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);

  async function upload(file: File) {
    setErr(''); setUploading(true);
    try {
      const sb = browserClient();
      const path = `${db.org.id}/imports/md/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await sb.storage.from('data-room').upload(path, file);
      if (upErr) throw upErr;
      const { data: batch, error: insErr } = await sb.from('import_batches')
        .insert({ org_id: db.org.id, file_name: file.name, storage_path: path, status: 'uploaded' }).select().single();
      if (insErr) throw insErr;
      setBatchId(batch.id);

      const res = await fetch('/api/import/md/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ batchId: batch.id }) });
      const body = await res.json();
      if (body.ok === false) throw new Error(body.error);

      const { data: fresh } = await sb.from('import_batches').select('extraction').eq('id', batch.id).single();
      if (!fresh) throw new Error('Could not reload the parsed batch.');
      setSections(fresh.extraction.sections);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function proposePeople() {
    if (!batchId || !sections) return;
    setPeopleProgress({ done: 0, total: sections.length });
    const updated = [...sections];
    for (let i = 0; i < sections.length; i++) {
      const res = await fetch('/api/import/md/extract-people', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ batchId, sectionIndex: i }),
      });
      const body = await res.json();
      if (body.ok && body.proposedPeople) updated[i] = { ...updated[i], proposedPeople: body.proposedPeople };
      setPeopleProgress({ done: i + 1, total: sections.length });
      setSections([...updated]);
    }
  }

  async function runDryRun() {
    if (!batchId) return;
    setDryRunning(true); setErr('');
    try {
      const res = await fetch('/api/import/md/dry-run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ batchId }) });
      const body = await res.json();
      if (body.ok === false) throw new Error(body.error);
      setPlan(body.plan);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setDryRunning(false);
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
  function toggleInteraction(key: string) {
    if (!plan) return;
    setPlan({ ...plan, interactions: plan.interactions.map((i) => i.key === key ? { ...i, include: !i.include } : i) });
  }
  function togglePerson(entityKey: string, name: string) {
    const k = `${entityKey}::${name}`;
    setConfirmedPeople({ ...confirmedPeople, [k]: !confirmedPeople[k] });
  }

  async function commit() {
    if (!plan || !batchId) return;
    setCommitting(true); setErr('');
    const confirmed = Object.keys(confirmedPeople).filter((k) => confirmedPeople[k]).map((k) => {
      const [entityKey, name] = k.split('::');
      return { entityKey, name };
    });
    try {
      const res = await fetch('/api/import/md/commit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ batchId, plan, confirmedPeople: confirmed }),
      });
      const body = await res.json();
      if (body.ok === false) throw new Error(body.error);
      setResult(body);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCommitting(false);
    }
  }

  if (!authEnabled) return <Card title="Import history (.md)"><p className="text-sm text-gray-400">Available once connected to Supabase.</p></Card>;

  if (result) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-lg font-bold">Import complete</h1>
        <Card>
          <ul className="space-y-1 text-sm">
            <li>Entities: {result.entitiesCreated} created, {result.entitiesUpdated} updated</li>
            <li>Interactions: {result.interactionsCreated} created, {result.interactionsSkipped} skipped (duplicates/excluded)</li>
            <li>People confirmed from AI proposals: {result.peopleCreated}</li>
            <li>Contact-fact conflicts queued for review: {result.conflictsQueued} (Fila → Contributions in back-office)</li>
          </ul>
          <p className="mt-3 text-xs text-gray-400">
            Private history (status/reopen_trigger/interaction content) never left this org and never became a contribution.
          </p>
        </Card>
      </div>
    );
  }

  const temaBCount = plan ? plan.entities.reduce((s, e) => s + e.temaBConflicts.length, 0) + plan.interactions.length : 0;
  const temaACount = plan ? plan.entities.length + plan.entities.reduce((s, e) => s + e.temaAConflicts.length, 0) : 0;
  const needsReviewCount = plan ? plan.interactions.filter((i) => i.needsReview).length : 0;

  return (
    <div className="max-w-4xl space-y-5">
      <h1 className="text-lg font-bold">Import full history (.md)</h1>
      <p className="text-sm text-gray-500">
        TEMA A (contact facts) and TEMA B (private negotiation history) stay separate throughout — TEMA B is never proposed
        to the shared catalog. Nothing is written until you approve and click Commit.
      </p>

      {!sections && (
        <Card title="1 · Upload">
          <input type="file" accept=".md" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} className="text-sm" />
          {uploading && <p className="mt-1 text-xs text-gray-400">Uploading & parsing…</p>}
          {err && <p className="mt-1 text-xs text-[#B00000]">{err}</p>}
        </Card>
      )}

      {sections && !plan && (
        <Card title={`2 · Parsed (${sections.length} entities, ${sections.reduce((s, x) => s + x.interactions.length, 0)} interactions)`}>
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={!!peopleProgress && peopleProgress.done < peopleProgress.total} onClick={proposePeople}
              className="rounded-lg border border-cyan-200 px-3 py-1.5 text-sm text-cyan-800 hover:bg-cyan-50 disabled:opacity-40">
              ✨ Propose people mentions (AI, optional)
            </button>
            {peopleProgress && <span className="text-xs text-gray-500">{peopleProgress.done}/{peopleProgress.total} sections</span>}
            <button disabled={dryRunning} onClick={runDryRun} className="ml-auto rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {dryRunning ? 'Matching…' : 'Run dry-run'}
            </button>
          </div>
          {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
        </Card>
      )}

      {plan && (
        <>
          <Card title="Counts">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><div className="text-xl font-bold text-[#0E7490]">{temaACount}</div><div className="text-xs text-gray-500">TEMA A items (entities + contact conflicts)</div></div>
              <div><div className="text-xl font-bold text-[#0E7490]">{temaBCount}</div><div className="text-xs text-gray-500">TEMA B items (interactions + private conflicts)</div></div>
              <div><div className="text-xl font-bold text-amber-600">{needsReviewCount}</div><div className="text-xs text-gray-500">needs_review (uncolored — see green warning)</div></div>
              <div><div className="text-xl font-bold text-gray-700">{plan.entities.filter((e) => e.recentCampaign).length}</div><div className="text-xs text-gray-500">recent-campaign entities (contact_lock applies)</div></div>
            </div>
          </Card>

          <Card title={`Entities (${plan.entities.filter((e) => e.include).length}/${plan.entities.length})`}>
            <ul className="max-h-[32rem] space-y-2 overflow-y-auto text-sm">
              {plan.entities.map((e) => (
                <li key={e.key} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="checkbox" checked={e.include} onChange={() => toggleEntity(e.key)} />
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      e.status === 'matched' ? 'bg-green-50 text-green-700' : e.status === 'conflict' ? 'bg-amber-50 text-amber-700' : 'bg-cyan-100 text-cyan-800'}`}>
                      {e.status}
                    </span>
                    <span className="font-medium">{e.key}</span>
                    <span className="text-xs text-gray-400">{e.desfecho}</span>
                    {e.recentCampaign && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-[#B00000]">recent campaign</span>}
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
                  {e.aliases.length > 0 && <p className="mt-1 text-xs text-gray-400">Aliases: {e.aliases.join(', ')}</p>}
                  {e.reopenTrigger && <p className="mt-1 text-xs text-cyan-800">Reopen trigger: {e.reopenTrigger}</p>}
                  {e.temaAConflicts.length > 0 && <p className="mt-1 text-xs text-amber-700">Contact-fact conflicts (queued for review): {e.temaAConflicts.map((c) => c.field).join(', ')}</p>}
                  {e.temaBConflicts.length > 0 && <p className="mt-1 text-xs text-gray-500">Private conflicts (not queued anywhere — edit directly if needed): {e.temaBConflicts.map((c) => c.field).join(', ')}</p>}
                </li>
              ))}
            </ul>
          </Card>

          {sections && sections.some((s) => (s.proposedPeople?.length ?? 0) > 0) && (
            <Card title="People mentioned (AI-proposed — confirm before creating)">
              <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
                {sections.flatMap((s) => (s.proposedPeople ?? []).map((p) => {
                  const k = `${s.name}::${p.name}`;
                  return (
                    <li key={k} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                      <input type="checkbox" checked={!!confirmedPeople[k]} onChange={() => togglePerson(s.name, p.name)} />
                      <span className="font-medium">{p.name}</span>
                      {p.role && <span className="text-xs text-gray-500">{p.role}</span>}
                      <span className="text-xs text-gray-400">at {s.name}</span>
                      <span className="ml-auto text-xs text-gray-400">confidence {Math.round(p.confidence * 100)}%</span>
                      <span className="w-full text-xs italic text-gray-400">"{p.evidence}"</span>
                    </li>
                  );
                }))}
              </ul>
            </Card>
          )}

          <Card title={`Interactions (${plan.interactions.filter((i) => i.include).length}/${plan.interactions.length})`}>
            <p className="mb-2 text-xs text-gray-500">Private history — never queued to contributions. Shown collapsed by default; expand to review individually.</p>
            <details>
              <summary className="cursor-pointer text-xs text-[#0E7490]">Show all {plan.interactions.length} interactions</summary>
              <ul className="mt-2 max-h-[32rem] space-y-1 overflow-y-auto text-sm">
                {plan.interactions.map((i) => (
                  <li key={i.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                    <input type="checkbox" checked={i.include} disabled={i.status === 'duplicate'} onChange={() => toggleInteraction(i.key)} />
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${i.status === 'duplicate' ? 'bg-gray-100 text-gray-500' : 'bg-cyan-100 text-cyan-800'}`}>{i.status}</span>
                    {i.needsReview && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">needs_review</span>}
                    <span className="text-xs text-gray-400">{i.entityKey} · {i.occurredAt ?? '?'}</span>
                    <span className="max-w-md truncate text-xs text-gray-600">{i.text}</span>
                  </li>
                ))}
              </ul>
            </details>
          </Card>

          <button disabled={committing} onClick={commit} className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-40">
            {committing ? 'Committing…' : 'Commit import'}
          </button>
          {err && <p className="text-xs text-[#B00000]">{err}</p>}
        </>
      )}
    </div>
  );
}
