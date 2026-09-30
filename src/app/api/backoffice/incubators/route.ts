// Prompt I-01 §C.1 — Backoffice › Incubadoras: list + create. Platform admin
// only (requirePlatformAdmin + middleware), service role, every mutation in
// admin_audit_log. Never writes orgs/org_members/access_grants.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';
import { parseIncubatorFields } from '@/lib/incubator-admin-input';

// Per-user, per-request data: never prerendered (an env-less build would
// otherwise freeze the not-configured answer into a static file).
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [{ data: incubators, error }, { data: members }, { data: rels }] = await Promise.all([
    admin.from('incubators').select('*').order('created_at', { ascending: false }),
    admin.from('incubator_members').select('id, incubator_id, role, status, full_name, invited_email, user_id'),
    admin.from('incubator_relationships').select('incubator_id, status'),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Member e-mails live in auth.users; resolve only the ones with a user.
  const userIds = Array.from(new Set((members ?? []).map((m) => m.user_id).filter(Boolean))) as string[];
  const emails = new Map<string, string>();
  await Promise.all(userIds.map(async (id) => {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) emails.set(id, data.user.email);
  }));

  const list = (incubators ?? []).map((i) => {
    const ms = (members ?? []).filter((m) => m.incubator_id === i.id && m.status !== 'removed');
    return {
      ...i,
      members: ms.map((m) => ({
        id: m.id, role: m.role, status: m.status, full_name: m.full_name,
        email: (m.user_id && emails.get(m.user_id)) || m.invited_email,
      })),
      active_relationships: (rels ?? []).filter((r) => r.incubator_id === i.id && (r.status === 'active' || r.status === 'graduated')).length,
    };
  });
  return NextResponse.json({ ok: true, incubators: list });
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const parsed = parseIncubatorFields(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  // A taken slug gets a numeric suffix rather than an error — the admin never
  // chose it, it is derived from the name.
  let slug = parsed.fields.slug;
  for (let n = 2; n < 50; n++) {
    const { data: taken } = await admin.from('incubators').select('id').eq('slug', slug).maybeSingle();
    if (!taken) break;
    slug = `${parsed.fields.slug}-${n}`;
  }

  const { data, error } = await admin.from('incubators').insert({ ...parsed.fields, slug }).select('*').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  await logAdminAction(admin, { adminUserId: userId, action: 'incubator_created', subjectType: 'incubator', subjectId: data.id, detail: { name: data.name, kind: data.kind, is_test: data.is_test } });
  return NextResponse.json({ ok: true, incubator: data });
}
