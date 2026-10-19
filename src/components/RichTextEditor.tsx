'use client';
// Prompt 918 (Adenda 1, D) — the editor of the call's description: bold, italic, two heading sizes, bulleted and numbered lists, links, and text colour from a short palette. A small
// editable area with a toolbar — no library. What it hands back is ALWAYS the output of sanitizeRichText (so the closed list of tags, nothing else), whatever was typed, pasted or dropped;
// the server sanitises it again when it is saved, and every place that shows it does too. Pasted text keeps only the formatting the editor has.
import { useEffect, useRef, useState } from 'react';
import { RICH_PALETTE, looksLikeHtml, renderDescription, safeHref, sanitizeRichText } from '@/lib/rich-text';

const BTN = 'min-h-[32px] min-w-[32px] rounded-md border border-transparent px-2 text-sm text-gray-700 hover:border-gray-300 hover:bg-white disabled:opacity-40';

/** Is there anything to keep? (An editable area left "empty" still holds <br> or an empty paragraph.) */
const isEmpty = (html: string): boolean => html.replace(/<(?:br|\/?p)>/g, '').trim() === '';

export function RichTextEditor({ id, labelledBy, value, onChange, disabled = false, placeholder, jump }: {
  id: string; labelledBy: string; value: string; onChange: (html: string) => void; disabled?: boolean; placeholder?: string; jump?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);        // what this editor itself last handed back: if `value` is that, nothing outside has changed it
  const [colours, setColours] = useState(false);
  const [problem, setProblem] = useState('');

  // The content comes in from OUTSIDE (the call loaded, a proposal was applied): put it in. Never while the person is typing — then `value` is what we just sent.
  useEffect(() => {
    const el = ref.current;
    if (!el || value === last.current) return;
    el.innerHTML = renderDescription(value);
    last.current = value;
  }, [value]);

  function emit() {
    const el = ref.current; if (!el) return;
    const html = sanitizeRichText(el.innerHTML);
    const next = isEmpty(html) ? '' : html;
    last.current = next;
    onChange(next);
  }
  function run(command: string, arg?: string) {
    if (disabled) return;
    ref.current?.focus();
    document.execCommand('styleWithCSS', false, command === 'foreColor' ? 'true' : 'false');
    document.execCommand(command, false, arg);
    emit();
  }
  function link() {
    const typed = window.prompt('Link address (it must start with https://)');
    if (typed === null) return;
    const href = safeHref(typed.trim());
    if (!href) { setProblem('That is not a link we can use: it must start with https:// (or mailto:).'); return; }
    setProblem('');
    run('createLink', href);
  }
  function paste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const plain = e.clipboardData.getData('text/plain');
    const safe = html ? sanitizeRichText(html) : '';
    // Text from a page or a document keeps the formatting the editor knows; anything else goes in as plain text.
    if (safe && looksLikeHtml(safe)) document.execCommand('insertHTML', false, safe);
    else document.execCommand('insertText', false, plain);
    emit();
  }

  return (
    <div className="rounded-lg border border-gray-300 bg-white focus-within:ring-1 focus-within:ring-[#0E7490]" data-testid="rich-editor">
      <div role="toolbar" aria-label="Text formatting" className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-1.5 py-1">
        {([
          ['bold', 'B', 'Bold', () => run('bold'), 'font-bold'],
          ['italic', 'I', 'Italic', () => run('italic'), 'italic'],
          ['h2', 'Title', 'Large heading', () => run('formatBlock', 'h2'), 'font-semibold'],
          ['h3', 'Subtitle', 'Medium heading', () => run('formatBlock', 'h3'), 'font-medium'],
          ['p', 'Text', 'Normal text', () => run('formatBlock', 'p'), ''],
          ['ul', '• List', 'Bulleted list', () => run('insertUnorderedList'), ''],
          ['ol', '1. List', 'Numbered list', () => run('insertOrderedList'), ''],
          ['link', 'Link', 'Add a link', link, 'underline'],
        ] as const).map(([key, label, title, action, cls]) => (
          <button key={key} type="button" className={`${BTN} ${cls}`} title={title} aria-label={title} data-testid={`rt-${key}`} disabled={disabled}
            onMouseDown={(e) => e.preventDefault()} onClick={action}>{label}</button>
        ))}
        <span className="relative">
          <button type="button" className={BTN} title="Text colour" aria-label="Text colour" aria-expanded={colours} aria-haspopup="true" data-testid="rt-colour" disabled={disabled}
            onMouseDown={(e) => e.preventDefault()} onClick={() => setColours((o) => !o)}>A<span aria-hidden="true" className="ml-0.5 text-[#0E7490]">▾</span></button>
          {colours && (
            <span role="menu" className="absolute left-0 top-full z-20 mt-1 flex gap-1 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg" data-testid="rt-palette">
              {RICH_PALETTE.map((c) => (
                <button key={c.key} type="button" role="menuitem" title={c.label} aria-label={c.label} data-testid={`rt-colour-${c.key}`}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => { setColours(false); run('foreColor', c.hex); }}
                  className="h-8 w-8 rounded-full border border-gray-300" style={{ backgroundColor: c.hex }} />
              ))}
            </span>
          )}
        </span>
        <button type="button" className={BTN} title="Clear formatting" aria-label="Clear formatting" data-testid="rt-clear" disabled={disabled}
          onMouseDown={(e) => e.preventDefault()} onClick={() => run('removeFormat')}>Clear</button>
      </div>
      <div ref={ref} id={id} role="textbox" aria-multiline="true" aria-labelledby={labelledBy} contentEditable={!disabled} suppressContentEditableWarning spellCheck data-jump={jump}
        data-placeholder={placeholder} data-testid="rich-area" tabIndex={disabled ? -1 : 0}
        onInput={emit} onBlur={() => { emit(); if (ref.current && last.current !== null) ref.current.innerHTML = renderDescription(last.current); }} onPaste={paste} onDrop={(e) => e.preventDefault()}
        className="rich-text rich-edit min-h-[7rem] px-3 py-2 text-sm text-gray-900 outline-none aria-disabled:bg-gray-50" aria-disabled={disabled} />
      {problem && <p role="alert" className="border-t border-gray-100 px-3 py-1.5 text-xs text-[#B00000]" data-testid="rt-problem">{problem}</p>}
    </div>
  );
}
