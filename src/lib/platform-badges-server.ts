// Prompt 601 — server-side composition for platform badges. Pure decision
// logic lives in platform-badges.ts; this file is the DB reads/writes, the
// Stripe coupon calls and the daily tech-master window sweep.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stripeConfigured, stripeSecret } from './stripe-env';
import { sendTransactionalEmail } from './resend';
import { BRAND_NAME } from './brand';
import {
  badgeCouponFor, formatDate, freePeriodActive, isBadgeActive, techMasterWindow, warningDue,
  BADGE_COUPON_PIONEER, BADGE_COUPON_TECH_MASTER, PIONEER_MIN_DISCOUNT_PCT, TECH_MASTER_MIN_ACTIVE_SECONDS,
  type PlatformBadgeKey, type PlatformBadgeRow,
} from './platform-badges';
import type { PlanTier } from './types';

type DbRow = {
  id: string; org_id: string; badge: PlatformBadgeKey; granted_at: string; granted_by: string | null; justification: string;
  free_tier: PlanTier | null; free_until: string | null; discount_pct: number | null; stripe_coupon_applied: string | null;
  revoked_at: string | null; revoked_by: string | null; revoke_reason: string | null;
  lapsed_at: string | null; lapse_reviewed_at: string | null; lapse_reviewed_by: string | null;
  last_warning_pct: number; last_warning_at: string | null; sedulous_count: number;
};

export const PLATFORM_BADGE_COLUMNS = 'id, org_id, badge, granted_at, granted_by, justification, free_tier, free_until, discount_pct, stripe_coupon_applied, revoked_at, revoked_by, revoke_reason, lapsed_at, lapse_reviewed_at, lapse_reviewed_by, last_warning_pct, last_warning_at, sedulous_count';

export function toBadgeRow(r: DbRow): PlatformBadgeRow {
  return {
    id: r.id, badge: r.badge, grantedAt: r.granted_at, justification: r.justification,
    freeTier: r.free_tier, freeUntil: r.free_until, discountPct: r.discount_pct,
    revokedAt: r.revoked_at, lapsedAt: r.lapsed_at, lapseReviewedAt: r.lapse_reviewed_at,
    lastWarningPct: r.last_warning_pct ?? 0, sedulousCount: r.sedulous_count ?? 0,
  };
}

/**
 * An org's badges: the table's active rows, plus Prompt 161's
 * orgs.pioneer_badge flag surfaced as a pioneer row when no pioneer row
 * exists — one reader for both truths, so the org badged before this table
 * existed (ablute_) keeps its rights without a data migration.
 */
export async function loadOrgPlatformBadges(admin: SupabaseClient, orgId: string): Promise<PlatformBadgeRow[]> {
  const [{ data: rows, error }, { data: org }] = await Promise.all([
    admin.from('platform_badges').select(PLATFORM_BADGE_COLUMNS).eq('org_id', orgId).is('revoked_at', null),
    admin.from('orgs').select('pioneer_badge').eq('id', orgId).maybeSingle(),
  ]);
  const out = error ? [] : ((rows ?? []) as unknown as DbRow[]).map(toBadgeRow);
  if (org?.pioneer_badge && !out.some((r) => r.badge === 'pioneer')) {
    out.push({
      id: null, badge: 'pioneer', grantedAt: '1970-01-01T00:00:00.000Z', justification: 'Pioneer promo code (Prompt 161)',
      freeTier: null, freeUntil: null, discountPct: PIONEER_MIN_DISCOUNT_PCT,
      revokedAt: null, lapsedAt: null, lapseReviewedAt: null, lastWarningPct: 0, sedulousCount: 0, legacy: true,
    });
  }
  return out;
}

export interface UsageSummary { lastUse: string | null; sessions60d: number; activeDays60d: number }

export async function orgUsageSummary(admin: SupabaseClient, orgId: string): Promise<UsageSummary> {
  const { data } = await admin.rpc('platform_badge_usage_summary', { p_org_id: orgId, p_min_active_seconds: TECH_MASTER_MIN_ACTIVE_SECONDS });
  const row = (data as { last_use: string | null; sessions_60d: number; active_days_60d: number }[] | null)?.[0];
  return { lastUse: row?.last_use ?? null, sessions60d: Number(row?.sessions_60d ?? 0), activeDays60d: Number(row?.active_days_60d ?? 0) };
}

// ---------------------------------------------------------------- Stripe

async function stripeForm(method: 'POST' | 'DELETE', path: string, form?: URLSearchParams): Promise<{ ok: boolean; code?: string; message?: string }> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${stripeSecret()}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form?.toString(),
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  return { ok: false, code: body?.error?.code, message: body?.error?.message };
}

/**
 * Create-or-reuse a badge coupon (same idempotent id scheme as checkout's
 * promo coupons: the first call creates it, every later one hits
 * resource_already_exists and reuses it).
 */
export async function ensureBadgeCoupon(id: string, percentOff: number, durationMonths: number | null = null): Promise<string | null> {
  if (!stripeConfigured()) return null;
  const form = new URLSearchParams();
  form.set('id', id);
  form.set('percent_off', String(percentOff));
  if (durationMonths == null) form.set('duration', 'forever');
  else { form.set('duration', 'repeating'); form.set('duration_in_months', String(durationMonths)); }
  const r = await stripeForm('POST', '/coupons', form);
  if (r.ok || r.code === 'resource_already_exists') return id;
  console.error('Stripe badge coupon create error:', r.code, r.message);
  return null;
}

/** §E — "isto se reflecte no Stripe": a coupon on the LIVE subscription, which then persists on every renewal and plan switch. */
export async function applyCouponToSubscription(subscriptionId: string, couponId: string): Promise<{ ok: boolean; error?: string }> {
  if (!stripeConfigured()) return { ok: false, error: 'Billing not configured.' };
  const form = new URLSearchParams();
  form.set('coupon', couponId);
  const r = await stripeForm('POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, form);
  return r.ok ? { ok: true } : { ok: false, error: `${r.code ?? 'error'}: ${r.message ?? ''}`.trim() };
}

export async function removeSubscriptionDiscount(subscriptionId: string): Promise<{ ok: boolean; error?: string }> {
  if (!stripeConfigured()) return { ok: false, error: 'Billing not configured.' };
  const r = await stripeForm('DELETE', `/subscriptions/${encodeURIComponent(subscriptionId)}/discount`);
  // No discount on the subscription is the state we wanted.
  if (r.ok || r.code === 'resource_missing') return { ok: true };
  return { ok: false, error: `${r.code ?? 'error'}: ${r.message ?? ''}`.trim() };
}

function monthsBetween(from: Date, to: Date): number {
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (30 * 24 * 60 * 60 * 1000)));
}

/**
 * The coupon a freshly granted badge should put on an EXISTING subscription
 * right now (nothing if the org has no subscription — then checkout is
 * blocked and there is simply nothing to charge). Tech master: 100%
 * forever. Pioneer inside its free period: 100% for the remaining months
 * (the sweep swaps it for the 25% one when the period ends); pioneer with
 * no free period: 25% forever.
 */
export async function applyBadgeCouponToOrgSubscription(
  admin: SupabaseClient, orgId: string, row: PlatformBadgeRow, now: Date,
): Promise<{ applied: string | null; error?: string; noSubscription?: boolean }> {
  const { data: org } = await admin.from('orgs').select('stripe_subscription_id').eq('id', orgId).maybeSingle();
  const subId = org?.stripe_subscription_id as string | null | undefined;
  if (!subId) return { applied: null, noSubscription: true };
  if (!stripeConfigured()) return { applied: null, error: 'Billing not configured.' };

  let couponId: string | null = null;
  if (row.badge === 'tech_master') {
    couponId = await ensureBadgeCoupon(BADGE_COUPON_TECH_MASTER, 100);
  } else if (row.badge === 'pioneer') {
    if (freePeriodActive(row, now) && row.freeUntil) {
      const months = monthsBetween(now, new Date(row.freeUntil));
      couponId = await ensureBadgeCoupon(`platform-badge-pioneer-free-${months}m`, 100, months);
    } else {
      couponId = await ensureBadgeCoupon(BADGE_COUPON_PIONEER, row.discountPct ?? PIONEER_MIN_DISCOUNT_PCT);
    }
  }
  if (!couponId) return { applied: null, error: 'Could not create the Stripe coupon.' };
  const r = await applyCouponToSubscription(subId, couponId);
  if (!r.ok) return { applied: null, error: r.error };
  if (row.id) await admin.from('platform_badges').update({ stripe_coupon_applied: couponId }).eq('id', row.id);
  return { applied: couponId };
}

// ------------------------------------------------------- notifications

export async function orgOwnerEmails(admin: SupabaseClient, orgId: string): Promise<string[]> {
  const { data: members } = await admin.from('org_members').select('user_id, role').eq('org_id', orgId);
  const ids = (members ?? []).filter((m) => m.role === 'owner' || m.role === 'admin').map((m) => m.user_id as string).slice(0, 5);
  const emails: string[] = [];
  for (const id of ids) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) emails.push(data.user.email);
  }
  return emails;
}

const IN_APP_SOURCE = 'platform_badge_tech_master';

/**
 * The in-app half of a warning: one open founder task per org (the Today
 * page is where a founder already looks for what needs doing), updated in
 * place rather than duplicated on each threshold.
 */
async function upsertInAppNotice(admin: SupabaseClient, orgId: string, title: string, notes: string, dueAt: string | null): Promise<void> {
  const { data: existing } = await admin.from('tasks').select('id').eq('org_id', orgId).eq('source', IN_APP_SOURCE).eq('done', false).limit(1).maybeSingle();
  if (existing) {
    await admin.from('tasks').update({ title, notes, due_at: dueAt }).eq('id', existing.id);
  } else {
    await admin.from('tasks').insert({ org_id: orgId, title, notes, due_at: dueAt, kind: 'admin', action_type: 'other', source: IN_APP_SOURCE, done: false });
  }
}

async function closeInAppNotice(admin: SupabaseClient, orgId: string): Promise<void> {
  await admin.from('tasks').update({ done: true }).eq('org_id', orgId).eq('source', IN_APP_SOURCE).eq('done', false);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function emailOwners(admin: SupabaseClient, orgId: string, subject: string, paragraphs: string[]): Promise<number> {
  const to = await orgOwnerEmails(admin, orgId);
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1f2937">${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}<p style="color:#6b7280;font-size:12px">${escapeHtml(BRAND_NAME)}</p></div>`;
  let sent = 0;
  for (const recipient of to) {
    const r = await sendTransactionalEmail({ to: recipient, subject, html, text: paragraphs.join('\n\n'), context: { orgId, kind: 'other' } });
    if (r.sent) sent++;
  }
  return sent;
}

async function systemAudit(admin: SupabaseClient, action: string, orgId: string, detail: unknown): Promise<void> {
  await admin.from('admin_audit_log').insert({ admin_user_id: null, action, subject_type: 'org', subject_id: orgId, detail });
}

// ----------------------------------------------------------- the sweep

export interface TechMasterSweepResult {
  checked: number; warningsSent: number; lapsed: number; reinstated: number; pioneerCouponsSwitched: number;
}

/**
 * Daily (from /api/automations). For every active tech master:
 *  - a qualifying use after a lapse reinstates the status (§F "reentrada");
 *  - 75/90/98% of the 2-month window → email to the owners + in-app notice,
 *    each threshold once (§C);
 *  - 100% with no use → `lapsed_at` (the admin queue), rights UNTOUCHED,
 *    nothing charged, until a person decides (§F).
 * And for every pioneer whose free period ended with a subscription still on
 * the free coupon: switch it to the 25% one, once.
 */
export async function runTechMasterWindowSweep(admin: SupabaseClient, nowIso: string): Promise<TechMasterSweepResult> {
  const now = new Date(nowIso);
  const result: TechMasterSweepResult = { checked: 0, warningsSent: 0, lapsed: 0, reinstated: 0, pioneerCouponsSwitched: 0 };

  const { data: rows, error } = await admin.from('platform_badges').select(`${PLATFORM_BADGE_COLUMNS}, orgs(name, is_test)`)
    .is('revoked_at', null).in('badge', ['tech_master', 'pioneer']);
  if (error) throw new Error(`platform_badges: ${error.message}`);

  for (const raw of (rows ?? []) as unknown as (DbRow & { orgs: { name: string; is_test: boolean } | null })[]) {
    if (raw.orgs?.is_test) continue;
    const row = toBadgeRow(raw);
    const orgName = raw.orgs?.name ?? raw.org_id;

    if (row.badge === 'pioneer') {
      if (row.freeUntil && new Date(row.freeUntil) <= now && raw.stripe_coupon_applied && raw.stripe_coupon_applied !== BADGE_COUPON_PIONEER) {
        const r = await applyBadgeCouponToOrgSubscription(admin, raw.org_id, row, now);
        if (r.applied) {
          result.pioneerCouponsSwitched++;
          await systemAudit(admin, 'platform_badge_coupon_applied', raw.org_id, { badge: 'pioneer', orgName, coupon: r.applied, reason: 'free period ended' });
        } else if (r.error) {
          console.error(`[platform-badges] pioneer coupon switch failed for org=${raw.org_id}: ${r.error}`);
        }
      }
      continue;
    }

    result.checked++;
    const usage = await orgUsageSummary(admin, raw.org_id);

    // §F — re-entry: a real use after the lapse restores the status by
    // itself, unless a person already revoked it (revoked rows never reach
    // this loop).
    if (row.lapsedAt && usage.lastUse && new Date(usage.lastUse) > new Date(row.lapsedAt)) {
      await admin.from('platform_badges').update({ lapsed_at: null, lapse_reviewed_at: null, lapse_reviewed_by: null, last_warning_pct: 0 }).eq('id', raw.id);
      await closeInAppNotice(admin, raw.org_id);
      await systemAudit(admin, 'platform_badge_reinstated', raw.org_id, { badge: 'tech_master', orgName, lapsedAt: row.lapsedAt, lastUse: usage.lastUse, by: 'daily sweep' });
      result.reinstated++;
      continue;
    }
    if (row.lapsedAt) continue; // already in the queue; nothing more to do until a person or a use acts

    const window = techMasterWindow(row, usage.lastUse, now);

    if (window.lapsed) {
      await admin.from('platform_badges').update({ lapsed_at: nowIso }).eq('id', raw.id);
      await upsertInAppNotice(admin, raw.org_id,
        'Your tech master status is under review — use Sherlock to restore it',
        'Two months passed without a use. Nothing was revoked and nothing is charged; using Sherlock again restores the status automatically unless the team has decided otherwise.',
        null);
      const sent = await emailOwners(admin, raw.org_id, `Your ${BRAND_NAME} tech master status is under review`, [
        `Hello — your company's tech master status on ${BRAND_NAME} stays free for as long as ${BRAND_NAME} is used at least once every 2 months.`,
        `That window passed on ${formatDate(window.deadlineAt)} without a use (last use: ${usage.lastUse ? formatDate(usage.lastUse) : 'none since the status was granted'}).`,
        'Nothing has been revoked and nothing is charged. A person on the team reviews it before anything changes — and simply using the app again restores the status by itself.',
      ]);
      await systemAudit(admin, 'platform_badge_lapsed', raw.org_id, { badge: 'tech_master', orgName, anchorAt: window.anchorAt, deadlineAt: window.deadlineAt, lastUse: usage.lastUse, emailsSent: sent });
      result.lapsed++;
      continue;
    }

    const due = warningDue(window.elapsedPct, row.lastWarningPct);
    if (due == null) continue;
    await admin.from('platform_badges').update({ last_warning_pct: due, last_warning_at: nowIso }).eq('id', raw.id);
    await upsertInAppNotice(admin, raw.org_id,
      `Use Sherlock before ${formatDate(window.deadlineAt)} to keep your tech master status`,
      `${due}% of the 2-month window has passed since the last use. Any real use of the app before ${formatDate(window.deadlineAt)} keeps the status free. If the window passes, nothing is charged before a person on the team looks at it.`,
      window.deadlineAt);
    const sent = await emailOwners(admin, raw.org_id, `Your ${BRAND_NAME} tech master status — ${window.daysLeft} day${window.daysLeft === 1 ? '' : 's'} left`, [
      `Hello — your company's tech master status on ${BRAND_NAME} stays free for as long as ${BRAND_NAME} is used at least once every 2 months.`,
      `${due}% of that window has now passed (last use: ${usage.lastUse ? formatDate(usage.lastUse) : 'none since the status was granted'}). Use ${BRAND_NAME} before ${formatDate(window.deadlineAt)} to keep it.`,
      'If the window passes, nothing happens automatically: a person on the team reviews it first, and using the app again restores the status.',
    ]);
    await systemAudit(admin, 'platform_badge_warning', raw.org_id, { badge: 'tech_master', orgName, pct: due, daysLeft: window.daysLeft, deadlineAt: window.deadlineAt, lastUse: usage.lastUse, emailsSent: sent });
    result.warningsSent++;
  }

  return result;
}

/**
 * §F re-entry on the write path: called from the usage heartbeat, so a
 * lapsed tech master who opens the app is restored within a minute rather
 * than at the next daily tick. One indexed no-op update for everyone else.
 */
export async function reinstateLapsedTechMasterOnUse(admin: SupabaseClient, orgId: string, nowIso: string): Promise<boolean> {
  const { data } = await admin.from('platform_badges')
    .update({ lapsed_at: null, lapse_reviewed_at: null, lapse_reviewed_by: null, last_warning_pct: 0 })
    .eq('org_id', orgId).eq('badge', 'tech_master').is('revoked_at', null).not('lapsed_at', 'is', null)
    .select('id');
  if (!data || data.length === 0) return false;
  await closeInAppNotice(admin, orgId);
  await systemAudit(admin, 'platform_badge_reinstated', orgId, { badge: 'tech_master', at: nowIso, by: 'usage heartbeat' });
  return true;
}

/** Convenience for readers that only need the coupon decision for an org. */
export async function orgBadgeCoupon(admin: SupabaseClient, orgId: string, now: Date) {
  const rows = await loadOrgPlatformBadges(admin, orgId);
  return { rows, coupon: badgeCouponFor(rows, now), active: rows.filter(isBadgeActive) };
}
