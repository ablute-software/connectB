// Prompt 904 Part C — who is the caller on their firm's seats, shared by the /api/portal/seats/* routes
// and by the colleagues-revoke route (so "who may remove a seat" is decided in ONE place).
import 'server-only';
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { isSeatAdminRole, type FirmSeatPlan } from '@/lib/investor-firm-seats';
import { makeSeatStore } from '@/lib/investor-firm-seats-store';

export interface SeatContext {
  userId: string;
  email: string | null;
  entityId: string;
  memberId: string;
  role: string | null;
  /** The firm's custom plan, or null for a firm on the 1/2/5 tiers. */
  plan: FirmSeatPlan | null;
  /** An administrator of THIS firm (seat role owner/admin) — only meaningful when `plan` is set. */
  isAdmin: boolean;
}

export async function resolveSeatContext(admin: SupabaseClient, user: { id: string; email?: string | null }): Promise<SeatContext | null> {
  // allowBillingLapsed: a firm in arrears must still be able to see (and free) its seats.
  const own = await resolveActiveInvestorMember(admin, user.id, { allowBillingLapsed: true });
  if (!own) return null;
  const [{ data: row }, plan] = await Promise.all([
    admin.from('matchdeal_investor_members').select('role').eq('id', own.id).maybeSingle(),
    makeSeatStore(admin).getPlan(own.catalog_entity_id),
  ]);
  const role = (row?.role as string | null | undefined) ?? null;
  return {
    userId: user.id, email: user.email ?? null, entityId: own.catalog_entity_id, memberId: own.id,
    role, plan, isAdmin: isSeatAdminRole(role),
  };
}

export type SeatRouteAuth =
  | { admin: SupabaseClient; ctx: SeatContext; error?: undefined }
  | { error: NextResponse; admin?: undefined; ctx?: undefined };

/** Signed in + linked to a firm. Does NOT require a plan or admin: callers add what they need. */
export async function authSeatCaller(): Promise<SeatRouteAuth> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return { error: NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 }) };
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const ctx = await resolveSeatContext(admin, user);
  if (!ctx) return { error: NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 }) };
  return { admin, ctx };
}

/** The caller must administer a firm that HAS a custom plan. Everything else is a clear refusal. */
export async function authSeatAdmin(): Promise<SeatRouteAuth> {
  const auth = await authSeatCaller();
  if (auth.error) return auth;
  if (!auth.ctx.plan) return { error: NextResponse.json({ ok: false, error: 'This firm has no custom seat plan.' }, { status: 400 }) };
  if (!auth.ctx.isAdmin) {
    return { error: NextResponse.json({ ok: false, error: "Only your firm's administrators can manage seats." }, { status: 403 }) };
  }
  return auth;
}

/**
 * C5 — the firm a person was removed from, for the "You're no longer part of X" screen: their most
 * recent REVOKED membership, only when they hold no active one anywhere.
 */
export async function findRemovedFirm(admin: SupabaseClient, userId: string): Promise<{ entityId: string; entityName: string } | null> {
  const { data: rows } = await admin.from('matchdeal_investor_members').select('catalog_entity_id, status, created_at')
    .eq('user_id', userId).order('created_at', { ascending: false });
  const list = (rows ?? []) as { catalog_entity_id: string; status: string }[];
  if (list.some((r) => r.status === 'active')) return null;
  const removed = list.find((r) => r.status === 'revoked');
  if (!removed) return null;
  const { data: entity } = await admin.from('catalog_entities').select('name').eq('id', removed.catalog_entity_id).maybeSingle();
  return { entityId: removed.catalog_entity_id, entityName: (entity?.name as string | undefined) ?? 'your firm' };
}
