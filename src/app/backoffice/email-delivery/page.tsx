'use client';
// Prompt 537 §1(b)/§2 — the Email delivery tab.
//
// This page exists because for three weeks the answer to "why didn't the
// invite arrive?" was only ever in a Vercel log. Two things are on it:
//
//  - the HEALTH CARD (§2): is a key set, what `from` is actually in effect,
//    and — the question that settles it permanently — does the provider
//    consider that sender's domain verified? One call to Resend's own
//    /domains endpoint answers "why 403" forever.
//  - the LOG (§1): the last 100 attempts with the provider's verbatim text.
//
// Nothing here interprets a failure into a friendlier category. The raw
// string is the product.
import { useCallback, useEffect, useState } from 'react';

interface Health {
  ok: boolean;
  apiKeyPresent: boolean;
  fromInEffect: string;
  fromDomain: string | null;
  replyToInEffect: string | null;
  fromEnvSet: boolean;
  domains: { name: string | null; status: string | null; region: string | null }[];
  fromDomainVerified: boolean;
  isSandbox?: boolean;
  domainsError?: string | null;
  diagnosis: string;
}

interface LogRow {
  id: string;
  org_id: string | null;
  org_name: string | null;
  kind: string;
  recipient: string;
  subject: string | null;
  status: string;
  provider_id: string | null;
  provider_error: string | null;
  from_address_used: string | null;
  created_at: string;
}

const STATUS_FILTERS = ['', 'failed', 'sent', 'not_configured', 'render_failed'];

function stamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export default function EmailDeliveryPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; to?: string; providerError?: string | null; error?: string | null } | null>(null);

  useEffect(() => {
    fetch('/api/backoffice/email-health', { cache: 'no-store' })
      .then((r) => r.json()).then(setHealth).catch(() => setErr('Could not read email health.'));
  }, []);

  const loadLog = useCallback(() => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    fetch(`/api/backoffice/email-log${qs}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => { if (b.ok) setRows(b.rows ?? []); else setErr(b.error ?? 'Could not read the log.'); })
      .catch(() => setErr('Could not read the log.'));
  }, [status]);

  useEffect(() => { loadLog(); }, [loadLog]);

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/backoffice/email-health/test-send', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      setTestResult(body);
      loadLog();
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  const healthy = health?.apiKeyPresent && health?.fromDomainVerified;

  return (
    <div>
      <h1 className="text-lg font-semibold text-gray-900">Email delivery</h1>
      <p className="mt-1 text-sm text-gray-500">
        Every send attempt, with the provider&rsquo;s own answer. If an invitation didn&rsquo;t arrive, the reason is on
        this page — no server logs required.
      </p>

      {err && <p className="mt-4 text-sm text-[#B00000]">{err}</p>}

      {health && (
        <div className={`mt-4 rounded-lg border p-4 ${healthy ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
          <p className={`text-sm font-semibold ${healthy ? 'text-emerald-800' : 'text-[#B00000]'}`}>
            {healthy ? '✓ Sender verified — third-party recipients can receive mail' : '⚠ Sends to third parties will be refused'}
          </p>
          <p className="mt-1 text-xs text-gray-700">{health.diagnosis}</p>

          <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-gray-500">API key</dt>
              {/* Boolean only — the key's value never leaves the server. */}
              <dd className={health.apiKeyPresent ? 'text-emerald-700' : 'text-[#B00000]'}>
                {health.apiKeyPresent ? 'present' : 'NOT SET'}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-500">From in effect</dt>
              <dd className="break-all font-mono text-gray-800">{health.fromInEffect}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-500">RESEND_FROM_EMAIL</dt>
              <dd className="text-gray-800">{health.fromEnvSet ? 'set' : 'not set (using the built-in fallback)'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-500">Reply-to</dt>
              <dd className="break-all font-mono text-gray-800">{health.replyToInEffect ?? '—'}</dd>
            </div>
          </dl>

          <div className="mt-3">
            <p className="text-xs font-medium text-gray-600">Domains at the provider</p>
            {health.domainsError ? (
              <p className="mt-1 font-mono text-[11px] text-[#B00000]">{health.domainsError}</p>
            ) : health.domains.length === 0 ? (
              <p className="mt-1 text-[11px] text-gray-500">None registered.</p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {health.domains.map((d) => (
                  <li key={d.name ?? Math.random()} className="text-[11px]">
                    <span className="font-mono text-gray-800">{d.name}</span>
                    {' — '}
                    <span className={(d.status ?? '').toLowerCase() === 'verified' ? 'text-emerald-700' : 'text-[#B00000]'}>
                      {d.status ?? 'unknown'}
                    </span>
                    {d.name?.toLowerCase() === health.fromDomain && <span className="ml-1 text-gray-500">(the sender&rsquo;s domain)</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={testing} onClick={sendTest}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0c637b] disabled:opacity-50">
              {testing ? 'Sending…' : 'Send test email to me'}
            </button>
            <span className="text-[11px] text-gray-500">
              Sends the real invitation template to your own address, logged below like any other send.
            </span>
          </div>
          {testResult && (
            <p className={`mt-2 text-[11px] ${testResult.ok ? 'text-emerald-800' : 'text-[#B00000]'}`}>
              {testResult.ok
                ? `Sent to ${testResult.to}.`
                : <>Not sent. <span className="break-words font-mono">{testResult.providerError ?? testResult.error}</span></>}
            </p>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">Filter</span>
        {STATUS_FILTERS.map((s) => (
          <button key={s || 'all'} type="button" onClick={() => setStatus(s)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${status === s ? 'bg-[#0E7490] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {s || 'all'}
          </button>
        ))}
        <button type="button" onClick={loadLog} className="ml-auto rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50">
          Refresh
        </button>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="py-2 pr-3">When</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Kind</th>
              <th className="py-2 pr-3">Recipient</th>
              <th className="py-2 pr-3">Org</th>
              <th className="py-2 pr-3">From</th>
              <th className="py-2">Provider response</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="py-6 text-center text-gray-400">No attempts recorded yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-3 whitespace-nowrap text-gray-500">{stamp(r.created_at)}</td>
                <td className={`py-2 pr-3 font-medium ${r.status === 'sent' ? 'text-emerald-700' : 'text-[#B00000]'}`}>{r.status}</td>
                <td className="py-2 pr-3 text-gray-600">{r.kind}</td>
                <td className="py-2 pr-3 break-all text-gray-800">{r.recipient}</td>
                <td className="py-2 pr-3 text-gray-600">{r.org_name ?? '—'}</td>
                <td className="py-2 pr-3 break-all font-mono text-[10px] text-gray-600">{r.from_address_used ?? '—'}</td>
                <td className="py-2 break-words font-mono text-[10px] text-gray-700">
                  {r.status === 'sent' ? (r.provider_id ?? 'accepted') : (r.provider_error ?? '—')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
