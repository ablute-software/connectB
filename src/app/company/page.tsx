'use client';
// IRM_SPEC §11 — Company Canon. The org's verified-truth archive: every
// factual claim the composer makes must trace back to a confirmed fact
// here, or generation pauses and asks (§11b). This page is where that
// archive is reviewed, confirmed, edited, and superseded — never deleted.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, Tooltip } from '@/components/ui';
import type { CompanyFact, CompanyFactCategory } from '@/lib/types';

const CATEGORIES: CompanyFactCategory[] = [
  'product', 'traction', 'team', 'positioning', 'financing', 'regulatory', 'market', 'metrics', 'other',
];

const STATUS_STYLE: Record<CompanyFact['status'], string> = {
  confirmed: 'bg-green-100 text-green-800',
  unconfirmed: 'bg-amber-100 text-amber-800',
  deprecated: 'bg-gray-100 text-gray-500',
};

const SOURCE_LABEL: Record<CompanyFact['source'], string> = {
  user: 'you', import: 'imported', ai_extracted: 'AI-suggested',
};

export default function CompanyPage() {
  const { db, addCompanyFact, confirmCompanyFact, editAndConfirmCompanyFact, rejectCompanyFact, supersedeCompanyFact } = useStore();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [category, setCategory] = useState<CompanyFactCategory>('product');
  const [statement, setStatement] = useState('');
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [superseding, setSuperseding] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then((me) => setAvailable(!!me.capabilities?.companyCanon)).catch(() => setAvailable(false));
  }, []);

  if (available === false) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">Company</h1>
        <Card><p className="text-sm text-gray-400">Not available in this workspace yet.</p></Card>
      </div>
    );
  }
  if (available === null) return <p className="text-sm text-gray-400">Loading…</p>;

  const active = db.companyFacts.filter((f) => f.status !== 'deprecated');
  const unconfirmed = active.filter((f) => f.status === 'unconfirmed');
  const confirmedByCategory = new Map<CompanyFactCategory, CompanyFact[]>();
  for (const f of active.filter((f) => f.status === 'confirmed')) {
    confirmedByCategory.set(f.category, [...(confirmedByCategory.get(f.category) ?? []), f]);
  }
  const deprecated = db.companyFacts.filter((f) => f.status === 'deprecated');

  function submitAdd() {
    if (!statement.trim()) return;
    addCompanyFact({ category, statement: statement.trim(), status: 'confirmed', source: 'user', confirmed_at: new Date().toISOString() });
    setStatement('');
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Company</h1>
        <span className="text-sm text-gray-500">{active.length} active fact{active.length === 1 ? '' : 's'}</span>
      </div>
      <p className="text-xs text-gray-400">
        The verified truth the AI composer grounds every claim in. Nothing here is asserted unless confirmed —
        superseding a fact keeps its history, since the change itself is often the best re-approach argument.
      </p>

      {unconfirmed.length > 0 && (
        <Card title={`Needs confirmation (${unconfirmed.length})`} tint="amber">
          <ul className="space-y-2">
            {unconfirmed.map((f) => (
              <li key={f.id} className="rounded-lg border border-gray-100 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">{f.category}</span>
                  <span className="text-xs text-gray-400">{SOURCE_LABEL[f.source]}</span>
                </div>
                {editing[f.id] !== undefined ? (
                  <textarea value={editing[f.id]} onChange={(e) => setEditing({ ...editing, [f.id]: e.target.value })}
                    rows={2} className="mt-1.5 w-full rounded border border-gray-300 p-2 text-sm" />
                ) : (
                  <p className="mt-1 text-gray-700">{f.statement}</p>
                )}
                <div className="mt-2 flex gap-2">
                  {editing[f.id] !== undefined ? (
                    <>
                      <button onClick={() => { editAndConfirmCompanyFact(f.id, editing[f.id]); setEditing((e) => { const n = { ...e }; delete n[f.id]; return n; }); }}
                        className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800">Save & confirm</button>
                      <button onClick={() => setEditing((e) => { const n = { ...e }; delete n[f.id]; return n; })}
                        className="rounded border border-gray-300 px-2 py-1 text-xs">Cancel</button>
                    </>
                  ) : (
                    <>
                      <Tooltip text="Confirms this fact exactly as written — the composer can now use it.">
                        <button onClick={() => confirmCompanyFact(f.id)} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800">Confirm</button>
                      </Tooltip>
                      <button onClick={() => setEditing({ ...editing, [f.id]: f.statement })}
                        className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">Edit then confirm</button>
                      <Tooltip text="Not true or not useful — removes it from the queue without adding it to the canon.">
                        <button onClick={() => rejectCompanyFact(f.id)} className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50">Reject</button>
                      </Tooltip>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Add a fact">
        <div className="flex flex-wrap gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value as CompanyFactCategory)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={statement} onChange={(e) => setStatement(e.target.value)} placeholder='One atomic fact, e.g. "Seed €1.3M phased; first tranche €300k"'
            className="min-w-[320px] flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm" />
          <button disabled={!statement.trim()} onClick={submitAdd}
            className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Add — confirmed</button>
        </div>
      </Card>

      {CATEGORIES.filter((c) => (confirmedByCategory.get(c) ?? []).length > 0).map((c) => (
        <Card key={c} title={c}>
          <ul className="space-y-2">
            {(confirmedByCategory.get(c) ?? []).map((f) => (
              <li key={f.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[f.status]}`}>{f.status}</span>
                  <span className="text-xs text-gray-400">{SOURCE_LABEL[f.source]} · {f.valid_from ?? f.created_at.slice(0, 10)}</span>
                </div>
                <p className="mt-1 text-gray-700">{f.statement}</p>
                {superseding[f.id] !== undefined ? (
                  <div className="mt-2 space-y-1.5">
                    <textarea value={superseding[f.id]} onChange={(e) => setSuperseding({ ...superseding, [f.id]: e.target.value })}
                      rows={2} placeholder="What's true now?" className="w-full rounded border border-gray-300 p-2 text-sm" />
                    <div className="flex gap-2">
                      <button onClick={() => { supersedeCompanyFact(f.id, superseding[f.id]); setSuperseding((s) => { const n = { ...s }; delete n[f.id]; return n; }); }}
                        disabled={!superseding[f.id]?.trim()}
                        className="rounded bg-[#0E7490] px-2 py-1 text-xs font-medium text-white disabled:opacity-40">Supersede</button>
                      <button onClick={() => setSuperseding((s) => { const n = { ...s }; delete n[f.id]; return n; })}
                        className="rounded border border-gray-300 px-2 py-1 text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2">
                    <Tooltip text="This fact changed — keeps it in history and marks a new one current. The change itself becomes a re-approach argument.">
                      <button onClick={() => setSuperseding({ ...superseding, [f.id]: '' })}
                        className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">Supersede</button>
                    </Tooltip>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}

      {deprecated.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-gray-400">History — deprecated facts ({deprecated.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {deprecated.map((f) => (
              <li key={f.id} className="rounded-lg border border-gray-100 bg-gray-50 p-2 text-xs text-gray-500">
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 font-semibold">{f.category}</span>{' '}
                <span className="line-through">{f.statement}</span>
                {f.superseded_by && <span> — superseded</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
