'use client';
// Prompt 681 §4 — the same gesture as the founder Pipeline's
// usePipelineRowDrag.ts (647/671/679): press a row, drag its shadow onto a
// taxonomy card, drop. Ported rather than imported because that hook is
// built around <table> rows (it clones a row INSIDE a cloned <table> with
// the original colgroup) — this list's rows are plain <div>s, and the
// dragged entity is an investor pipeline card, not a founder Entity. Every
// other mechanic is the same on purpose: 6px/300ms start threshold, ghost
// scale/opacity/tilt, lean-toward-target, fall-into-door, return-flight on
// a miss, Esc to cancel, one swallowed click after a real drag, and
// prefers-reduced-motion collapsing every animation to instant snaps.
import { useCallback, useEffect, useRef, useState } from 'react';
import { investorDropTargetAccepts, type InvestorDropTarget } from '@/lib/investor-pipeline-drop';

const DRAG_START_PX = 6;
const TOUCH_HOLD_MS = 300;
const GHOST_SCALE = 0.85;
const GHOST_OPACITY = 0.6;
const GHOST_TILT_DEG = -1.5;
const GHOST_LEAN_DEG = 3;
const FALL_MS = 200;
const DOOR_CLOSE_MS = 160;
const RETURN_MS = 150;

export interface DraggableCard { orgId: string; name: string }

interface Pending<T extends DraggableCard> {
  card: T; row: HTMLDivElement; pointerId: number; pointerType: string;
  startX: number; startY: number; holdTimer: number | null;
}
interface Drag<T extends DraggableCard> {
  card: T; row: HTMLDivElement; ghost: HTMLDivElement;
  offsetX: number; offsetY: number; x: number; y: number; over: InvestorDropTarget | null;
}

export interface InvestorPipelineRowDrag<T extends DraggableCard> {
  enabled: boolean;
  active: boolean;
  originId: string | null;
  over: InvestorDropTarget | null;
  onRowPointerDown: (e: React.PointerEvent<HTMLDivElement>, card: T) => void;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function playAnim(el: Element, keyframes: Keyframe[], duration: number, easing: string): Promise<void> {
  try { el.animate(keyframes, { duration, easing, fill: 'forwards' }); } catch { /* animations unsupported — the flow still proceeds */ }
  return wait(duration);
}

function ghostTransform(x: number, y: number, scale: number, tilt: number): string {
  return `translate3d(${x}px, ${y}px, 0) scale(${scale}) rotate(${tilt}deg)`;
}

function targetElement(target: InvestorDropTarget): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-investor-drop-target="${target}"]`);
}

function hitTest(x: number, y: number): InvestorDropTarget | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-investor-drop-target]'))) {
    const view = el.dataset.investorDropTarget;
    if (!investorDropTargetAccepts(view)) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return view;
  }
  return null;
}

function makeGhost(row: HTMLDivElement, width: number): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.className = 'investor-pipeline-drag-ghost';
  Object.assign(wrap.style, {
    position: 'fixed', left: '0px', top: '0px', width: `${width}px`, pointerEvents: 'none', zIndex: '60',
    opacity: String(GHOST_OPACITY), boxShadow: '0 14px 30px rgba(15, 23, 42, 0.24)', borderRadius: '10px',
    overflow: 'hidden', background: '#ffffff', willChange: 'transform',
  } as Partial<CSSStyleDeclaration>);
  const clone = row.cloneNode(true) as HTMLDivElement;
  clone.removeAttribute('style');
  clone.style.width = `${width}px`;
  wrap.appendChild(clone);
  document.body.appendChild(wrap);
  return wrap;
}

export function useInvestorPipelineRowDrag<T extends DraggableCard>(opts: {
  enabled: boolean;
  reducedMotion: boolean;
  /** Runs after the shadow has fallen into the door; resolves true when the drop was confirmed and committed. */
  onDrop: (card: T, target: InvestorDropTarget) => Promise<boolean>;
}): InvestorPipelineRowDrag<T> {
  const [active, setActive] = useState(false);
  const [originId, setOriginId] = useState<string | null>(null);
  const [over, setOver] = useState<InvestorDropTarget | null>(null);
  const pendingRef = useRef<Pending<T> | null>(null);
  const dragRef = useRef<Drag<T> | null>(null);
  const onDropRef = useRef(opts.onDrop);
  onDropRef.current = opts.onDrop;
  const reducedRef = useRef(opts.reducedMotion);
  reducedRef.current = opts.reducedMotion;

  const positionGhost = useCallback((d: Drag<T>, lean: number) => {
    d.ghost.style.transform = ghostTransform(d.x - d.offsetX, d.y - d.offsetY, GHOST_SCALE, reducedRef.current ? 0 : GHOST_TILT_DEG + lean);
  }, []);

  const clearPending = useCallback(() => {
    const p = pendingRef.current;
    if (p?.holdTimer) window.clearTimeout(p.holdTimer);
    pendingRef.current = null;
  }, []);

  const startDrag = useCallback((x: number, y: number) => {
    const p = pendingRef.current;
    if (!p || dragRef.current) return;
    clearPending();
    const rect = p.row.getBoundingClientRect();
    try { p.row.setPointerCapture(p.pointerId); } catch { /* not every browser lets a div capture; the document listeners still see the pointer */ }
    const ghost = makeGhost(p.row, rect.width);
    const d: Drag<T> = { card: p.card, row: p.row, ghost, offsetX: x - rect.left, offsetY: y - rect.top, x, y, over: null };
    ghost.style.transformOrigin = `${d.offsetX}px ${d.offsetY}px`;
    dragRef.current = d;
    positionGhost(d, 0);
    document.body.classList.add('investor-pipeline-dragging');
    setActive(true);
    setOriginId(p.card.orgId);
  }, [clearPending, positionGhost]);

  const leanTowards = useCallback((d: Drag<T>): number => {
    if (!d.over || reducedRef.current) return 0;
    const el = targetElement(d.over);
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return (r.left + r.width / 2) > d.x ? GHOST_LEAN_DEG : -GHOST_LEAN_DEG;
  }, []);

  const suppressNextClick = useCallback(() => {
    const swallow = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation(); };
    document.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 400);
  }, []);

  useEffect(() => {
    if (!opts.enabled) return;

    const preventTouchScroll = (ev: TouchEvent) => { if (dragRef.current) ev.preventDefault(); };
    const preventContextMenu = (ev: Event) => { if (pendingRef.current || dragRef.current) ev.preventDefault(); };

    const endDrag = (d: Drag<T>) => {
      d.ghost.remove();
      dragRef.current = null;
      document.body.classList.remove('investor-pipeline-dragging');
      setActive(false);
      setOver(null);
      setOriginId(null);
    };

    const returnToOrigin = async (d: Drag<T>, fromDoor: InvestorDropTarget | null) => {
      const origin = d.row.getBoundingClientRect();
      const to = ghostTransform(origin.left, origin.top, 1, 0);
      if (reducedRef.current) { d.ghost.style.transform = to; return; }
      let from = d.ghost.style.transform;
      if (fromDoor) {
        const door = targetElement(fromDoor)?.getBoundingClientRect();
        if (door) from = ghostTransform(door.left + door.width / 2 - d.offsetX, door.top + door.height / 2 - d.offsetY, 0.2, 0);
      }
      await playAnim(d.ghost, [{ transform: from, opacity: fromDoor ? 0 : GHOST_OPACITY }, { transform: to, opacity: GHOST_OPACITY }], RETURN_MS, 'ease-out');
    };

    const fallIntoDoor = async (d: Drag<T>, target: InvestorDropTarget) => {
      const door = targetElement(target)?.getBoundingClientRect();
      if (reducedRef.current || !door) { d.ghost.style.opacity = '0'; return; }
      const from = d.ghost.style.transform;
      const to = ghostTransform(door.left + door.width / 2 - d.offsetX, door.top + door.height / 2 - d.offsetY, 0.2, 0);
      await playAnim(d.ghost, [{ transform: from, opacity: GHOST_OPACITY }, { transform: to, opacity: 0 }], FALL_MS, 'ease-in');
    };

    const cancelDrag = async () => {
      clearPending();
      const d = dragRef.current;
      if (!d) return;
      suppressNextClick();
      await returnToOrigin(d, null);
      endDrag(d);
    };

    const onMove = (e: PointerEvent) => {
      const p = pendingRef.current;
      if (p && !dragRef.current) {
        const dist = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
        if (p.pointerType === 'touch') { if (dist > DRAG_START_PX) clearPending(); return; }
        if (dist < DRAG_START_PX) return;
        startDrag(p.startX, p.startY);
      }
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      d.x = e.clientX;
      d.y = e.clientY;
      const target = hitTest(e.clientX, e.clientY);
      if (target !== d.over) { d.over = target; setOver(target); }
      positionGhost(d, leanTowards(d));
    };

    const onUp = async () => {
      if (pendingRef.current && !dragRef.current) { clearPending(); return; }
      const d = dragRef.current;
      if (!d) return;
      suppressNextClick();
      setActive(false);
      if (!d.over) { await returnToOrigin(d, null); endDrag(d); return; }
      const target = d.over;
      await fallIntoDoor(d, target);
      d.over = null;
      setOver(null);
      if (!reducedRef.current) await wait(DOOR_CLOSE_MS);
      let committed = false;
      try { committed = await onDropRef.current(d.card, target); } catch { committed = false; }
      if (!committed) await returnToOrigin(d, target);
      endDrag(d);
    };

    const onCancel = () => { void cancelDrag(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && dragRef.current) void cancelDrag(); };

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKey);
    document.addEventListener('touchmove', preventTouchScroll, { passive: false });
    document.addEventListener('contextmenu', preventContextMenu);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('touchmove', preventTouchScroll);
      document.removeEventListener('contextmenu', preventContextMenu);
      clearPending();
      const d = dragRef.current;
      if (d) endDrag(d);
    };
  }, [opts.enabled, clearPending, startDrag, positionGhost, leanTowards, suppressNextClick]);

  const onRowPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, card: T) => {
    if (!opts.enabled || dragRef.current || pendingRef.current) return;
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [data-no-drag]')) return;
    const pending: Pending<T> = {
      card, row: e.currentTarget, pointerId: e.pointerId, pointerType: e.pointerType,
      startX: e.clientX, startY: e.clientY, holdTimer: null,
    };
    if (e.pointerType === 'touch') {
      pending.holdTimer = window.setTimeout(() => {
        if (pendingRef.current === pending) startDrag(pending.startX, pending.startY);
      }, TOUCH_HOLD_MS);
    }
    pendingRef.current = pending;
  }, [opts.enabled, startDrag]);

  return { enabled: opts.enabled, active, originId, over, onRowPointerDown };
}
