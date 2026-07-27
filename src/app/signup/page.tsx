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

const STAGES = [
  { value: '', label: 'Stage…' },
  { value: 'pre_seed', label: 'Pre-seed' },
  { value: 'seed', label: 'Seed' },
  { value: 'series_a', label: 'Series A' },
  { value: 'later', label: 'Later' },
];

function InvestorSignupPanel() {
  const [email, setEmail] = useState('');
  const [firmName, setFirmName] = useState('');
  const [note, setNote] = useState('');
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
      </div>
    </AuthShell>
  );
}

function FounderSignupForm() {
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
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const canSubmit = !busy && !!email && !!password && !!org && !!name && !!title;

  async function submit() {
    setBusy(true); setMsg('');
    try {
      const sb = browserClient();
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { full_name: name, org_name: org } },
      });
      if (error) { setMsg(error.message); return; }
      // Provision org + membership (server route uses service role).
      const res = await fetch('/api/provision-org', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: data.user?.id, org_name: org, email,
          website, sector, stage, round_target_eur: roundTarget ? Number(roundTarget) : undefined,
          country, one_liner: oneLiner,
          full_name: name, title, phone, linkedin_url: linkedin,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (body && body.ok === false) { setMsg(body.error ?? 'Could not provision your org.'); return; }
      if (data.session) { window.location.href = '/'; }
      else setMsg('Account created. Check your email to confirm, then sign in.');
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
          className="mb-4 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />

        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">You</div>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name *"
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Role / cargo *"
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
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="Password (min 8 chars) *"
          className="mb-4 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />

        <button disabled={!canSubmit} onClick={submit}
          className="w-full rounded-xl bg-[#0E7490] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
          {busy ? 'Creating…' : 'Create account'}
        </button>
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
