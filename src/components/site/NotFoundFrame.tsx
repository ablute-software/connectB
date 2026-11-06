'use client';
// Prompt 933 — the public header and footer around the 404 card. The Shell draws this, and only when the page on screen is the one of an address that matches no route (it loads this file with next/dynamic):
// PublicSiteLayout brings the landing's stylesheet and two font families, which no other screen of the app may pay for, and a client module is the only kind a client component (the Shell) can pull in lazily.
// `signedIn` is the Shell's own answer from /api/me: a person with a session sees "Open workspace" where a visitor sees "Sign in" and "Create account".
import type { ReactNode } from 'react';
import { PublicSiteLayout } from './PublicSiteLayout';

export function NotFoundFrame({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  return <PublicSiteLayout signedIn={signedIn} fill>{children}</PublicSiteLayout>;
}
