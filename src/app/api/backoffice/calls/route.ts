// Prompt 908 — back-office, Calls (read only): every call of every promoter, one row each, with who runs it,
// how many applications it has (NUMBERS ONLY — submitted, and in progress; never an answer, never a draft's
// content), its link, its dates and, for the expanded row, phases, fields per page and who confirmed it.
// Platform admin only, checked here as well as by the middleware. Nothing here writes, and it does not even
// sync a call's status: it shows the status as it is right now (effectiveStatus) without touching the row.
// Not behind CALLS_MODE: that switch hides the entities' tab; the platform team always sees what exists.
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { rowToCall } from '@/lib/calls/mappers';
import { effectiveStatus } from '@/lib/calls/lifecycle';
import type { BackofficeCallRow, PersonRef } from '@/lib/calls/backoffice-view';

// A GET with no request argument is otherwise prerendered at build time and frozen: this answer is per caller and per moment.
export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: callRows, error } = await admin.from('calls').select('*').order('created_at', { ascending: false }).limit(1000);
  if (error) return NextResponse.json({ ok: false, error: 'Calls are not available yet.' }, { status: 200 });
  const calls = ((callRows ?? []) as Row[]).map((r) => ({ call: rowToCall(r), validatedBy: (r.validated_by as string | null) ?? null }));
  if (calls.length === 0) return NextResponse.json({ ok: true, rows: [] });

  const callIds = calls.map((c) => c.call.id);
  const firmIds = [...new Set(calls.filter((c) => c.call.promoterKind === 'catalog_entity').map((c) => c.call.promoterId))];
  const incIds = [...new Set(calls.filter((c) => c.call.promoterKind === 'incubator').map((c) => c.call.promoterId))];

  const [{ data: firms }, { data: incs }, { data: apps }, { data: phases }, { data: fields }] = await Promise.all([
    firmIds.length ? admin.from('catalog_entities').select('id, name, is_test').in('id', firmIds) : Promise.resolve({ data: [] }),
    incIds.length ? admin.from('incubators').select('id, name, is_test').in('id', incIds) : Promise.resolve({ data: [] }),
    // Only the status: an application's content is never read by this route.
    admin.from('call_applications').select('call_id, status').in('call_id', callIds),
    admin.from('call_phases').select('call_id, position, name, starts_on, ends_on').in('call_id', callIds).order('position', { ascending: true }),
    admin.from('call_form_fields').select('call_id, page').in('call_id', callIds),
  ]);

  const orgOf = new Map<string, { name: string; isTest: boolean }>();
  for (const f of (firms ?? []) as Row[]) orgOf.set(`catalog_entity:${f.id}`, { name: String(f.name), isTest: f.is_test === true });
  for (const i of (incs ?? []) as Row[]) orgOf.set(`incubator:${i.id}`, { name: String(i.name), isTest: i.is_test === true });

  const appCount = new Map<string, { submitted: number; inProgress: number }>();
  for (const a of (apps ?? []) as Row[]) {
    const c = appCount.get(a.call_id as string) ?? { submitted: 0, inProgress: 0 };
    if (a.status === 'submitted') c.submitted++; else if (a.status === 'draft') c.inProgress++;
    appCount.set(a.call_id as string, c);
  }
  const phasesOf = new Map<string, BackofficeCallRow['phases']>();
  for (const p of (phases ?? []) as Row[]) {
    const list = phasesOf.get(p.call_id as string) ?? [];
    list.push({ name: String(p.name), startsOn: (p.starts_on as string | null) ?? null, endsOn: (p.ends_on as string | null) ?? null });
    phasesOf.set(p.call_id as string, list);
  }
  const pagesOf = new Map<string, Map<number, number>>();
  for (const f of (fields ?? []) as Row[]) {
    const m = pagesOf.get(f.call_id as string) ?? new Map<number, number>();
    m.set(f.page as number, (m.get(f.page as number) ?? 0) + 1);
    pagesOf.set(f.call_id as string, m);
  }

  // People: one lookup per distinct user, with the best name we have for them.
  const userIds = [...new Set(calls.flatMap((c) => [c.call.createdBy, c.validatedBy]).filter((x): x is string => !!x))];
  const people = new Map<string, PersonRef>();
  await Promise.all(userIds.map(async (id) => { people.set(id, await personOf(admin, id, calls.map((c) => c.call))); }));

  const now = new Date();
  const rows: BackofficeCallRow[] = calls.map(({ call, validatedBy }) => ({
    id: call.id, name: call.name, status: effectiveStatus(call, now),
    organisation: {
      kind: call.promoterKind, id: call.promoterId, isTest: orgOf.get(`${call.promoterKind}:${call.promoterId}`)?.isTest ?? false,
      name: orgOf.get(`${call.promoterKind}:${call.promoterId}`)?.name ?? 'Unknown organisation',
    },
    admin: people.get(call.createdBy) ?? { name: null, email: null },
    applications: appCount.get(call.id) ?? { submitted: 0, inProgress: 0 },
    linkToken: call.linkToken, timezone: call.timezone, createdAt: call.createdAt, opensAt: call.opensAt, closesAt: call.closesAt,
    phases: phasesOf.get(call.id) ?? [],
    fieldsPerPage: [...(pagesOf.get(call.id) ?? new Map<number, number>())].sort((a, b) => a[0] - b[0]).map(([page, n]) => ({ page, fields: n })),
    validatedBy: validatedBy ? people.get(validatedBy) ?? { name: null, email: null } : null,
    validatedAt: call.validatedAt, publishedAt: call.publishedAt,
  }));
  return NextResponse.json({ ok: true, rows });
}

/** Name and email of a user: the account's own name if it has one, else the name they gave their firm/organisation. */
async function personOf(admin: SupabaseClient, userId: string, calls: { promoterKind: string; promoterId: string }[]): Promise<PersonRef> {
  const { data } = await admin.auth.admin.getUserById(userId);
  const user = data?.user;
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  let name = (typeof meta.full_name === 'string' && meta.full_name.trim()) || (typeof meta.name === 'string' && meta.name.trim()) || null;
  if (!name) {
    const firmIds = [...new Set(calls.filter((c) => c.promoterKind === 'catalog_entity').map((c) => c.promoterId))];
    if (firmIds.length) {
      const { data: m } = await admin.from('matchdeal_investor_members').select('id').eq('user_id', userId).in('catalog_entity_id', firmIds).limit(1).maybeSingle();
      if (m) {
        const { data: p } = await admin.from('matchdeal_profiles').select('representative_name').eq('membership_id', (m as Row).id as string).eq('kind', 'investor').limit(1).maybeSingle();
        name = ((p as Row | null)?.representative_name as string | null) || null;
      }
    }
  }
  if (!name) {
    const { data: ims } = await admin.from('incubator_members').select('full_name').eq('user_id', userId).limit(5);
    name = ((ims ?? []) as Row[]).map((m) => m.full_name as string | null).find((n) => !!n) ?? null;
  }
  return { name, email: user?.email?.toLowerCase() ?? null };
}
