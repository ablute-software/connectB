'use client';
// Automations — list, mode toggle (draft_review vs full_auto), run history
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';

const TRIGGER_LABEL: Record<string, string> = {
  no_reply_14d: 'Outbound with no reply for 14 days',
  followup_no_reply_14d: 'Follow-up unanswered for another 14 days',
  inbound_meeting_request: 'Inbound classified as meeting request',
  inbound_pass: 'Inbound classified as pass',
  contact_lock_expired: 'Contact lock expired',
  grant_activated: 'Data-room grant activated',
  document_viewed: 'Investor viewed a document',
  hook_missing: 'Hook missing on a person in an active wave',
};

export default function AutomationsPage() {
  const { db, toggleAutomation, setAutomationMode } = useStore();
  const isPaid = db.org.plan === 'paid';

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Automations</h1>
      <p className="text-sm text-gray-500 max-w-2xl">
        Each automation runs in one of two modes: <b>draft &amp; review</b> (drafts land in the Outbox for your approval)
        or <b>full auto</b> (executes without stopping — but only when pre-flight is green and within the caps; anything
        blocked falls back to the Outbox with the reason). LinkedIn has no official send API, so LinkedIn automations
        always produce ready-to-paste drafts.
      </p>
      {!isPaid && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Full-auto mode is a paid feature — on the free plan everything routes through the Outbox.
        </div>
      )}

      <Card>
        <ul className="divide-y divide-gray-100">
          {db.automations.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={a.enabled} onChange={() => toggleAutomation(a.id)} />
              </label>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{a.name}</div>
                <div className="text-xs text-gray-500">When: {TRIGGER_LABEL[a.trigger]} → {a.action.replace(/_/g, ' ')}</div>
              </div>
              <div className="flex overflow-hidden rounded-lg border border-gray-300 text-xs">
                <button onClick={() => setAutomationMode(a.id, 'draft_review')}
                  className={`px-2.5 py-1 ${a.mode === 'draft_review' ? 'bg-[#0E7490] text-white' : 'bg-white text-gray-600'}`}>
                  Draft & review
                </button>
                <button onClick={() => isPaid && setAutomationMode(a.id, 'full_auto')}
                  disabled={!isPaid}
                  title={isPaid ? '' : 'Paid feature'}
                  className={`px-2.5 py-1 ${a.mode === 'full_auto' ? 'bg-[#0E7490] text-white' : 'bg-white text-gray-600'} disabled:opacity-40`}>
                  Full auto{!isPaid && ' 🔒'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="How execution works">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-gray-600">
          <li>A scheduled job (Vercel cron → <code className="rounded bg-gray-100 px-1">/api/automations</code>) evaluates triggers hourly.</li>
          <li>Each match becomes a run. <b>Pre-flight and caps are evaluated first</b> — a full-auto run that fails any check lands in the Outbox instead, with the reason.</li>
          <li>Email sends go through Resend from {db.org.sender_email ?? 'your verified domain'} (BCC {db.org.bcc_email}); bounces increment the person’s bounce counter and block the address.</li>
          <li>Guessed (unverified) addresses are <b>never</b> auto-sent. No exception, no override.</li>
          <li>Every executed run is logged as an interaction, marked “automation”.</li>
        </ol>
      </Card>
    </div>
  );
}
