'use client';
// Prompt 422 §B — structured cap table data entry, same shape as
// PreviousFundingCard.tsx (list + add form + running total), living
// alongside the round data it complements. Data entry only, no chart on
// this side — that's the investor-side Ownership calculator (§C).
//
// Prompt 432 §D — an investor row can represent a convertible instrument
// (SAFE, convertible note) instead of a fixed %. The panel is INLINE,
// expanded below the row, never a floating popover — this codebase has a
// documented history of position:fixed overlays collapsing under an
// ancestor with transform/backdrop-filter (CLAUDE.md's root rule on
// full-viewport overlays); an inline panel in the document's own flow
// sidesteps that whole bug class.
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { capTableTotal, isCapTableTotalOff, quarterYearToIsoDate } from '@/lib/cap-table';
import { uploadAndVerifyFile } from '@/lib/vault-upload-client';
import { CapTableAiFillPanel } from './CapTableAiFillPanel';
import type { CapTableEntry } from '@/lib/types';

const CATEGORY_LABEL: Record<CapTableEntry['category'], string> = {
  founder: 'Founder', option_pool: 'Option pool', adviser: 'Adviser', investor: 'Investor',
};
const CATEGORIES: CapTableEntry['category'][] = ['founder', 'option_pool', 'adviser', 'investor'];
const QUARTERS: ('Q1' | 'Q2' | 'Q3' | 'Q4')[] = ['Q1', 'Q2', 'Q3', 'Q4'];
// "A reasonable range" per the prompt's own words — current year through +6.
const YEAR_OPTIONS = Array.from({ length: 7 }, (_, i) => String(new Date().getFullYear() + i));
const MONTH_TO_QUARTER: Record<string, 'Q1' | 'Q2' | 'Q3' | 'Q4'> = {
  '01': 'Q1', '02': 'Q1', '03': 'Q1', '04': 'Q2', '05': 'Q2', '06': 'Q2',
  '07': 'Q3', '08': 'Q3', '09': 'Q3', '10': 'Q4', '11': 'Q4', '12': 'Q4',
};

function fmtPct(n: number) {
  return `${n % 1 === 0 ? n : n.toFixed(1)}%`;
}

// Shared by the in-progress panel's own summary line and the saved-rows
// list below — same wording, same source of truth.
function formatConversionTrigger(triggerType: 'date' | 'event' | null, conversionDate: string | null, conversionEvent: string | null): string | null {
  if (triggerType === 'date' && conversionDate) {
    const quarter = MONTH_TO_QUARTER[conversionDate.slice(5, 7)] ?? '';
    return `Converts ${quarter} ${conversionDate.slice(0, 4)}`.trim();
  }
  if (triggerType === 'event' && conversionEvent) return `Converts on: ${conversionEvent}`;
  return null;
}

interface ConvertibleValue {
  triggerType: 'date' | 'event' | null;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  year: string;
  event: string;
  agreementDocumentId: string | null;
  agreementDocumentName: string | null;
}
const EMPTY_CONVERTIBLE: ConvertibleValue = {
  triggerType: null, quarter: 'Q1', year: YEAR_OPTIONS[0], event: '', agreementDocumentId: null, agreementDocumentName: null,
};

// Prompt 432 §D — the inline convertible-note panel. Controlled: the
// parent owns `value` (so add() can read the committed trigger/document
// straight through) and the label/pct it can fill once Watson Review
// returns something the founder hasn't already typed themselves.
function ConvertibleNotePanel({ orgId, documents, label, pct, onFillLabel, onFillPct, value, onChange, onDone }: {
  orgId: string; documents: { id: string; name: string }[]; label: string; pct: string;
  onFillLabel: (v: string) => void; onFillPct: (v: string) => void;
  value: ConvertibleValue; onChange: (patch: Partial<ConvertibleValue>) => void; onDone: () => void;
}) {
  const { addDocument } = useStore();
  const [docMode, setDocMode] = useState<'existing' | 'upload'>(documents.length > 0 ? 'existing' : 'upload');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [watsonBusy, setWatsonBusy] = useState(false);
  const [watsonError, setWatsonError] = useState('');
  const [watsonNote, setWatsonNote] = useState('');

  async function handleUpload(file: File) {
    setUploadBusy(true); setUploadError('');
    try {
      const verified = await uploadAndVerifyFile(orgId, file);
      const docId = addDocument({
        name: file.name, storage_path: verified.storagePath,
        // Prompt 432 §D.3 — closed by default, not the app's usual
        // 'on_grant' default: this is the founder's own private evidence
        // for a number/date on their cap table, not something meant to be
        // requestable at all until they explicitly decide to share it via
        // the normal Vault grant mechanism.
        is_view_only: true, visibility: 'due_diligence', watermark: false, downloadable: false,
        malware_scan_status: verified.malwareScanStatus as 'not_scanned' | 'pending' | 'clean' | 'local_only' | 'flagged' | undefined,
      });
      onChange({ agreementDocumentId: docId, agreementDocumentName: file.name });
    } catch (e) {
      setUploadError((e as Error).message);
    } finally { setUploadBusy(false); }
  }

  async function watsonReview() {
    if (!value.agreementDocumentId) return;
    setWatsonBusy(true); setWatsonError(''); setWatsonNote('');
    try {
      const res = await fetch('/api/company/cap-table-investor-terms-watson-fill', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId: value.agreementDocumentId }),
      });
      const body = await res.json();
      if (!body.ok) { setWatsonError(body.error ?? 'Could not read that document — try again.'); return; }
      // §D.4 — fill ONLY empty fields, never overwrite what the founder
      // already wrote by hand.
      if (!label.trim() && body.label) onFillLabel(body.label);
      if (!pct.trim() && body.pct != null) onFillPct(String(body.pct));
      if (!value.triggerType) {
        if (body.conversionTriggerType === 'date' && body.conversionDate) {
          onChange({ triggerType: 'date', year: body.conversionDate.slice(0, 4), quarter: MONTH_TO_QUARTER[body.conversionDate.slice(5, 7)] ?? 'Q1' });
        } else if (body.conversionTriggerType === 'event' && body.conversionEvent) {
          onChange({ triggerType: 'event', event: body.conversionEvent });
        }
      }
      if (body.sourceNote) setWatsonNote(body.sourceNote);
    } catch {
      setWatsonError('Could not read that document — try again.');
    } finally { setWatsonBusy(false); }
  }

  return (
    <div className="mt-2 w-full rounded-lg border border-cyan-100 bg-cyan-50/40 p-2.5">
      <p className="text-[11px] font-medium text-gray-600">Conversion trigger</p>
      <div className="mt-1 flex gap-1.5">
        <button type="button" onClick={() => onChange({ triggerType: 'date' })}
          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${value.triggerType === 'date' ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-200 text-gray-600'}`}>
          By quarter/year
        </button>
        <button type="button" onClick={() => onChange({ triggerType: 'event' })}
          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${value.triggerType === 'event' ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-200 text-gray-600'}`}>
          By event
        </button>
      </div>

      {value.triggerType === 'date' && (
        <div className="mt-1.5 flex gap-1.5">
          <select value={value.quarter} onChange={(e) => onChange({ quarter: e.target.value as ConvertibleValue['quarter'] })}
            className="rounded border border-gray-300 px-2 py-1 text-xs">
            {QUARTERS.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
          <select value={value.year} onChange={(e) => onChange({ year: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-xs">
            {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      )}
      {value.triggerType === 'event' && (
        <input value={value.event} onChange={(e) => onChange({ event: e.target.value })}
          placeholder="e.g. next priced round, Series A close"
          className="mt-1.5 w-full rounded border border-gray-300 px-2 py-1 text-xs" />
      )}

      <p className="mt-2.5 text-[11px] font-medium text-gray-600">Agreement document</p>
      <div className="mt-1 flex gap-1.5">
        <button type="button" onClick={() => setDocMode('existing')}
          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${docMode === 'existing' ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-200 text-gray-600'}`}>
          📁 From Vault
        </button>
        <button type="button" onClick={() => setDocMode('upload')}
          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${docMode === 'upload' ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-200 text-gray-600'}`}>
          ⬆️ Upload new
        </button>
      </div>
      {docMode === 'existing' ? (
        documents.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-gray-400">No documents in your Vault yet — upload one instead.</p>
        ) : (
          <select value={value.agreementDocumentId ?? ''}
            onChange={(e) => onChange({ agreementDocumentId: e.target.value || null, agreementDocumentName: documents.find((d) => d.id === e.target.value)?.name ?? null })}
            className="mt-1.5 w-full rounded border border-gray-300 px-2 py-1 text-xs">
            <option value="">Select a document…</option>
            {documents.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )
      ) : (
        <div className="mt-1.5">
          <input type="file" disabled={uploadBusy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); }} className="text-xs" />
          {uploadBusy && <p className="mt-1 text-[11px] text-gray-400">Uploading…</p>}
          {uploadError && <p className="mt-1 text-[11px] text-[#B00000]">{uploadError}</p>}
          {value.agreementDocumentId && docMode === 'upload' && !uploadBusy && !uploadError && (
            <p className="mt-1 text-[11px] text-emerald-700">✓ {value.agreementDocumentName}</p>
          )}
        </div>
      )}
      <p className="mt-1 text-[10px] text-gray-400">
        Private — only reachable if you explicitly grant an investor access during Due Diligence.
      </p>

      <div className="mt-2.5 flex items-center gap-2">
        <button type="button" onClick={() => void watsonReview()} disabled={!value.agreementDocumentId || watsonBusy}
          className="rounded-lg border border-[#0E7490] px-2.5 py-1 text-xs font-medium text-[#0E7490] disabled:opacity-40">
          {watsonBusy ? 'Watson is reading…' : '✨ Watson Review'}
        </button>
        <button type="button" onClick={onDone} className="ml-auto rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white">
          Done
        </button>
      </div>
      {watsonError && <p className="mt-1 text-[11px] text-[#B00000]">{watsonError}</p>}
      {watsonNote && <p className="mt-1 text-[10px] text-gray-400">📄 {watsonNote}</p>}
    </div>
  );
}

export function CapTableCard() {
  const { db, addCapTableEntry, removeCapTableEntry } = useStore();
  const [category, setCategory] = useState<CapTableEntry['category']>('founder');
  const [label, setLabel] = useState('');
  const [pct, setPct] = useState('');
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [isConvertible, setIsConvertible] = useState(false);
  const [convertibleOpen, setConvertibleOpen] = useState(false);
  const [convertible, setConvertible] = useState<ConvertibleValue>(EMPTY_CONVERTIBLE);

  const entries = db.capTableEntries ?? [];
  const total = capTableTotal(entries);
  const totalOff = isCapTableTotalOff(entries);

  const convertibleTriggerReady = convertible.triggerType === 'date' ? !!convertible.year
    : convertible.triggerType === 'event' ? !!convertible.event.trim() : false;

  function toggleConvertible(checked: boolean) {
    setIsConvertible(checked);
    if (checked) { setConvertibleOpen(true); }
    else { setConvertibleOpen(false); setConvertible(EMPTY_CONVERTIBLE); }
  }

  async function add() {
    const pctNum = Number(pct);
    if (!label.trim() || !pct || Number.isNaN(pctNum) || pctNum < 0 || pctNum > 100) return;
    if (isConvertible && !convertibleTriggerReady) return;
    await addCapTableEntry({
      category, label: label.trim(), pct: pctNum, as_of: asOf,
      ...(isConvertible ? {
        is_convertible: true,
        conversion_trigger_type: convertible.triggerType,
        conversion_date: convertible.triggerType === 'date' ? quarterYearToIsoDate(convertible.quarter, convertible.year) : null,
        conversion_event: convertible.triggerType === 'event' ? convertible.event.trim() : null,
        agreement_document_id: convertible.agreementDocumentId,
      } : {}),
    });
    setLabel(''); setPct(''); setIsConvertible(false); setConvertibleOpen(false); setConvertible(EMPTY_CONVERTIBLE);
  }

  return (
    <Card title="Cap table">
      <p className="mb-2 text-xs text-gray-500">
        Your ownership structure — founders, option pool, advisers, named investors. Shown to investors as a chart
        in their Ownership calculator once you&apos;ve added rows here.
      </p>

      {entries.length > 0 ? (
        <ul className="mb-3 space-y-1">
          {entries.map((e) => {
            const conversionNote = e.is_convertible ? formatConversionTrigger(e.conversion_trigger_type ?? null, e.conversion_date ?? null, e.conversion_event ?? null) : null;
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{CATEGORY_LABEL[e.category]}</span>
                <span className="font-medium text-gray-900">{e.label}</span>
                <span className="tabular-nums text-gray-700">{fmtPct(e.pct)}</span>
                {conversionNote && <span className="text-xs text-gray-500">🔄 {conversionNote}</span>}
                <span className="text-xs text-gray-400">as of {e.as_of}</span>
                <button onClick={() => removeCapTableEntry(e.id)} className="ml-auto text-[11px] text-gray-400 hover:text-[#B00000]">remove</button>
              </li>
            );
          })}
          <li className={`border-t border-gray-100 pt-1 text-sm font-semibold ${totalOff ? 'text-amber-700' : 'text-gray-900'}`}>
            Total: {fmtPct(total)}
            {totalOff && <span className="ml-2 text-xs font-normal text-amber-600">doesn&apos;t add up to ~100% yet</span>}
          </li>
        </ul>
      ) : (
        <p className="mb-3 text-xs text-gray-400">Nothing recorded yet.</p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value as CapTableEntry['category'])}
          className="rounded border border-gray-300 px-2 py-1.5 text-sm">
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Founder A, ESOP pool, Seed investors…"
          className="w-48 rounded border border-gray-300 px-2 py-1.5 text-sm" />
        <input value={pct} onChange={(e) => setPct(e.target.value)} type="number" min="0" max="100" step="0.1" placeholder="%"
          className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm" />
        {category === 'investor' && (
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <input type="checkbox" checked={isConvertible} onChange={(e) => toggleConvertible(e.target.checked)} />
            Convertible Note (or other convertible instrument)
          </label>
        )}
        <input value={asOf} onChange={(e) => setAsOf(e.target.value)} type="date"
          className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>

      {isConvertible && (
        convertibleOpen ? (
          <ConvertibleNotePanel orgId={db.org.id} documents={db.documents} label={label} pct={pct}
            onFillLabel={setLabel} onFillPct={setPct} value={convertible}
            onChange={(patch) => setConvertible((prev) => ({ ...prev, ...patch }))}
            onDone={() => setConvertibleOpen(false)} />
        ) : (
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-600">
            <span>🔄 {formatConversionTrigger(convertible.triggerType, convertible.triggerType === 'date' ? quarterYearToIsoDate(convertible.quarter, convertible.year) : null, convertible.event || null) ?? 'Convertible — trigger not set yet'}</span>
            {convertible.agreementDocumentName && <span className="text-gray-400">· agreement attached</span>}
            <button type="button" onClick={() => setConvertibleOpen(true)} className="text-[#0E7490] hover:underline">edit</button>
          </div>
        )
      )}

      <div className="mt-2">
        <button onClick={add} disabled={!label.trim() || !pct || (isConvertible && !convertibleTriggerReady)}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:bg-gray-300">
          Add
        </button>
      </div>

      <CapTableAiFillPanel addCapTableEntry={addCapTableEntry} />
    </Card>
  );
}
