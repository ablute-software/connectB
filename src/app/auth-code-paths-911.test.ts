// Prompt 911 (A) — "every path that creates an account with email and password confirms it with a code". The pages are
// client components that need a browser to click through (no DOM library in this repo), so this guards the wiring itself,
// reading the sources: which files may call auth.signUp(), that each sign-up page sends the code FIRST and only falls back
// to the link flow when the routes answer "off", that a reload restores the code step, and that no auth screen prints a raw
// provider error. If someone adds a fourth sign-up path, this fails until it is on the code flow.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const norm = (p: string) => p.replace(/\\/g, '/');

const SIGNUP_PAGES = [
  { name: 'founder sign-up', file: 'src/app/signup/page.tsx', flow: "'signup'", legacyAction: "'signup'" },
  { name: 'team invite', file: 'src/app/invite/[token]/page.tsx', flow: "'invite'", legacyAction: "'invite_signup'" },
  { name: 'incubator team invite', file: 'src/app/invite/incubator/member/[token]/page.tsx', flow: "'member'", legacyAction: "'invite_signup'" },
];

describe('every account-creating path', () => {
  it('the only places that call signUp() are the three pages (as the link fallback) and the server port of the code flow', () => {
    const callers = walk('src').filter((f) => /\.signUp\(/.test(read(f))).map(norm).sort();
    expect(callers).toEqual([
      'src/app/invite/[token]/page.tsx',
      'src/app/invite/incubator/member/[token]/page.tsx',
      'src/app/signup/page.tsx',
      'src/lib/auth-code/supabase-ports.ts',
    ]);
  });

  for (const p of SIGNUP_PAGES) {
    describe(p.name, () => {
      const src = read(p.file);
      it('sends the code first and shows the code box on the same page', () => {
        expect(src).toContain('registerWithCode(');
        expect(src).toContain('<EmailCodeConfirm');
        expect(src.indexOf('registerWithCode(')).toBeLessThan(src.indexOf('.signUp('));
      });
      it('falls back to the link-only flow only when the code routes are off (AUTH_CODE_MODE=off), and reports a refusal', () => {
        expect(src).toMatch(/kind === 'off'/);
        expect(src).toContain(`reportAuthEmailFailure({`);
        expect(src).toContain(`action: ${p.legacyAction}`);
      });
      it('a reload comes back to the code box: it reads the pending entry on mount and writes it when the code is sent', () => {
        expect(src).toContain(`readPending(${p.flow},`);
        expect(src).toContain(`writePending({ flow: ${p.flow},`);
        expect(src).toContain(`clearPending(${p.flow})`);
      });
      it('never stores the password', () => {
        for (const m of src.matchAll(/writePending\(\{[\s\S]*?\}\);/g)) expect(m[0]).not.toMatch(/password/i);
      });
    });
  }

  it('the incubator team invite creates its account as an incubator member (the server decides what the account is)', () => {
    expect(read('src/app/invite/incubator/member/[token]/page.tsx')).toContain("intent: 'incubator_member'");
  });

  it('password recovery stays by link: the page does not use the code box, and still sends the reset link', () => {
    const src = read('src/app/forgot-password/page.tsx');
    expect(src).toContain('resetPasswordForEmail');
    expect(src).not.toContain('EmailCodeConfirm');
    expect(src).not.toContain('registerWithCode');
  });
});

describe('no authentication screen prints a raw provider error', () => {
  const SCREENS = [
    'src/app/signup/page.tsx', 'src/app/login/page.tsx', 'src/app/forgot-password/page.tsx', 'src/app/reset-password/page.tsx',
    'src/app/set-password/page.tsx', 'src/app/invite/[token]/page.tsx', 'src/app/invite/incubator/member/[token]/page.tsx',
    'src/components/auth/InvestorSignInForm.tsx', 'src/components/auth/EmailCodeConfirm.tsx', 'src/components/auth/CodeStep.tsx',
  ];
  it.each(SCREENS)('%s', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/set(Msg|Err|CodeErr|Error|Notice)\(\s*(error|err)\.message\s*\)/);
    expect(src).not.toMatch(/JSON\.stringify\((error|err|json|body)\)/);
  });
});
