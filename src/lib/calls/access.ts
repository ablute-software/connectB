// Prompt 905 — who may touch the Calls area, decided in ONE place and re-checked by every route (never only
// by the visibility of a button). Layers, in order:
//   1. the CALLS_MODE switch (off -> 404, as if the routes did not exist; allowlist -> only listed emails);
//   2. a signed-in user;
//   3. membership of a promoting entity: an investor firm (matchdeal_investor_members) or an ecosystem
//      organisation (incubator_members);
//   4. for anything that writes, the role: owner/admin of an investor firm, owner/manager of an ecosystem
//      organisation (the highest roles each side has; finer permission categories arrive in Stage 3);
//   5. for a given call, that it belongs to a promoter the caller is a member of. A call of another entity answers
//      404, never 403: its existence is not revealed.
import 'server-only';
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authEnabled, serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { resolveIncubatorMember } from '@/lib/incubator-access-core';
import { callsAllowedFor, callsMode } from './mode';
import { loadCall, promoterName } from './store';
import type { Call, PromoterKind } from './types';

export interface Promoter {
  kind: PromoterKind;
  id: string;
  name: string;
  role: string;
  /** May create and edit calls (Stage 1: the top roles of each side). */
  canManage: boolean;
}

export const INVESTOR_MANAGE_ROLES = ['owner', 'admin'];
export const INCUBATOR_MANAGE_ROLES = ['owner', 'manager'];

export function canManageRole(kind: PromoterKind, role: string | null | undefined): boolean {
  return !!role && (kind === 'incubator' ? INCUBATOR_MANAGE_ROLES : INVESTOR_MANAGE_ROLES).includes(role);
}

export async function listPromoters(
  admin: SupabaseClient, sb: Awaited<ReturnType<typeof serverClient>>, userId: string,
): Promise<Promoter[]> {
  const out: Promoter[] = [];
  const firm = await resolveActiveInvestorMember(admin, userId, { allowBillingLapsed: true });
  if (firm) {
    const { data } = await admin.from('matchdeal_investor_members').select('role').eq('id', firm.id).maybeSingle();
    const role = ((data as { role?: string } | null)?.role as string | undefined) ?? 'member';
    out.push({ kind: 'catalog_entity', id: firm.catalog_entity_id, name: await promoterName(admin, 'catalog_entity', firm.catalog_entity_id), role, canManage: canManageRole('catalog_entity', role) });
  }
  const org = await resolveIncubatorMember(sb, userId);
  if (org) out.push({ kind: 'incubator', id: org.incubatorId, name: org.incubatorName, role: org.role, canManage: canManageRole('incubator', org.role) });
  return out;
}

export interface CallsAuth { admin: SupabaseClient; userId: string; email: string | null; promoters: Promoter[] }
export type CallsGate<T> = ({ error?: undefined } & T) | { error: NextResponse };

const notFound = () => NextResponse.json({ ok: false }, { status: 404 });

/** Switch + session + at least one promoter. */
export async function authCalls(): Promise<CallsGate<CallsAuth>> {
  // Switch off: the routes do not exist, for anyone (even signed out) — nothing to probe.
  if (callsMode() === 'off') return { error: notFound() };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!authEnabled || !url || !service) return { error: NextResponse.json({ ok: false, error: 'not configured', demo: true }, { status: 200 }) };
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  if (!callsAllowedFor(user.email)) return { error: notFound() };
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const promoters = await listPromoters(admin, sb, user.id);
  if (promoters.length === 0) return { error: NextResponse.json({ ok: false, error: 'Calls are for investors and ecosystem organisations.' }, { status: 403 }) };
  return { admin, userId: user.id, email: user.email ?? null, promoters };
}

/** The promoter the caller acts for: the requested kind, else their only one. */
export function pickPromoter(promoters: Promoter[], kind: string | null | undefined): Promoter | null {
  if (kind === 'catalog_entity' || kind === 'incubator') return promoters.find((p) => p.kind === kind) ?? null;
  return promoters.length === 1 ? promoters[0] : null;
}

export interface CallAuth extends CallsAuth { call: Call; promoter: Promoter }

/** Switch + session + THIS call, which must belong to one of the caller's promoters (and, to write, they must manage). */
export async function authCall(callId: string, opts: { write?: boolean } = {}): Promise<CallsGate<CallAuth>> {
  const auth = await authCalls();
  if (auth.error) return auth;
  const call = await loadCall(auth.admin, callId);
  const promoter = call ? auth.promoters.find((p) => p.kind === call.promoterKind && p.id === call.promoterId) : undefined;
  if (!call || !promoter) return { error: notFound() };
  if (opts.write && !promoter.canManage) {
    return { error: NextResponse.json({ ok: false, error: 'Only the owners and administrators of your organisation can change a call.' }, { status: 403 }) };
  }
  return { ...auth, call, promoter };
}
