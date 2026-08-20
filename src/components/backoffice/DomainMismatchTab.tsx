'use client';
// Prompt 284 §1 — backoffice review queue: entities.email_domain doesn't
// appear anywhere in entities.website (Nalka Invest case: email_domain
// "nalkainvest.com", real site nalka.com). NOT a bulk-fix — production has
// three distinct groups behind the same query (obvious junk, a wrong-
// domain typo like Nalka, and a legitimate different domain on purpose,
// e.g. a parent company) — so every row gets a suggestion when there's
// on-row evidence for one, never an automatic write. Row layout follows
// FraudFlagsTab.tsx's pending-queue shape (evidence, then terminal action
// buttons, busy state per action) — no new visual language needed.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface Suggestion { kind: 'suggest_domain' | 'probably_intentional' | 'none'; domain?: string }
interface Mismatch {
  id: string; name: string; orgName: string; website: string; emailDomain: string; email: string | null; suggestion: Suggestion;
}

function MismatchRow({ m, onResolved }: { m: Mismatch; onResolved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [domainDraft, setDomainDraft] = useState(m.emailDomain);
  const [busy, setBusy] = useState<'apply' | 'edit' | 'correct' | null>(null);
  const [err, setErr] = useState('');

  async function resolve(action: 'apply_suggestion' | 'edit_manually' | 'mark_correct', domain?: string) {
    setBusy(action === 'apply_suggestion' ? 'apply' : action === 'edit_manually' ? 'edit' : 'correct'); setErr('');
    try {
      const res = await fetch(`/api/backoffice/domain-mismatch/${m.id}/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, domain }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error); return; }
      onResolved();
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="rounded-lg border border-gray-100 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">{m.name}</span>
        <span className="text-xs text-gray-400">({m.orgName})</span>
        {m.suggestion.kind === 'probably_intentional' && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700"
            title="The entity's own email uses the same domain as email_domain — they agree with each other, just not with the website. Likely a real, deliberate difference (e.g. a parent company's domain).">
            probably intentional
          </span>
        )}
      </div>
      <div className="mt-1.5 grid gap-1 text-xs text-gray-600 sm:grid-cols-3">
        <div><span className="text-gray-400">Website:</span> {m.website}</div>
        <div><span className="text-gray-400">Email domain:</span> {m.emailDomain}</div>
        <div><span className="text-gray-400">Email:</span> {m.email ?? '—'}</div>
      </div>
      {err && <p className="mt-1 text-xs text-[#B00000]">{err}</p>}
      {editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={domainDraft} onChange={(e) => setDomainDraft(e.target.value)} placeholder="correct-domain.com"
            className="rounded border border-gray-300 px-2 py-1 text-xs" />
          <button disabled={!!busy || !domainDraft.trim()} onClick={() => resolve('edit_manually', domainDraft.trim())}
            className="rounded bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
            {busy === 'edit' ? 'Saving…' : 'Save'}
          </button>
          <button disabled={!!busy} onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:underline">Cancel</button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {m.suggestion.kind === 'suggest_domain' && (
            <button disabled={!!busy} onClick={() => resolve('apply_suggestion', m.suggestion.domain)}
              className="rounded bg-[#0f5132] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
              {busy === 'apply' ? 'Applying…' : `Apply suggestion: ${m.suggestion.domain}`}
            </button>
          )}
          <button disabled={!!busy} onClick={() => setEditing(true)}
            className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40">
            Edit manually
          </button>
          <button disabled={!!busy} onClick={() => resolve('mark_correct')}
            className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40">
            {busy === 'correct' ? 'Marking…' : 'Mark as correct'}
          </button>
        </div>
      )}
    </li>
  );
}

export function DomainMismatchTab() {
  const [mismatches, setMismatches] = useState<Mismatch[] | null>(null);
  const [err, setErr] = useState('');

  function refresh() {
    fetch('/api/backoffice/domain-mismatch/status').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setMismatches(body.mismatches);
    }).catch((e) => setErr((e as Error).message));
  }
  useEffect(refresh, []);

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      <Card title={`Domain mismatch — email_domain vs website (${mismatches?.length ?? 0})`}>
        <p className="mb-2 text-xs text-gray-500">
          email_domain doesn&apos;t appear anywhere in the entity&apos;s own website. Not a bulk-fix — some are typos,
          some are a legitimate different domain on purpose (a parent company, a specific mailbox). Nothing changes
          without a click.
        </p>
        {!mismatches ? <p className="text-sm text-gray-400">Loading…</p> : mismatches.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing to review.</p>
        ) : (
          <ul className="space-y-2">{mismatches.map((m) => <MismatchRow key={m.id} m={m} onResolved={refresh} />)}</ul>
        )}
      </Card>
    </div>
  );
}
