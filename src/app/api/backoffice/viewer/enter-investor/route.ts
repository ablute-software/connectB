// Prompt 611 §F — entering an investor FIRM's account.
//
// The audit ACTION is the same one, deliberately: `viewer_enter`, with
// subject_type 'investor_entity' and subject_id = catalog_entities.id. §F is
// explicit about why — "não criem uma acção de auditoria nova. É o mesmo acto
// — olhar para dentro da conta de alguém — e tem de responder à mesma
// pergunta com a mesma consulta: quem entrou, onde, quando, porquê, e por
// quanto tempo. Dois nomes diferentes para o mesmo acto é como se perde a
// resposta." So one query over admin_audit_log answers it for both sides.
//
// By the FIRM and not the person: an investor is not an org, and what a
// member does is split across three different keys (see §F's table). Nuno's
// decision is the firm, so the subject is the firm.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { VIEWER_INVESTOR_COOKIE, VIEWER_COOKIE_MAX_AGE, readInvestorViewerSession } from '@/lib/developer-viewer';
import { normalizeViewerReason } from '@/lib/viewer-reason';

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { entityId, reason: rawReason } = await req.json().catch(() => ({})) as { entityId?: string; reason?: string };
  if (!entityId) return NextResponse.json({ ok: false, error: 'entityId is required.' }, { status: 400 });

  const reasonCheck = normalizeViewerReason(rawReason);
  if (!reasonCheck.ok) return NextResponse.json({ ok: false, error: reasonCheck.error }, { status: 400 });

  const { data: entity } = await admin.from('catalog_entities').select('id, name').eq('id', entityId).maybeSingle();
  if (!entity) return NextResponse.json({ ok: false, error: 'Investor firm not found.' }, { status: 404 });

  // Same "close the hanging one first" rule the org route learned in Prompt
  // 598: two entries with no exit between them make the duration
  // unanswerable, which is half of what the log is for.
  const existing = readInvestorViewerSession(req);
  if (existing) {
    await admin.from('admin_audit_log').insert({
      admin_user_id: userId, action: 'viewer_exit', subject_type: 'investor_entity', subject_id: existing.orgId,
      detail: { durationMs: Date.now() - new Date(existing.enteredAt).getTime(), closedBy: 'viewer_enter' },
    });
  }

  const enteredAt = new Date().toISOString();
  await admin.from('admin_audit_log').insert({
    admin_user_id: userId, action: 'viewer_enter', subject_type: 'investor_entity', subject_id: entityId,
    detail: { firmName: entity.name, enteredAt, reason: reasonCheck.reason },
  });

  const response = NextResponse.json({ ok: true, firmName: entity.name });
  response.cookies.set(VIEWER_INVESTOR_COOKIE, `${entityId}:${enteredAt}`, {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: VIEWER_COOKIE_MAX_AGE,
  });
  return response;
}
