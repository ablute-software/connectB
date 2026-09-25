'use client';
// Prompt 587 §B — where role='investor_pending' lands (landing-redirect.ts,
// middleware.ts's /login-/signup redirect): a claim was submitted but didn't
// auto-approve (investor-entity-claims.ts's evaluateClaimDomain — no domain
// match, a freemail entity domain, or no domain on file at all) and no
// admin has decided it yet. Never the marketing landing, never the founder
// app shell — this explains what's happening and why, using the exact
// evidence snapshotted at claim time (POST /api/portal/claims), not generic
// "under review" copy with no reason.
import { useEffect, useState } from 'react';
import { BRAND_NAME } from '@/lib/brand';
import { authEnabled, browserClient } from '@/lib/supabase';
import { InvestorSignInForm } from '@/components/auth/InvestorSignInForm';
import { LoadingState } from '@/components/workspace-shell/LoadingState';

interface ClaimEvidence {
  entityDomain?: string | null;
  entityDomainIsFreemail?: boolean;
  isDispute?: boolean;
}
interface OwnClaim {
  id: string; catalog_entity_id: string; entityName: string;
  status: 'pending' | 'approved' | 'rejected'; domain_match: boolean;
  evidence: ClaimEvidence | null; created_at: string;
}

function pendingReason(claim: OwnClaim): string {
  const ev = claim.evidence;
  if (ev?.isDispute) return 'Someone else already manages this profile — our team is reviewing your request against theirs.';
  if (!ev?.entityDomain) return "This profile doesn't have a registered domain on file yet, so we can't verify it automatically.";
  if (ev.entityDomainIsFreemail) return "This profile's domain on file is a shared/freemail provider, so it can't be auto-verified.";
  if (!claim.domain_match) return "Your email domain doesn't match this firm's registered domain on file.";
  return 'Under review.';
}

export default function ClaimPendingPage() {
  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined);
  const [claims, setClaims] = useState<OwnClaim[] | null>(null);

  useEffect(() => {
    if (!authEnabled) { setSessionEmail(null); return; }
    browserClient().auth.getUser().then(({ data }) => setSessionEmail(data.user?.email?.toLowerCase() ?? null));
  }, []);

  useEffect(() => {
    if (!sessionEmail) return;
    fetch('/api/portal/claims').then((r) => r.json()).then((d) => { if (d.ok) setClaims(d.claims); });
  }, [sessionEmail]);

  const pending = (claims ?? []).filter((c) => c.status === 'pending');

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <div className="mb-6 text-xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
        {BRAND_NAME}
      </div>

      {sessionEmail === undefined ? (
        <LoadingState text="Loading…" compact />
      ) : !sessionEmail ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm text-gray-600">Sign in to see your claim&apos;s status.</p>
          <InvestorSignInForm next="/claim/pending" linkFailed={false} />
        </div>
      ) : claims === null ? (
        <LoadingState text="Loading…" compact />
      ) : pending.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h1 className="mb-1 text-lg font-semibold text-gray-900">No claim pending review</h1>
          <p className="text-sm text-gray-500">
            You don&apos;t have a claim currently being verified.{' '}
            <a href="/claim" className="font-medium text-[#0E7490] underline">Claim a profile</a>.
          </p>
        </div>
      ) : (
        <>
          <h1 className="mb-1 text-lg font-semibold text-gray-900">Your claim is being verified</h1>
          <p className="mb-5 text-sm text-gray-500">
            Our team typically reviews a claim within 1-2 business days. We&apos;ll email you as soon as it&apos;s decided —
            no need to keep checking back.
          </p>
          <ul className="space-y-3">
            {pending.map((c) => (
              <li key={c.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-gray-900">{c.entityName}</p>
                <p className="mt-1 text-xs text-gray-600">{pendingReason(c)}</p>
                <p className="mt-2 text-[11px] text-gray-400">
                  Submitted {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs text-gray-400">
            Need to claim a different profile? <a href="/claim" className="font-medium text-[#0E7490] underline">Search again</a>.
          </p>
        </>
      )}
    </div>
  );
}
