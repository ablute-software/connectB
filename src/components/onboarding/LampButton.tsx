'use client';
// Prompt 141 — replaces the per-page "?" (PageGuideButton) everywhere.
// Explicit call from Nuno (2026-08-09), overriding the prompt's own
// "don't duplicate the '?'" framing: not a second entry point alongside the
// "?" — a full replacement, because the lamp reads as more visible. Every
// <PageGuideButton pageKey="..."/> render call site was removed in the same
// change; PageGuideButton.tsx/PageTour.tsx themselves are untouched (still
// used by other onboarding surfaces) — this only stops calling one of them.
//
// Anchored dropdown, not a fixed-inset modal — deliberately `position:
// absolute` off a local `position: relative` wrapper, not `fixed` off
// document.body like W1Badge/FirstStepsPanel. That sidesteps the
// fixed-positioning containing-block bug documented on WorkspaceHeader's own
// `backdrop-blur` (see CLAUDE.md) entirely: `absolute` is scoped to the
// nearest positioned ancestor regardless of transform/filter further up, so
// there's nothing here for that class of bug to attach to. First anchored
// dropdown in the design system — kept local to this file rather than
// generalized, since nothing else needs the shape yet.
import { useEffect, useRef, useState } from 'react';
import { useOnboarding } from '@/lib/onboarding/OnboardingProvider';
import { HelpSupportWidget } from '@/components/HelpSupportWidget';
import type { SupportSource } from '@/components/ContactForm';

const TOUR_LABEL: Record<string, string> = {
  guide_pipeline: 'Pipeline', guide_settings: 'About your company', guide_documents: 'Vault Data Room',
  guide_people_access: 'People & Access', guide_today: 'Today', guide_warrants: 'Outbox',
  guide_dashboard: 'Dashboard', guide_plans: 'Plans & billing', guide_agenda: 'Agenda',
  guide_entity: 'Investor dossier', guide_network: 'My Network',
};

export function LampButton({ tourKeys, supportSource }: { tourKeys: string[]; supportSource: SupportSource }) {
  const { rearmKey } = useOnboarding();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Tips and help" aria-expanded={open} title="Tips and help"
        className="flex h-8 w-8 items-center justify-center rounded-full text-[17px] leading-none hover:bg-gray-50">
        💡
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1.5 w-56 rounded-xl border border-gray-200 bg-white py-1.5 shadow-lg">
          {tourKeys.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">No page guide here yet.</p>
          ) : tourKeys.map((k) => (
            <button key={k} role="menuitem" onClick={() => { rearmKey(k); setOpen(false); }}
              className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50">
              Show tips — {TOUR_LABEL[k] ?? k}
            </button>
          ))}
          <div className="my-1 border-t border-gray-100" />
          {/* Closes this dropdown on the same click that opens
              HelpSupportWidget's own modal (event bubbles from its button up
              to this div) — no prop needs threading into that component. */}
          <div className="px-3 py-1.5" onClick={() => setOpen(false)}>
            <HelpSupportWidget source={supportSource} className="text-sm text-gray-700 hover:text-gray-900" />
          </div>
        </div>
      )}
    </div>
  );
}
