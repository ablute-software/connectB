'use client';
// Prompt 537 §1(a) — what actually happened to this recipient's invitation,
// on the recipient's own row, in the founder's own workspace.
//
// The whole failure this closes: the send outcome existed only as a
// console.error in Vercel, and the founder saw "Email sending failed — try
// again in a moment." So they tried again. For three weeks. The provider had
// been giving a precise answer the entire time — an unverified sender domain
// — and nobody in the loop could read it.
//
// So this component shows the provider's own words. Not a category, not a
// friendlier paraphrase: the verbatim text, next to the exact `from` address
// that produced it, with Copy guest link right beside it because the link
// works regardless of whether the email ever left the building.
import { useEffect, useState } from 'react';

export interface EmailStatusRow {
  recipient: string;
  status: 'sent' | 'failed' | 'not_configured' | 'render_failed' | string;
  subject: string | null;
  provider_error: string | null;
  from_address_used: string | null;
  created_at: string;
}

/** Locale-independent on purpose — this renders after hydration, and a
 *  locale-dependent string here differs between server and client. */
function shortTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

export function useEmailStatuses(enabled: boolean): {
  byRecipient: Record<string, EmailStatusRow>;
  refresh: () => void;
} {
  const [byRecipient, setByRecipient] = useState<Record<string, EmailStatusRow>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch('/api/data-room/email-status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => { if (!cancelled && b.ok) setByRecipient(b.byRecipient ?? {}); })
      .catch(() => { /* the panel works without it — this is diagnosis, not function */ });
    return () => { cancelled = true; };
  }, [enabled, tick]);
  return { byRecipient, refresh: () => setTick((t) => t + 1) };
}

export function EmailDeliveryStatus({ emails, byRecipient }: {
  emails: string[];
  byRecipient: Record<string, EmailStatusRow>;
}) {
  const rows = emails
    .map((e) => byRecipient[e.trim().toLowerCase()])
    .filter(Boolean) as EmailStatusRow[];
  if (rows.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {rows.map((row) => {
        const ok = row.status === 'sent';
        return (
          <div key={`${row.recipient}-${row.created_at}`}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'}`}>
            <div className="font-medium">
              {ok
                ? `Invitation sent ${shortTime(row.created_at)}`
                : `Invitation NOT sent (${shortTime(row.created_at)})`}
              {' — '}
              <span className="font-normal">{row.recipient}</span>
            </div>
            {!ok && (
              <>
                {/* The provider's verbatim answer. This is the line that
                    ends the guessing — do not summarise it. */}
                <p className="mt-0.5 break-words font-mono text-[10px] leading-snug text-red-800">
                  {row.provider_error ?? statusSentence(row.status)}
                </p>
                <p className="mt-0.5 text-[10px] text-red-700">
                  The guest link below still works — copy it and send it yourself.
                </p>
              </>
            )}
            {row.from_address_used && (
              <p className="mt-0.5 text-[10px] opacity-70">Sent from: {row.from_address_used}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Only for the statuses that have no provider text of their own, because the
// provider was never reached.
function statusSentence(status: string): string {
  if (status === 'not_configured') return 'No email provider is configured in this environment (RESEND_API_KEY is not set).';
  if (status === 'render_failed') return 'The invitation could not be composed, so nothing was sent.';
  return 'The provider gave no reason.';
}
