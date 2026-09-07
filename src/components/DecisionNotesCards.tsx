'use client';
// Prompt 852 §D — the two notes, side by side, below the Sherlock banner.
//
// Before this they lived in two unrelated places: the pass reason only
// inside an `interactions` row (visible in the History rail, nowhere else),
// and the reopen note in its own small white card under the banner ("Your
// note when freezing"). A founder looking at a closed relationship could see
// why it closed OR what would restart it, never both at once — and the pass
// flow never asked for the second one, so `reopen_trigger` (the field the
// reawakening engine requires) was usually empty on exactly the entities
// that needed it.
//
// LAYOUT, the numbers settled here so both cards are identical and neither
// can grow: title (10px uppercase) + exactly TWO lines of 13px/18px text +
// the date (10px). The text block, and only the text block, carries
// `max-h-[36px] overflow-y-auto` — 2 x 18px — so a longer note scrolls
// INSIDE the card rather than making the card taller. Never put the overflow
// on the card: the card's height is the thing being held constant.
// Side by side from `sm` up, stacked below it.
//
// §B — the founder's own "Not a fit for us" decision renders here too, in
// the same card family, so the dossier says it once and in one voice rather
// than in a second, differently-worded copy.
import { categoryLabel } from './NotAFitAction';

const CARD = 'flex-1 min-w-0 rounded-xl border p-3';
const TITLE = 'text-[10px] font-semibold uppercase tracking-wide';
// Two lines, exactly: 2 × 18px. The one number that makes the cards equal.
const TEXT = 'mt-1 max-h-[36px] overflow-y-auto whitespace-pre-wrap text-[13px] leading-[18px]';
const DATE = 'mt-1 text-[10px]';

function isoDate(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

export interface DecisionNote {
  /** 'pass' = they passed; 'restart' = what would justify re-approaching;
   *  'not_a_fit' = the founder's own decision (§A). */
  kind: 'pass' | 'restart' | 'not_a_fit';
  category?: string | null;
  text: string;
  recordedAt?: string | null;
  /** Free text after the date — e.g. who recorded it. Never invented: shown
   *  only when the caller actually knows. */
  source?: string | null;
  onEdit?: () => void;
}

const TONE: Record<DecisionNote['kind'], { card: string; title: string; text: string; date: string; label: string }> = {
  pass: {
    card: 'border-red-200 bg-red-50/50', title: 'text-red-800', text: 'text-gray-800', date: 'text-gray-500',
    label: 'Pass reason',
  },
  restart: {
    card: 'border-[#0E7490]/25 bg-[#E8F4F8]', title: 'text-[#0E7490]', text: 'text-gray-800', date: 'text-gray-500',
    label: "What's needed to restart",
  },
  not_a_fit: {
    card: 'border-gray-200 bg-gray-50', title: 'text-gray-700', text: 'text-gray-800', date: 'text-gray-500',
    label: 'Not a fit for us',
  },
};

export function DecisionNoteCard({ note }: { note: DecisionNote }) {
  const tone = TONE[note.kind];
  const date = isoDate(note.recordedAt);
  return (
    <div className={`${CARD} ${tone.card}`}>
      <div className="flex items-start gap-1.5">
        <span className={`${TITLE} ${tone.title}`}>
          {tone.label}{note.category ? `: ${categoryLabel(note.category)}` : ''}
        </span>
        {note.onEdit && (
          <button onClick={note.onEdit} title="Edit this note"
            className="ml-auto shrink-0 text-[11px] text-gray-300 hover:text-gray-700">✎</button>
        )}
      </div>
      <p className={`${TEXT} ${tone.text}`}>{note.text}</p>
      {(date || note.source) && (
        <p className={`${DATE} ${tone.date}`}>
          {date ? `Recorded ${date}` : 'Recorded'}{note.source ? `, ${note.source}` : ''}
        </p>
      )}
    </div>
  );
}

export function DecisionNotesCards({ notes }: { notes: DecisionNote[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="-mt-1 flex flex-col gap-2 sm:flex-row">
      {notes.map((n) => <DecisionNoteCard key={n.kind} note={n} />)}
    </div>
  );
}
