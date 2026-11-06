// Prompt 933 — what src/app/not-found.tsx shows: the answer to an address that matches nothing. Static text and two links, no hooks: Next puts the not-found element of the root layout into the data of EVERY page
// of the app, so whatever is here is paid by all of them, and the header and footer are kept out of it on purpose (the Shell draws those, only when this page is the one on screen — see NotFoundFrame).
//
// The words are Nuno's call (Prompt 933 asks for two or three alternatives): the lead says what happened in plain terms, and "404" and "not found" come last, small, for whoever has to quote them. The two
// actions are the ones the prompt names: back to the product's front door ("/" sends a signed-in visitor on to where they work, the landing handles that), and a way to tell us when the link should have worked.
import Link from 'next/link';
import { LogoMark } from '@/components/Logo';
import { BRAND_NAME } from '@/lib/brand';
import s from './not-found.module.css';

export function NotFoundCard() {
  return (
    <div className={`${s.nf} ${s.root}`}>
      <LogoMark size={64} className={s.mark} />
      <h1 className={s.title}>No leads here<span className={s.stop} aria-hidden="true" /></h1>
      <p className={s.lead}>That address doesn’t match anything on {BRAND_NAME}. It may have been mistyped, or the link may be old.</p>
      <div className={s.actions}>
        <Link href="/" className={s.primary}>Back to {BRAND_NAME}</Link>
        <Link href="/contact" className={s.secondary}>Report a problem</Link>
      </div>
      <p className={s.code}>Error 404 · Page not found</p>
    </div>
  );
}
