// Prompt 911 (addendum) — the real ports hand Supabase the emailRedirectTo of the path that registered, on the first email AND on a
// resend (a new email must bring the person back to the same place). The Supabase client is replaced; only what is passed is checked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const signUp = vi.fn(async (_a: unknown) => ({ error: null }));
const resend = vi.fn(async (_a: unknown) => ({ error: null }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { signUp, resend, admin: {} }, rpc: vi.fn() }) }));
vi.mock('@/lib/supabase-server', () => ({ serverClient: vi.fn() }));
vi.mock('@/lib/resend', () => ({ sendTransactionalEmail: vi.fn(), transactionalTemplate: vi.fn() }));

import { makeSupabasePorts } from './supabase-ports';

const PROFILE = { fullName: 'Ana', startup: 'S', country: 'PT', role: 'CEO' };

beforeEach(() => {
  signUp.mockClear(); resend.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

describe('emailRedirectTo reaches Supabase', () => {
  it('on the first email: the platform, an invite, or the call page the applicant was on', async () => {
    const ports = makeSupabasePorts({} as never);
    for (const url of ['https://www.sherlockdeal.com/', 'https://www.sherlockdeal.com/invite/abc', 'https://www.sherlockdeal.com/call/x/form/3']) {
      signUp.mockClear();
      await ports.createAccountAndSendCode('a@b.co', PROFILE, { intent: null, redirectTo: url });
      expect((signUp.mock.calls[0][0] as { options: { emailRedirectTo: string } }).options.emailRedirectTo).toBe(url);
    }
  });

  it('on a resend, so the new email returns to the same place', async () => {
    await makeSupabasePorts({} as never).resendCode('a@b.co', { intent: null, redirectTo: 'https://www.sherlockdeal.com/invite/abc' });
    expect(resend.mock.calls[0][0]).toMatchObject({ type: 'signup', email: 'a@b.co', options: { emailRedirectTo: 'https://www.sherlockdeal.com/invite/abc' } });
  });

  it('an incubator team member is born with signup_intent, next to the redirect', async () => {
    await makeSupabasePorts({} as never).createAccountAndSendCode('m@b.co', PROFILE, { intent: 'incubator_member', redirectTo: 'https://www.sherlockdeal.com/invite/incubator/member/pending' });
    const arg = signUp.mock.calls[0][0] as { options: { emailRedirectTo: string; data: Record<string, unknown> } };
    expect(arg.options.data.signup_intent).toBe('incubator_member');
    expect(arg.options.data.password_set).toBe(false);
    expect(arg.options.emailRedirectTo).toContain('/invite/incubator/member/pending');
  });
});
