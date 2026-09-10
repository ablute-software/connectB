'use client';
// Prompt 585 §F.8 — one reusable card for all three entry points (person
// page header, entity §E block, message compositor). Never a send button
// — "Use in draft" only pre-fills the existing message composer; the
// founder edits and presses Send themselves, same as typing it by hand.
import { useState } from 'react';
import { browserClient } from '@/lib/supabase';

interface HookSuggestion {
  id: string;
  verdict: 'strong' | 'weak' | 'none';
  hook_text: string | null;
  claims: { text: string; evidence_ids: string[] }[];
  invalidated_at: string | null;
}

interface EvidenceRef { id: string; title: string; url: string }

export function HookSuggestionCard({
  targetKind, targetId, entityId, channel, label, onUseInDraft,
}: {
  targetKind: 'person' | 'entity';
  targetId: string;
  entityId: string;
  channel: 'platform_message' | 'linkedin' | 'email' | 'form';
  label: string;
  // Absent on a page with no message composer to fill (e.g. the person
  // page reaches its own entity's composer by navigating there instead).
  onUseInDraft?: (text: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [suggestion, setSuggestion] = useState<HookSuggestion | null>(null);
  const [evidenceById, setEvidenceById] = useState<Map<string, EvidenceRef>>(new Map());
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function suggest() {
    setState('loading'); setError(''); setCopied(false);
    try {
      const res = await fetch('/api/hooks/suggest', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_kind: targetKind, target_id: targetId, entity_id: entityId, channel }),
      });
      const body = await res.json();
      if (!body.ok) { setError(body.error ?? 'Could not generate a hook.'); setState('error'); return; }
      const s = body.suggestion as HookSuggestion;
      setSuggestion(s);

      const ids = Array.from(new Set(s.claims.flatMap((c) => c.evidence_ids)));
      if (ids.length > 0) {
        const { data } = await browserClient().from('catalog_evidence').select('id, title, url').in('id', ids);
        setEvidenceById(new Map((data ?? []).map((e) => [e.id as string, e as EvidenceRef])));
      }
      setState('ready');
    } catch (e) {
      setError((e as Error).message); setState('error');
    }
  }

  async function useInDraft() {
    if (!suggestion?.hook_text) return;
    await fetch(`/api/hooks/${suggestion.id}/used`, { method: 'POST' }).catch(() => {});
    onUseInDraft?.(suggestion.hook_text);
  }

  function copy() {
    if (!suggestion?.hook_text) return;
    navigator.clipboard?.writeText(suggestion.hook_text).then(() => setCopied(true)).catch(() => {});
  }

  if (state === 'idle') {
    return <button onClick={suggest} className="text-xs font-medium text-cyan-700 hover:underline">{label}</button>;
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      {state === 'loading' && <p className="text-xs text-gray-400">Thinking…</p>}
      {state === 'error' && (
        <>
          <p className="text-xs text-[#B00000]">{error}</p>
          <button onClick={suggest} className="mt-1 text-xs text-cyan-700 hover:underline">Try again</button>
        </>
      )}
      {state === 'ready' && suggestion && (
        suggestion.verdict === 'none' ? (
          <div>
            <p className="text-sm text-gray-500">No sensible link found — review the evidence.</p>
            <button onClick={suggest} className="mt-1 text-xs text-cyan-700 hover:underline">Regenerate</button>
          </div>
        ) : (
          <div>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${suggestion.verdict === 'strong' ? 'bg-cyan-100 text-cyan-800' : 'bg-gray-100 text-gray-600'}`}>
              {suggestion.verdict}
            </span>
            {suggestion.invalidated_at && (
              <p className="mt-1.5 rounded bg-amber-50 p-1.5 text-xs text-amber-800">
                This suggestion cited a source that was since removed — regenerate.
              </p>
            )}
            <p className="mt-1.5 text-sm text-gray-800">{suggestion.hook_text}</p>
            <ul className="mt-1.5 space-y-1">
              {suggestion.claims.map((claim, i) => (
                <li key={i} className="flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
                  {claim.evidence_ids.map((id) => {
                    const ref = evidenceById.get(id);
                    return ref ? (
                      <a key={id} href={ref.url} target="_blank" rel="noopener noreferrer" className="rounded-full bg-gray-100 px-1.5 py-0.5 text-gray-600 hover:underline">{ref.title}</a>
                    ) : null;
                  })}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={copy} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">{copied ? 'Copied' : 'Copy'}</button>
              {!suggestion.invalidated_at && onUseInDraft && (
                <button onClick={useInDraft} className="rounded bg-[#0E7490] px-2 py-1 text-xs font-medium text-white">Use in draft</button>
              )}
              <button onClick={suggest} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">Regenerate</button>
            </div>
            <p className="mt-2 text-[11px] text-gray-400">Suggestion built only from the sources shown. Edit before sending.</p>
          </div>
        )
      )}
    </div>
  );
}
