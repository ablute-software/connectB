'use client';
// Prompt 917 (Adenda 2, A) — a text field that wraps a long text onto more lines instead of scrolling it sideways. An <input> can only scroll a long value (its scrollWidth then exceeds its
// width, which the form editor's panel must never do); this is a textarea that starts at one line, grows with its content and never shows a scroll bar. It behaves like an input for the person
// typing (Enter does not add a line break), and its first height comes from the length of the text so that the server render and the first paint already have the right size.
import { useLayoutEffect, useRef } from 'react';

export function AutoTextarea({ value, onChange, className = '', disabled, maxLength, placeholder, ariaLabel, id, testId }: {
  value: string; onChange: (v: string) => void; className?: string; disabled?: boolean; maxLength?: number; placeholder?: string; ariaLabel?: string; id?: string; testId?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea ref={ref} id={id} aria-label={ariaLabel} data-testid={testId} rows={Math.max(1, Math.ceil(value.length / 36))} autoComplete="off" value={value} disabled={disabled} maxLength={maxLength} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, ' '))}
      onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
      className={`resize-none overflow-hidden [overflow-wrap:anywhere] ${className}`} />
  );
}
