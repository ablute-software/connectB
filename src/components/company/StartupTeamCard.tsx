'use client';
// Company tab redesign — the startup's own team (founders, key people).
// Distinct from "App access" (org_members — who can log into this
// workspace); this is just who the company is, shown to nobody outside the
// founder's own settings today. Add/edit/remove inline, append-only order
// (no drag-reorder yet).
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { CompletenessField } from './CompletenessField';
import type { CompletenessField as Field } from '@/lib/companyCompleteness';
import type { CompanyPerson } from '@/lib/types';

const BLANK = { full_name: '', title: '', is_founder: false, linkedin_url: '', email: '', bio: '' };

export function StartupTeamCard({ canEdit, missing, flashId }: { canEdit: boolean; missing: Field[]; flashId: string | null }) {
  const { db, updateOrg, addCompanyPerson, updateCompanyPerson, removeCompanyPerson } = useStore();
  const org = db.org;
  const people = db.companyPeople;
  const missingIds = new Set(missing.map((f) => f.id));
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(BLANK);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState(BLANK);
  const [countDraft, setCountDraft] = useState<string | null>(null);

  const founderCount = org.founder_count_override ?? people.filter((p) => p.is_founder).length;

  function submitAdd() {
    if (!draft.full_name.trim()) return;
    addCompanyPerson({
      full_name: draft.full_name.trim(), title: draft.title.trim() || undefined, is_founder: draft.is_founder,
      linkedin_url: draft.linkedin_url.trim() || undefined, email: draft.email.trim() || undefined, bio: draft.bio.trim() || undefined,
    });
    setDraft(BLANK); setAdding(false);
  }

  function startEdit(p: CompanyPerson) {
    setEditDraft({
      full_name: p.full_name, title: p.title ?? '', is_founder: p.is_founder,
      linkedin_url: p.linkedin_url ?? '', email: p.email ?? '', bio: p.bio ?? '',
    });
    setEditingId(p.id);
  }
  function saveEdit(id: string) {
    updateCompanyPerson(id, {
      full_name: editDraft.full_name.trim(), title: editDraft.title.trim() || undefined, is_founder: editDraft.is_founder,
      linkedin_url: editDraft.linkedin_url.trim() || undefined, email: editDraft.email.trim() || undefined, bio: editDraft.bio.trim() || undefined,
    });
    setEditingId(null);
  }

  const personFields = (v: typeof BLANK, set: (v: typeof BLANK) => void) => (
    <div className="grid grid-cols-2 gap-2">
      <input value={v.full_name} onChange={(e) => set({ ...v, full_name: e.target.value })} placeholder="Full name *" className="rounded border border-gray-300 px-2 py-1 text-sm" />
      <input value={v.title} onChange={(e) => set({ ...v, title: e.target.value })} placeholder="Title / role" className="rounded border border-gray-300 px-2 py-1 text-sm" />
      <input value={v.linkedin_url} onChange={(e) => set({ ...v, linkedin_url: e.target.value })} placeholder="LinkedIn URL" className="rounded border border-gray-300 px-2 py-1 text-sm" />
      <input value={v.email} onChange={(e) => set({ ...v, email: e.target.value })} type="email" placeholder="Email (optional)" className="rounded border border-gray-300 px-2 py-1 text-sm" />
      <label className="col-span-2 flex items-center gap-1.5 text-xs text-gray-600">
        <input type="checkbox" checked={v.is_founder} onChange={(e) => set({ ...v, is_founder: e.target.checked })} /> Founder
      </label>
      <input value={v.bio} onChange={(e) => set({ ...v, bio: e.target.value })} placeholder="Mini-bio (optional, 1-2 lines)" className="col-span-2 rounded border border-gray-300 px-2 py-1 text-sm" />
    </div>
  );

  return (
    <Card title="Team" right={canEdit && !adding ? <button onClick={() => setAdding(true)} className="text-xs text-cyan-700 hover:underline">+ Add person</button> : undefined}>
      <CompletenessField id="team.people" label="" missing={missingIds.has('team.people')} flashing={flashId === 'team.people'} className={people.length ? 'p-0' : undefined}>
        {people.length === 0 && !adding ? <p className="text-sm text-gray-400">No team members yet.</p> : (
          <ul className="space-y-2">
            {people.map((p) => (
              <li key={p.id} className={`rounded-lg border p-2.5 text-sm transition-colors duration-700 ${flashId === 'team.founder' && p.is_founder ? 'border-amber-300 bg-amber-50' : 'border-gray-100'}`}>
                {editingId === p.id ? (
                  <div className="space-y-2">
                    {personFields(editDraft, setEditDraft)}
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(p.id)} className="rounded bg-[#0E7490] px-2 py-1 text-xs font-medium text-white">Save</button>
                      <button onClick={() => setEditingId(null)} className="rounded border border-gray-300 px-2 py-1 text-xs">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-medium text-gray-900">{p.full_name}</span>
                      {p.is_founder && <span className="ml-1.5 rounded-full bg-[#E8F4F8] px-1.5 py-0.5 text-[9px] font-semibold text-[#0E7490]">FOUNDER</span>}
                      {p.title && <div className="text-xs text-gray-500">{p.title}</div>}
                      {p.bio && <div className="text-xs text-gray-400">{p.bio}</div>}
                      {p.linkedin_url && <a href={p.linkedin_url} target="_blank" rel="noreferrer" className="text-xs text-cyan-700 hover:underline">LinkedIn</a>}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-2 text-xs">
                        <button onClick={() => startEdit(p)} className="text-gray-400 hover:text-gray-700">Edit</button>
                        <button onClick={() => removeCompanyPerson(p.id)} className="text-gray-400 hover:text-[#B00000]">Remove</button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CompletenessField>

      {adding && (
        <div className="mt-3 space-y-2 rounded-lg border border-cyan-100 bg-cyan-50/40 p-2.5">
          {personFields(draft, setDraft)}
          <div className="flex gap-2">
            <button disabled={!draft.full_name.trim()} onClick={submitAdd} className="rounded bg-[#0E7490] px-2 py-1 text-xs font-medium text-white disabled:opacity-40">Add</button>
            <button onClick={() => { setAdding(false); setDraft(BLANK); }} className="rounded border border-gray-300 px-2 py-1 text-xs">Cancel</button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-gray-100 pt-3">
        <CompletenessField id="team.employee_count" label="Total employees" missing={missingIds.has('team.employee_count')} flashing={flashId === 'team.employee_count'}>
          {canEdit ? (
            <input type="number" value={countDraft ?? (org.employee_count != null ? String(org.employee_count) : '')}
              onChange={(e) => setCountDraft(e.target.value)}
              onBlur={() => { if (countDraft !== null) { updateOrg({ employee_count: countDraft ? Number(countDraft) : undefined }); setCountDraft(null); } }}
              className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" />
          ) : <span>{org.employee_count ?? '—'}</span>}
        </CompletenessField>
        <div className="text-xs text-gray-500">Founders: <b className="text-gray-800">{founderCount}</b> (from the list above{org.founder_count_override != null ? ', overridden' : ''})</div>
      </div>
    </Card>
  );
}
