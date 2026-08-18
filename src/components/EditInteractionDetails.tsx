'use client';
// Prompt 252 — fixing a wrong occurred_at/channel/content on an already-
// logged interaction, with an audit trail. The APEX Ventures case: the row
// showed occurred_at 2018-01-01 while its own content said "27 de novembro
// de 2025" — there was no way to correct it; the existing "Edit" (231,
// InlineClassify) only reopens classification. Deliberately a SEPARATE
// small pencil affordance next to the date, not a second "Edit" label on
// the same row — the two edit different things and shouldn't be confused.
import { useState } from 'react';
import { useStore } from '@/lib/store';
import type { Channel, Interaction, InteractionEdit } from '@/lib/types';

const CHANNELS: { v: Channel; l: string }[] = [
  { v: 'linkedin_dm', l: 'LinkedIn DM' }, { v: 'linkedin_note', l: 'LinkedIn note' },
  { v: 'email', l: 'Email' }, { v: 'web_form', l: 'Web form' }, { v: 'call', l: 'Call' },
  { v: 'meeting', l: 'Meeting' }, { v: 'event', l: 'Event' }, { v: 'intro', l: 'Intro' },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Small "edited {date}" hint, shown next to a row that has an audit trail —
// this IS the "ver quem editou e quando" requirement, inline where the
// founder is already looking, not buried in a separate log page.
export function InteractionEditHint({ edits }: { edits: InteractionEdit[] }) {
  if (edits.length === 0) return null;
  const last = [...edits].sort((a, b) => b.edited_at.localeCompare(a.edited_at))[0];
  const who = last.edited_by === 'demo' ? 'demo' : 'you';
  return (
    <span className="whitespace-nowrap text-[10px] text-gray-400" title={edits.map((e) => `${e.field}: "${e.old_value ?? ''}" → "${e.new_value ?? ''}" (${e.edited_by ?? '?'}, ${e.edited_at.slice(0, 16).replace('T', ' ')})`).join('\n')}>
      edited by {who} {last.edited_at.slice(0, 10)}
    </span>
  );
}

export function EditInteractionDetails({ interaction, onDone }: { interaction: Interaction; onDone: () => void }) {
  const { editInteraction } = useStore();
  // Only the date portion is editable — the original time-of-day carries
  // over untouched, since nothing here asked to fix clock time, only date.
  const [date, setDate] = useState(interaction.occurred_at.slice(0, 10));
  const [channel, setChannel] = useState<Channel>(interaction.channel);
  const [content, setContent] = useState(interaction.content);

  function save() {
    // Belt-and-suspenders against the date input's `max` (a client-side
    // hint, not a hard boundary) — a future date would let this outbound
    // silently dodge today's/this-week's caps (outboundCounts() windows on
    // occurred_at) without ever counting toward any real day.
    const clampedDate = date > todayIso() ? todayIso() : date;
    const time = interaction.occurred_at.slice(10); // "THH:MM:SS.sssZ", carried over as-is
    editInteraction(interaction.id, {
      occurred_at: `${clampedDate}${time}`,
      channel,
      content: content.trim(),
    });
    onDone();
  }

  return (
    <div className="mt-1.5 space-y-1.5 rounded border border-gray-200 bg-white p-2">
      <div className="flex flex-wrap gap-1.5">
        <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)}
          className="rounded border border-gray-300 px-1.5 py-1 text-xs" />
        <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}
          className="rounded border border-gray-300 px-1.5 py-1 text-xs">
          {CHANNELS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
        </select>
      </div>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={2}
        className="w-full rounded border border-gray-300 p-1.5 text-xs text-gray-900" />
      <div className="flex gap-1.5">
        <button disabled={!date || content.trim().length === 0} onClick={save}
          className="rounded-full bg-[#0E7490] px-2.5 py-1 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-300">
          Save
        </button>
        <button onClick={onDone} className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] text-gray-600">
          Cancel
        </button>
      </div>
    </div>
  );
}
