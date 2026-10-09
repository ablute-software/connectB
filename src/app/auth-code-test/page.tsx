// Prompt 904 Part B — the ONLY place the code-registration component is mounted until Stage 1.
// It does not exist for anyone else: AUTH_CODE_MODE unset/off -> 404, and even with the switch
// on, only a signed-in platform admin gets the page (everyone else sees the same 404). The
// routes behind it have their own gate (the email allowlist), so reaching them directly does
// not bypass this.
//
// Heads-up for whoever tests: a successful registration signs the browser in AS THE NEW
// ACCOUNT, replacing this admin session. Sign in as admin again afterwards.
import { notFound } from 'next/navigation';
import { authCodeMode } from '@/lib/auth-code/mode';
import { authEnabled, resolveRole, serverClient } from '@/lib/supabase-server';
import { EmailCodeSignup } from '@/components/auth/EmailCodeSignup';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Code registration test', robots: { index: false, follow: false } };

export default async function AuthCodeTestPage() {
  if (authCodeMode() === 'off') notFound();
  // Demo mode (no Supabase env): there is no admin to check and no account to create — the
  // page only exists so the screens can be looked at.
  if (authEnabled) {
    const sb = await serverClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) notFound();
    const role = await resolveRole(user.id, user.email, sb, user.email_confirmed_at);
    if (role !== 'developer') notFound();
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="space-y-4">
        <p className="text-center text-xs text-gray-500">Test page — registration with password and 6-digit code (Prompt 904)</p>
        <EmailCodeSignup />
      </div>
    </main>
  );
}
