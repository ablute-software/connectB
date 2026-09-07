'use client';
// Prompt 603 §C — the page between signup and the first workspace access:
// our commitments, in plain language, with every feature-naming commitment
// linking to the feature. Shown once per version (terms_acceptances,
// version 'commitments-1.0'); no countdown, no forced scroll — the record of
// who accepted which version, when, is what has value.
//
// Reachable at any time (Settings and the footer can link here); the
// automatic redirect after signup is behind COMMITMENTS_GATE_ENABLED until
// the text passes legal review (lib/commitments.ts).
//
// Prompt 606 — the visual layer. The page is about documents, so the shape is
// a DOCUMENT: a portrait sheet on a full field of brand teal. 4px corner, not
// a card's 16px; deep shadow; wide margins. No padlocks, no shields, no
// numbering, no box per promise — the three groups are separated by a rule.
//
// AuthShell is deliberately NOT used here, unlike login/signup: it paints its
// own decorative backdrop (gradient + blurred shapes + frosted glass), and
// this design needs a flat field. The route is already in shell.tsx's
// standalone list, so it renders bare and can own the whole viewport.
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';
import { getCommitments, COMMITMENTS_VERSION } from '@/lib/commitments';
import { COMMITMENTS_FOOTNOTE, CONTROLLER_NAME, COMMITMENT_GROUPS } from '@/content/commitments/v1';

function CommitmentsInner() {
  const sp = useSearchParams();
  const next = sp.get('next') && sp.get('next')!.startsWith('/') ? sp.get('next')! : '/pipeline';
  const [status, setStatus] = useState<{ needsAcceptance: boolean; gateEnabled: boolean; acceptedVersion: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const commitments = getCommitments();

  useEffect(() => {
    fetch('/api/commitments/status', { cache: 'no-store' }).then((r) => r.json()).then(setStatus).catch(() => setStatus({ needsAcceptance: false, gateEnabled: false, acceptedVersion: null }));
  }, []);

  async function accept() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/commitments/accept', { method: 'POST' });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not record your acceptance.'); return; }
      window.location.href = next;
    } finally { setBusy(false); }
  }

  const alreadyAccepted = status?.acceptedVersion === COMMITMENTS_VERSION;

  return (
    <div className="commitments-field min-h-screen px-4 py-[120px] pb-[140px]">
      {/* 660px, not the artboard's 760px (§C.1). At 760 with 72px margins the
          measure is ~85 characters; comfortable is 65-75, and on a page built
          to be read quickly a long line loses the eye on the return sweep.
          660 lands at ~70. pb-32 leaves room for the fixed bar below. */}
      <div className="commitments-sheet mx-auto w-full max-w-[660px] rounded-[4px] px-6 py-10 pb-32 sm:px-[72px] sm:pb-32 sm:pt-20">
        <div className="commitments-wordmark text-[12px] font-bold uppercase tracking-[0.09em]">{BRAND_NAME}</div>

        {/* Prompt 608 §E asks whether this banner is a SECOND switch someone has
            to remember to turn off. It is not: `status.gateEnabled` is
            literally `commitmentsGateEnabled()` from /api/commitments/status,
            the same value that decides the post-signup redirect. One
            environment variable, both behaviours — there is no state in which
            the page is live and still marked as a draft, and nothing to
            remember on the day it ships. Keep it derived; never give the
            banner a flag of its own. */}
        {status && !status.gateEnabled && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Draft under legal review — this page is not yet shown automatically to new accounts.
          </div>
        )}

        <h1 className="commitments-title mt-[34px] text-[38px] font-[650] leading-[1.22] tracking-[-0.01em]">
          Your information, safe here
        </h1>
        <p className="commitments-body mt-[22px] text-[15.5px] leading-[1.68]">
          You&apos;re about to bring your company&apos;s documents into {BRAND_NAME}. Here is how we handle
          them — so you can get on with raising, and not spend the week wondering.
        </p>

        <div className="mt-11">
          {COMMITMENT_GROUPS.map((group, gi) => {
            const items = commitments.filter((c) => c.group === group.key);
            if (items.length === 0) return null;
            return (
              <div key={group.key}>
                {/* A rule between groups, never a container around one. */}
                {gi > 0 && <hr className="commitments-rule my-8 h-px border-0" />}
                <div className="commitments-grouplabel text-[11px] font-bold uppercase tracking-[0.09em] opacity-80">
                  {group.label}
                </div>
                <div className="mt-4 flex flex-col gap-[15px]">
                  {items.map((c) => (
                    <p key={c.n} className="commitments-body text-[14.5px] leading-[1.66]">
                      {/* No numbering: the sentence opens in the text colour at
                          650 and continues in the secondary tone. */}
                      <span className="commitments-strong font-[650]">{c.title.replace(/\.$/, '')}</span>
                      {' — '}{c.body}
                      {c.link && (
                        <>
                          {' '}
                          <Link href={c.link.href} className="commitments-link underline underline-offset-2">{c.link.label} →</Link>
                        </>
                      )}
                    </p>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Roman, not italic (§C, minor): system-font italic is synthesised and
            reads as dirty at this size. Lighter colour carries the aside. */}
        <p className="commitments-aside mt-9 text-[14px] leading-[1.65]">
          This isn&apos;t the small print — you&apos;ve already been through that. It&apos;s simply how we work.
        </p>

        <p className="commitments-fine mt-8 text-[12px] leading-[1.6]">
          {COMMITMENTS_FOOTNOTE} Data controller: {CONTROLLER_NAME}. Read the{' '}
          <Link href="/terms" className="commitments-link underline underline-offset-2">Terms</Link> and the{' '}
          <Link href="/legal/subprocessors" className="commitments-link underline underline-offset-2">list of suppliers</Link>.
        </p>
        <p className="commitments-fine mt-2 text-[12px]">
          Version {COMMITMENTS_VERSION}. Your acceptance is recorded with the version, the date and the email on the account.
        </p>
      </div>

      {/* §C.3 — the sheet is long, so the action is pinned to the bottom over
          the teal field rather than the page being compressed to fit. Chosen
          over shrinking the scale because it keeps the design intact and the
          button is reachable at any scroll position, on any laptop. */}
      <div className="commitments-bar fixed inset-x-0 bottom-0 z-10 px-4 py-4">
        <div className="mx-auto flex w-full max-w-[660px] flex-wrap items-center gap-3">
          {alreadyAccepted ? (
            <>
              <Link href={next} className="commitments-cta inline-flex items-center justify-center rounded-[7px] px-[26px] py-[14px] text-[14.5px] font-[650]">
                Take me to my workspace
              </Link>
              <span className="commitments-onfield text-xs opacity-80">You accepted this version on record.</span>
            </>
          ) : (
            <button disabled={busy || !status} onClick={accept}
              className="commitments-cta inline-flex items-center justify-center rounded-[7px] px-[26px] py-[14px] text-[14.5px] font-[650] disabled:opacity-40">
              {busy ? 'Recording…' : 'Take me to my workspace'}
            </button>
          )}
          {err && <span className="commitments-onfield text-xs">{err}</span>}
        </div>
      </div>
    </div>
  );
}

export default function CommitmentsPage() {
  return <Suspense fallback={null}><CommitmentsInner /></Suspense>;
}
