'use client';
// Prompt 905 — the saving indicator of the editor (spec §14.1): "Saving…", "Saved", "Save error". It never says
// "Saved" before the server confirmed, and a failure keeps what is on screen and offers a retry.
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

export function saveStateText(state: SaveState): string {
  switch (state) {
    case 'saving': return 'Saving…';
    case 'saved': return 'Saved';
    case 'dirty': return 'Unsaved changes';
    case 'error': return 'Save error';
    case 'conflict': return 'Out of date';
    default: return '';
  }
}

export function SaveStatus({ state, message, onRetry, onReload }: {
  state: SaveState; message?: string; onRetry?: () => void; onReload?: () => void;
}) {
  if (state === 'idle') return <span className="h-5" data-testid="save-status" data-state="idle" />;
  const tone = state === 'saved' ? 'text-emerald-700' : state === 'error' || state === 'conflict' ? 'text-[#B00000]' : 'text-gray-500';
  return (
    <span className={`inline-flex items-center gap-2 text-xs font-medium ${tone}`} role="status" aria-live="polite" data-testid="save-status" data-state={state}>
      <span aria-hidden="true">{state === 'saved' ? '✓' : state === 'error' || state === 'conflict' ? '⚠' : '…'}</span>
      {saveStateText(state)}
      {message && state !== 'saved' && <span className="font-normal text-gray-500">— {message}</span>}
      {state === 'error' && onRetry && <button type="button" onClick={onRetry} className="underline">Try again</button>}
      {state === 'conflict' && onReload && <button type="button" onClick={onReload} className="underline">Reload</button>}
    </span>
  );
}
