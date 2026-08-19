'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import type { Entity, EntityStatus, FitScore, Person } from '@/lib/types';
import { PreflightCheck, preflightSummary } from '@/lib/rules';
import { useStore } from '@/lib/store';

export const BRAND = '#0E7490';

// Single global tooltip: hover/focus ~500ms → short one-sentence popup near
// the trigger. Neutral dark chip per DESIGN_IDEAS.md (calm, no color-as-
// decoration) — semantic color stays reserved for status/verification.
export function Tooltip({ text, children, side = 'top', block }: {
  text: string; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; block?: boolean;
}) {
  const [show, setShow] = useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function open() { timer.current = setTimeout(() => setShow(true), 500); }
  function close() { if (timer.current) clearTimeout(timer.current); setShow(false); }

  const posClass = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }[side];

  return (
    <span className={`relative ${block ? 'block w-full' : 'inline-flex'}`} onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close}>
      {children}
      {show && (
        <span role="tooltip"
          className={`pointer-events-none absolute z-50 w-max max-w-[220px] rounded-lg bg-gray-900 px-2 py-1 text-center text-[11px] font-medium leading-snug text-white shadow-lg ${posClass}`}>
          {text}
        </span>
      )}
    </span>
  );
}

// Prompt 49 §4 — a clickable "(i)" for jargon inside free-text copy (e.g.
// "run pre-flight" in the pipeline's next-step line). Deliberately
// click-toggled, not hover-only like Tooltip above: this sits inline in a
// sentence someone is reading, and hover has no equivalent on a touch
// device — a founder on their phone would never be able to see it at all.
export function TermHint({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex">
      <button type="button" onClick={() => setShow((s) => !s)} aria-label="What does this mean?"
        className="ml-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-current text-[9px] font-bold leading-none opacity-60 hover:opacity-100">
        i
      </button>
      {show && (
        <span role="tooltip"
          className="pointer-events-none absolute z-50 top-full left-1/2 mt-1.5 w-max max-w-[220px] -translate-x-1/2 rounded-lg bg-gray-900 px-2 py-1 text-center text-[11px] font-medium leading-snug text-white shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

// Prompt 175 §C — no reusable toggle/switch existed anywhere in the app
// before this (confirmed — every on/off setting was a plain checkbox,
// including swot_visible_to_investors/roadmap_visible_to_investors). Pill
// track + sliding thumb, brand color when on, pure CSS (no new
// dependency) — the actual `<input type="checkbox">` stays present but
// visually hidden (`sr-only`), so this keeps native keyboard/
// screen-reader semantics rather than reinventing them with a plain div.
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <span className="relative inline-flex">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span className={`h-5 w-9 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1 ${checked ? 'bg-[#0E7490] peer-focus-visible:ring-[#0E7490]' : 'bg-gray-300 peer-focus-visible:ring-gray-400'}`} />
        <span className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
      </span>
      {label}
    </label>
  );
}

export function Card({ title, children, tint, right }: {
  title?: React.ReactNode; children: React.ReactNode;
  tint?: 'red' | 'amber' | 'blue'; right?: React.ReactNode;
}) {
  const tints = {
    red: 'bg-red-50/70 border-red-100', amber: 'bg-amber-50/70 border-amber-100',
    blue: 'bg-[#E8F4F8] border-cyan-100', none: 'bg-white border-gray-100 shadow-sm',
  };
  return (
    <div className={`rounded-2xl border p-5 ${tints[tint ?? 'none']}`}>
      {title && (
        <div className="mb-2.5 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

const statusStyle: Record<EntityStatus, string> = {
  not_contacted: 'border border-gray-300 text-gray-600',
  contacted: 'border border-cyan-600 text-cyan-700',
  in_conversation: 'bg-[#E8F4F8] text-cyan-800',
  diligence: 'bg-[#0E7490] text-white',
  passed: 'border border-red-300 text-red-700',
  invested: 'bg-green-700 text-white',
  dormant: 'bg-gray-400 text-white',
};

const statusExplain: Record<EntityStatus, string> = {
  not_contacted: 'No outbound has been sent to anyone at this entity yet.',
  contacted: 'At least one outbound was sent; still awaiting a substantive reply.',
  in_conversation: 'They replied with interest, a question, or a meeting request.',
  diligence: 'Actively in diligence — documents, calls, references.',
  passed: 'They said no — see the pass reason on the entity page.',
  invested: 'They committed capital to this round.',
  dormant: 'Frozen — no active outbound planned; may be reopened later.',
};

// Prompt 257 §1 — "dormant"/"parked"/"frozen"/"cold" were four words for
// the SAME entities.status='dormant' value across different files (badge,
// filter, dashboard, tour said "dormant"; journey/actions-required/
// nextBestAction said "parked"). Unified to "Frozen" everywhere the STATUS
// itself is named — this map is the one place that translation happens, so
// every other status keeps reading straight off the enum. The one place
// this deliberately does NOT reach: RelationshipSummaryCard's park-reason
// picker still offers "Cold — no reply" for a never-replied entity,
// distinct from "no continuity" — a real distinction the code goes out of
// its way to compute (stageExits' parkLabel), not just a leftover label.
export const statusLabel: Record<EntityStatus, string> = {
  not_contacted: 'not contacted', contacted: 'contacted', in_conversation: 'in conversation',
  diligence: 'diligence', passed: 'passed', invested: 'invested', dormant: 'Frozen',
};

export function StatusPill({ status }: { status: EntityStatus }) {
  return (
    <Tooltip text={statusExplain[status]}>
      <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle[status]}`}>
        {statusLabel[status]}
      </span>
    </Tooltip>
  );
}

const fitStyle: Record<FitScore, string> = {
  high: 'text-[#0E7490] font-bold', medium_high: 'text-green-800 font-semibold',
  medium: 'text-amber-700', low: 'text-gray-400',
};
const fitLabel: Record<FitScore, string> = { high: 'High', medium_high: 'Med-High', medium: 'Medium', low: 'Low' };

export function FitTag({ fit }: { fit?: FitScore }) {
  if (!fit) return <span className="text-gray-300">—</span>;
  return (
    <Tooltip text="How well this investor's thesis matches ablute_, hand-assessed from their public materials.">
      <span className={`text-xs ${fitStyle[fit]}`}>{fitLabel[fit]}</span>
    </Tooltip>
  );
}

export function WaveTag({ wave }: { wave?: number }) {
  if (!wave) return null;
  const c = wave === 1 ? 'bg-[#0E7490] text-white' : wave === 2 ? 'bg-teal-600 text-white' : 'bg-gray-300 text-gray-700';
  return (
    <Tooltip text={`Outreach wave ${wave} — the priority batch this investor is scheduled to be approached in.`}>
      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${c}`}>W{wave}</span>
    </Tooltip>
  );
}

const verExplain: Record<'verified' | 'guessed' | 'bounced' | 'missing', string> = {
  verified: 'Confirmed correct — safe to send to.',
  guessed: 'Inferred, never confirmed — sending here risks a bounce or the wrong person.',
  bounced: 'A previous send to this address failed to deliver.',
  missing: 'No value on file yet.',
};

export function VerBadge({ state, label }: { state: 'verified' | 'guessed' | 'bounced' | 'missing'; label?: string }) {
  const map = {
    verified: ['bg-green-600', label ?? 'Verified'],
    guessed: ['bg-amber-500', label ?? 'Guessed — NOT VERIFIED'],
    bounced: ['bg-red-600', label ?? 'Bounced'],
    missing: ['bg-gray-300', label ?? 'Not found'],
  } as const;
  const [dot, text] = map[state];
  return (
    <Tooltip text={verExplain[state]}>
      <span className="inline-flex items-center gap-1 text-xs text-gray-600">
        <span className={`h-2 w-2 rounded-full ${dot}`} /> {text}
      </span>
    </Tooltip>
  );
}

// Prompt 256 §B — marks an Entity summary field that was filled from the
// investor's own MatchDeal profile rather than typed in by the founder. No
// new color: same neutral gray-100/gray-500 pairing already used for
// low-emphasis badges elsewhere on this page (e.g. the "unverified" VerBadge
// label).
export function MatchDealProfileBadge() {
  return (
    <Tooltip text="Pulled from their MatchDeal profile, not typed in by you. Edit the field and your version takes over for good.">
      <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
        from their MatchDeal profile
      </span>
    </Tooltip>
  );
}

export function HardFilterBanner({ entity }: { entity: Entity }) {
  const { resolveHardFilter } = useStore();
  if (entity.hard_filter_status !== 'open' || !entity.hard_filter) return null;
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border-l-4 border-[#B00000] bg-red-50 px-4 py-3">
      <div>
        <div className="text-sm font-semibold text-[#B00000]">⚠ Hard filter open</div>
        <div className="text-sm text-gray-800">{entity.hard_filter}</div>
        <div className="mt-1 text-xs text-gray-500">Address it head-on or resolve it — don’t hope they miss it.</div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button onClick={() => resolveHardFilter(entity.id, 'resolved_ok')}
          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50">Resolved OK</button>
        <button onClick={() => resolveHardFilter(entity.id, 'resolved_blocked')}
          className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50">Blocked</button>
      </div>
    </div>
  );
}

export const PREFLIGHT_EXPLAIN: Record<string, string> = {
  dnc: 'Blocks contact forever once someone has asked not to be approached again.',
  hook: 'A specific, researched reason to reach out — never a generic message.',
  hard_filter: 'A known dealbreaker for this entity that needs addressing or resolving first.',
  contact_lock: 'Only one person per entity is approached at a time — no parallel spraying.',
  seniority: 'Contact the most senior person first; juniors wait until they reply or go dormant.',
  email: 'Only send to an address that has been verified and hasn’t bounced before.',
};

export function PreflightCard({ checks, onProceed, ctaLabel = 'Log outbound' }: {
  checks: PreflightCheck[];
  onProceed?: (overrides: { rule: string; justification: string }[]) => void;
  ctaLabel?: string;
}) {
  const summary = preflightSummary(checks);
  const [showOverride, setShowOverride] = useState(false);
  const [justification, setJustification] = useState('');
  return (
    <Card title="Can I contact?">
      <ul className="space-y-1.5">
        {checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-sm">
            <span className={`mt-0.5 ${c.ok ? 'text-green-600' : 'text-[#B00000]'}`}>{c.ok ? '✓' : '✗'}</span>
            <span className="flex-1">
              <Tooltip text={PREFLIGHT_EXPLAIN[c.key] ?? c.label} side="right">
                <span className={c.ok ? 'text-gray-700' : 'font-medium text-gray-900'}>{c.label}</span>
              </Tooltip>
              {!c.ok && c.reason && <span className="block text-xs text-gray-500">{c.reason}{!c.overridable && ' — no override.'}</span>}
            </span>
            {!c.ok && !c.overridable && <span title="No override">🔒</span>}
          </li>
        ))}
      </ul>
      {onProceed && (
        <div className="mt-3">
          {summary.green ? (
            <button onClick={() => onProceed([])}
              className="w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white hover:bg-[#0c637b]">
              {ctaLabel}
            </button>
          ) : summary.blocked ? (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-[#B00000]">
              Blocked — a non-overridable check failed.
            </div>
          ) : showOverride ? (
            <div className="space-y-2">
              <textarea value={justification} onChange={(e) => setJustification(e.target.value)}
                placeholder="Justification (required — logged in the overrides audit)"
                className="w-full rounded border border-amber-300 p-2 text-sm" rows={2} />
              <div className="flex gap-2">
                <button disabled={justification.trim().length < 5}
                  onClick={() => onProceed(summary.failed.map((f) => ({ rule: f.key, justification })))}
                  className="flex-1 rounded-lg border border-amber-500 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-40">
                  Override & proceed
                </button>
                <button onClick={() => setShowOverride(false)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowOverride(true)}
              className="w-full rounded-lg border border-amber-500 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50">
              Override… ({summary.failed.length} failed)
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

export function PersonEmailBlock({ person }: { person: Person }) {
  const { db } = useStore();
  return (
    <div className="space-y-2 text-sm">
      <div>
        <div className="text-xs text-gray-500">Email (verified)</div>
        {person.email_verified ? (
          <div className="flex items-center gap-2">
            <span className="font-mono">{person.bounce_count > 0 ? <s>{person.email_verified}</s> : person.email_verified}</span>
            {person.bounce_count > 0
              ? <VerBadge state="bounced" label={`Bounced ×${person.bounce_count}`} />
              : (
                <>
                  <VerBadge state="verified" />
                  <a className="rounded border border-gray-300 px-1.5 py-0.5 text-xs hover:bg-gray-50"
                    href={`mailto:${person.email_verified}`}>
                    Compose
                  </a>
                </>
              )}
          </div>
        ) : <div className="text-gray-400">No verified address</div>}
      </div>
      <div>
        <div className="text-xs text-gray-500">Email (guess)</div>
        {person.email_guess ? (
          <div className="flex items-center gap-2 select-none">
            <span className="font-mono text-gray-400">{person.email_guess}</span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">NOT VERIFIED — do not send</span>
          </div>
        ) : <div className="text-gray-400">—</div>}
        {person.email_guess && (
          <div className="text-[11px] text-gray-400">confidence: {person.email_guess_confidence ?? '—'} · source: {person.email_source ?? '—'}</div>
        )}
      </div>
    </div>
  );
}

export function EntityLink({ id, children }: { id: string; children: React.ReactNode }) {
  return <Link href={`/entities/${id}`} className="text-[#0E7490] hover:underline">{children}</Link>;
}
export function PersonLink({ id, children }: { id: string; children: React.ReactNode }) {
  return <Link href={`/people/${id}`} className="text-[#0E7490] hover:underline">{children}</Link>;
}

// IRM_SPEC §2/§3 "Add info" — placeholder for the authored-contribution flow
// (§1), which needs the contributions table + back-office verify queue that
// haven't landed yet. Acknowledges the click instead of silently doing nothing.
export function AddInfoButton() {
  const [clicked, setClicked] = useState(false);
  return (
    <button
      onClick={() => { setClicked(true); setTimeout(() => setClicked(false), 2500); }}
      className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50">
      {clicked ? 'Coming soon — contribution flow lands in a later phase' : '+ Add info'}
    </button>
  );
}

// Every field shown today is a private per-org overlay — nothing is promoted
// to the shared public catalog yet (that split is §1b, back-office verify).
export function PrivateBadge() {
  return (
    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
      private to your org
    </span>
  );
}

// Generic in-page tab bar for pages that merged several routes together
// (Today/Agenda, Dashboard/Review & Optimization, Queue, Settings). Roving
// tabindex + arrow-key navigation per the WAI-ARIA tabs pattern. Active tab
// is owned by the caller (paired with useTabParam so it lives in the URL,
// not component state) — this component only renders and dispatches.
export interface TabItem {
  key: string; label: string; badge?: number;
  // Persistent "light" state — used today for the Company tab's 100%-
  // complete star (companyCompleteness.ts). Not tied to `selected`; stays on
  // whenever the caller says so, active tab or not.
  glow?: boolean; glowTitle?: string;
  // Prompt 86 §13 — lets a page tour anchor a step to a specific tab
  // button (e.g. Dashboard's "Review & Optimization"). Optional; most
  // callers never set it.
  tourId?: string;
}

export function Tabs({ items, active, onChange }: {
  items: TabItem[]; active: string; onChange: (key: string) => void;
}) {
  function onKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = items[(idx + dir + items.length) % items.length];
    onChange(next.key);
    (e.currentTarget.parentElement?.children[(idx + dir + items.length) % items.length] as HTMLElement | undefined)?.focus();
  }

  return (
    <div role="tablist" aria-label="Sections" className="mb-4 flex gap-1 border-b border-gray-100">
      {items.map((it, idx) => {
        const selected = it.key === active;
        return (
          <button key={it.key} role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} title={it.glowTitle}
            data-tour-id={it.tourId} onClick={() => onChange(it.key)} onKeyDown={(e) => onKeyDown(e, idx)}
            className={`relative flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
              selected ? 'border-[#0E7490] text-[#0E7490]' : it.glow ? 'border-transparent text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {it.label}
            {it.glow && <span aria-hidden="true" className="text-amber-500">✦</span>}
            {!!it.badge && (
              <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-white">{it.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function fmtEur(n?: number) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1000) return `€${Math.round(n / 1000)}k`;
  return `€${n}`;
}

// fmtRoundEur lives in @/lib/format-money (plain .ts, not .tsx) so it can
// actually be unit-tested — see that file's header for why.
export { fmtRoundEur } from '@/lib/format-money';
