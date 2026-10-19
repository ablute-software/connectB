'use client';
// Prompt 919 E — the "Website health" card on a startup's Ficha do cliente: the last Google analysis (scores + date), whether the founder
// shares it with investors, whether PAGESPEED_API_KEY is set on this deployment, and "Force re-check", which ignores the 7-day limit.
// A platform admin sees the RAW reason when a check failed (a founder only ever reads the founder-safe sentence), because that is what
// tells support whether the problem is the site, Google's quota, or the key.
//
// WebsiteHealthBackofficeView is the presentational half (what the tests render); the container below it talks to the route.
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { formatCheckedDate } from '@/lib/website-health';

export interface BackofficeView {
  fetchedAt: string; url: string; ok: boolean; findings: number;
  scores: { performance: number | null; seo: number | null; accessibility: number | null; bestPractices: number | null };
  error: { kind: string; message: string; httpStatus?: number } | null;
}
export interface BackofficePayload {
  ok: boolean; available?: boolean; error?: string; orgName?: string; rawWebsite?: string | null; website?: string | null;
  keyConfigured?: boolean; visibleToInvestors?: boolean;
  latest?: { mobile: BackofficeView | null; desktop: BackofficeView | null };
  allowance?: { allowed: boolean; reason?: string; nextCheckAt?: string };
}

function Row({ label, v }: { label: string; v: BackofficeView | null | undefined }) {
  if (!v) return <p className="text-sm text-gray-400">{label}: no check yet.</p>;
  if (!v.ok) {
    return (
      <p className="text-sm text-gray-700" data-testid={`wh-${label.toLowerCase()}`}>
        <b className="font-semibold">{label}:</b> failed on {formatCheckedDate(v.fetchedAt)} — <span className="font-mono text-xs text-[#B00000]">{v.error?.kind ?? 'unknown'}{v.error?.httpStatus ? ` (HTTP ${v.error.httpStatus})` : ''}</span>
        {v.error?.message ? <span className="block text-xs text-gray-500">{v.error.message}</span> : null}
      </p>
    );
  }
  const s = v.scores;
  return (
    <p className="text-sm text-gray-700" data-testid={`wh-${label.toLowerCase()}`}>
      <b className="font-semibold">{label}:</b> performance {s.performance ?? '–'} · SEO {s.seo ?? '–'} · accessibility {s.accessibility ?? '–'} · best practices {s.bestPractices ?? '–'}
      <span className="text-gray-400"> — {formatCheckedDate(v.fetchedAt)}, {v.findings} finding{v.findings === 1 ? '' : 's'}</span>
    </p>
  );
}

export function WebsiteHealthBackofficeView({ data, busy, msg, onForce }: { data: BackofficePayload | null; busy: boolean; msg: string; onForce: () => void }) {
  if (!data || data.available === false) return null; // not loaded, or the migration is not applied: nothing to show
  // Prompt 919 addendum (19/10/2026) — no Google key on this deployment means the feature is OFF for founders (no card, no check), not "over
  // quota": Google answers a keyless request with quota 0, so nothing can ever succeed. This is where the team is told, and told what to do.
  const keyMissing = data.ok && data.keyConfigured === false;
  return (
    <Card title="Website health" right={
      <button type="button" onClick={onForce} disabled={busy || !data.website || keyMissing}
        title={keyMissing ? 'PAGESPEED_API_KEY is not set on this deployment — see the note on this card' : undefined}
        className="rounded-full border border-[#0E7490] px-3 py-1 text-xs font-semibold text-[#0E7490] hover:bg-cyan-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400">
        {busy ? 'Checking…' : 'Force re-check'}
      </button>
    }>
      {keyMissing && (
        <div role="alert" data-testid="wh-key-missing" className="mb-3 rounded-lg border border-[#B00000]/30 bg-red-50 px-3 py-2 text-sm text-[#7a0000]">
          <b className="font-semibold">Switched OFF for founders.</b> <span className="font-mono text-xs">PAGESPEED_API_KEY</span> is not set on this deployment, and without a key
          Google refuses every request (quota 0) — so founders do not see this card and no check can run. Set the key in Vercel
          (<span className="font-mono text-xs">docs/ops/CONFIG_REGISTRY.md</span> §1.4b), redeploy, then it turns itself on.
        </div>
      )}
      {!data.ok ? <p className="text-sm text-[#B00000]">{data.error ?? 'Could not load.'}</p> : (
        <div className="space-y-1.5">
          <p className="text-sm text-gray-700">
            Website on file: {data.rawWebsite ? <span className="font-mono text-xs">{data.rawWebsite}</span> : <span className="text-gray-400">none</span>}
            {data.rawWebsite && !data.website ? <span className="ml-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">not a public address</span> : null}
          </p>
          <Row label="Mobile" v={data.latest?.mobile} />
          <Row label="Desktop" v={data.latest?.desktop} />
          <p className="text-xs text-gray-500">
            Shared with investors: <b className={data.visibleToInvestors ? 'text-emerald-700' : 'text-gray-600'}>{data.visibleToInvestors ? 'yes' : 'no'}</b>
            {' · '}PageSpeed key on this deployment:{' '}
            <b className={data.keyConfigured ? 'text-emerald-700' : 'text-[#B00000]'}>{data.keyConfigured ? 'set' : 'NOT SET — the check is off'}</b>
          </p>
          {msg && <p className="text-xs font-medium text-gray-700" role="status">{msg}</p>}
        </div>
      )}
    </Card>
  );
}

export function WebsiteHealthBackofficeCard({ orgId }: { orgId: string }) {
  const [data, setData] = useState<BackofficePayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    fetch(`/api/backoffice/website-health/${orgId}`).then((r) => r.json()).then(setData).catch(() => setData({ ok: false, error: 'Could not load.' }));
  }, [orgId]);
  useEffect(load, [load]);

  async function force() {
    setBusy(true); setMsg('');
    try {
      const res = await fetch(`/api/backoffice/website-health/${orgId}`, { method: 'POST' });
      const body = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; anyOk?: boolean };
      setMsg(body.ok ? (body.anyOk ? 'Re-check done.' : 'Re-check ran, but Google refused both — see the reasons above.') : (body.error ?? 'The re-check could not run.'));
      load();
    } catch { setMsg('The re-check could not run.'); } finally { setBusy(false); }
  }

  return <WebsiteHealthBackofficeView data={data} busy={busy} msg={msg} onForce={() => { void force(); }} />;
}
