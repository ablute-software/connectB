'use client';
// Prompt 909 (I3) — Calls editor, tab "Team & distribution". The Team half works: the organisation's categories
// (boxes that expand and list their people, with the nine permissions for the whole category), who is in THIS call
// (only active members with a seat can be added), a discreet "Adjust permissions for this person" per person, and the
// conflicts declared up front. Distribution says it comes in the next stage. The team is not configuration: it is
// edited whatever the state of the call, and every change goes into the call's history. The server decides what is
// allowed; this screen only shows it (and never offers what the server will refuse).
import { useCallback, useEffect, useState } from 'react';
import { ADMIN_CATEGORY_NAME, SUGGESTED_CATEGORIES, sameCategoryName, type PermissionKey, type PermissionSet } from '@/lib/calls/permissions';
import { CategoryPicker, type CategoryChoice } from './CategoryPicker';
import { PermissionToggles } from './PermissionToggles';
import { useTeamEngine } from './useTeamEngine';

const INPUT = 'rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm disabled:bg-gray-50';
const BUTTON = 'rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40';

export function TeamTab({ callId }: { callId: string }) {
  // A click shows its result at once and saves behind it (useTeamEngine); `busy` is only true while something that has to wait for the answer is on its way (a category being created, renamed or deleted).
  const { data, error, enqueue, blocking: busy } = useTeamEngine(callId);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [adjusting, setAdjusting] = useState<Set<string>>(new Set());
  const [newCategory, setNewCategory] = useState('');
  const [addCategory, setAddCategory] = useState<Record<string, CategoryChoice>>({});
  const [conflict, setConflict] = useState({ userId: '', companyName: '', note: '' });
  // The category a person was just put in opens by itself, so they do not seem to vanish into a closed box; for a category that is being created it opens once the server has made it.
  const [reveal, setReveal] = useState<string | null>(null);
  useEffect(() => {
    const hit = reveal && data?.categories.find((c) => sameCategoryName(c.name, reveal));
    if (hit) { setOpen((o) => new Set(o).add(hit.id)); setReveal(null); }
  }, [reveal, data]);

  /** One change. Switches, a person's category and adding or removing someone show at once; the rest wait for the server. Resolves true when the server accepted it. */
  const run = useCallback((body: Record<string, unknown> & { action: string }): Promise<boolean> => enqueue(body), [enqueue]);

  const toggleIn = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  if (!data) return <p className="text-sm text-gray-400" data-testid="team-loading">{error || 'Loading…'}</p>;
  const can = data.canManageTeam;
  const org = data.organisation.name;
  const taken = new Set(data.categories.map((c) => c.name.toLowerCase()));
  const suggestions = SUGGESTED_CATEGORIES.filter((s) => !taken.has(s.toLowerCase()));
  const defaultCategory: CategoryChoice = { kind: 'existing', id: (data.categories.find((c) => c.name !== ADMIN_CATEGORY_NAME) ?? data.categories[0])?.id ?? '' };
  /** A person's category from the list: an existing one is a plain change; a suggestion or a new name is made first and the person put in it, in one step. */
  const pickFor = (userId: string, inCall: boolean, picked: CategoryChoice) => {
    // A suggestion or a name chosen earlier may have been created since (by this person's colleague, or for somebody else a moment ago): then it is simply that category, never a second one.
    const already = picked.kind === 'existing' ? null : data.categories.find((c) => sameCategoryName(c.name, picked.name));
    const choice: CategoryChoice = already ? { kind: 'existing', id: already.id } : picked;
    if (choice.kind === 'existing') setOpen((o) => new Set(o).add(choice.id)); else setReveal(choice.name);
    if (choice.kind === 'existing') return run(inCall ? { action: 'set_category', userId, categoryId: choice.id } : { action: 'add_member', userId, categoryId: choice.id });
    return run({ action: 'create_category', name: choice.name, assignUserId: userId });
  };

  return (
    <div className="space-y-8" data-testid="team-tab">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Team</h2>
        <p className="mt-1 text-[11px] text-gray-500" data-testid="team-note">Changes to categories apply to all calls of {org}. The team can be changed at any time, even after the call is confirmed or open.</p>
        {!can && <p role="status" className="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900" data-testid="team-readonly">You can see the team of this call, but you do not have the “Manage team &amp; permissions” permission.</p>}
        {data.noAdministrator && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-[#B00000]">This call has nobody who can both configure it and manage its team. Give someone both permissions.</p>}
        {error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-[#B00000]" data-testid="team-error">{error}</p>}
      </div>

      {/* Create a category: first thing in the section, so nobody has to look for it (Prompt 918, follow-up) */}
      {can && (
        <section aria-label="Create a category" className="rounded-xl border border-[#BAD9E3] bg-[#E8F4F8] p-4" data-testid="create-category-box">
          <h2 className="text-sm font-semibold text-[#0E7490]">Create a category</h2>
          <p className="mt-1 text-xs text-gray-700">Categories group permissions — e.g. Evaluator, Analyst. Create one, then assign people to it below.</p>
          <form className="mt-3 flex w-full flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); void run({ action: 'create_category', name: newCategory }).then((ok) => { if (ok) setNewCategory(''); }); }}>
            <label className="sr-only" htmlFor="new-category">Name of the new category</label>
            <input id="new-category" list="category-suggestions" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} autoComplete="off"
              placeholder="Choose from the list or write a name" className={`${INPUT} w-full bg-white sm:w-72`} data-testid="new-category" />
            <datalist id="category-suggestions">{suggestions.map((sg) => <option key={sg} value={sg} />)}</datalist>
            <button type="submit" disabled={busy || !newCategory.trim()} className={`${BUTTON} w-full bg-white py-2 sm:w-auto sm:py-1`} data-testid="create-category">Create</button>
          </form>
        </section>
      )}

      {/* Categories: one box each, expanding to its permissions and its people */}
      <section aria-label="Categories" className="space-y-2">
        {data.categories.map((c) => {
          const people = data.members.filter((m) => m.categoryId === c.id);
          const isOpen = open.has(c.id);
          return (
            <div key={c.id} className="rounded-lg border border-gray-200 bg-white" data-testid={`category-${c.name}`}>
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen((s) => toggleIn(s, c.id))}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                <span><span className="mr-1 text-gray-400">{isOpen ? '▾' : '▸'}</span><b className="text-sm text-gray-900">{c.name}</b>
                  <span className="ml-2 text-xs text-gray-500">{people.length} {people.length === 1 ? 'person' : 'people'} in this call</span></span>
                <span className="text-[11px] text-gray-400">{Object.values(c.permissions).filter(Boolean).length} of 9 permissions</span>
              </button>
              {isOpen && (
                <div className="space-y-4 border-t border-gray-100 px-4 py-4">
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Permissions of the category</p>
                    <PermissionToggles idPrefix={`cat-${c.name}`} values={c.permissions} disabled={!can}
                      onToggle={(key, value) => void run({ action: 'set_category_permissions', categoryId: c.id, permissions: { ...c.permissions, [key]: value } })} />
                  </div>
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">People</p>
                    {people.length === 0 ? <p className="text-xs text-gray-400">Nobody from this category is in this call.</p> : (
                      <ul className="space-y-3">
                        {people.map((m) => {
                          const adj = adjusting.has(m.userId);
                          return (
                            <li key={m.userId} className="rounded-lg bg-gray-50 px-3 py-2" data-testid={`member-${m.email ?? m.userId}`}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-sm text-gray-900">{m.name ?? m.email}{m.name && m.email && <span className="ml-2 text-xs text-gray-400">{m.email}</span>}
                                  {m.orgRole && <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">{m.orgRole}</span>}</span>
                                <span className="flex flex-wrap items-center gap-2">
                                  <CategoryPicker id={`cat-of-${m.userId}`} label={`Category of ${m.name ?? m.email}`} categories={data.categories} value={{ kind: 'existing', id: m.categoryId }}
                                    disabled={!can || busy} className={`${INPUT} py-1 text-xs`} onPick={(choice) => void pickFor(m.userId, true, choice)} />
                                  <button type="button" className={BUTTON} aria-expanded={adj} onClick={() => setAdjusting((s) => toggleIn(s, m.userId))}>Adjust permissions for this person</button>
                                  {can && <button type="button" className="text-xs text-[#B00000] hover:underline" onClick={() => void run({ action: 'remove_member', userId: m.userId })}>Remove</button>}
                                </span>
                              </div>
                              {adj && (
                                <div className="mt-3 border-t border-gray-200 pt-3" data-testid={`adjust-${m.email ?? m.userId}`}>
                                  <PermissionToggles idPrefix={`person-${m.userId}`} values={m.effective} markAdjusted={m.overrides} disabled={!can}
                                    onToggle={(key: PermissionKey, value: boolean) => {
                                      // Only what differs from the category is stored as an adjustment.
                                      const next: Partial<PermissionSet> = { ...m.overrides };
                                      if (c.permissions[key] === value) delete next[key]; else next[key] = value;
                                      void run({ action: 'set_overrides', userId: m.userId, overrides: next });
                                    }} />
                                  {Object.keys(m.overrides).length > 0 && can && (
                                    <button type="button" className="mt-2 text-[11px] text-[#0E7490] hover:underline"
                                      onClick={() => void run({ action: 'set_overrides', userId: m.userId, overrides: {} })}>Back to the category’s permissions</button>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  {can && (
                    <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3 text-xs">
                      <RenameCategory name={c.name} disabled={busy} onRename={(name) => run({ action: 'rename_category', categoryId: c.id, name })} />
                      <button type="button" className="text-[#B00000] hover:underline disabled:opacity-40" disabled={busy || c.peopleInOrganisation > 0}
                        title={c.peopleInOrganisation > 0 ? `${c.peopleInOrganisation} ${c.peopleInOrganisation === 1 ? 'person is' : 'people are'} still in this category (in this call or another). Move them first.` : undefined}
                        onClick={() => { if (window.confirm(`Delete the category “${c.name}” for all calls of ${org}?`)) void run({ action: 'delete_category', categoryId: c.id }); }}>Delete category</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

      </section>

      {/* Who can be added */}
      <section aria-label="Add people">
        <h2 className="text-sm font-semibold text-gray-900">People of {org}</h2>
        <p className="mt-1 text-[11px] text-gray-500">Only active members with a seat can be part of a call’s team.</p>
        {data.candidates.length === 0 ? <p className="mt-2 text-xs text-gray-400">Everybody is already in this call.</p> : (
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {data.candidates.map((p) => (
              <li key={p.userId ?? p.email} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 ${p.eligible ? '' : 'bg-gray-50 text-gray-400'}`} data-testid={`candidate-${p.email ?? p.userId}`}>
                <span className="text-sm">{p.name ?? p.email}{p.name && p.email && <span className="ml-2 text-xs opacity-70">{p.email}</span>}
                  {p.role && <span className="ml-2 text-[10px] uppercase tracking-wide opacity-70">{p.role}</span>}
                  {!p.eligible && p.reason && <span className="block text-[11px]" data-testid="no-seat">{p.reason}</span>}</span>
                {p.eligible && can && p.userId && (
                  <span className="flex items-center gap-2">
                    <CategoryPicker id={`add-cat-${p.userId}`} label={`Category for ${p.name ?? p.email}`} categories={data.categories} value={addCategory[p.userId] ?? defaultCategory}
                      disabled={busy} className={`${INPUT} py-1 text-xs`} onPick={(choice) => setAddCategory((st) => ({ ...st, [p.userId as string]: choice }))} />
                    <button type="button" disabled={busy} className={BUTTON} data-testid={`add-${p.email ?? p.userId}`}
                      onClick={() => void pickFor(p.userId as string, false, addCategory[p.userId as string] ?? defaultCategory).then((ok) => { if (ok) setAddCategory((st) => { const n = { ...st }; delete n[p.userId as string]; return n; }); })}>Add to the call</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Conflicts up front */}
      <section aria-label="Declared conflicts" data-testid="conflicts">
        <h2 className="text-sm font-semibold text-gray-900">Declared conflicts</h2>
        <p className="mt-1 text-[11px] text-gray-500">Record a conflict of interest up front, for example a company in a reviewer’s portfolio. Declaring one on a single application comes with the evaluation stage.</p>
        {data.conflicts.length === 0 ? <p className="mt-2 text-xs text-gray-400">None declared.</p> : (
          <ul className="mt-2 space-y-1.5">
            {data.conflicts.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-800">
                <span><b>{c.personName ?? c.personEmail ?? 'Someone'}</b> · {c.companyName}{c.note && <span className="text-gray-500"> · {c.note}</span>}</span>
                {can && <button type="button" disabled={busy} className="text-[#B00000] hover:underline" onClick={() => void run({ action: 'remove_conflict', conflictId: c.id })}>Remove</button>}
              </li>
            ))}
          </ul>
        )}
        {can && data.members.length > 0 && (
          <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run({ action: 'declare_conflict', ...conflict }).then((ok) => { if (ok) setConflict({ userId: conflict.userId, companyName: '', note: '' }); }); }}>
            <label className="text-xs text-gray-600">Person
              <select value={conflict.userId} onChange={(e) => setConflict((s) => ({ ...s, userId: e.target.value }))} className={`${INPUT} mt-0.5 block py-1 text-xs`} data-testid="conflict-person">
                <option value="">Choose…</option>
                {data.members.map((m) => <option key={m.userId} value={m.userId}>{m.name ?? m.email}</option>)}
              </select></label>
            <label className="text-xs text-gray-600">Company
              <input value={conflict.companyName} onChange={(e) => setConflict((s) => ({ ...s, companyName: e.target.value }))} autoComplete="off" className={`${INPUT} mt-0.5 block w-48 py-1 text-xs`} data-testid="conflict-company" /></label>
            <label className="text-xs text-gray-600">Note
              <input value={conflict.note} onChange={(e) => setConflict((s) => ({ ...s, note: e.target.value }))} autoComplete="off" className={`${INPUT} mt-0.5 block w-56 py-1 text-xs`} /></label>
            <button type="submit" disabled={busy || !conflict.userId || !conflict.companyName.trim()} className={BUTTON} data-testid="declare-conflict">Declare conflict</button>
          </form>
        )}
      </section>

    </div>
  );
}

function RenameCategory({ name, disabled, onRename }: { name: string; disabled: boolean; onRename: (name: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  if (!editing) return <button type="button" className="text-[#0E7490] hover:underline" onClick={() => { setValue(name); setEditing(true); }}>Rename</button>;
  return (
    <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void onRename(value).then((ok) => { if (ok) setEditing(false); }); }}>
      <label className="sr-only" htmlFor="rename-category">New name</label>
      <input id="rename-category" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" className={`${INPUT} w-40 py-0.5 text-xs`} />
      <button type="submit" disabled={disabled || !value.trim()} className={BUTTON}>Save</button>
      <button type="button" className="text-gray-500 hover:underline" onClick={() => setEditing(false)}>Cancel</button>
    </form>
  );
}

