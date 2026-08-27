'use client';
// Founder sign-up: creates the auth user, then an org + owner membership via
// an API route. NEXT_STEPS Phase 2 — collects the startup + person profile
// fields up front so a new org doesn't start as a bare name.
//
// ?as=investor renders a different panel: investors aren't self-serve today
// (access is an access_grants row a founder creates for their email, per
// resolveRole in supabase-server.ts) — that part is real and unchanged, "Sign
// in with your granted email" still points at /portal. What used to sit above
// it was a dead end for everyone else: 5 CTAs across the /investors landing
// (hero, claim, features, closing band, footer) all land here, and the only
// options were "sign in" (doesn't apply, no grant yet) or leave. Replaced
// with a real request-access form — /api/investor-access-request — that
// captures the lead for manual follow-up. Not self-signup (still doesn't
// promise instant access), but no longer a wall.
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { browserClient, authEnabled } from '@/lib/supabase';
import { LogoLockup } from '@/components/Logo';
import { AuthShell } from '@/components/auth/AuthShell';
import { PasswordRequirementsIndicator } from '@/components/auth/PasswordRequirementsIndicator';
import { checkPassword } from '@/lib/password-policy';

const STAGES = [
  { value: '', label: 'Stage…' },
  { value: 'pre_seed', label: 'Pre-seed' },
  { value: 'seed', label: 'Seed' },
  { value: 'series_a', label: 'Series A' },
  { value: 'later', label: 'Later' },
];

// Prompt 124 C1 — acquisition_source distribution, per the metrics spec's
// own V1 scope (§7.1: "Organic, Referral, Campaign, Partner, Direct,
// Other"). A UTM param present at signup (utm_source/utm_campaign, kept
// verbatim as free-text detail) always wins over the self-reported pick —
// it's the more reliable signal when both exist.
const ACQUISITION_SOURCES = ['', 'Organic', 'Referral', 'Campaign', 'Partner', 'Direct', 'Other'];

function InvestorSignupPanel() {
  // Prompt 154 gap 3 — prefilled when this panel is reached from a Data
  // Room guest preview link (/signup?as=investor&email=…&note=…): the
  // guest already has a real access_grants row (invited_email + a used
  // guest_token), so their request here isn't a cold lead — the prefilled
  // note tells back-office reviewers that context instead of losing it.
  const sp = useSearchParams();
  const [email, setEmail] = useState(() => sp.get('email') ?? '');
  const [firmName, setFirmName] = useState('');
  const [note, setNote] = useState(() => sp.get('note') ?? '');
  const [website, setWebsite] = useState(''); // honeypot — never shown to real visitors
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    if (!email.trim()) { setErr('Enter your email.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/investor-access-request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firm_name: firmName, note, website }),
      });
      const body = await res.json().catch(() => ({}));
      if (body && body.ok === false) { setErr(body.error ?? 'Could not send the request.'); return; }
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-7 shadow-2xl">
        <div className="mb-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          <LogoLockup size={28} accentClassName="text-[#2a7f8e]" />
        </div>
        <p className="mb-5 text-sm text-gray-500">Investor access on Sherlock Deal</p>

        {sent ? (
          <div className="rounded-xl border border-cyan-100 bg-[#E8F4F8] px-3.5 py-3 text-sm text-[#0E7490]">
            Request received — we&apos;ll confirm your access by email.
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600">
              Investor accounts aren&apos;t self sign-up yet. Tell us who you are and we&apos;ll follow up
              to confirm access — or if a founder has already granted you access, sign in below.
            </p>
            <div className="mt-4 space-y-2.5">
              <input type="email" placeholder="you@fund.com *" value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
              <input type="text" placeholder="Firm name (optional)" value={firmName} onChange={(e) => setFirmName(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
              <textarea placeholder="Anything that helps us route this — e.g. “I'm a partner at X, looking for deals in Y” (optional)"
                value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
              {/* Honeypot — hidden from real visitors via CSS, not `type=hidden`
                  (some bots skip those); ContactForm.tsx uses the same pattern. */}
              <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1} autoComplete="off"
                className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden="true" />
            </div>
            {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
            <button onClick={submit} disabled={busy}
              className="mt-3 w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
              {busy ? 'Sending…' : 'Request access'}
            </button>
            <Link href="/login?as=investor"
              className="mt-2.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-center text-sm font-medium text-gray-600 hover:bg-gray-50">
              Sign in with your granted email
            </Link>
          </>
        )}

        <div className="mt-5 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">
          Raising a round? <Link href="/signup" className="font-medium text-[#0E7490] hover:underline">Create a founder account</Link>
        </div>
        {/* Prompt 341 — availability BEFORE contracting is a legal
            requirement, not cosmetic (DL 7/2004). */}
        <p className="mt-3 text-center text-[11px] text-gray-400">
          By creating an account you agree to the <Link href="/terms" target="_blank" className="hover:underline">Terms &amp; Conditions</Link>.
        </p>
      </div>
    </AuthShell>
  );
}

function FounderSignupForm() {
  const sp = useSearchParams();
  // Prompt 124 C1 — UTM wins over the self-reported pick when both exist;
  // read once at mount, not on every render (URL doesn't change mid-form).
  const [howHeard, setHowHeard] = useState('');
  const utmSource = sp.get('utm_source');
  const utmCampaign = sp.get('utm_campaign');

  // Startup (required: name; rest optional — a founder mid-signup may not have
  // every detail handy, and the app tolerates partial data everywhere else).
  const [org, setOrg] = useState('');
  const [website, setWebsite] = useState('');
  const [sector, setSector] = useState('');
  const [stage, setStage] = useState('');
  const [roundTarget, setRoundTarget] = useState('');
  const [country, setCountry] = useState('');
  const [oneLiner, setOneLiner] = useState('');

  // Person (required: full name + role/cargo, per IRM_SPEC Phase 2)
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedin, setLinkedin] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Prompt 404 §B.1 — replaces the old standalone "By creating an account
  // you agree to..." paragraph with two real checkboxes, per the approved
  // mockup. Newsletter is always optional (never enters canSubmit); Terms
  // is the one truly required field on this whole form besides email/
  // password/org/name/title.
  const [wantsNewsletter, setWantsNewsletter] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // Prompt 152 — set once the auth account exists (signUp succeeded), so a
  // failed/ambiguous provision-org call can be retried with the SAME
  // already-created account instead of silently proceeding or dead-ending.
  // `session` is captured here (not read from the original signUp() result
  // later) because that result goes out of scope once this state is set —
  // a retry needs to know, without re-calling signUp(), whether to redirect
  // straight in or show the "check your email" message.
  const [pendingAccount, setPendingAccount] = useState<{ userId: string; session: boolean } | null>(null);

  const canSubmit = !busy && !!email && checkPassword(password).valid && !!org && !!name && !!title && agreedToTerms;

  // Prompt 152 — found live: a real signup left auth.users with a row and
  // zero org_members, because the old code treated a network/parse failure
  // on this call (res.json().catch(() => ({}))) the same as success —
  // `{}.ok === false` is false, so it fell through to "Account created,
  // check your email," indistinguishable from a real success. Every path
  // through this function now either provisions successfully or sets
  // pendingAccount + a message that says so explicitly; nothing falls
  // through silently.
  async function attemptProvision(userId: string): Promise<boolean> {
    try {
      const res = await fetch('/api/provision-org', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId, org_name: org, email,
          website, sector, stage, round_target_eur: roundTarget ? Number(roundTarget) : undefined,
          country, one_liner: oneLiner,
          full_name: name, title, phone, linkedin_url: linkedin,
          // Prompt 404 §B.2 — the founder's own newsletter consent, joined
          // onto org_members (see migration 0255's own comment on why that
          // table, not `people`).
          marketing_opt_in: wantsNewsletter,
          // Prompt 124 C1 — UTM wins when present; the self-reported pick is
          // the fallback signal, never both merged into one ambiguous value.
          acquisition_source: utmSource ? 'Campaign' : howHeard || undefined,
          acquisition_source_detail: utmSource ? `utm_source=${utmSource}${utmCampaign ? `&utm_campaign=${utmCampaign}` : ''}` : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body || body.ok === false) {
        setMsg(`Your account was created, but we couldn't finish setting up your workspace${body?.error ? ` (${body.error})` : ''}. Click Retry.`);
        return false;
      }
      return true;
    } catch {
      setMsg("Your account was created, but we couldn't reach the server to finish setting up your workspace. Check your connection and click Retry.");
      return false;
    }
  }

  // Prompt 404 §B.3 — reuses /api/terms/accept exactly as it already exists
  // (idempotent, resolves TERMS_VERSION server-side) — no second route. Only
  // callable once a real session exists (the route requires an authenticated
  // user); best-effort, same "never block sign-up over this" discipline as
  // provision-org's own materializeNetworkInvitesIfAny. The no-session path
  // (email confirmation required) is a known, documented gap — see the file
  // header note near submit() below.
  async function acceptTerms() {
    await fetch('/api/terms/accept', { method: 'POST' }).catch(() => {});
  }

  async function submit() {
    setBusy(true); setMsg('');
    try {
      const sb = browserClient();
      // Prompt 126 B / 119 §4.3 D3 — same shared policy as investor
      // set-password/reset-password; password_set marks this account as
      // already having one, so it never gets offered the investor-only
      // first-login /set-password screen.
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { full_name: name, org_name: org, password_set: true } },
      });
      if (error) { setMsg(error.message); return; }
      const userId = data.user?.id;
      if (!userId) { setMsg('Something went wrong creating your account — please try again.'); return; }
      const hasSession = !!data.session;
      const provisioned = await attemptProvision(userId);
      if (!provisioned) { setPendingAccount({ userId, session: hasSession }); return; }
      if (hasSession) {
        // Prompt 404 §B.3 — when Supabase requires email confirmation first
        // (no session yet), there's no authenticated user for this route to
        // record against. agreedToTerms already blocked the submit either
        // way; the actual acceptance row is only ever written once a real
        // session exists. Known gap, not solved here (the prompt's own
        // scoping): that confirmed-email first load doesn't call this yet,
        // so that one path has no acceptance row until they hit a screen
        // that does (e.g. this same form again, or a future /set-password-
        // style detour) — flagged, not silently left to look handled.
        await acceptTerms();
        window.location.href = '/';
      } else {
        setMsg('Account created. Check your email to confirm, then sign in.');
      }
    } finally { setBusy(false); }
  }

  async function retry() {
    if (!pendingAccount) return;
    setBusy(true); setMsg('');
    try {
      const provisioned = await attemptProvision(pendingAccount.userId);
      if (!provisioned) return;
      setPendingAccount(null);
      if (pendingAccount.session) {
        await acceptTerms();
        window.location.href = '/';
      } else {
        setMsg('Account created. Check your email to confirm, then sign in.');
      }
    } finally { setBusy(false); }
  }

  return (
    <AuthShell>
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-7 shadow-2xl">
        <div className="mb-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          <LogoLockup size={28} accentClassName="text-[#2a7f8e]" />
        </div>
        <p className="mb-5 text-sm text-gray-500">Create your founder account and start managing your raise.</p>
        {!authEnabled && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Demo mode — sign-up is disabled. <Link href="/pipeline" className="underline">Enter the app</Link>.
          </div>
        )}

        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Startup</div>
        <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Company / startup name *"
          className="mb-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        <div className="mb-2 grid grid-cols-2 gap-2">
          <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website"
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          <input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Sector"
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <select value={stage} onChange={(e) => setStage(e.target.value)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <input value={roundTarget} onChange={(e) => setRoundTarget(e.target.value)} type="number" placeholder="Round target (EUR)"
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country"
          className="mb-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        <input value={oneLiner} onChange={(e) => setOneLiner(e.target.value)} placeholder="One-liner — what you do in one sentence"
          className="mb-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        {!utmSource && (
          <select value={howHeard} onChange={(e) => setHowHeard(e.target.value)}
            className="mb-4 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-600">
            {ACQUISITION_SOURCES.map((s) => <option key={s} value={s}>{s || 'How did you hear about us? (optional)'}</option>)}
          </select>
        )}

        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">You</div>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name *"
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Role *"
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div className="mb-4 grid grid-cols-2 gap-2">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone"
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          <input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="LinkedIn URL"
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        </div>

        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Account</div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@company.com *"
          className="mb-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password *"
          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
        <PasswordRequirementsIndicator password={password} />

        {/* Prompt 404 §B.1 — replaces the old standalone agreement
            paragraph. Two boxes, same visual treatment, approved mockup
            (signup_terms_mockup.png): newsletter opt-in on top (always
            optional, never blocks submit), Terms acceptance below
            (required — the one checkbox canSubmit actually depends on). */}
        <label className="mt-3 flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2.5 text-xs text-gray-500">
          <input type="checkbox" checked={wantsNewsletter} onChange={(e) => setWantsNewsletter(e.target.checked)}
            className="mt-0.5 accent-[#0E7490]" />
          Send me product updates and news by email (optional)
        </label>
        <label className="mt-2 flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2.5 text-sm text-gray-700">
          <input type="checkbox" checked={agreedToTerms} onChange={(e) => setAgreedToTerms(e.target.checked)}
            className="mt-0.5 accent-[#0E7490]" />
          {/* Prompt 341 — availability BEFORE contracting is a legal
              requirement, not cosmetic (DL 7/2004). */}
          I have read and accept the{' '}
          <Link href="/terms" target="_blank" className="font-semibold text-[#0E7490] hover:underline">Terms &amp; Conditions</Link>.
        </label>

        {pendingAccount ? (
          <button disabled={busy} onClick={retry}
            className="mt-3 w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
            {busy ? 'Retrying…' : 'Retry'}
          </button>
        ) : (
          <button disabled={!canSubmit} onClick={submit}
            className="mt-3 w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
            {busy ? 'Creating…' : 'Create account'}
          </button>
        )}
        <p className="mt-2 text-[11px] text-gray-400">* required</p>
        {msg && <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700">{msg}</div>}
        <div className="mt-5 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">
          Already have an account? <Link href="/login" className="font-medium text-[#0E7490] hover:underline">Sign in</Link>
        </div>
      </div>
    </AuthShell>
  );
}

function SignupInner() {
  const sp = useSearchParams();
  return sp.get('as') === 'investor' ? <InvestorSignupPanel /> : <FounderSignupForm />;
}

export default function SignupPage() {
  return <Suspense fallback={null}><SignupInner /></Suspense>;
}
