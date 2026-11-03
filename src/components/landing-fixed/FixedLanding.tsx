'use client';
// Prompt 935 (02/11/2026) — the fixed landing: ONE screen, no page scroll. A photograph whose magnifying glass is the selected place of a wheel, a glass card under it with that place's panel, and a header with the
// audience switch and the account buttons. The approved mockup (v21) is the specification; the geometry is CSS (landing-fixed.css, formulas in src/lib/landing-fixed.ts), the rules of the gestures are in
// src/lib/landing-fixed.ts, and this file is the state machine that joins them: which place is selected, whether the card is raised, which heading is showing, the documents popup and the contact form.
//
// Server and client agree on the first paint: the selected place is the mode's `home`, its panel carries `fx-on` already in the server HTML (Panels.tsx) and the heading is the mode's first line, so hydration
// changes nothing on screen. Everything after that (the wheel turning, the card rising) moves with transform/opacity/height inside boxes whose size does not depend on it: nothing here can shift the layout.
//
// The overlay of the documents popup is NOT portalled to <body>, against the project's usual rule for full-window overlays: its stylesheet is scoped under `.fx-root`, and `.fx-root` itself is the fixed,
// full-window box with no transform, filter, backdrop-filter, perspective, contain or will-change (pinned by landing-fixed.test.ts), so a `position: fixed` child of it is the window's, which is what the rule protects.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { LogoLockup } from '@/components/Logo';
import { WheelIcon } from '@/components/landing-fixed/Icons';
import {
  CONTACT_MIN_MESSAGE, CONTACT_SUBJECTS, CTA, HERO_LINES, MODES, MODE_PATH, SIGN_IN, isDocId,
  type DocId, type HeroLine, type LandingMode,
} from '@/content/site/landing-fixed';
import {
  FIT_MAX, LINE_EVERY_MS, LINE_FOG_MS, WHEEL_MIN_DELTA, cardCanScroll, fitScale, hasMore, jumped, nextLine, ringOffset, stepAllowed, stepIndex, swipeStep,
} from '@/lib/landing-fixed';

// The legal text is only fetched when someone opens the popup.
const LegalChapters = dynamic(() => import('@/components/landing-fixed/LegalChapters'), {
  ssr: false,
  loading: () => <p className="fx-source">Loading…</p>,
});

/** The full page each chapter of the popup comes from ("Open full document"). */
const DOC_PAGE: Record<DocId, string> = {
  terms: '/terms', privacy: '/legal/privacy-notice', suppliers: '/legal/subprocessors', 'data-rights': '/privacy-request', gdpr: '/legal/privacy-notice', 'ai-act': '/terms',
};

const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Heading({ line }: { line: HeroLine }) {
  return <>{line[0]}<em>{line[1]}</em>{line[2] ?? ''}</>;
}

type SendState = 'idle' | 'sending' | 'sent' | 'error';

export function FixedLanding({ initialMode, signedIn, children }: { initialMode: LandingMode; signedIn: boolean; children: React.ReactNode }) {
  const [mode, setMode] = useState<LandingMode>(initialMode);
  const def = MODES[mode];
  const N = def.items.length;
  const [cur, setCur] = useState(def.home);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [contact, setContact] = useState(false);
  const [doc, setDoc] = useState<DocId | null>(null);
  const [line, setLine] = useState(0);
  const [fog, setFog] = useState(false);
  const [jumping, setJumping] = useState<ReadonlySet<number>>(new Set());

  const bodyRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastStep = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  // the handlers below are registered once and must see the current values
  const live = useRef({ cur, N, doc, open, mode });
  live.current = { cur, N, doc, open, mode };

  const item = def.items[cur];
  const lines = HERO_LINES[mode];

  /* ---------- the wheel ---------- */
  const go = useCallback((n: number) => {
    const { N: count, cur: from } = live.current;
    const next = ((n % count) + count) % count;
    // a place that goes round the back of the ring is hidden, moved and shown again: it never slides across the screen
    const before = Array.from({ length: count }, (_, i) => ringOffset(i, from, count));
    const j = new Set<number>();
    for (let i = 0; i < count; i++) if (jumped(before[i], ringOffset(i, next, count), count)) j.add(i);
    setJumping(j);
    setContact(false);
    setOpen(false);
    setCur(next);
  }, []);

  useEffect(() => {
    if (jumping.size === 0) return;
    const a = requestAnimationFrame(() => requestAnimationFrame(() => setJumping(new Set())));
    return () => cancelAnimationFrame(a);
  }, [jumping]);

  const step = useCallback((dir: 1 | -1) => {
    const { doc: openDoc, cur: c, N: count } = live.current;
    if (openDoc) return;
    const ae = document.activeElement;
    if (ae && FIELD_TAGS.has(ae.tagName)) return;
    const now = Date.now();
    if (!stepAllowed(lastStep.current, now)) return;
    lastStep.current = now;
    go(stepIndex(c, dir, count));
  }, [go]);

  // the wheel, the arrow keys and the swipe
  useEffect(() => {
    const body = bodyRef.current;
    const onWheel = (e: WheelEvent) => {
      if (live.current.doc) return;
      const t = e.target as Node | null;
      if (body && t && body.contains(t) && cardCanScroll(e.deltaY, body.scrollTop, body.clientHeight, body.scrollHeight)) return;
      e.preventDefault();
      if (Math.abs(e.deltaY) < WHEEL_MIN_DELTA) return;
      step(e.deltaY > 0 ? 1 : -1);
    };
    let tx: number | null = null; let ty: number | null = null; let inCard = false;
    const onStart = (e: TouchEvent) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; inCard = !!(body && e.target instanceof Node && body.contains(e.target)); };
    const onEnd = (e: TouchEvent) => {
      if (tx === null || ty === null) return;
      const dx = e.changedTouches[0].clientX - tx; const dy = e.changedTouches[0].clientY - ty; tx = ty = null;
      const s = swipeStep(dx, dy, inCard);
      if (s !== 0 && !live.current.doc) step(s);
    };
    const onKey = (e: KeyboardEvent) => {
      if (live.current.doc) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', onWheel); window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd); window.removeEventListener('keydown', onKey);
    };
  }, [step]);

  // a link to #<place> opens on that place
  useEffect(() => {
    const id = decodeURIComponent((window.location.hash || '').replace('#', ''));
    const i = MODES[live.current.mode].items.findIndex((x) => x.id === id);
    if (i >= 0) setCur(i);
  }, []);

  /* ---------- the card ---------- */
  // The type fills the card: the selected panel is measured at a scale from 1 to FIT_MAX and keeps the largest one at which nothing overflows. Not on a phone (the card scrolls there) and not for the contact form.
  const fitType = useCallback(() => {
    const b = bodyRef.current;
    if (!b) return;
    const sec = b.querySelector<HTMLElement>(':scope > section.fx-on');
    if (!sec || sec.dataset.id === 'contact' || window.innerWidth <= 760) { b.style.removeProperty('--fxk'); return; }
    b.scrollTop = 0; // the panel's bottom is read against the body's box: scrolled, it would read short
    // scrollHeight can never be below clientHeight, so "fits" is read from where the panel ends against where the body's content box ends
    const limit = () => b.getBoundingClientRect().top + b.clientTop + b.clientHeight - parseFloat(getComputedStyle(b).paddingBottom);
    const fits = (k: number) => { b.style.setProperty('--fxk', String(k)); return sec.getBoundingClientRect().bottom <= limit() - 1 && b.scrollWidth <= b.clientWidth; };
    b.style.setProperty('--fxk', String(fitScale(fits, FIT_MAX)));
  }, []);
  // Which panel shows: the server marked the home one; from here the selected one (or the contact form) does.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const key = mode === 'startups' ? 's' : 'i';
    body.querySelectorAll<HTMLElement>(':scope > section').forEach((sec) => {
      const m = sec.dataset.mode;
      if (m === 'x') return;
      sec.hidden = !(m === key || m === 'any');
      sec.classList.toggle('fx-on', !contact && sec.dataset.id === item.id);
    });
    body.scrollTop = 0;
    fitType();
  }, [mode, item.id, contact, fitType]);

  const checkMore = useCallback(() => {
    const b = bodyRef.current;
    if (!b) return;
    fitType();
    setMore(hasMore(b.scrollHeight, b.clientHeight, live.current.open));
  }, [fitType]);
  useEffect(() => {
    const a = requestAnimationFrame(checkMore);
    document.fonts?.ready.then(checkMore).catch(() => {});
    window.addEventListener('resize', checkMore);
    return () => { cancelAnimationFrame(a); window.removeEventListener('resize', checkMore); };
  }, [checkMore, item.id, contact, open, mode]);

  /* ---------- the heading ---------- */
  useEffect(() => {
    setLine(0); setFog(false);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let swap: ReturnType<typeof setTimeout> | undefined;
    let i = 0;
    const t = setInterval(() => {
      setFog(true);
      swap = setTimeout(() => { i = nextLine(i, HERO_LINES[mode].length); setLine(i); setFog(false); }, LINE_FOG_MS);
    }, LINE_EVERY_MS);
    return () => { clearInterval(t); if (swap) clearTimeout(swap); };
  }, [mode]);

  /* ---------- the audience switch ---------- */
  const switchMode = (m: LandingMode) => (e: React.MouseEvent) => {
    // a plain click on the link stays on this page (no navigation, no new document); a click with a modifier key opens the other landing the usual way
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (m === live.current.mode) return;
    setMode(m);
    setCur(MODES[m].home); setContact(false); setOpen(false); setJumping(new Set());
    try { window.history.replaceState(null, '', MODE_PATH[m]); } catch { /* the address bar stays as it was */ }
  };

  /* ---------- the documents popup and the contact form ---------- */
  const openDoc = useCallback((id: DocId) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDoc(id);
  }, []);
  const closeDoc = useCallback(() => {
    setDoc(null);
    // the page behind is inert until the next render: lift it now, or the focus below would be refused
    mainRef.current?.removeAttribute('inert');
    const o = opener.current; opener.current = null;
    if (o && document.contains(o)) o.focus();
  }, []);
  const openContact = useCallback(() => {
    setContact(true); setOpen(false);
    requestAnimationFrame(() => { if (window.innerWidth > 760) bodyRef.current?.querySelector<HTMLInputElement>('#fx-contact input')?.focus(); });
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-doc]') : null;
      if (!a || !mainRef.current?.contains(a)) return;
      const id = a.dataset.doc;
      if (id === 'contact') { e.preventDefault(); openContact(); return; }
      if (isDocId(id)) { e.preventDefault(); openDoc(id); }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [openContact, openDoc]);

  // while the popup is open: the page behind it is inert, Esc closes, Tab stays inside, and focus starts on the close button
  useEffect(() => {
    const main = mainRef.current;
    if (!doc) { main?.removeAttribute('inert'); return; }
    main?.setAttribute('inert', '');
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDoc(); return; }
      if (e.key !== 'Tab' || !modalRef.current) return;
      const f = Array.from(modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null);
      if (f.length === 0) return;
      const first = f[0]; const last = f[f.length - 1]; const ae = document.activeElement;
      if (e.shiftKey && (ae === first || !modalRef.current.contains(ae))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (ae === last || !modalRef.current.contains(ae))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); main?.removeAttribute('inert'); };
  }, [doc, closeDoc]);

  /* ---------- the contact form ---------- */
  const [send, setSend] = useState<SendState>('idle');
  const [sendError, setSendError] = useState('');
  const submitContact = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const subject = CONTACT_SUBJECTS[Number(f.get('subject')) || 0] ?? CONTACT_SUBJECTS[0];
    setSend('sending'); setSendError('');
    try {
      const res = await fetch('/api/support/submit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: String(f.get('name') ?? ''), email: String(f.get('email') ?? ''), category: subject.category, subject: subject.label, message: String(f.get('message') ?? ''),
          source: mode === 'startups' ? 'landing' : 'landing_investors', website: String(f.get('website') ?? ''),
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.ok === false) { setSendError(typeof out.error === 'string' ? out.error : 'Something went wrong. Please try again.'); setSend('error'); return; }
      setSend('sent');
    } catch {
      setSendError('Something went wrong. Please try again.'); setSend('error');
    }
  };

  /* ---------- what the wheel draws ---------- */
  const offsets = useMemo(() => def.items.map((_, i) => ringOffset(i, cur, N)), [def, cur, N]);
  const cta = CTA[mode];
  const title = contact ? 'Contact' : item.label;
  const kicker = contact ? 'Opens here, not in a new page' : item.kicker;

  return (
    <div className="fx-root">
      <div ref={mainRef} id="fx-main">
        <div className="fx-bg" aria-hidden="true">
          {/* eslint-disable @next/next/no-img-element -- the photograph is placed by CSS to the pixel (landing-fixed.css); next/image would add a wrapper and its own sizing */}
          <img className="fx-blur" src="/landing/lens-photo-blur.webp" alt="" decoding="async" fetchPriority="high" width={360} height={373} />
          <picture>
            <source srcSet="/landing/lens-photo.avif" type="image/avif" />
            <source srcSet="/landing/lens-photo.webp" type="image/webp" />
            <img className="fx-photo" src="/landing/lens-photo.webp" alt="" decoding="async" fetchPriority="high" width={1150} height={928} />
          </picture>
          {/* eslint-enable @next/next/no-img-element */}
        </div>

        <nav className="fx-nav" aria-label="Main">
          <Link className="fx-brand" href={MODE_PATH[mode]}>
            <LogoLockup size={28} accentClassName="fx-deal" />
          </Link>
          <div className="fx-seg" role="group" aria-label="Audience">
            <Link href={MODE_PATH.startups} onClick={switchMode('startups')} aria-current={mode === 'startups' ? 'page' : undefined}>For startups</Link>
            <Link href={MODE_PATH.investors} onClick={switchMode('investors')} aria-current={mode === 'investors' ? 'page' : undefined}>For investors</Link>
          </div>
          {!signedIn && (
            <div className="fx-actions">
              <Link className="fx-btn fx-btn-ghost" href={SIGN_IN.href}>{SIGN_IN.label}</Link>
              <Link className="fx-btn fx-btn-primary" href={cta.href} id="fx-cta-top">{cta.label}</Link>
            </div>
          )}
        </nav>

        <main id="fx-content">
        <div className="fx-head">
          <h1 className={fog ? 'fx-fog' : undefined}><Heading line={lines[line] ?? lines[0]} /></h1>
        </div>

        <div className="fx-wheel" role="tablist" aria-label="Sections">
          <ul role="presentation">
            {def.items.map((it, i) => {
              const o = offsets[i];
              // on an even ring one place sits straight behind the lens, opposite the selected one: it stays hidden, so the wheel shows three places each side and is balanced (Nuno, 03/11/2026); it shows up as soon as the wheel turns
              const hid = N % 2 === 0 && Math.abs(o) === N / 2;
              const cls = [o === 0 ? 'fx-on' : '', Math.abs(o) >= 3 ? 'fx-far' : '', hid ? 'fx-hid' : '', jumping.has(i) ? 'fx-jump' : ''].filter(Boolean).join(' ');
              return (
                <li key={`${mode}-${it.id}`} role="presentation" aria-hidden={hid || undefined} className={cls || undefined} style={{ '--s': Math.sign(o), '--k': Math.max(Math.abs(o) - 1, 0) } as React.CSSProperties}>
                  <button type="button" role="tab" aria-label={it.label} aria-selected={o === 0} tabIndex={hid ? -1 : undefined} onClick={() => go(i)}><WheelIcon name={it.icon} /></button>
                  <span className="fx-lbl" aria-hidden="true">{it.short}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <span className="fx-sr" aria-live="polite">{title}</span>

        <div className={`fx-card${open ? ' fx-open' : ''}${more ? ' fx-has-more' : ''}`} id="fx-card" onTransitionEnd={checkMore}>
          <div className="fx-top" onClick={() => { if (more) setOpen((o) => !o); }}>
            <h2>{title}</h2>
            <span className="fx-mono">{kicker}</span>
            <button className="fx-exp" type="button" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
              {open ? 'Less ' : 'See all '}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
          </div>
          <div className="fx-body" ref={bodyRef} id="fx-card-body">
            {children}
            <section data-id="contact" data-mode="x" id="fx-contact" hidden={!contact} className={contact ? 'fx-on' : undefined}>
              {send === 'sent' ? (
                <div className="fx-cform">
                  <p className="fx-cform-ok" role="status">Message sent. We reply to the address you gave, usually within a couple of business days.</p>
                  <div><button type="button" className="fx-btn fx-btn-ghost fx-btn-sm" onClick={() => { setSend('idle'); setContact(false); }}>← Back</button></div>
                </div>
              ) : (
                <form className="fx-cform" onSubmit={submitContact}>
                  <div className="fx-cform-head">
                    <span className="fx-mono">We usually reply within a couple of business days</span>
                    <button type="button" className="fx-btn fx-btn-ghost fx-btn-sm" onClick={() => setContact(false)}>← Back</button>
                  </div>
                  <div className="fx-cform-grid">
                    <label>Name<input name="name" type="text" autoComplete="name" required maxLength={120} /></label>
                    <label>Email<input name="email" type="email" autoComplete="email" required maxLength={200} /></label>
                    <label>Subject<select name="subject" defaultValue="0">{CONTACT_SUBJECTS.map((s, i) => <option key={s.label} value={i}>{s.label}</option>)}</select></label>
                    <label className="fx-full">Message<textarea name="message" rows={3} required minLength={CONTACT_MIN_MESSAGE} maxLength={5000} /></label>
                  </div>
                  {/* honeypot, as in /contact: off-screen, never reached by keyboard or screen reader */}
                  <div className="fx-hp" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
                  {send === 'error' && <p className="fx-cform-err" role="alert">{sendError}</p>}
                  <div className="fx-cform-foot">
                    <span className="fx-mono">Privacy notice applies</span>
                    <button type="submit" className="fx-btn fx-btn-primary" disabled={send === 'sending'}>{send === 'sending' ? 'Sending…' : 'Send message'}</button>
                  </div>
                </form>
              )}
            </section>
          </div>
        </div>
        </main>

        {!signedIn && (
          <div className="fx-mbar" role="group" aria-label="Sign in or create an account">
            <Link className="fx-btn fx-btn-ghost" href={SIGN_IN.href}>{SIGN_IN.label}</Link>
            <Link className="fx-btn fx-btn-primary" href={cta.href}>{cta.label}</Link>
          </div>
        )}
      </div>

      {doc && (
        <div className="fx-modal" role="dialog" aria-modal="true" aria-labelledby="fx-modal-title" ref={modalRef}>
          <div className="fx-modal-back" onClick={closeDoc} />
          <div className="fx-modal-card">
            <div className="fx-top">
              <h2 id="fx-modal-title">Terms &amp; conditions</h2>
              <span className="fx-mono">All chapters</span>
              <button type="button" className="fx-close" aria-label="Close" onClick={closeDoc} ref={closeRef}>×</button>
            </div>
            <div className="fx-body" data-modal-body>
              <LegalChapters highlight={doc} />
            </div>
            <div className="fx-modal-foot">
              <a className="fx-btn fx-btn-ghost" href={DOC_PAGE[doc]} target="_blank" rel="noopener noreferrer">Open full document</a>
              <button type="button" className="fx-btn fx-btn-primary" onClick={closeDoc}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

