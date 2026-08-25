'use client';
// Prompt 357 §B — "Fill with Watson" / "Call Sherlock": two AI helpers for
// the founder's own Team card. Watson = the internal engine (Vault
// documents only); Sherlock = the detective (also web search + a founder-
// confirmed LinkedIn snippet). Both produce an EDITABLE DRAFT only — never
// auto-published; the founder reviews every bio (and, for Sherlock, every
// individual researched fact) before Save writes anything.
//
// Not gated behind watson_draft_credits (that quota is for outreach-draft
// generation, a different feature) — relying on ai_call_log cost
// visibility alone for this pass, same decision as Prompt 349's Watson
// evaluation-support feature.
//
// Prompt 376 §A — the real ablute_ test: running Sherlock after Watson
// produced WORSE bios (lost a PhD, a professorship, a research project) —
// documents are the strong source, the web is only a complement, and the
// old flat "Save" button had no notion of that at all. There is no single
// "Save" any more: each person gets Replace / Merge with current / Keep
// current, with a loss warning (checkBioLoss, team-bio-guard.ts) whenever
// the AI draft would actually lose information the current bio already had
// — informative, never a silent block, since the founder is always the one
// who decides.
import { useState } from 'react';
import { browserClient } from '@/lib/supabase';
import { checkBioLoss } from '@/lib/team-bio-guard';
import type { CompanyPerson, Org } from '@/lib/types';

interface VaultDoc { id: string; name: string }
interface DraftMember { personId: string; personName: string; bio: string }
interface FactProposal { personId: string; personName: string; statement: string; confidence: number; sourceUrl: string }
interface FactConflict { personId: string; personName: string; statement: string; sourceUrl: string; field: 'founded_year'; webValue: number; appValue: number }

export function TeamAiFillPanel({ orgId, org, people, updateCompanyPerson, updateOrg }: {
  orgId: string; org: Pick<Org, 'founded_year'>; people: CompanyPerson[];
  updateCompanyPerson: (id: string, patch: Partial<CompanyPerson>) => void;
  updateOrg: (patch: Partial<Org>) => void;
}) {
  const [mode, setMode] = useState<'watson' | 'sherlock' | null>(null);
  const [docs, setDocs] = useState<VaultDoc[] | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draftMembers, setDraftMembers] = useState<DraftMember[] | null>(null);
  const [synergy, setSynergy] = useState('');
  const [facts, setFacts] = useState<FactProposal[]>([]);
  const [approvedFacts, setApprovedFacts] = useState<Set<number>>(new Set());
  const [conflicts, setConflicts] = useState<FactConflict[]>([]);
  const [resolvedConflicts, setResolvedConflicts] = useState<Set<number>>(new Set());
  // Per person: which of the three actions was taken, so the button row
  // becomes a confirmation once clicked instead of staying live forever.
  const [resolvedMembers, setResolvedMembers] = useState<Record<string, 'replaced' | 'merged' | 'kept'>>({});
  const [savedSynergy, setSavedSynergy] = useState(false);

  const currentBioByPersonId = new Map(people.map((p) => [p.id, p.bio ?? '']));

  async function openMode(m: 'watson' | 'sherlock') {
    setMode(m); setError(''); setResolvedMembers({}); setResolvedConflicts(new Set());
    if (!docs) {
      const { data } = await browserClient().from('documents').select('id, name').eq('org_id', orgId).order('name');
      setDocs((data ?? []) as VaultDoc[]);
    }
  }

  function toggleDoc(id: string) {
    setSelectedDocIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function generate() {
    if (mode === 'watson' && selectedDocIds.length === 0) { setError('Pick at least one document.'); return; }
    setBusy(true); setError(''); setDraftMembers(null); setFacts([]); setApprovedFacts(new Set()); setConflicts([]); setResolvedMembers({}); setResolvedConflicts(new Set());
    try {
      const res = await fetch(mode === 'watson' ? '/api/company/team-watson-fill' : '/api/company/team-sherlock-research', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentIds: selectedDocIds }),
      });
      const body = await res.json();
      if (!body.ok) { setError(body.error ?? 'Could not generate — try again.'); return; }
      setDraftMembers(body.members ?? []);
      setSynergy(body.teamSynergy ?? '');
      setFacts(body.facts ?? []);
      setConflicts(body.conflicts ?? []);
    } catch {
      setError('Could not generate — try again.');
    } finally { setBusy(false); }
  }

  function insertFact(fact: FactProposal, idx: number) {
    setApprovedFacts((prev) => new Set(prev).add(idx));
    setDraftMembers((prev) => (prev ?? []).map((m) => (
      m.personId === fact.personId ? { ...m, bio: m.bio ? `${m.bio} ${fact.statement}` : fact.statement } : m
    )));
  }

  function editBio(personId: string, bio: string) {
    setDraftMembers((prev) => (prev ?? []).map((m) => (m.personId === personId ? { ...m, bio } : m)));
  }

  // Prompt 376 §A.3 — three real outcomes per person, never a single Save
  // that overwrites blind: Replace (the AI draft becomes the bio), Merge
  // (current + draft, both kept, founder can trim afterward via the normal
  // edit field), Keep current (this person's bio is left untouched).
  function replaceBio(m: DraftMember) {
    updateCompanyPerson(m.personId, { bio: m.bio.trim() });
    setResolvedMembers((prev) => ({ ...prev, [m.personId]: 'replaced' }));
  }
  function mergeBio(m: DraftMember) {
    const current = (currentBioByPersonId.get(m.personId) ?? '').trim();
    const merged = current ? `${current} ${m.bio.trim()}` : m.bio.trim();
    updateCompanyPerson(m.personId, { bio: merged });
    setResolvedMembers((prev) => ({ ...prev, [m.personId]: 'merged' }));
  }
  function keepCurrent(m: DraftMember) {
    setResolvedMembers((prev) => ({ ...prev, [m.personId]: 'kept' }));
  }

  async function saveSynergy() {
    if (!synergy.trim()) return;
    await browserClient().from('matchdeal_profiles').update({ team_summary: synergy.trim() })
      .eq('kind', 'startup').eq('membership_id', orgId);
    setSavedSynergy(true);
  }

  // Prompt 376 §C — the founder resolves which side was right; picking the
  // web value corrects the org's own profile (the real ablute_ case: the
  // app's founded_year was the one that was wrong).
  function resolveConflict(conflict: FactConflict, idx: number, useWebValue: boolean) {
    if (useWebValue && conflict.field === 'founded_year') updateOrg({ founded_year: conflict.webValue });
    setResolvedConflicts((prev) => new Set(prev).add(idx));
  }

  function close() {
    setMode(null); setDraftMembers(null); setSelectedDocIds([]); setError(''); setSavedSynergy(false);
  }

  if (!mode) {
    return (
      <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
        <span className="text-xs text-gray-400">AI-assisted bios:</span>
        <button onClick={() => openMode('watson')} className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
          ✨ Fill with Watson
        </button>
        <button onClick={() => openMode('sherlock')} className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
          🔎 Call Sherlock
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-cyan-100 bg-cyan-50/40 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-800">{mode === 'watson' ? '✨ Fill with Watson' : '🔎 Call Sherlock'}</h3>
        <button onClick={close} className="text-xs text-gray-400 hover:underline">Close</button>
      </div>
      <p className="text-[11px] text-gray-500">
        {mode === 'watson'
          ? 'Pick documents already in your Vault (e.g. CVs) — Watson reads only what\'s already here.'
          : 'Pick documents (optional) — Sherlock also searches the public web and reads any LinkedIn URL you\'ve already saved for a team member.'}
      </p>
      {mode === 'sherlock' && (
        <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800">
          This looks up public professional information about your team members — make sure they&apos;re aware, in line
          with T&amp;C clause 6.4.
        </p>
      )}

      {!draftMembers && (
        <>
          {docs === null ? (
            <p className="text-xs text-gray-400">Loading documents…</p>
          ) : docs.length === 0 ? (
            <p className="text-xs text-gray-400">No documents in your Vault yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {docs.map((d) => (
                <button key={d.id} onClick={() => toggleDoc(d.id)}
                  className={`rounded-full border px-2 py-1 text-[11px] ${selectedDocIds.includes(d.id) ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-200 text-gray-600'}`}>
                  {d.name}
                </button>
              ))}
            </div>
          )}
          {error && <p className="text-xs text-[#B00000]">{error}</p>}
          <button onClick={generate} disabled={busy || (mode === 'watson' && selectedDocIds.length === 0)}
            className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
            {busy ? (mode === 'watson' ? 'Watson is reading…' : 'Sherlock is investigating…') : 'Generate'}
          </button>
        </>
      )}

      {draftMembers && (
        <div className="space-y-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">AI-generated draft — review before saving</p>
          {draftMembers.length === 0 && <p className="text-xs text-gray-400">Couldn&apos;t match anyone on your team to the selected material.</p>}
          {draftMembers.map((m) => {
            const memberFacts = facts.map((f, i) => ({ f, i })).filter(({ f, i }) => f.personId === m.personId && !approvedFacts.has(i));
            const currentBio = currentBioByPersonId.get(m.personId) ?? '';
            const loss = currentBio ? checkBioLoss(currentBio, m.bio) : { lost: false, reasons: [] };
            const resolution = resolvedMembers[m.personId];
            return (
              <div key={m.personId} className="rounded-lg border border-gray-200 bg-white p-2.5">
                <p className="text-xs font-semibold text-gray-900">{m.personName}</p>

                {currentBio && (
                  <div className="mt-1 rounded bg-gray-50 p-1.5 text-[11px] text-gray-500">
                    <span className="font-medium text-gray-600">Current: </span>{currentBio}
                  </div>
                )}
                <textarea value={m.bio} onChange={(e) => editBio(m.personId, e.target.value)} rows={2}
                  className="mt-1.5 w-full rounded border border-gray-300 px-2 py-1 text-xs" />
                <p className="mt-0.5 text-[10px] text-gray-400">↑ AI draft — edit freely before choosing an action.</p>

                {loss.lost && !resolution && (
                  <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                    ⚠ Replacing with this draft would lose information the current bio has: {loss.reasons.join('; ')}.
                    Merge instead, or edit the draft above to include it.
                  </p>
                )}

                {memberFacts.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {memberFacts.map(({ f, i }) => (
                      <div key={i} className="flex items-start gap-1.5 rounded bg-gray-50 px-1.5 py-1 text-[11px]">
                        <div className="flex-1">
                          <span className="text-gray-600">{f.statement}</span>
                          <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="ml-1 text-[10px] text-[#0E7490] hover:underline">source</a>
                          <span className="ml-1 text-[10px] text-gray-400">({Math.round(f.confidence * 100)}% confidence)</span>
                        </div>
                        <button onClick={() => insertFact(f, i)} className="shrink-0 text-[10px] font-medium text-[#0E7490] hover:underline">Approve → insert</button>
                      </div>
                    ))}
                  </div>
                )}

                {resolution ? (
                  <p className="mt-1.5 text-[11px] font-medium text-emerald-700">
                    {resolution === 'replaced' ? 'Replaced.' : resolution === 'merged' ? 'Merged with the current bio.' : 'Kept the current bio — nothing changed.'}
                  </p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button onClick={() => replaceBio(m)}
                      className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white">
                      {loss.lost ? 'Replace anyway' : 'Replace'}
                    </button>
                    {currentBio && (
                      <button onClick={() => mergeBio(m)} className="rounded-lg border border-[#0E7490] px-2.5 py-1 text-xs font-medium text-[#0E7490] hover:bg-[#E8F4F8]">
                        Merge with current
                      </button>
                    )}
                    {currentBio && (
                      <button onClick={() => keepCurrent(m)} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">
                        Keep current
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {conflicts.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Conflicts with your profile — which is correct?</p>
              {conflicts.map((c, i) => resolvedConflicts.has(i) ? null : (
                <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs">
                  <p className="text-gray-800">
                    The web says <b>{c.webValue}</b> (source below); your profile says <b>{c.appValue}</b>. Which is correct?
                  </p>
                  <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-[10px] text-[#0E7490] underline">{c.sourceUrl}</a>
                  <div className="mt-1.5 flex gap-1.5">
                    <button onClick={() => resolveConflict(c, i, true)} className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white">
                      Use {c.webValue} (update my profile)
                    </button>
                    <button onClick={() => resolveConflict(c, i, false)} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">
                      Keep {c.appValue}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-900">Team synergy</p>
            <textarea value={synergy} onChange={(e) => setSynergy(e.target.value)} rows={2}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs" />
            <p className="mt-0.5 text-[10px] text-gray-400">Saved as your team summary, shown to investors.</p>
            {savedSynergy ? (
              <p className="mt-1 text-xs font-medium text-emerald-700">Saved.</p>
            ) : (
              <button onClick={saveSynergy} className="mt-1 rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white">Save synergy</button>
            )}
          </div>
          <p className="text-[10px] text-gray-400">AI-generated — review and edit before saving.</p>
          <button onClick={close} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Done</button>
        </div>
      )}
    </div>
  );
}
