'use client';
// Prompt 647 §1 — the gesture: press a Pipeline row, drag its shadow onto a
// header button, drop.
//
// Pointer events, not the native drag-and-drop API: we need our own ghost, a
// 300ms hold on touch, Esc to cancel, and a return flight on a miss — none of
// which the native API gives. A plain click still opens the dossier: nothing
// starts until the pointer has moved 6px (mouse/pen) or stayed 300ms (touch),
// and the click that follows a real drag is swallowed once.
//
// Everything that moves at 60fps lives in refs and on the ghost node itself,
// never in React state: the page behind this renders 700 rows, and a
// re-render per pointermove would make the shadow stutter. State changes
// only when something the page must draw changes — which row is the origin,
// which door is open, whether targets should look receptive.
//
// The ghost is a clone of the row's own DOM inside a table with the original
// colgroup, so it keeps the row's columns (and, below md, its card layout);
// 85% scale, 0.6 opacity, a soft shadow and a -1.5° tilt so it reads as
// lifted. Over a door it leans 3° towards it. prefers-reduced-motion (§1.7):
// the shadow still follows the pointer — that is the drag, not decoration —
// but nothing tilts, falls or flies back.
import { useCallback, useEffect, useRef, useState } from 'react';
import { dropTargetAccepts, type DropTarget } from '@/lib/pipeline-drop';
import type { Entity } from '@/lib/types';

const DRAG_START_PX = 6;
const TOUCH_HOLD_MS = 300;
const GHOST_SCALE = 0.85;
const GHOST_OPACITY = 0.6;
const GHOST_TILT_DEG = -1.5;
const GHOST_LEAN_DEG = 3;
const FALL_MS = 200;
const DOOR_CLOSE_MS = 160;
const RETURN_MS = 150;

interface Pending {
  entity: Entity;
  row: HTMLTableRowElement;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  holdTimer: number | null;
}

interface Drag {
  entity: Entity;
  row: HTMLTableRowElement;
  ghost: HTMLDivElement;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  over: DropTarget | null;
}

export interface PipelineRowDrag {
  enabled: boolean;
  /** A row is being dragged: the targets look receptive. */
  active: boolean;
  /** The row being dragged (drawn stronger in place), until the drop settles. */
  originId: string | null;
  /** The door the shadow is over. */
  over: DropTarget | null;
  onRowPointerDown: (e: React.PointerEvent<HTMLTableRowElement>, entity: Entity) => void;
}

/** §1.7 — read once, kept current: the page passes it to every animation decision. */
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

// Play a Web Animation for its visual, but never gate control flow on
// Animation.finished: a hidden/background tab pauses the animation timeline,
// so .finished can hang indefinitely and would strand the drop before the
// confirmation ever opened. setTimeout keeps firing (throttled, but it
// fires) whatever the tab's visibility, so the flow always proceeds while
// the animation still plays when the tab is visible.
function playAnim(el: Element, keyframes: Keyframe[], duration: number, easing: string): Promise<void> {
  try { el.animate(keyframes, { duration, easing, fill: 'forwards' }); } catch { /* animations unsupported — the flow still proceeds */ }
  return wait(duration);
}

function ghostTransform(x: number, y: number, scale: number, tilt: number): string {
  return `translate3d(${x}px, ${y}px, 0) scale(${scale}) rotate(${tilt}deg)`;
}

function targetElement(target: DropTarget): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-drop-target="${target}"]`);
}

function hitTest(x: number, y: number): DropTarget | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-drop-target]'))) {
    const view = el.dataset.dropTarget;
    if (!dropTargetAccepts(view)) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return view;
  }
  return null;
}

function makeGhost(row: HTMLTableRowElement, width: number): HTMLDivElement {
  const table = row.closest('table');
  const wrap = document.createElement('div');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.className = 'pipeline-drag-ghost';
  Object.assign(wrap.style, {
    position: 'fixed', left: '0px', top: '0px', width: `${width}px`, pointerEvents: 'none', zIndex: '60',
    opacity: String(GHOST_OPACITY), boxShadow: '0 14px 30px rgba(15, 23, 42, 0.24)', borderRadius: '10px',
    overflow: 'hidden', background: '#ffffff', willChange: 'transform',
  } as Partial<CSSStyleDeclaration>);
  const t = document.createElement('table');
  t.className = table?.className ?? '';
  t.style.width = `${width}px`;
  t.style.tableLayout = 'fixed';
  const colgroup = table?.querySelector('colgroup');
  if (colgroup) t.appendChild(colgroup.cloneNode(true));
  const tbody = document.createElement('tbody');
  const clone = row.cloneNode(true) as HTMLTableRowElement;
  clone.classList.remove('pipeline-drag-origin');
  clone.removeAttribute('style');
  tbody.appendChild(clone);
  t.appendChild(tbody);
  wrap.appendChild(t);
  document.body.appendChild(wrap);
  return wrap;
}

export function usePipelineRowDrag(opts: {
  enabled: boolean;
  reducedMotion: boolean;
  /** Runs after the shadow has fallen into the door; resolves true when the drop was confirmed and committed. */
  onDrop: (entity: Entity, target: DropTarget) => Promise<boolean>;
}): PipelineRowDrag {
  const [active, setActive] = useState(false);
  const [originId, setOriginId] = useState<string | null>(null);
  const [over, setOver] = useState<DropTarget | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const onDropRef = useRef(opts.onDrop);
  onDropRef.current = opts.onDrop;
  const reducedRef = useRef(opts.reducedMotion);
  reducedRef.current = opts.reducedMotion;

  const positionGhost = useCallback((d: Drag, lean: number) => {
    d.ghost.style.transform = ghostTransform(d.x - d.offsetX, d.y - d.offsetY, GHOST_SCALE, reducedRef.current ? 0 : GHOST_TILT_DEG + lean);
  }, []);

  const clearPending = useCallback(() => {
    const p = pendingRef.current;
    if (p?.holdTimer) window.clearTimeout(p.holdTimer);
    pendingRef.current = null;
  }, []);

  // One entry for both the 6px mouse move and the 300ms touch hold.
  const startDrag = useCallback((x: number, y: number) => {
    const p = pendingRef.current;
    if (!p || dragRef.current) return;
    clearPending();
    const rect = p.row.getBoundingClientRect();
    try { p.row.setPointerCapture(p.pointerId); } catch { /* not every browser lets a row capture; the document listeners still see the pointer */ }
    const ghost = makeGhost(p.row, rect.width);
    const d: Drag = { entity: p.entity, row: p.row, ghost, offsetX: x - rect.left, offsetY: y - rect.top, x, y, over: null };
    ghost.style.transformOrigin = `${d.offsetX}px ${d.offsetY}px`;
    dragRef.current = d;
    positionGhost(d, 0);
    document.body.classList.add('pipeline-dragging');
    setActive(true);
    setOriginId(p.entity.id);
  }, [clearPending, positionGhost]);

  const leanTowards = useCallback((d: Drag): number => {
    if (!d.over || reducedRef.current) return 0;
    const el = targetElement(d.over);
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return (r.left + r.width / 2) > d.x ? GHOST_LEAN_DEG : -GHOST_LEAN_DEG;
  }, []);

  // The click a real drag leaves behind (pointerdown on the name link,
  // pointerup after moving) would open the dossier: swallow exactly one, and
  // stop waiting for it shortly after so an unrelated click is never eaten.
  const suppressNextClick = useCallback(() => {
    const swallow = (ev: MouseEvent) => { ev.preventDefault(); ev.stopPropagation(); };
    document.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 400);
  }, []);

  useEffect(() => {
    if (!opts.enabled) return;

    const preventTouchScroll = (ev: TouchEvent) => { if (dragRef.current) ev.preventDefault(); };
    const preventContextMenu = (ev: Event) => { if (pendingRef.current || dragRef.current) ev.preventDefault(); };

    const endDrag = (d: Drag) => {
      d.ghost.remove();
      dragRef.current = null;
      document.body.classList.remove('pipeline-dragging');
      setActive(false);
      setOver(null);
      setOriginId(null);
    };

    const returnToOrigin = async (d: Drag, fromDoor: DropTarget | null) => {
      // Re-measured now: the page may have scrolled while the row was away.
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

    const fallIntoDoor = async (d: Drag, target: DropTarget) => {
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
        // A finger that moves before the hold is a scroll, not a drag.
        if (p.pointerType === 'touch') { if (dist > DRAG_START_PX) clearPending(); return; }
        if (dist < DRAG_START_PX) return;
        // The shadow is born under the press point, then this same move
        // carries it on — so a fast first move already lands where it went.
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
      // §1.4 — the shadow falls in, the door closes, only then the question.
      await fallIntoDoor(d, target);
      d.over = null;
      setOver(null);
      if (!reducedRef.current) await wait(DOOR_CLOSE_MS);
      let committed = false;
      try { committed = await onDropRef.current(d.entity, target); } catch { committed = false; }
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

  const onRowPointerDown = useCallback((e: React.PointerEvent<HTMLTableRowElement>, entity: Entity) => {
    if (!opts.enabled || dragRef.current || pendingRef.current) return;
    if (e.button !== 0) return;
    // A press on a control inside the row is that control's, never a drag.
    if ((e.target as HTMLElement).closest('button, input, select, textarea, [data-no-drag]')) return;
    const pending: Pending = {
      entity, row: e.currentTarget, pointerId: e.pointerId, pointerType: e.pointerType,
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
