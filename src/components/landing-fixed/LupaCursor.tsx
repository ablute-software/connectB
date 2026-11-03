'use client';
// Nuno, 03/11/2026: the mouse pointer is a small magnifier (public/landing/lupa.png, the glass is at the pointer). Over one of the tab icons it grows, and so does the icon under it; a click pins the place,
// and the magnifier is small again so the pointer can go down to the card's buttons. Only on a device with a mouse (fine pointer, hover); on a phone the icons are tapped. It follows the pointer
// with transform, in a requestAnimationFrame, never by re-rendering; no media query decides whether to show it (a laptop with a touch screen reports touch as its primary pointer, and some setups report no fine pointer at all): the first move of a MOUSE or PEN pointer (never a finger) turns it on; the page's own cursor is hidden only once the first move arrives (without JavaScript nothing changes), and stays on form fields.
import { useEffect, useRef } from 'react';

/** The glass' centre in the picture, as a fraction of its width and height (measured from the file). */
const HOT = { x: 0.3235, y: 0.3696 } as const;

export function LupaCursor() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const root = el?.closest('.fx-root');
    if (!el || !root) return;
    let x = -100; let y = -100; let raf = 0; let locked = false; let over: Element | null = null;
    const paint = () => { raf = 0; el.style.transform = `translate3d(${x}px, ${y}px, 0)`; };
    const setBig = (on: boolean) => { el.dataset.big = on && !locked ? '1' : '0'; };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      x = e.clientX; y = e.clientY;
      if (!raf) raf = requestAnimationFrame(paint);
      if (!root.classList.contains('fx-lupa-on')) { root.classList.add('fx-lupa-on'); el.dataset.show = '1'; }
      const t = e.target instanceof Element ? e.target.closest('[data-tab]') : null;
      if (t !== over) { over = t; if (!t) locked = false; setBig(!!t); }
      // a form field or the documents popup keeps the ordinary pointer
      const plain = e.target instanceof Element && !!e.target.closest('input, textarea, select, [role="dialog"]');
      el.dataset.show = plain ? '0' : '1';
    };
    const onDown = () => { if (over) { locked = true; setBig(false); } };
    // pressing the button and moving over a link or a logo starts the browser's own drag: pointer events stop, the magnifier stays behind and the ordinary pointer comes back (Nuno, 03/11/2026)
    const onDrag = (e: DragEvent) => { if (!(e.target instanceof Element && e.target.closest('input, textarea, select, [role="dialog"]'))) e.preventDefault(); };
    const onLeave = () => { el.dataset.show = '0'; };
    const onEnter = () => { if (root.classList.contains('fx-lupa-on')) el.dataset.show = '1'; };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('dragstart', onDrag);
    document.documentElement.addEventListener('mouseleave', onLeave);
    document.documentElement.addEventListener('mouseenter', onEnter);
    return () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerdown', onDown); window.removeEventListener('dragstart', onDrag);
      document.documentElement.removeEventListener('mouseleave', onLeave); document.documentElement.removeEventListener('mouseenter', onEnter);
      if (raf) cancelAnimationFrame(raf);
      root.classList.remove('fx-lupa-on');
    };
  }, []);
  return (
    <div className="fx-lupa" ref={ref} data-show="0" data-big="0" aria-hidden="true" style={{ '--hx': HOT.x, '--hy': HOT.y } as React.CSSProperties}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a pointer, not content */}
      <img src="/landing/lupa.png" alt="" width={64} height={57} />
    </div>
  );
}
