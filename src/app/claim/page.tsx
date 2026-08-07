'use client';
// "Claim this profile" (2026-08-07, Nuno's decision B). The landing page's
// "Claim this profile" CTA (/investors) lands here. Signed out → the same
// InvestorSignInForm every other investor entry point uses (magic-link,
// shouldCreateUser:true — this IS the "signup" half of "signup → claim",
// no separate account-creation UI needed); signed in with a confirmed
// email → search catalog_entities by name, pick one, submit a claim.
// Domain-match evidence is computed server-side at submit time
// (POST /api/portal/claims) — never trusted from anything this page sends.
import { useEffect, useState } from 'react';
import { BRAND_NAME } from '@/lib/brand';
import { authEnabled, browserClient } from '@/lib/supabase';
import { InvestorSignInForm } from '@/components/auth/InvestorSignInForm';

interface EntityResult {
  id: string; name: string; website: string | null; hqCity: string | null; hqCountry: string | null; verificationStatus: string;
}
interface OwnClaim { id: string; catalog_entity_id: string; entityName: string; status: 'pending' | 'approved' | 'rejected'; domain_match: boolean; created_at: string }

export default function ClaimPage() {
  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined);
  const [emailConfirmed, setEmailConfirmed] = useState(true);
  const [linkFailed] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('linkFailed') === '1');

  const [q, setQ] = useState('');
  const [results, setResults] = useState<EntityResult[] | null>(null);
  const [selected, setSelected] = useState<EntityResult | null>(null);
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ text: string; kind: 'success' | 'info' | 'error' } | null>(null);
  const [ownClaims, setOwnClaims] = useState<OwnClaim[] | null>(null);

  useEffect(() => {
    if (!authEnabled) { setSessionEmail(null); return; }
    browserClient().auth.getUser().then(({ data }) => {
      setSessionEmail(data.user?.email?.toLowerCase() ?? null);
      setEmailConfirmed(!!data.user?.email_confirmed_at);
    });
  }, []);

  function loadOwnClaims() {
    fetch('/api/portal/claims').then((r) => r.json()).then((d) => { if (d.ok) setOwnClaims(d.claims); }).catch(() => {});
  }
  useEffect(() => { if (sessionEmail) loadOwnClaims(); }, [sessionEmail]);

  useEffect(() => {
    if (!sessionEmail || q.trim().length < 2) { setResults(null); return; }
    const t = setTimeout(() => {
      fetch(`/api/portal/claims/search-entities?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json()).then((d) => setResults(d.ok ? d.entities : []));
    }, 250);
    return () => clearTimeout(t);
  }, [q, sessionEmail]);

  async function submitClaim() {
    if (!selected) return;
    setBusy(true); setSubmitMsg(null);
    try {
      const res = await fetch('/api/portal/claims', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ catalogEntityId: selected.id, requestedRole: role.trim() || undefined }),
      });
      const body = await res.json();
      if (!body.ok) { setSubmitMsg({ text: body.error ?? 'Could not submit the claim.', kind: 'error' }); return; }
      if (body.alreadyPending) {
        setSubmitMsg({ text: `You already have a pending claim on ${selected.name}.`, kind: 'info' });
      } else if (body.isDispute) {
        setSubmitMsg({ text: `Claim submitted for review. Someone else already manages this profile — our team will look into it.`, kind: 'info' });
      } else if (body.domainMatch) {
        setSubmitMsg({ text: `Claim submitted — your email domain matches ${selected.name}'s. Our team still reviews every claim before it's approved.`, kind: 'success' });
      } else {
        setSubmitMsg({ text: `Claim submitted for manual review — your email domain doesn't match what's on file for ${selected.name}.`, kind: 'info' });
      }
      setSelected(null); setQ(''); setResults(null); setRole('');
      loadOwnClaims();
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <div className="mb-6 text-xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
        {BRAND_NAME}
      </div>
      <h1 className="mb-1 text-lg font-semibold text-gray-900">Claim this profile</h1>
      <p className="mb-5 text-sm text-gray-500">
        Search for your firm, and if it&apos;s already on {BRAND_NAME}, claim it. We verify your email domain
        against the firm&apos;s own site — a match speeds up review, but a human always makes the final call.
      </p>

      {sessionEmail === undefined ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !sessionEmail ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm text-gray-600">Sign in (or create a free account) to claim a profile — this is how we know which email domain to check.</p>
          <InvestorSignInForm next="/claim" linkFailed={linkFailed} />
        </div>
      ) : !emailConfirmed ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Confirm your email first — check your inbox for the link we sent.
        </p>
      ) : (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by firm name…"
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          {results && results.length === 0 && q.trim().length >= 2 && (
            <p className="mt-2 text-xs text-gray-400">No matches. Not every firm is catalogued yet.</p>
          )}
          {results && results.length > 0 && (
            <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
              {results.map((e) => (
                <li key={e.id}>
                  <button onClick={() => setSelected(e)} className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-gray-50">
                    <span className="font-medium text-gray-800">{e.name}</span>
                    <span className="text-xs text-gray-400">
                      {[e.hqCity, e.hqCountry].filter(Boolean).join(', ') || 'Location not on file'}
                      {e.website && ` · ${e.website}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected && (
            <div className="mt-4 rounded-xl border border-cyan-100 bg-[#E8F4F8] p-4">
              <p className="text-sm font-medium text-gray-900">Claim {selected.name}?</p>
              <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Your role (optional — e.g. Partner)"
                className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => setSelected(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600">Cancel</button>
                <button disabled={busy} onClick={submitClaim}
                  className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                  {busy ? 'Submitting…' : 'Submit claim'}
                </button>
              </div>
            </div>
          )}

          {submitMsg && (
            <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${
              submitMsg.kind === 'success' ? 'border border-green-200 bg-green-50 text-green-800'
              : submitMsg.kind === 'error' ? 'border border-red-200 bg-red-50 text-[#B00000]'
              : 'border border-gray-200 bg-gray-50 text-gray-700'}`}>
              {submitMsg.text}
            </p>
          )}

          {ownClaims && ownClaims.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Your claims</p>
              <ul className="space-y-1.5">
                {ownClaims.map((c) => (
                  <li key={c.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
                    <span className="text-gray-700">{c.entityName}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      c.status === 'approved' ? 'bg-green-50 text-green-700' : c.status === 'rejected' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-800'}`}>
                      {c.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
