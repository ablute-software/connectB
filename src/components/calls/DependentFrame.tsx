'use client';
// Prompt 927 (C) — a follow-up question is drawn INDENTED, with a connector that links it to the question it depends on and a short "Shown if «Yes»" line. One component for the editor, the preview, the
// entity's test and the applicant's form, so the four can never drift. It only draws: the questions, their order and their conditions are never touched by it (so it also applies where a call is
// already open and the form cannot change). On a phone the indent is smaller; the connector stays. A follow-up of a follow-up nests, so the indent adds up.
import { dependencyDepth, shownIfLabel } from '@/lib/calls/form-builder';
import type { FormField } from '@/lib/calls/types';

/** `gap` is the space the surrounding list leaves between two questions: the connector starts there, so it reaches up to the question above. */
export function DependentFrame({ field, all, gap = 'md', tag = true, children }: { field: FormField; all: FormField[]; gap?: 'sm' | 'md'; tag?: boolean; children: React.ReactNode }) {
  const depth = dependencyDepth(all, field.id);
  if (depth === 0) return <>{children}</>;
  const note = tag ? shownIfLabel(field, all) : null;
  const elbow = gap === 'sm' ? 'before:-top-2' : 'before:-top-5';
  let node = (
    <div className={`relative ml-1.5 min-w-0 pl-3.5 sm:ml-3 sm:pl-5 before:absolute before:bottom-1/2 before:left-0 before:w-2.5 before:rounded-bl-lg before:border-b-2 before:border-l-2 before:border-amber-300 sm:before:w-4 ${elbow}`} data-testid="dependent" data-depth={depth}>
      {note && <p className="mb-1 text-[11px] font-medium text-amber-700" data-testid="shown-if">{note}</p>}
      {children}
    </div>
  );
  // a follow-up of a follow-up: one more level of indent per step up the chain (the outer levels draw no connector of their own)
  for (let d = 1; d < depth; d++) node = <div className="ml-1.5 min-w-0 sm:ml-3" data-testid="dependent-level">{node}</div>;
  return node;
}
