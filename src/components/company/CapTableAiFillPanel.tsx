'use client';
// Prompt 431 — removido o modo "Fill with Watson" (multi-documento):
// confirmado na prática que despejava o Vault inteiro (dezenas de ficheiros
// sem relação) sem forma de restringir, o que o Nuno considerou que não
// ajudava. Este painel é agora só perguntas guiadas — sem seletor de modo,
// sem passo "Generate". Uma IA muito mais estreita volta no Prompt 432, mas
// presa a UM documento por linha de investidor convertível — ver
// CapTableCard.tsx.
//
// Ainda válido do Prompt 426 §B/§C: espelha o padrão do TeamAiFillPanel
// (draft sempre editável antes de gravar); deep-link via
// ?capTableRequestItem=<item.id> e resolve esse pedido ao gravar
// (fulfill_cap_table, §D) — nunca fora deste fluxo com deep-link.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { capTableGuidedPanelOpen, capTableTotal, isCapTableTotalOff } from '@/lib/cap-table';
import type { CapTableEntry } from '@/lib/types';

interface DraftEntry { category: CapTableEntry['category']; label: string; pct: string; asOf: string }

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

export function CapTableAiFillPanel({ addCapTableEntry, hasRows = false }: {
  addCapTableEntry: (e: Omit<CapTableEntry, 'id'>) => Promise<{ error?: string }>;
  // Prompt 542 §1 — whether the cap table already has entries. Drives the
  // DEFAULT only; see capTableGuidedPanelOpen for why an explicit toggle
  // is tracked separately rather than seeding useState from this.
  hasRows?: boolean;
}) {
  const requestItemId = useSearchParams().get('capTableRequestItem');
  // null = the founder has not decided; follow the table's own state.
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const [autoOpenDone, setAutoOpenDone] = useState(false);
  const open = capTableGuidedPanelOpen({ hasRows, userToggled });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draftEntries, setDraftEntries] = useState<DraftEntry[]>([]);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  // §C — auto-open exactamente uma vez, assim que aparece um request item
  // via deep-link. Guardado em autoOpenDone (não em `open`) para fechar o
  // painel depois nunca o reabrir sozinho.
  useEffect(() => {
    if (!requestItemId || autoOpenDone) return;
    setAutoOpenDone(true);
    setUserToggled(true);
  }, [requestItemId, autoOpenDone]);

  function addRow(category: CapTableEntry['category'], label: string, pct: string) {
    setDraftEntries((prev) => [...prev, { category, label, pct, asOf: new Date().toISOString().slice(0, 10) }]);
  }
  function editRow(idx: number, patch: Partial<DraftEntry>) {
    setDraftEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }
  function removeRow(idx: number) {
    setDraftEntries((prev) => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    if (draftEntries.length === 0) return;
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
      if (requestItemId) {
        await fetch('/api/founder/document-requests/respond', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ itemId: requestItemId, action: 'fulfill_cap_table', entryCount: count }),
        }).catch(() => {});
      }
      setSavedCount(count);
      setDraftEntries([]);
    } finally { setBusy(false); }
  }

  function close() {
    setUserToggled(false); setDraftEntries([]); setError(''); setSavedCount(null);
  }

  const numericEntries = draftEntries.map((e) => ({ category: e.category, label: e.label, pct: Number(e.pct) || 0 }));
  const total = capTableTotal(numericEntries);
  const totalOff = isCapTableTotalOff(numericEntries);

  if (!open) {
    // Prompt 542 §1 — with rows already in the table this is a quiet text
    // link, not a bordered call-to-action: the founder is past "help me
    // start" and only needs a way back in to add a shareholder. With an
    // empty table the panel is open anyway, so this branch is only reached
    // there after an explicit Close.
    if (hasRows) {
      return (
        <div className="mt-3">
          <button onClick={() => setUserToggled(true)} className="text-xs text-gray-500 hover:text-[#0E7490] hover:underline">
            Add more rows with guided questions
          </button>
        </div>
      );
    }
    return (
      <div className="mt-3 border-t border-gray-100 pt-3">
        <button onClick={() => setUserToggled(true)} className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
          📝 Answer guided questions
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-cyan-100 bg-cyan-50/40 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-800">📝 Guided questions</h3>
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
          <div className="space-y-2.5">
            {GUIDED_SECTIONS.map((s) => (
              <div key={s.category}>
                <p className="text-[11px] font-medium text-gray-600">{s.title}</p>
                <GuidedRowAdder placeholder={s.placeholder} onAdd={(label, pct) => addRow(s.category, label, pct)} />
              </div>
            ))}
          </div>

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
