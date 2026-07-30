// SherlockDeal_Metricas_BackOffice_V1, Section 1.2 — customer-assistance
// actions: grant a discount/extension/pack-or-feature-unlock, or flag an
// org for commercial contact. Generic on purpose (org_type/org_ref_id) —
// the same shape Section 12.3 (Organizations tab, a later phase) describes
// for its own "apply benefit" action, built once so that tab doesn't need
// a second table. Today only investor orgs (catalog_entities.id) have a UI
// wired to this; startups (orgs.id) can use the same route once a
// customer-assistance panel exists on that side too.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

const ACTION_TYPES = ['discount', 'extension', 'pack_unlock', 'feature_unlock', 'flag_commercial_contact', 'other'] as const;

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { searchParams } = new URL(req.url);
  const orgType = searchParams.get('orgType');
  const orgRefId = searchParams.get('orgRefId');
  if (!orgType || !orgRefId) return NextResponse.json({ ok: false, error: 'orgType and orgRefId are required.' }, { status: 400 });

  const { data, error } = await admin.from('admin_org_actions')
    .select('id, action_type, starts_at, ends_at, value, reason, status, created_by, created_at')
    .eq('org_type', orgType).eq('org_ref_id', orgRefId).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, actions: data });
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json() as {
    orgType?: 'startup' | 'investor'; orgRefId?: string; actionType?: string;
    endsAt?: string | null; value?: string | null; reason?: string;
  };
  if (!body.orgType || !body.orgRefId || !body.actionType || !body.reason?.trim()) {
    return NextResponse.json({ ok: false, error: 'orgType, orgRefId, actionType, and reason are required.' }, { status: 400 });
  }
  if (!ACTION_TYPES.includes(body.actionType as typeof ACTION_TYPES[number])) {
    return NextResponse.json({ ok: false, error: 'Invalid actionType.' }, { status: 400 });
  }

  const { data: created, error } = await admin.from('admin_org_actions').insert({
    org_type: body.orgType, org_ref_id: body.orgRefId, action_type: body.actionType,
    ends_at: body.endsAt || null, value: body.value || null, reason: body.reason.trim(), created_by: userId,
  }).select('id').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: userId, action: 'org_benefit_granted', subjectType: body.orgType, subjectId: body.orgRefId,
    detail: { actionType: body.actionType, value: body.value, endsAt: body.endsAt, reason: body.reason },
  });
  return NextResponse.json({ ok: true, id: created.id });
}

export async function PATCH(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json() as { id?: string };
  if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });

  const { error } = await admin.from('admin_org_actions').update({ status: 'revoked' }).eq('id', body.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, { adminUserId: userId, action: 'org_benefit_revoked', subjectType: 'admin_org_actions', subjectId: body.id });
  return NextResponse.json({ ok: true });
}
