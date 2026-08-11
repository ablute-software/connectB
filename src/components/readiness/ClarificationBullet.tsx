'use client';
// Prompt 168 §B — per-bullet clarification toggle. Sits to the right of any
// Review bullet (any of the 6 categories, any run — ReviewPanel's latest
// risks/recommendations, SwotVisualCard, History's per-run list, and the
// standalone report page all render this same component). Writes go
// directly through the browser client — review_clarifications' RLS mirrors
// company_facts (any org member, full CRUD; see migration 0160's own
// comment) — no custom API route.
import { useState } from 'react';
import { browserClient } from '@/lib/supabase';
import type { ReviewCategory, ReviewClarification } from '@/lib/review-clarifications';

export function ClarificationBullet({ orgId, reviewRunId, category, itemIndex, itemText, existing, onSaved, hideOnPrint }: {
  orgId: string;
  reviewRunId: string;
  category: ReviewCategory;
  itemIndex: number;
  itemText: string;
  existing: ReviewClarification | null;
  onSaved: (c: ReviewClarification) => void;
  /** The standalone /readiness/report/[id] page is printable — this keeps
   *  the toggle/editor out of the printed output without an invalid
   *  `<span><div>...` wrapper (a span can't legally contain block content,
   *  and print:hidden on the wrong element silently does nothing). */
  hideOnPrint?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(existing?.clarification_text ?? '');
  const [visible, setVisible] = useState(existing?.visible_to_investors ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function toggle() {
    if (!open) { setDraft(existing?.clarification_text ?? ''); setVisible(existing?.visible_to_investors ?? true); setErr(''); }
    setOpen((o) => !o);
  }

  async function save() {
    if (!draft.trim()) return;
    setSaving(true); setErr('');
    try {
      const sb = browserClient();
      const { data, error } = existing
        ? await sb.from('review_clarifications')
          .update({ clarification_text: draft.trim(), visible_to_investors: visible, updated_at: new Date().toISOString() })
          .eq('id', existing.id).select().single()
        : await sb.from('review_clarifications')
          .insert({
            org_id: orgId, review_run_id: reviewRunId, category, item_index: itemIndex,
            item_text: itemText, clarification_text: draft.trim(), visible_to_investors: visible,
          }).select().single();
      if (error) { setErr(error.message); return; }
      onSaved(data as ReviewClarification);
      setOpen(false);
    } finally { setSaving(false); }
  }

  return (
    <>
      <button type="button" onClick={toggle}
        title={existing ? 'View / edit clarification' : 'Add a clarification'}
        aria-label={existing ? 'View or edit clarification' : 'Add a clarification'}
        className={`ml-1.5 align-middle text-xs ${hideOnPrint ? 'print:hidden' : ''} ${existing ? 'text-[#0E7490]' : 'text-gray-300 hover:text-gray-400'}`}>
        {existing ? '💬' : '🗨️'}
      </button>
      {open && (
        <div className={`mt-1 w-full rounded-lg border border-gray-200 bg-white p-2 ${hideOnPrint ? 'print:hidden' : ''}`}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
            placeholder="Add a clarification…" className="w-full rounded border border-gray-300 p-1.5 text-xs" />
          <div className="mt-1 flex items-center justify-between gap-2">
            <label className="flex items-center gap-1 text-[11px] text-gray-500">
              <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
              Visible to investors
            </label>
            <button disabled={!draft.trim() || saving} onClick={save}
              className="rounded bg-[#0E7490] px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {err && <p className="mt-1 text-[11px] text-[#B00000]">{err}</p>}
        </div>
      )}
    </>
  );
}
