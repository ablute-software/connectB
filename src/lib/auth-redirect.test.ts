// Prompt 911 (addendum) — where the sign-up email's link brings the person back to. {{ .RedirectTo }} is a FULL url that arrives in a
// query string; it must only ever be followed as a path of this site.
import { describe, expect, it } from 'vitest';
import { OWN_HOSTS, confirmDestination, redirectUrl, safeRedirectPath } from './auth-redirect';

const ORIGIN = 'https://www.sherlockdeal.com';

describe('safeRedirectPath — what a sign-up page may ask for', () => {
  it('accepts a path of this site: the platform, an invite, a call and the page the applicant was on', () => {
    for (const p of ['/', '/pipeline', '/invite/abc123', '/invite/incubator/member/pending', '/call/Zk4f03abc5d43b4d5e899', '/call/Zk4f03abc5d43b4d5e899/form/3', '/call/x/form?page=2']) {
      expect(safeRedirectPath(p)).toBe(p);
    }
  });

  it('refuses anything that is not a plain path of this site', () => {
    for (const p of [
      'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'pipeline', '', ' /pipeline', '/a b', '/a\nb',
      '/call/x?a=1&b=2', '/call/x#frag', '/api/me', '/api', '/' + 'x'.repeat(400), null, undefined, 42, {},
    ]) {
      expect(safeRedirectPath(p as never)).toBeNull();
    }
  });
});

describe('redirectUrl — the emailRedirectTo each path hands to Supabase', () => {
  it('is the origin plus the validated path, and the platform by default', () => {
    expect(redirectUrl(ORIGIN, '/invite/abc')).toBe('https://www.sherlockdeal.com/invite/abc');
    expect(redirectUrl(`${ORIGIN}/`, '/call/x/form/2')).toBe('https://www.sherlockdeal.com/call/x/form/2');
    expect(redirectUrl(ORIGIN, undefined)).toBe('https://www.sherlockdeal.com/');
    expect(redirectUrl(ORIGIN, 'https://evil.example')).toBe('https://www.sherlockdeal.com/');
  });
});

describe('confirmDestination — what /auth/confirm does with next={{ .RedirectTo }}', () => {
  it('follows a full URL of our own host as its path (the link always lands on the Site URL)', () => {
    expect(confirmDestination('https://www.sherlockdeal.com/', ORIGIN)).toBe('/');
    expect(confirmDestination('https://www.sherlockdeal.com/invite/abc', ORIGIN)).toBe('/invite/abc');
    expect(confirmDestination('https://sherlockdeal.com/call/x/form/3?step=2', ORIGIN)).toBe('/call/x/form/3?step=2');
    expect(confirmDestination('https://connect-b-delta.vercel.app/pipeline', ORIGIN)).toBe('/pipeline');
    expect(OWN_HOSTS).toContain('sherlockdeal.com');
  });

  it('a bare site URL (Supabase\'s default when no emailRedirectTo was given) goes to the platform root', () => {
    expect(confirmDestination('https://www.sherlockdeal.com', ORIGIN)).toBe('/');
  });

  it('keeps a relative path (the old templates sent next=%2Fset-password) and the fallback when there is none', () => {
    expect(confirmDestination('/set-password', ORIGIN)).toBe('/set-password');
    expect(confirmDestination(null, ORIGIN)).toBe('/pipeline');
    expect(confirmDestination('', ORIGIN, '/')).toBe('/');
  });

  it('never follows another site: the fallback instead', () => {
    for (const n of ['https://evil.example/pipeline', 'http://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'https://www.sherlockdeal.com.evil.example/x', 'data:text/html,hi', 'not a url']) {
      expect(confirmDestination(n, ORIGIN)).toBe('/pipeline');
    }
  });

  it('the host the page is on is trusted too, for local work', () => {
    expect(confirmDestination('http://localhost:3000/invite/abc', 'http://localhost:3000')).toBe('/invite/abc');
    expect(confirmDestination('http://localhost:3001/x', 'http://localhost:3000')).toBe('/pipeline');
  });
});
