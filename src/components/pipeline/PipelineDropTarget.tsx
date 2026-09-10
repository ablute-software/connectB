'use client';
// Prompt 647 §1.3 — the header button as a vault door.
//
// The face is the same button the header always had (toggle the view, same
// classes, same title). What is new sits behind it: a dark interior with the
// current count and "Drop to freeze" / "Drop to pass". While a row is
// dragged over it the face swings open on its left hinge (perspective 600px,
// rotateY(-70deg), 220ms ease-out) and closes when the row leaves (160ms).
// While any drag is in progress the face pulses once so the founder can see
// where a row may be dropped. After a confirmed drop the count pulses with a
// "+1".
//
// prefers-reduced-motion (§1.7): no rotation. The open door becomes a colour
// and outline change on the face itself, with the interior's text swapped
// in, so the flow reads the same without a single transform.
import { DROP_TARGET_INTERIOR, type DropTarget } from '@/lib/pipeline-drop';

export function PipelineDropTarget({ target, label, title, count, active, onClick, armed, open, pulse, reducedMotion, className }: {
  target: DropTarget;
  label: string;
  title: string;
  count: number;
  /** The view is currently showing (same styling the plain button had). */
  active: boolean;
  onClick: () => void;
  /** A drag is in progress somewhere: the face pulses once. */
  armed: boolean;
  /** The dragged row is over this button: the door is open. */
  open: boolean;
  /** A drop just landed here: the count pulses "+1". */
  pulse: boolean;
  reducedMotion: boolean;
  className?: string;
}) {
  const faceTone = active || (open && reducedMotion)
    ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]'
    : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50';
  return (
    <div data-drop-target={target} className={`relative ${className ?? ''}`} style={{ perspective: '600px' }}>
      {!reducedMotion && (
        <div aria-hidden
          className={`pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 text-white transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
          style={{ transitionDuration: open ? '220ms' : '160ms' }}>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-300">{DROP_TARGET_INTERIOR[target]}</span>
          <span className="text-sm font-bold">{count}</span>
        </div>
      )}
      <button type="button" onClick={onClick} title={title}
        className={`relative w-full rounded-lg border px-2.5 py-1.5 text-sm font-medium ${faceTone} ${armed && !open ? 'pipeline-drop-armed' : ''} ${open && reducedMotion ? 'ring-2 ring-[#0E7490]/40' : ''} ${pulse ? 'pipeline-count-pulse' : ''}`}
        style={reducedMotion ? undefined : {
          transformOrigin: 'left center',
          transform: open ? 'rotateY(-70deg)' : 'rotateY(0deg)',
          transition: `transform ${open ? 220 : 160}ms ease-out`,
          backfaceVisibility: 'hidden',
        }}>
        {open && reducedMotion ? `${DROP_TARGET_INTERIOR[target]} (${count})` : label}
      </button>
      {pulse && (
        <span aria-hidden className="pipeline-plus-one pointer-events-none absolute -right-1 -top-2 text-[11px] font-bold text-[#0E7490]">+1</span>
      )}
    </div>
  );
}
