'use client';
// Prompt 923 (pending item) — a Table question as the entity's editor SHOWS it, in the editor panel and in Review & publish: this one component in both, so the two can never disagree.
//
//   By default the table as the applicant sees it on a computer, reduced to fit the width it is given (never below FLOOR: under that the text stops being readable, so the box scrolls sideways
//   inside itself instead and "Open full preview" shows it at full size). A "Desktop / Phone" selector switches to the phone layout (cards) inside a phone-wide frame. "Open full preview" is the
//   twin of the applicant's "Expand table": a full-screen copy, with the same selector, "Done" or Escape to go back. It is a preview: what is typed goes to the same onChange, saves nothing.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AnswerValue, FormField } from '@/lib/calls/types';
import { TableInput } from './TableInput';

export type PreviewMode = 'desktop' | 'phone';
/** Below this scale the text is too small to read: the box scrolls instead of shrinking further. */
export const FIT_FLOOR = 0.5;
/** The width a phone shows (the cards must look as they do on one). */
export const PHONE_WIDTH = 375;

const BTN = 'rounded-lg border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50';

/** Measured before the first paint, so the table is never drawn at full width for a frame; on the server (no layout) it is the plain effect. */
const useMeasure = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** The scale that makes `natural` fit `available`, never above 1 and never below the floor. */
export const fitScale = (available: number, natural: number): number => (natural <= 0 || available <= 0 ? 1 : Math.max(FIT_FLOOR, Math.min(1, available / natural)));

function ModeSelector({ mode, onMode }: { mode: PreviewMode; onMode: (m: PreviewMode) => void }) {
  const item = (m: PreviewMode, text: string) => (
    <button key={m} type="button" aria-pressed={mode === m} data-testid={`preview-mode-${m}`} onClick={() => onMode(m)}
      className={`px-2.5 py-0.5 text-xs font-medium ${mode === m ? 'bg-[#0E7490] text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{text}</button>
  );
  return <div role="group" aria-label="Preview as" className="inline-flex overflow-hidden rounded-lg border border-gray-300" data-testid="preview-mode">{item('desktop', 'Desktop')}{item('phone', 'Phone')}</div>;
}

/** Draws its children at their natural width and scales them down to the width it has. */
function FitWidth({ children }: { children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; width: number | null; height: number | null }>({ scale: 1, width: null, height: null });
  useMeasure(() => {
    const o = outer.current; const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const scale = fitScale(o.clientWidth, i.offsetWidth);
      const width = Math.ceil(i.offsetWidth * scale); const height = Math.ceil(i.offsetHeight * scale);
      setFit((prev) => (prev.scale === scale && prev.width === width && prev.height === height ? prev : { scale, width, height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(o); ro.observe(i);
    return () => ro.disconnect();
  }, []);
  // A transform shrinks what is drawn, not the box it occupies (a scrollbar would still be measured on the full-size box): so the reduced copy sits in a box of exactly its reduced size.
  return (
    <div ref={outer} className="max-w-full overflow-x-auto overflow-y-hidden" data-testid="fit-outer" data-scale={fit.scale.toFixed(2)}>
      <div className="overflow-hidden" style={fit.width === null ? undefined : { width: fit.width, height: fit.height ?? undefined }}>
        <div ref={inner} style={{ width: 'max-content', minWidth: 480, transform: `scale(${fit.scale})`, transformOrigin: '0 0' }} data-testid="fit-inner">{children}</div>
      </div>
    </div>
  );
}

function Body({ field, value, currency, mode, full, onChange }: { field: FormField; value: AnswerValue; currency: string; mode: PreviewMode; full: boolean; onChange: (v: AnswerValue) => void }) {
  if (mode === 'phone') {
    return (
      <div className="mx-auto rounded-2xl border-2 border-gray-300 bg-gray-50 p-3" style={{ width: '100%', maxWidth: PHONE_WIDTH }} data-testid="preview-phone-frame">
        <TableInput field={field} value={value} currency={currency} variant="cards" onChange={onChange} />
      </div>
    );
  }
  const table = <TableInput field={field} value={value} currency={currency} variant="table" hideExpand onChange={onChange} />;
  return full ? <div data-testid="preview-desktop-full">{table}</div> : <FitWidth>{table}</FitWidth>;
}

export function TablePreview({ field, value, currency, onChange }: { field: FormField; value: AnswerValue; currency: string; onChange: (v: AnswerValue) => void }) {
  const [mode, setMode] = useState<PreviewMode>('desktop');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="min-w-0" data-testid="table-preview-box" data-mode={mode}>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <ModeSelector mode={mode} onMode={setMode} />
        <button type="button" className={BTN} onClick={() => setOpen(true)} data-testid="open-full-preview">Open full preview</button>
      </div>
      <Body field={field} value={value} currency={currency} mode={mode} full={false} onChange={onChange} />
      {open && typeof document !== 'undefined' && createPortal(
        <div role="dialog" aria-modal="true" aria-label={`Preview: ${field.label}`} className="fixed inset-0 z-50 flex flex-col bg-white" data-testid="full-preview" data-calls-touch>
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-2">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{field.label}</p>
            <ModeSelector mode={mode} onMode={setMode} />
            <button type="button" onClick={() => setOpen(false)} data-testid="full-preview-done" className="min-h-[44px] shrink-0 rounded-lg bg-[#0E7490] px-5 py-2 text-sm font-semibold text-white hover:bg-[#0c637b]">Done</button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3" data-testid="full-preview-scroll"><Body field={field} value={value} currency={currency} mode={mode} full onChange={onChange} /></div>
        </div>,
        document.body,
      )}
    </div>
  );
}
