// Prompt 924 — a host for the REAL PublishResults, bundled into a real browser by publish-results.browser.test.ts. The server is a stub of `fetch` that behaves like the routes where it matters to the screen: the
// name of the call must be typed, a scheduled publication can be cancelled, a published one cannot be published again, an email can be sent again. Test-only: nothing in the app imports it.
import { createRoot } from 'react-dom/client';
import { confirmationMatches, defaultMessage, type PublicationView, type SendRow } from '@/lib/calls/results';
import { PublishResults } from './PublishResults';

declare global { interface Window { __startPublish: (o: { pending?: boolean }) => void; __publishRequests: { method: string; url: string; body: unknown }[] } }

const CALL_ID = 'call-1';
const NAME = 'Seed Call 2027';

window.__startPublish = ({ pending = false }) => {
  window.__publishRequests = [];
  const labels = { advance: 'Selected', reject: 'Not selected', waitlist: 'Waiting list' };
  const sends = (): SendRow[] => [
    { sendId: 's1', applicationId: 'a1', reference: 'REF-001', startupName: 'Blue Health', label: 'Selected', status: 'sent', attempts: 1, error: null, sentAt: '2026-10-29T12:00:00Z' },
    { sendId: 's2', applicationId: 'a2', reference: 'REF-002', startupName: 'Cyan Labs', label: 'Not selected', status: 'bounced', attempts: 1, error: 'Invalid recipient address', sentAt: null },
    { sendId: 's3', applicationId: 'a3', reference: 'REF-003', startupName: 'Green Tech', label: 'Waiting list', status: 'queued', attempts: 1, error: 'provider timeout', sentAt: null },
    { sendId: 's4', applicationId: 'a4', reference: 'REF-004', startupName: 'Red Ltd with a very long name that has to wrap inside its own box on a phone', label: 'Not selected', status: 'sent', attempts: 1, error: null, sentAt: '2026-10-29T12:00:00Z' },
  ];
  let batch: PublicationView['batch'] = null;
  let rows: SendRow[] = [];
  const count = () => ({ queued: rows.filter((r) => r.status === 'queued').length, sent: rows.filter((r) => r.status === 'sent').length, bounced: rows.filter((r) => r.status === 'bounced').length, failed: rows.filter((r) => r.status === 'failed').length });
  const view = (): PublicationView => ({
    ok: true, phase: { id: 'p1', name: 'Phase 1', hasNext: false }, summary: { total: 4, counts: { advance: 1, reject: 2, waitlist: 1 }, emails: 4 },
    blockers: pending && !batch ? [{ code: 'pending', text: '1 application has no decision yet. Every application needs one before the results can be published.' }] : [],
    labels, subjects: { advance: `${NAME}: Selected`, reject: `${NAME}: Not selected`, waitlist: `${NAME}: Waiting list` },
    messages: { advance: defaultMessage('advance', 'en', false), reject: defaultMessage('reject', 'en', false), waitlist: defaultMessage('waitlist', 'en', false) },
    batch, history: batch?.status === 'published' ? [batch] : [], sends: { counts: count(), rows }, timezone: 'Europe/Lisbon', callName: NAME, callStatus: 'closed', locked: !!batch,
  });
  const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    window.__publishRequests.push({ method, url, body });
    if (url !== `/api/calls/${CALL_ID}/results/publish`) return reply(404, { ok: false });
    if (method === 'GET') return reply(200, view());
    switch (body.action) {
      case 'test': return reply(200, { ok: true, sent: 3, to: 'a•••@ablute.pt' });
      case 'publish':
        if (!confirmationMatches(body.confirmName, NAME)) return reply(400, { ok: false, error: 'Type the name of the call to confirm.' });
        batch = { id: 'b1', status: 'published', scheduledAt: null, publishedAt: '2026-10-29T12:00:00Z', publishedBy: 'u', total: 4, counts: { advance: 1, reject: 2, waitlist: 1 } }; rows = sends();
        return reply(200, { ...view(), published: 4 });
      case 'schedule':
        if (!confirmationMatches(body.confirmName, NAME)) return reply(400, { ok: false, error: 'Type the name of the call to confirm.' });
        batch = { id: 'b2', status: 'scheduled', scheduledAt: body.at, publishedAt: null, publishedBy: null, total: 0, counts: {} };
        return reply(200, { ...view(), scheduledAt: body.at });
      case 'cancel_schedule': batch = null; return reply(200, view());
      case 'process_sends': rows = rows.map((r) => (r.status === 'queued' ? { ...r, status: 'sent', error: null, attempts: r.attempts + 1 } : r)); return reply(200, view());
      case 'resend': rows = rows.map((r) => (r.sendId === body.sendId ? { ...r, status: 'sent', error: null, attempts: 1 } : r)); return reply(200, { ...view(), status: 'sent' });
      default: return reply(400, { ok: false, error: 'Unknown action.' });
    }
  }) as typeof fetch;
  createRoot(document.getElementById('root')!).render(<div style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}><PublishResults callId={CALL_ID} onOpenPrepare={() => { document.title = 'went-to-prepare'; }} /></div>);
};
