'use client';
// Prompt 426 §B — "Watson, help me build it" for the cap table: mirrors
// TeamAiFillPanel.tsx's shape (Vault-document picker → Watson reads them →
// editable draft → explicit save), rendered inside CapTableCard the same
// way TeamAiFillPanel lives inside StartupTeamCard. Two differences from
// Team's version: (1) no "Call Sherlock" web-search mode — ownership data
// isn't public, so there's nothing for a web search to responsibly find;
// (2) a no-AI guided-questions fallback (Nuno's own decision), since a
// founder with no Vault documents — or whose documents don't state a clear
// breakdown — still needs a way to build this without Watson.
//
// Prompt 423 wired "Request cap table" on the investor side, which creates
// an access_request_items row with item_type='cap_table'; Prompt 426 §C
// deep-links here via ?capTableRequestItem=<item.id> (read directly, same
// as CompanyPanel's own flashParam) — when present, this panel auto-opens
// in the right mode (Watson if the Vault has documents, guided otherwise)
// and, once the founder saves at least one row, resolves that request item
// automatically (fulfill_cap_table, §D) — never outside this exact
// deep-linked flow, since a standalone save from Company directly has no
// request to resolve.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { browserClient } from '@/lib/supabase';
import { capTableTotal, isCapTableTotalOff } from '@/lib/cap-table';
import type { CapTableFillEntry } from '@/lib/cap-table-ai-fill';
import type { CapTableEntry } from '@/lib/types';

interface VaultDoc { id: string; name: string }
// pct stays a STRING while it's an editable draft field — same reason
// CapTableCard's own add-row form keeps it a string until submit (a
// controlled number input fed back a coerced Number() on every keystroke
// can't hold a trailing "." while the founder is still typing a decimal).
interface DraftEntry { category: CapTableEntry['category']; label: string; pct: string; asOf: string; sourceNote: string | null }

const CATEGORY_LABEL: Record<CapTableEntry['category'], string> = {
  founder: 'Founder', option_pool: 'Option pool', adviser: 'Adviser', investor: 'Investor',
};
const GUIDED_SECTIONS: { category: CapTableEntry['category']; title: string; placeholder: string }[] = [
  { category: 'founder', title: 'Founders', placeholder: 'Founder name' },
  { category: 'option_pool', title: 'Option pool (ESOP)', placeholder: 'e.g. Employee option pool' },
  { category: 'adviser', title: 'Advisers with equity', placeholder: 'Adviser name' },
  { category: 'investor', title: 'Investors from previous rounds', placeholder: 'Investor name' },
];

function fmtPct(n: number) {
  return `${n % 1 === 0 ? n : n.toFixed(1)}%`;
}

export function CapTableAiFillPanel({ orgId, addCapTableEntry }: {
  orgId: string; addCapTableEntry: (e: Omit<CapTableEntry, 'id'>) => Promise<{ error?: string }>;
}) {
  const requestItemId = useSearchParams().get('capTableRequestItem');
  const [mode, setMode] = useState<'watson' | 'guided' | null>(null);
  const [autoOpenDone, setAutoOpenDone] = useState(false);
  const [docs, setDocs] = useState<VaultDoc[] | null>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draftEntries, setDraftEntries] = useState<DraftEntry[] | null>(null);
  const [watsonEmptyNotice, setWatsonEmptyNotice] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  // §C — auto-open in the right mode exactly once, the moment a deep-linked
  // request item id shows up. Gated on autoOpenDone (not on mode itself) so
  // closing the panel afterward never silently reopens it.
  useEffect(() => {
    if (!requestItemId || autoOpenDone) return;
    setAutoOpenDone(true);
    (async () => {
      const { data } = await browserClient().from('documents').select('id, name').eq('org_id', orgId).order('name');
      const list = (data ?? []) as VaultDoc[];
      setDocs(list);
      if (list.length > 0) { setMode('watson'); } else { setMode('guided'); setDraftEntries([]); }
    })();
  }, [requestItemId, autoOpenDone, orgId]);

  async function openMode(m: 'watson' | 'guided') {
    setMode(m); setError('');
    if (m === 'watson' && !docs) {
      const { data } = await browserClient().from('documents').select('id, name').eq('org_id', orgId).order('name');
      setDocs((data ?? []) as VaultDoc[]);
    }
    if (m === 'guided' && draftEntries === null) setDraftEntries([]);
  }

  function toggleDoc(id: string) {
    setSelectedDocIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function generate() {
    if (selectedDocIds.length === 0) { setError('Pick at least one document.'); return; }
    setBusy(true); setError(''); setWatsonEmptyNotice(false);
    try {
      const res = await fetch('/api/company/cap-table-watson-fill', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentIds: selectedDocIds }),
      });
      const body = await res.json();
      if (!body.ok) { setError(body.error ?? 'Could not generate — try again.'); return; }
      const found = (body.entries ?? []) as CapTableFillEntry[];
      if (found.length === 0) {
        // §B — Watson found no clear breakdown: the expected empty case,
        // not an error. Falls straight into the guided fallback.
        setWatsonEmptyNotice(true);
        setMode('guided');
        setDraftEntries([]);
      } else {
        setDraftEntries(found.map((e) => ({ category: e.category, label: e.label, pct: String(e.pct), asOf: e.asOf, sourceNote: e.sourceNote })));
      }
    } catch {
      setError('Could not generate — try again.');
    } finally { setBusy(false); }
  }

  function addGuidedRow(category: CapTableEntry['category'], label: string, pct: string) {
    setDraftEntries((prev) => [...(prev ?? []), { category, label, pct, asOf: new Date().toISOString().slice(0, 10), sourceNote: null }]);
  }
  function editRow(idx: number, patch: Partial<DraftEntry>) {
    setDraftEntries((prev) => (prev ?? []).map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function removeRow(idx: number) {
    setDraftEntries((prev) => (prev ?? []).filter((_, i) => i !== idx));
  }

  async function save() {
    if (!draftEntries || draftEntries.length === 0) return;
    setBusy(true); setError('');
    try {
      for (const e of draftEntries) {
        const pctNum = Number(e.pct);
        if (!e.label.trim() || !e.pct || Number.isNaN(pctNum) || pctNum < 0 || pctNum > 100) {
          setError(`"${e.label.trim() || 'a row'}" needs a label and a valid percentage (0-100).`);
          return;
        }
      }
      for (const e of draftEntries) {
        const result = await addCapTableEntry({ category: e.category, label: e.label.trim(), pct: Number(e.pct), as_of: e.asOf });
        if (result.error) { setError(result.error); return; }
      }
      const count = draftEntries.length;
      // §D — only the deep-linked flow has a request item to resolve; a
      // standalone save from Company directly has nothing to close.
      if (requestItemId) {
        await fetch('/api/founder/document-requests/respond', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ itemId: requestItemId, action: 'fulfill_cap_table', entryCount: count }),
        }).catch(() => {});
      }
      setSavedCount(count);
      setDraftEntries(null);
    } finally { setBusy(false); }
  }

  function close() {
    setMode(null); setDraftEntries(null); setSelectedDocIds([]); setError(''); setSavedCount(null); setWatsonEmptyNotice(false);
  }

  const numericEntries = (draftEntries ?? []).map((e) => ({ category: e.category, label: e.label, pct: Number(e.pct) || 0 }));
  const total = capTableTotal(numericEntries);
  const totalOff = isCapTableTotalOff(numericEntries);

  if (!mode) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        <span className="text-xs text-gray-400">AI-assisted cap table:</span>
        <button onClick={() => openMode('watson')} className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
          ✨ Fill with Watson
        </button>
        <button onClick={() => openMode('guided')} className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
          📝 Answer guided questions
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-cyan-100 bg-cyan-50/40 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-800">{mode === 'watson' ? '✨ Fill with Watson' : '📝 Guided questions'}</h3>
        <button onClick={close} className="text-xs text-gray-400 hover:underline">Close</button>
      </div>

      {requestItemId && (
        <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-800">🔎 An investor asked for this.</p>
      )}

      {savedCount !== null ? (
        <div>
          <p className="text-xs font-medium text-emerald-700">
            Saved {savedCount} {savedCount === 1 ? 'entry' : 'entries'} to your cap table.
            {requestItemId && ' The investor’s request has been marked as fulfilled.'}
          </p>
          <button onClick={close} className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Done</button>
        </div>
      ) : (
        <>
          {mode === 'watson' && draftEntries === null && (
            <>
              <p className="text-[11px] text-gray-500">
                Pick documents already in your Vault (e.g. a cap table export, term sheet, incorporation documents) — Watson reads only what&apos;s already here.
              </p>
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
              <div className="flex items-center gap-2">
                <button onClick={generate} disabled={busy || selectedDocIds.length === 0}
                  className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                  {busy ? 'Watson is reading…' : 'Generate'}
                </button>
                <button onClick={() => openMode('guided')} className="text-[11px] text-gray-500 hover:underline">
                  or answer guided questions instead
                </button>
              </div>
            </>
          )}

          {mode === 'guided' && watsonEmptyNotice && (
            <p className="rounded-lg bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600">
              Watson didn&apos;t find a clear ownership breakdown in the selected documents — let&apos;s fill it in together instead.
            </p>
          )}

          {/* Prompt 429 — draftEntries !== null (not mode === 'guided'), so
              this is also available in Watson mode once a non-empty draft
              exists: the SAME three places that ever set mode to 'guided'
              (openMode, the auto-open effect, generate()'s empty fallback)
              always set draftEntries to [] in that same instant, so this
              stays exactly equivalent there — and now covers the case that
              was missing entirely: Watson with rows already generated,
              where the founder still needs "add more by hand" per 426 §B's
              own "pode adicionar mais à mão" for BOTH modes. */}
          {draftEntries !== null && (
            <div className="space-y-2.5">
              {mode === 'watson' && <p className="text-[11px] font-medium text-gray-600">Add more rows by hand</p>}
              {GUIDED_SECTIONS.map((s) => (
                <div key={s.category}>
                  <p className="text-[11px] font-medium text-gray-600">{s.title}</p>
                  <GuidedRowAdder placeholder={s.placeholder} onAdd={(label, pct) => addGuidedRow(s.category, label, pct)} />
                </div>
              ))}
            </div>
          )}

          {draftEntries !== null && (
            <div className="space-y-2 border-t border-gray-100 pt-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Draft — review before saving</p>
              {draftEntries.length === 0 ? (
                <p className="text-xs text-gray-400">Nothing added yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {draftEntries.map((e, i) => (
                    <li key={i} className="rounded-lg border border-gray-200 bg-white p-2">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{CATEGORY_LABEL[e.category]}</span>
                        <input value={e.label} onChange={(ev) => editRow(i, { label: ev.target.value })}
                          className="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-0.5" />
                        <input value={e.pct} onChange={(ev) => editRow(i, { pct: ev.target.value })} type="number" min="0" max="100" step="0.1"
                          className="w-16 shrink-0 rounded border border-gray-300 px-1.5 py-0.5" />
                        <button onClick={() => removeRow(i)} className="shrink-0 text-[11px] text-gray-400 hover:text-[#B00000]">remove</button>
                      </div>
                      {e.sourceNote && <p className="mt-1 text-[10px] text-gray-400">📄 {e.sourceNote}</p>}
                    </li>
                  ))}
                  <li className={`text-xs font-semibold ${totalOff ? 'text-amber-700' : 'text-gray-900'}`}>
                    Total: {fmtPct(total)}
                    {totalOff && <span className="ml-2 text-xs font-normal text-amber-600">doesn&apos;t add up to ~100% yet</span>}
                  </li>
                </ul>
              )}
              {error && <p className="text-xs text-[#B00000]">{error}</p>}
              <button onClick={save} disabled={busy || draftEntries.length === 0}
                className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                {busy ? 'Saving…' : 'Save to my cap table'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function GuidedRowAdder({ placeholder, onAdd }: { placeholder: string; onAdd: (label: string, pct: string) => void }) {
  const [label, setLabel] = useState('');
  const [pct, setPct] = useState('');

  function submit() {
    const pctNum = Number(pct);
    if (!label.trim() || !pct || Number.isNaN(pctNum) || pctNum < 0 || pctNum > 100) return;
    onAdd(label.trim(), pct);
    setLabel(''); setPct('');
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={placeholder}
        className="w-40 rounded border border-gray-300 px-2 py-1 text-xs" />
      <input value={pct} onChange={(e) => setPct(e.target.value)} type="number" min="0" max="100" step="0.1" placeholder="%"
        className="w-16 rounded border border-gray-300 px-2 py-1 text-xs" />
      <button onClick={submit} disabled={!label.trim() || !pct}
        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40">
        + Add
      </button>
    </div>
  );
}
