'use client';
// The Pipeline's EMPTY state (and the note for a company that is not raising), in a file of its own.
//
// It lived inside pipeline/page.tsx. It moved on 20/10/2026 because a Next page file may export nothing but the page, and this is now worth rendering in a test and
// in the browser check: Nuno looked at Mob2is' empty pipeline and could not tell why it was empty ("if an action is missing, it should be on the screen"), and the
// sentence under the title is now decided from the server's numbers (pipeline-empty-reason.ts) for each of the situations that used to share one reassuring line.
import { useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import type { PlanTier } from '@/lib/types';
import { pipelineEmptyCopy, pipelineEmptyReason, type UnlockFacts } from '@/lib/pipeline-empty-reason';
import { notRaisingAdvisory } from '@/lib/not-raising-advisory';
import { useOrgActor } from '@/lib/use-org-actor';

// P104 #6 — the copy always described two paths (catalog assignment or
// manual import), but nothing ever called unlockPack() from any UI —
// confirmed by exhaustive grep, 0 rows in pack_unlocks for any real org.
// Self-service, confirmed with Nuno: a button appears and the founder
// triggers the delivery themselves.
//
// Prompt 536 §1 — SELF_SERVICE_COMPLETENESS_THRESHOLD (70% of
// calcCompanyCompleteness) is GONE from this decision, and that removal is
// the fix. Two different definitions of "complete" were live at once: this
// bar opened the button, while isProfileGateComplete() (nine named fields)
// governed the quota. Krohnsty crossed the bar at 13:22 and the gate at
// 13:26 — clicked in between, and the unlock read a quota of 3 instead of
// the 8 it would read four minutes later. The button now gates on exactly
// the predicate that governs the quota, served as `gateComplete` by
// /api/pipeline-unlock, which the page already fetches. Anything less than
// literally the same predicate reopens the race.
// Prompt 579 — `unlimited` (true only for an is_ablute_developer() account,
// migration 0166) means `deliverable` is already the real catalog supply
// left, with no quota ceiling behind it — never the raw sentinel; see
// computeDeliverable in pipeline-unlock-server.ts, the one place this number
// is computed for both this page and the deliver route.
// Prompt 914 — `plan` is the plan the org is on RIGHT NOW (stored ⊕ free trial ⊕ badge), resolved by the same route that computed the
// numbers: the upgrade CTA must not offer "upgrade to Mother Funding" to an org that is already on it through a free trial.
// 20/10/2026 — `quota` and `delivered` (the numbers the route already had) let an EMPTY pipeline say why it is empty: "N of N delivered, next batch on the 1st"
// instead of one sentence that fitted every case (pipeline-empty-reason.ts).
export type UnlockState = { gateComplete: boolean; catalogQuotaTarget: number; deliverable: number; unlimited: boolean; missing: string[]; plan: PlanTier | null; quota: number | null; delivered: number };
// Matched by name, not id — packs have no stable machine key (no `kind`
// column like folders do); acceptable here since this only ever unlocks a
// curated catalog pack, not a security-relevant lookup like Prompt 103's
// Data Room folder fix. Fails safe (button just doesn't render) if renamed.
export const STARTER_PACK_NAME = 'Starter Europe';

// pipeline.empty (onboarding_sherlockdeal_v2.md §3, §1.1) — deliberately
// NOT part of the onboarding engine: no persistence, no dismiss button,
// no `seen` key. It's computed live from db.entities every render and
// disappears the instant it stops being true. `screen` replaces the whole
// page when there are zero entities at all; `banner` sits above the table
// when entities exist but none are wave-classified yet — same copy, same
// key, different container per the implementation note in §3.
export function EmptyCompanyBlock({ variant, unlock, onDelivered }: { variant: 'screen' | 'banner'; unlock: UnlockState | null; onDelivered?: () => void }) {
  const { db, unlockPack } = useStore();
  const [unlocking, setUnlocking] = useState(false);
  const [result, setResult] = useState<'added' | 'none' | null>(null);
  // Prompt 156 — the match runs off the profile data as it stands the
  // instant unlockPack() fires, and (per the plan's monthly cadence) can't
  // be re-run on demand afterward — so this button used to go straight
  // from "eligible" to "unlocked" with nothing in between confirming the
  // founder actually meant to lock that data in now. `confirming` is a
  // pure UI gate in front of the same unlockPack() call below — no new
  // state, no new endpoint, matches this prompt's own "UI only" scope.
  const [confirming, setConfirming] = useState(false);

  const starterPack = db.packs.find((p) => p.name === STARTER_PACK_NAME);
  const { viewer } = useOrgActor();
  // Prompt 536 §1/§3 — one predicate (the profile gate) and one budget
  // (deliverable = quota minus what has already been delivered), both
  // straight from /api/pipeline-unlock. `unlock === null` means the route
  // hasn't answered yet, or auth is off (demo mode): fall back to the old
  // pack-presence check there rather than hiding the button on a page that
  // simply hasn't loaded its state — demo mode has no server to ask.
  //
  // 20/10/2026 (Nuno, on Mob2is: "why is the pipeline empty? if an action is missing it should be on the screen"): the sentence under the title is now decided
  // from the same numbers (pipeline-empty-reason.ts) — which says WHICH of "profile incomplete / investors waiting for one click / every investor of the plan
  // delivered, next batch on the 1st / nothing left that matches / none included" this is — instead of one reassuring line that fitted all of them.
  const facts: UnlockFacts = unlock ?? { gateComplete: true, deliverable: 1, unlimited: false, missing: [], quota: null, delivered: 0 };
  const reason = pipelineEmptyReason(facts, !!starterPack, new Date());
  const gateComplete = facts.gateComplete;
  const eligible = reason.kind === 'ready_to_unlock';
  const onMaxPlan = (unlock?.plan ?? db.org.plan) === 'motherfunding';
  // Upgrading is offered only where it is a way out (the allowance is spent, or there is none) and there is a higher plan to go to.
  const canUpgrade = !onMaxPlan && (reason.kind === 'quota_spent' || reason.kind === 'plan_has_none');
  const READ_ONLY_TITLE = 'Read-only: you are viewing this company as a developer';

  async function runUnlock() {
    if (!starterPack) return;
    setUnlocking(true);
    const added = await unlockPack(starterPack.id);
    setUnlocking(false);
    setConfirming(false);
    setResult(added > 0 ? 'added' : 'none');
    onDelivered?.();
  }

  return (
    <div className={variant === 'screen' ? 'flex min-h-[50vh] items-center justify-center' : 'rounded-2xl border border-gray-100 bg-white p-6 shadow-sm'}>
      <div className="mx-auto max-w-[420px] text-center">
        <div className="mx-auto mb-5 flex h-[80px] w-[80px] items-center justify-center rounded-full bg-gray-50 text-3xl">🔍</div>
        {confirming ? (
          <>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">Congratulations — we have enough to show you your best-matched investors</h2>
            <p className="mb-5 text-sm text-gray-500">
              Confirm your company profile is accurate before you unlock — the match uses this data as it stands right now.
              If something&apos;s wrong, fix it first: you won&apos;t get a fresh match until your plan&apos;s monthly renewal.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button disabled={unlocking} onClick={runUnlock}
                className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c637b] disabled:opacity-50">
                {unlocking ? 'Unlocking…' : 'Confirm and unlock my pipeline'}
              </button>
              <button disabled={unlocking} onClick={() => setConfirming(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                Let me check my profile first
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">No investors in the pipeline yet</h2>
            <p className="mb-5 text-sm text-gray-500">
              {/* Prompt 536 §1 — the profile case names the fields (a percentage from a different calculation is what produced "70% complete, now unlock"
                  followed by an under-delivered pipeline); the others say which of the quota's numbers is the reason. */}
              {pipelineEmptyCopy(reason, { onMaxPlan })}
            </p>
            {result === 'added' && <p className="mb-3 text-sm font-medium text-emerald-700">Done — check the table below.</p>}
            {result === 'none' && <p className="mb-3 text-sm text-gray-500">No new investors left in this pack for your account.</p>}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {eligible && (
                <button onClick={() => setConfirming(true)} disabled={viewer} title={viewer ? READ_ONLY_TITLE : undefined}
                  className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c637b] disabled:opacity-50">
                  Unlock my pipeline
                </button>
              )}
              {canUpgrade && (
                <Link href="/plans" className="inline-block rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c637b]">
                  View plans
                </Link>
              )}
              {reason.kind === 'no_matches_left' && (
                <Link href="/settings?tab=company" className="inline-block rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Review your profile
                </Link>
              )}
              {/* "Import contacts instead" used to land on /settings, i.e. the Company tab; the importer is the Import history tab. */}
              <Link href={gateComplete ? '/settings?tab=import-history' : '/settings'} className="inline-block rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                {gateComplete ? 'Import contacts instead' : 'Complete your profile'}
              </Link>
            </div>
            <NotRaisingNotice />
          </>
        )}
      </div>
    </div>
  );
}

// Nuno, 20/10/2026: "if an action is missing, say so on the screen, with the option to fix it". A company that told us it is NOT raising has one — and what that
// setting really does is narrower than it sounds (not-raising-advisory.ts says what, and only what, the code does). The change is visible to investors (the ones who
// watch the company can be alerted that a round opened), so it is a two-step: ask, then change. A Developer Viewer sees the note and the button, disabled; a member
// who may not change the organisation's settings sees the note only.
function NotRaisingNotice() {
  const { db, updateOrg } = useStore();
  const { viewer, canManageOrgSettings } = useOrgActor();
  const [confirming, setConfirming] = useState(false);
  const advisory = notRaisingAdvisory({ roundRaising: db.org.round_raising, companyName: db.org.name });
  if (!advisory) return null;
  return (
    <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-left text-xs text-amber-900">
      <p className="font-semibold">{advisory.title}</p>
      <p className="mt-0.5">{advisory.body}</p>
      {(canManageOrgSettings || viewer) && (confirming ? (
        <div className="mt-2">
          <p>{advisory.confirmBody}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => { updateOrg({ round_raising: true }); setConfirming(false); }}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0c637b]">
              Yes, mark as raising
            </button>
            <button type="button" onClick={() => setConfirming(false)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
              Keep it as it is
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} disabled={viewer} title={viewer ? 'Read-only: you are viewing this company as a developer' : undefined}
          className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50">
          {advisory.actionLabel}
        </button>
      ))}
    </div>
  );
}
