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
import { useState } from 'react';
import { browserClient } from '@/lib/supabase';
import type { CompanyPerson } from '@/lib/types';

interface VaultDoc { id: string; name: string }
interface DraftMember { personId: string; personName: string; bio: string }
interface FactProposal { personId: string; personName: string; statement: string; confidence: number; sourceUrl: string }

export function TeamAiFillPanel({ orgId, people, updateCompanyPerson }: {
  orgId: string; people: CompanyPerson[];
  updateCompanyPerson: (id: string, patch: Partial<CompanyPerson>) => void;
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
  const [saved, setSaved] = useState(false);

  async function openMode(m: 'watson' | 'sherlock') {
    setMode(m); setError(''); setSaved(false);
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
    setBusy(true); setError(''); setDraftMembers(null); setFacts([]); setApprovedFacts(new Set());
    try {
      const res = await fetch(mode === 'watson' ? '/api/company/team-watson-fill' : '/api/company/team-sherlock-research', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentIds: selectedDocIds }),
      });
      const body = await res.json();
      if (!body.ok) { setError(body.error ?? 'Could not generate — try again.'); return; }
      setDraftMembers(body.members ?? []);
      setSynergy(body.teamSynergy ?? '');
      setFacts(body.facts ?? []);
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

  async function saveAll() {
    for (const m of draftMembers ?? []) {
      if (m.bio.trim()) updateCompanyPerson(m.personId, { bio: m.bio.trim() });
    }
    if (synergy.trim()) {
      await browserClient().from('matchdeal_profiles').update({ team_summary: synergy.trim() })
        .eq('kind', 'startup').eq('membership_id', orgId);
    }
    setSaved(true);
  }

  function close() {
    setMode(null); setDraftMembers(null); setSelectedDocIds([]); setError(''); setSaved(false);
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
            return (
              <div key={m.personId} className="rounded-lg border border-gray-200 bg-white p-2.5">
                <p className="text-xs font-semibold text-gray-900">{m.personName}</p>
                <textarea value={m.bio} onChange={(e) => editBio(m.personId, e.target.value)} rows={2}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs" />
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
              </div>
            );
          })}
          <div>
            <p className="text-xs font-semibold text-gray-900">Team synergy</p>
            <textarea value={synergy} onChange={(e) => setSynergy(e.target.value)} rows={2}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-xs" />
            <p className="mt-0.5 text-[10px] text-gray-400">Saved as your team summary, shown to investors.</p>
          </div>
          <p className="text-[10px] text-gray-400">AI-generated — review and edit before saving.</p>
          {saved ? (
            <p className="text-xs font-medium text-emerald-700">Saved.</p>
          ) : (
            <div className="flex gap-2">
              <button onClick={saveAll} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white">Save</button>
              <button onClick={close} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Discard</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
