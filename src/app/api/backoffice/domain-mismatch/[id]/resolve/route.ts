// Prompt 284 §1 — resolves one Domain mismatch queue row. Three actions,
// all admin-clicked, nothing automatic: apply_suggestion/edit_manually
// both write a new email_domain; mark_correct writes no value at all — the
// existing one is already right (the Crista Galli case: a legitimate
// different domain on purpose). Every action sets email_domain_verified =
// true, which is what drops the row out of the status route's query —
// that column's own pre-existing meaning, not a new "resolved" flag.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

type Action = 'apply_suggestion' | 'edit_manually' | 'mark_correct';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const body = await req.json().catch(() => ({})) as { action?: Action; domain?: string };
  if (body.action !== 'apply_suggestion' && body.action !== 'edit_manually' && body.action !== 'mark_correct') {
    return NextResponse.json({ ok: false, error: 'Invalid action.' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { email_domain_verified: true };
  if (body.action === 'apply_suggestion' || body.action === 'edit_manually') {
    const domain = body.domain?.trim();
    if (!domain) return NextResponse.json({ ok: false, error: 'A domain is required for this action.' }, { status: 400 });
    patch.email_domain = domain;
  }

  const { error } = await admin.from('entities').update(patch).eq('id', params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: userId, action: 'domain_mismatch_resolve', subjectType: 'entity', subjectId: params.id,
    detail: { resolveAction: body.action, domain: patch.email_domain ?? null },
  });
  return NextResponse.json({ ok: true });
}
