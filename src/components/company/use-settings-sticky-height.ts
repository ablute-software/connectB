'use client';
// Publishes the height of the About page's sticky header block as `--settings-sticky-height` on <html>, kept current by a ResizeObserver — the same shape
// WorkspaceHeader uses for `--workspace-header-height`. settings-layout.ts adds the two in CSS, so everything that has to sit below (or scroll to just under)
// the header follows it as it wraps, grows or shrinks, instead of trusting a number measured once. Removed again on unmount, so no other page inherits it.
import { useLayoutEffect, type RefObject } from 'react';
import { SETTINGS_STICKY_HEIGHT_VAR } from './settings-layout';

interface Measurable { getBoundingClientRect(): { height: number } }
interface StyleTarget { style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } }
interface Observer { observe(el: unknown): void; disconnect(): void }

/** The whole behaviour, without React, so it can be exercised with fakes: publish now, publish on every resize of `el`, and undo it all on stop(). */
export function publishStickyHeight(
  el: Measurable, root: StyleTarget, makeObserver?: (callback: () => void) => Observer,
): () => void {
  const publish = () => root.style.setProperty(SETTINGS_STICKY_HEIGHT_VAR, `${Math.ceil(el.getBoundingClientRect().height)}px`);
  publish();
  const observer = makeObserver?.(publish);
  observer?.observe(el);
  return () => { observer?.disconnect(); root.style.removeProperty(SETTINGS_STICKY_HEIGHT_VAR); };
}

export function useSettingsStickyHeight(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    return publishStickyHeight(el, document.documentElement, typeof ResizeObserver !== 'undefined' ? (cb) => new ResizeObserver(cb) : undefined);
  }, [ref]);
}
