'use client';
// Prompt 918 (Adenda 1, D) — the editor of the call's description: bold, italic, two heading sizes, bulleted and numbered lists, links, and text colour from a short palette. A small
// editable area with a toolbar — no library. What it hands back is ALWAYS the output of sanitizeRichText (so the closed list of tags, nothing else), whatever was typed, pasted or dropped;
// the server sanitises it again when it is saved, and every place that shows it does too. Pasted text keeps only the formatting the editor has.
import { useEffect, useRef, useState } from 'react';
import { RICH_PALETTE, looksLikeHtml, renderDescription, safeHref, sanitizeRichText } from '@/lib/rich-text';
import { codesToTags, plainWithCodes, tagHtml, tagsToCodes, type MergeField } from '@/lib/merge-tags';

const BTN = 'min-h-[32px] min-w-[32px] rounded-md border border-transparent px-2 text-sm text-gray-700 hover:border-gray-300 hover:bg-white disabled:opacity-40';

/** Is there anything to keep? (An editable area left "empty" still holds <br> or an empty paragraph.) */
const isEmpty = (html: string): boolean => html.replace(/<(?:br|\/?p)>/g, '').trim() === '';

/**
 * With `mergeFields` (Prompt 924) the fields a message fills in are shown as TAGS — "Applicant name", never `{applicant_name}` — each one a single block (not edited inside, gone with one Backspace, kept by copy and paste),
 * inserted from the list under the editor or from the menu that opens when `{` is typed. What is handed back (and stored) is still the code, `{applicant_name}`: the cleaning, the sending and the preview are untouched.
 * A code that is not one of the fields is shown as a red "Unknown field" tag and stays in the text as it was written.
 */
export function RichTextEditor({ id, labelledBy, value, onChange, disabled = false, placeholder, jump, mergeFields }: {
  id: string; labelledBy: string; value: string; onChange: (html: string) => void; disabled?: boolean; placeholder?: string; jump?: string; mergeFields?: MergeField[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string | null>(null);        // what this editor itself last handed back: if `value` is that, nothing outside has changed it
  const [colours, setColours] = useState(false);
  const [problem, setProblem] = useState('');
  const [menu, setMenu] = useState<{ active: number } | null>(null);
  /** What goes into the editable area for a stored value: its html, with the codes as tags when the editor has fields. */
  const toDom = (v: string): string => (mergeFields ? codesToTags(renderDescription(v), mergeFields) : renderDescription(v));

  // The content comes in from OUTSIDE (the call loaded, a proposal was applied): put it in. Never while the person is typing — then `value` is what we just sent.
  useEffect(() => {
    const el = ref.current;
    if (!el || value === last.current) return;
    el.innerHTML = toDom(value);
    last.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function emit() {
    const el = ref.current; if (!el) return;
    const html = sanitizeRichText(mergeFields ? tagsToCodes(el.innerHTML) : el.innerHTML);
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
    // A tag copied from this editor comes back as the code first, is cleaned like anything pasted, and goes in as a tag again.
    const safe = html ? sanitizeRichText(mergeFields ? tagsToCodes(html) : html) : '';
    // Text from a page or a document keeps the formatting the editor knows; anything else goes in as plain text.
    if (safe && looksLikeHtml(safe)) {
      const withTags = mergeFields ? codesToTags(safe, mergeFields) : safe;
      // A copy that is only inline (text and tags) goes in as it is; blocks (paragraphs) are left to the browser, which knows how to merge them.
      if (mergeFields && !/<(?:p|h[1-6]|ul|ol|li|blockquote|div)[\s>]/i.test(safe)) insertInline(withTags);
      else document.execCommand('insertHTML', false, withTags);
    }
    else if (mergeFields && /\{[A-Za-z_]/.test(plain)) insertInline(codesToTags(plain.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'), mergeFields));
    else document.execCommand('insertText', false, plain);
    emit();
  }
  /** Copy and cut: the clipboard gets the tags (so pasting here keeps them) and, as plain text, the codes (so any other place gets something readable). */
  function copy(e: React.ClipboardEvent<HTMLDivElement>, cut: boolean) {
    if (!mergeFields) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const box = document.createElement('div');
    box.appendChild(sel.getRangeAt(0).cloneContents());
    e.preventDefault();
    e.clipboardData.setData('text/html', box.innerHTML);
    e.clipboardData.setData('text/plain', plainWithCodes(box.innerHTML));
    if (cut) { document.execCommand('delete'); emit(); }
  }
  /** Puts one field where the cursor is (at the end, if the cursor is elsewhere). */
  function insertTag(key: string) {
    if (disabled || !mergeFields) return;
    const el = ref.current; if (!el) return;
    el.focus();
    insertInline(tagHtml(key, mergeFields));
    setMenu(null);
    emit();
  }
  /**
   * Puts inline html (a tag, or text with tags) at the cursor with the Range API, and the cursor after it. `execCommand('insertHTML')` is not used for this: at the end of a paragraph Chrome puts a block-less
   * element OUTSIDE the paragraph, and the caret inside the tag, where a Backspace no longer removes it whole.
   */
  function insertInline(html: string) {
    const el = ref.current; const sel = window.getSelection(); if (!el || !sel) return;
    if (sel.rangeCount === 0 || !el.contains(sel.anchorNode)) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const last = tpl.content.lastChild;
    range.insertNode(tpl.content);
    if (last) { range.setStartAfter(last); range.collapse(true); sel.removeAllRanges(); sel.addRange(range); }
  }
  /** Typing `{` opens the list of fields instead of a bracket; arrows, Enter and Escape work it. */
  function keyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!mergeFields || disabled) return;
    if (menu) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenu({ active: (menu.active + 1) % mergeFields.length }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMenu({ active: (menu.active - 1 + mergeFields.length) % mergeFields.length }); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertTag(mergeFields[menu.active].key); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMenu(null); return; }
      setMenu(null);
      return;
    }
    if (e.key === '{') { e.preventDefault(); setMenu({ active: 0 }); }
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
        onInput={emit} onBlur={() => { emit(); setMenu(null); if (ref.current && last.current !== null) ref.current.innerHTML = toDom(last.current); }} onPaste={paste} onCopy={(e) => copy(e, false)} onCut={(e) => copy(e, true)} onKeyDown={keyDown} onDrop={(e) => e.preventDefault()}
        className="rich-text rich-edit min-h-[7rem] px-3 py-2 text-sm text-gray-900 outline-none aria-disabled:bg-gray-50" aria-disabled={disabled} />
      {mergeFields && menu && (
        <ul role="listbox" aria-label="Fields" className="mx-3 mb-2 max-h-48 overflow-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg" data-testid="merge-menu">
          {mergeFields.map((f, i) => (
            <li key={f.key} role="option" aria-selected={i === menu.active} data-testid={`merge-menu-${f.key}`} onMouseDown={(e) => e.preventDefault()} onClick={() => insertTag(f.key)}
              className={`cursor-pointer rounded px-2 py-1 text-sm ${i === menu.active ? 'bg-[#E8F4F8] text-[#0A5F75]' : 'text-gray-800 hover:bg-gray-50'}`}>{f.label}</li>
          ))}
        </ul>
      )}
      {mergeFields && (
        <p className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500" data-testid="merge-fields">
          Fields — click one to put it where the cursor is, or type <kbd className="rounded border border-gray-300 bg-gray-50 px-1">{'{'}</kbd>:
          {mergeFields.map((f) => (
            <button key={f.key} type="button" disabled={disabled} data-testid={`merge-add-${f.key}`} className="merge-tag disabled:opacity-40"
              onMouseDown={(e) => e.preventDefault()} onClick={() => insertTag(f.key)}>{f.label}</button>
          ))}
        </p>
      )}
      {problem && <p role="alert" className="border-t border-gray-100 px-3 py-1.5 text-xs text-[#B00000]" data-testid="rt-problem">{problem}</p>}
    </div>
  );
}
