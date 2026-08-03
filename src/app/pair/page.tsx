'use client';
// MatchDeal QR pairing v2 — app.sherlockdeal.com/pair. This is the real
// PWA destination the QR code always points to now (spec: "o URL abre
// sempre a PWA... que faz o emparelhamento", never a store redirect that
// has nowhere real to send anyone — MatchDeal isn't published yet). Once
// a native app exists with Universal Links registered on this same
// domain, the OS intercepts the URL before it ever reaches this page —
// no code change needed here when that happens.
//
// MD-08: this screen used to render inside the founder CRM Shell, which
// on a phone meant a sticky "ablute_" header, the outreach caps pill, a
// "+ Log interaction" button and a horizontally-scrolling CRM nav bar
// wrapped around a small white card — i.e. "sherlockdeal.com badly
// scaled", not MatchDeal. /pair is now a standalone route (see the
// early-return list in shell.tsx) and owns its full viewport: dark
// surface, MatchDeal wordmark, deck edge-to-edge, safe-area insets so it
// survives a notch and a home indicator when installed to the home
// screen.
import { useCallback, useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase';
import { MatchDealShell } from '@/components/matchdeal/MatchDealShell';
import { InstallPrompt } from '@/components/matchdeal/InstallPrompt';
import { detectMobileClient } from '@/lib/is-mobile-client';

type Stage = 'checking' | 'need_login' | 'launch_gate' | 'consuming' | 'paired' | 'error';
// Prompt 82 — checked before anything else on this route. UX gate only
// (see is-mobile-client.ts's own header) — a spoofed UA still reaches the
// deck, and that's an accepted, explicitly-scoped gap, not an oversight.
type DeviceCheck = 'checking' | 'mobile' | 'desktop';

const DEVICE_ID_KEY = 'sherlockdeal_pwa_device_id';

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_ID_KEY, id); }
  return id;
}

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="flex items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 via-emerald-500 to-orange-400 text-white shadow-lg"
        style={{ width: compact ? 30 : 42, height: compact ? 30 : 42, fontSize: compact ? 15 : 21 }}
      >
        🤝
      </span>
      <span
        className={`font-extrabold tracking-tight text-white ${compact ? 'text-[17px]' : 'text-[24px]'}`}
        style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}
      >
        Match<span className="bg-gradient-to-r from-emerald-300 to-orange-300 bg-clip-text text-transparent">Deal</span>
      </span>
    </div>
  );
}

export default function PairPage() {
  const [device, setDevice] = useState<DeviceCheck>('checking');
  const [stage, setStage] = useState<Stage>('checking');
  const [token, setToken] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [kind, setKind] = useState<'startup' | 'investor' | null>(null);
  const [ownProfileId, setOwnProfileId] = useState<string | null>(null);
  const [pairedAt, setPairedAt] = useState<string | null>(null);
  // Mini-prompt 2026-08-03 — /pair's own login step, no password ever, for
  // either founder or investor accounts. The old "Sign in" link went to
  // /login with no ?as=investor, so it always showed the founder
  // email+password form regardless of which kind was actually pairing.
  // Reuses the same signInWithOtp/verifyOtp mechanism /login?as=investor
  // already has, just inline on this screen instead of navigating away.
  // Prompt 114 — this login step is now ONLY reachable via the no-token
  // "Open MatchDeal on this device" path (§5, below): a QR/token pairing no
  // longer needs it at all, since the token itself authenticates. There is
  // no longer a wrong-account check to fall back on for the token path —
  // that trade was made explicitly (Prompt 114 §4): the token's own
  // properties (opaque, single-use, 5-minute TTL, shown physically on the
  // desktop screen) are the entire protection now, the same trust level
  // any email magic link already has.
  const [loginEmail, setLoginEmail] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginMsg, setLoginMsg] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [showCodeEntry, setShowCodeEntry] = useState(false);
  const [loginCode, setLoginCode] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeErr, setCodeErr] = useState('');

  useEffect(() => {
    setDevice(detectMobileClient() ? 'mobile' : 'desktop');
  }, []);

  // Prompt 84 — pulled out of the mount effect so "Check again" and the
  // visibility-change re-check (below) can call the exact same self-check
  // instead of duplicating it. This is the fix for the actual reported
  // symptom: resolution used to run exactly once per page load and never
  // retry, so if it resolved null the moment before a profile finished
  // being filled in (or, per the addenda, resolved the WRONG kind), the
  // installed PWA stayed stuck on a stale result until someone force-
  // reloaded — which nothing in that screen ever prompted them to do.
  const recheckSelf = useCallback(async () => {
    setStage('consuming');
    try {
      const res = await fetch(`/api/matchdeal/pairing/self?deviceId=${encodeURIComponent(getOrCreateDeviceId())}`);
      const body = await res.json();
      if (!body.ok || !body.kind) { setErrorMsg('No linked MatchDeal profile for this account.'); setStage('error'); return; }
      setKind(body.kind); setOwnProfileId(body.ownProfileId ?? null); setPairedAt(null);
      setStage('paired');
    } catch {
      setErrorMsg('Network error — try again.'); setStage('error');
    }
  }, []);

  useEffect(() => {
    if (device !== 'mobile') return; // desktop never reaches the auth/pairing flow below
    const t = new URLSearchParams(window.location.search).get('token');
    setToken(t);

    (async () => {
      // Prompt 114 Fase 1 — a token in the URL is consumed FIRST, before any
      // getUser()/need_login check: the whole point is a phone that has
      // never signed in anywhere. 'need_login' must never appear on a
      // valid-token path.
      if (t) {
        setStage('consuming');
        try {
          const res = await fetch('/api/matchdeal/pairing/consume', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: t, deviceId: getOrCreateDeviceId() }),
          });
          const body = await res.json();
          if (!body.ok) { setErrorMsg(body.error ?? 'Could not pair.'); setStage('error'); return; }

          // Hydrate the session the server just issued for the token's own
          // owner before touching anything session-gated below (launch-gate
          // reads the session via its own serverClient() call).
          if (body.session) {
            await browserClient().auth.setSession({
              access_token: body.session.access_token, refresh_token: body.session.refresh_token,
            });
          }

          try {
            const gateRes = await fetch('/api/matchdeal/launch-gate');
            const gateBody = await gateRes.json();
            if (!gateBody.allowed) { setStage('launch_gate'); return; }
          } catch {
            setErrorMsg('Network error — try again.'); setStage('error'); return;
          }

          setKind(body.kind); setOwnProfileId(body.ownProfileId ?? null); setPairedAt(body.pairedAt);
          setStage('paired');
        } catch {
          setErrorMsg('Network error — try again.'); setStage('error');
        }
        return;
      }

      // No token — Prompt 75's "Open MatchDeal on this device" path. Left
      // exactly as it was (Prompt 114 §5 is still an open question — see
      // the report — and explicitly must not be removed by inference).
      const { data: { user } } = await browserClient().auth.getUser();
      if (!user) { setStage('need_login'); return; }

      // Prompt 92 — launch gate. Checked right after login, before the
      // self-check, so a non-@ablute.pt account never reaches the deck
      // (which today only has fictional demo data).
      try {
        const gateRes = await fetch('/api/matchdeal/launch-gate');
        const gateBody = await gateRes.json();
        if (!gateBody.allowed) { setStage('launch_gate'); return; }
      } catch {
        setErrorMsg('Network error — try again.'); setStage('error'); return;
      }

      // This IS the account's own already-signed-in browser, viewing its
      // own deck, not a new device joining via QR. Resolve the profile
      // directly instead of erroring "Missing pairing code" — that error
      // was a genuine dead end for the one path meant as the demo's
      // emergency fallback.
      await recheckSelf();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  // Prompt 84 — the installed PWA can sit backgrounded (not reloaded) for
  // hours between "isn't set up yet" and the profile actually becoming
  // resolvable; re-check automatically the moment it's foregrounded again,
  // instead of only ever checking once at mount. Scoped to exactly the
  // stuck state (paired + no profile) so it doesn't re-fire pointless
  // requests from every other screen.
  useEffect(() => {
    if (!(stage === 'paired' && !ownProfileId)) return;
    function onVisible() { if (document.visibilityState === 'visible') void recheckSelf(); }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [stage, ownProfileId, recheckSelf]);

  async function sendMagicLink() {
    setLoginBusy(true); setLoginMsg('');
    try {
      const nextParam = token ? `/pair?token=${token}` : '/pair';
      const { error } = await browserClient().auth.signInWithOtp({
        email: loginEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextParam)}`,
          // false, unlike /login?as=investor's deliberate true: /pair only
          // ever pairs a SECOND device onto an account that already exists
          // (the one that generated the QR) — silently creating a phantom
          // account for a mistyped email here would just leave stray rows
          // behind, not help anyone.
          shouldCreateUser: false,
        },
      });
      if (error) { setLoginMsg(error.message); return; }
      setMagicLinkSent(true);
    } finally {
      setLoginBusy(false);
    }
  }

  async function verifyLoginCode() {
    setCodeErr(''); setCodeBusy(true);
    try {
      const { error } = await browserClient().auth.verifyOtp({ email: loginEmail, token: loginCode, type: 'email' });
      if (error) { setCodeErr(error.message); return; }
      // Already on the right URL (token, if any, is still in the query
      // string) — a reload is enough to let the mount effect above re-run
      // now that the session exists, same as /login's own window.location
      // navigation accomplishes by landing back on this same page.
      window.location.reload();
    } finally {
      setCodeBusy(false);
    }
  }

  // Prompt 82 — checked before the auth/pairing flow above ever runs, so a
  // desktop browser never even reaches "Checking your session…" or spends
  // a pairing token. 'checking' renders nothing (not even the wordmark)
  // for the one client-render tick before navigator.userAgent is read, to
  // avoid a flash of the deck-shell chrome on a desktop that's about to
  // get turned away.
  if (device === 'checking') {
    return <div className="min-h-[100dvh] bg-[#0B1220]" />;
  }
  if (device === 'desktop') {
    return (
      <div
        className="relative flex w-full min-h-[100dvh] flex-col items-center justify-center bg-[#0B1220] px-6 text-center text-white"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <Wordmark />
        <div className="mt-7 w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.07] p-6 backdrop-blur-xl">
          <div className="text-3xl">📱</div>
          <h1 className="mt-2 text-[17px] font-bold text-white">MatchDeal only opens on your phone</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-white/65">
            Scan the QR code from Sherlock Deal, or open this same link on your mobile — MatchDeal
            isn&apos;t available in a desktop browser.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex w-full flex-col overflow-hidden bg-[#0B1220] text-white"
      style={{
        minHeight: '100dvh',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Ambient colour — the same blue/green/orange the MatchDeal button
          in the app header cycles through, so the phone screen and the
          desktop entry point read as one product. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-blue-600/25 blur-3xl" />
        <div className="absolute -right-20 top-1/3 h-64 w-64 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute -bottom-24 left-1/4 h-72 w-72 rounded-full bg-orange-500/20 blur-3xl" />
      </div>

      {stage !== 'paired' ? (
        <div className="relative flex flex-1 flex-col items-center justify-center px-6 py-10">
          <Wordmark />
          <div className="mt-7 w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.07] p-6 text-center backdrop-blur-xl">
            {stage === 'checking' && <p className="text-sm text-white/60">Checking your session…</p>}

            {stage === 'need_login' && (
              <>
                <h1 className="text-[19px] font-bold text-white">Pair this device</h1>
                <p className="mt-2 text-[13.5px] leading-relaxed text-white/65">
                  Sign in with the same account you use on sherlockdeal.com to finish pairing — no password needed here.
                </p>

                <input
                  value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} type="email" placeholder="you@company.com"
                  className="mt-4 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/30"
                />

                {magicLinkSent ? (
                  <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left text-[12px] text-white/70">
                    <p>We sent a sign-in link and a 6-digit code to {loginEmail}.</p>
                    <p className="mt-1 text-white/50">Tap the link on this device, or enter the code below.</p>
                    <button onClick={() => { setMagicLinkSent(false); setLoginMsg(''); }} className="mt-1 text-white/40 hover:underline">
                      Not you? Start over
                    </button>
                  </div>
                ) : (
                  <button
                    disabled={loginBusy || !loginEmail} onClick={() => void sendMagicLink()}
                    className="mt-3 w-full rounded-2xl bg-gradient-to-r from-blue-500 to-emerald-500 px-4 py-3 text-sm font-bold text-white shadow-lg transition active:scale-[.98] disabled:opacity-40"
                  >
                    {loginBusy ? 'Sending…' : 'Email me a sign-in link'}
                  </button>
                )}

                {showCodeEntry ? (
                  <div className="mt-3 border-t border-white/10 pt-3 text-left">
                    <label className="mb-1 block text-[11px] font-medium text-white/50">6-digit code from the email</label>
                    <input
                      value={loginCode} onChange={(e) => setLoginCode(e.target.value)} placeholder="123456" inputMode="numeric"
                      className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30"
                    />
                    <button
                      onClick={() => void verifyLoginCode()} disabled={!loginEmail || !loginCode || codeBusy}
                      className="mt-2 w-full rounded-xl bg-white/10 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      {codeBusy ? 'Checking…' : 'Use code'}
                    </button>
                    {codeErr && <p className="mt-2 text-[12px] text-rose-300">{codeErr}</p>}
                  </div>
                ) : (
                  <button onClick={() => setShowCodeEntry(true)} className="mt-2 block w-full text-center text-[12px] text-white/40 hover:underline">
                    Have a sign-in code instead?
                  </button>
                )}

                {loginMsg && <p className="mt-2 text-[12px] text-rose-300">{loginMsg}</p>}
              </>
            )}

            {stage === 'launch_gate' && (
              <>
                <div className="text-3xl">🚀</div>
                <h1 className="mt-2 text-[19px] font-bold text-white">MatchDeal launches in September 2026</h1>
                <p className="mt-2 text-[13.5px] leading-relaxed text-white/65">
                  Check back soon — we&apos;re not quite ready for you yet.
                </p>
              </>
            )}

            {stage === 'consuming' && (
              <>
                <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-emerald-400" />
                <p className="mt-3 text-sm text-white/60">Pairing this device…</p>
              </>
            )}

            {stage === 'error' && (
              <>
                <div className="text-3xl">⚠️</div>
                <p className="mt-2 text-[14px] font-medium text-white">{errorMsg}</p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-white/55">
                  Go back to sherlockdeal.com and generate a new code from the MatchDeal button.
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="relative flex flex-1 flex-col">
          <InstallPrompt />
          <header className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3">
            <Wordmark compact />
            <span
              className="flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300"
              title={pairedAt ? `Paired on ${new Date(pairedAt).toLocaleDateString()}` : undefined}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {pairedAt ? 'Paired' : 'This device'}
            </span>
          </header>

          {ownProfileId && kind ? (
            <MatchDealShell viewerProfileId={ownProfileId} viewerKind={kind} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <div className="text-4xl">👤</div>
              <p className="mt-3 text-[15px] font-semibold text-white">Your MatchDeal profile isn&apos;t set up yet</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
                Finish it on sherlockdeal.com and this screen will start showing candidates.
              </p>
              {/* Prompt 84 — already refreshed automatically when this tab
                  is foregrounded (see the visibilitychange effect above);
                  this is the explicit fallback for a browser/PWA that
                  doesn't fire that event reliably. */}
              <button onClick={() => void recheckSelf()}
                className="mt-4 rounded-2xl border border-white/15 px-4 py-2 text-[13px] font-medium text-white/80 hover:bg-white/5">
                Check again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
