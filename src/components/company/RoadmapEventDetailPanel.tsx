'use client';
// Prompt 385 §B — the detail panel: the replacement for RoadmapCanvas's own
// former DetailPopover (both its read-only view and its inline edit form).
// Lives beside the Categories card, below the canvas (the caller's layout,
// not this component's) — fed by whichever event RoadmapCanvas reports
// selected via its own lifted `selectedId`/`onSelect` props.
import { useState } from 'react';
import { GENERAL_LABEL, type CategoryColor } from '@/lib/roadmap-categories';
import { derivedEventState, quarterLabel } from '@/lib/roadmap-canvas';
import { CATEGORY_BAR, GLASS_CARD, LABEL_CAPS, STATE_CHIP, STATE_LABEL, STATE_DOT } from './roadmap-visual';
import type { CanvasCategory, CanvasDocOption, CanvasEvent, ResolvedDocChip } from './RoadmapCanvas';
import type { RoadmapEventStatus } from '@/lib/types';

export function RoadmapEventDetailPanel({
  event, categories, editable, documents = [], resolveDocChip, now = new Date(), onUpdate, onRemove,
}: {
  event: CanvasEvent | null;
  categories: CanvasCategory[];
  editable: boolean;
  documents?: CanvasDocOption[];
  resolveDocChip?: (documentId: string) => ResolvedDocChip | null;
  now?: Date;
  onUpdate?: (id: string, patch: Partial<CanvasEvent>) => void | Promise<void>;
  onRemove?: (id: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (!event) {
    return (
      <div className={`${GLASS_CARD} flex min-h-[140px] items-center p-6`}>
        <p className="text-sm text-[#434656]">Select an event on the timeline to see its details.</p>
      </div>
    );
  }

  // Reset the edit form whenever the selection itself changes (never keep a
  // stale draft from a previously-selected event lying around).
  return (
    <PanelBody key={event.id} event={event} categories={categories} editable={editable} documents={documents}
      resolveDocChip={resolveDocChip} now={now} onUpdate={onUpdate} onRemove={onRemove}
      editing={editing} setEditing={setEditing} />
  );
}

function PanelBody({ event, categories, editable, documents, resolveDocChip, now, onUpdate, onRemove, editing, setEditing }: {
  event: CanvasEvent; categories: CanvasCategory[]; editable: boolean; documents: CanvasDocOption[];
  resolveDocChip?: (documentId: string) => ResolvedDocChip | null; now: Date;
  onUpdate?: (id: string, patch: Partial<CanvasEvent>) => void | Promise<void>;
  onRemove?: (id: string) => void | Promise<void>;
  editing: boolean; setEditing: (v: boolean) => void;
}) {
  const category = event.category_id ? categories.find((c) => c.id === event.category_id) : null;
  const categoryLabel = category?.label ?? GENERAL_LABEL;
  const categoryColor = (category?.color as CategoryColor) ?? 'gray';
  const state = derivedEventState(event.status, event.date, event.end_date, now);
  const docChip = event.document_id
    ? (resolveDocChip ? resolveDocChip(event.document_id) : { name: documents.find((d) => d.id === event.document_id)?.name ?? 'a document', visible: true })
    : null;

  if (editing) {
    return (
      <div className={`${GLASS_CARD} p-6`}>
        <EditForm event={event} categories={categories} documents={documents}
          onCancel={() => setEditing(false)}
          onSave={async (patch) => { await onUpdate?.(event.id, patch); setEditing(false); }}
          onRemove={onRemove ? async () => { await onRemove(event.id); setEditing(false); } : undefined} />
      </div>
    );
  }

  return (
    <div className={`${GLASS_CARD} flex flex-col justify-center gap-3 p-6 sm:flex-row sm:items-start sm:justify-between`}>
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`${LABEL_CAPS} rounded px-2 py-1 ${CATEGORY_BAR[categoryColor]?.text ?? 'text-gray-600'} bg-current/10`}>
            {categoryLabel}
          </span>
          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATE_CHIP[state]}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOT[state]}`} />
            {STATE_LABEL[state]}
          </span>
          <span className="border-l border-[#c3c5d9]/60 pl-2 text-[11px] text-[#434656]">{quarterLabel(event.date)}</span>
        </div>
        <h2 className="text-[22px] font-semibold leading-tight text-[#131b2e]">{event.title}</h2>
        {event.description && <p className="mt-2 max-w-2xl text-sm text-[#434656]">{event.description}</p>}
        {docChip?.visible && (
          <span className="mt-3 inline-block rounded-full bg-[#006c46]/10 px-2.5 py-1 text-xs font-medium text-[#006c46]">
            Backed by: {docChip.name}
          </span>
        )}
      </div>
      {editable && (
        <div className="flex shrink-0 gap-2">
          <button onClick={() => setEditing(true)}
            className="rounded-lg border border-[#c3c5d9] bg-white/70 px-4 py-2 text-sm font-medium text-[#131b2e] hover:bg-white">
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

function EditForm({ event, categories, documents, onCancel, onSave, onRemove }: {
  event: CanvasEvent; categories: CanvasCategory[]; documents: CanvasDocOption[];
  onCancel: () => void;
  onSave: (patch: Partial<CanvasEvent>) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description ?? '');
  const [date, setDate] = useState(event.date);
  const [endDate, setEndDate] = useState(event.end_date ?? '');
  const [status, setStatus] = useState<RoadmapEventStatus>(event.status);
  const [categoryId, setCategoryId] = useState(event.category_id ?? '');
  const [documentId, setDocumentId] = useState(event.document_id ?? '');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await onSave({
        title: title.trim(), description: description.trim() || null, date, end_date: endDate || null,
        status, category_id: categoryId || null, document_id: documentId || null,
      });
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-2.5">
      <input autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)}
        className="w-full rounded-lg border border-[#c3c5d9] px-2.5 py-1.5 text-base font-medium text-[#131b2e]" />
      <textarea autoComplete="off" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Description (optional)"
        className="w-full rounded-lg border border-[#c3c5d9] px-2.5 py-1.5 text-sm" />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">Date
          <input autoComplete="off" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-[#c3c5d9] px-1.5 py-1" />
        </label>
        <label className="flex items-center gap-1">End (optional)
          <input autoComplete="off" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border border-[#c3c5d9] px-1.5 py-1" />
        </label>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="rounded-lg border border-[#c3c5d9] px-1.5 py-1">
          <option value="">{GENERAL_LABEL}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as RoadmapEventStatus)} className="rounded-lg border border-[#c3c5d9] px-1.5 py-1">
          <option value="planned">Planned</option>
          <option value="done">Done</option>
        </select>
        {documents.length > 0 && (
          <select value={documentId} onChange={(e) => setDocumentId(e.target.value)} className="rounded-lg border border-[#c3c5d9] px-1.5 py-1">
            <option value="">No evidence attached</option>
            {documents.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[#c3c5d9]/30 pt-2.5">
        {onRemove ? (
          <button onClick={() => void onRemove()} className="text-xs text-[#434656]/60 hover:text-[#ba1a1a]">Delete</button>
        ) : <span />}
        <div className="flex gap-2">
          <button onClick={onCancel} className="rounded-lg border border-[#c3c5d9] px-3 py-1.5 text-xs">Cancel</button>
          <button disabled={!title.trim() || saving} onClick={submit}
            className="rounded-lg bg-[#0041c8] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
