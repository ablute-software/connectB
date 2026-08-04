// Prompt 123 Block C.2 — the "History" subtab: every moderation action
// (suspend/undo/delete), optionally filtered to one target. actorEmail is
// resolved via listUsers (account_moderation_actions only stores the uuid).
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const url = new URL(req.url);
  const targetType = url.searchParams.get('targetType');
  const targetId = url.searchParams.get('targetId');

  let query = admin.from('account_moderation_actions').select('*').order('created_at', { ascending: false }).limit(200);
  if (targetType) query = query.eq('target_type', targetType);
  if (targetId) query = query.eq('target_id', targetId);
  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const actorIds = Array.from(new Set((rows ?? []).map((r) => r.actor as string)));
  const emailById = new Map<string, string>();
  for (const id of actorIds) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (data?.user?.email) emailById.set(id, data.user.email);
  }

  return NextResponse.json({
    ok: true,
    actions: (rows ?? []).map((r) => ({
      id: r.id, targetType: r.target_type, targetId: r.target_id, action: r.action,
      justification: r.justification, actorEmail: emailById.get(r.actor as string) ?? r.actor,
      createdAt: r.created_at, quarantineUntil: r.quarantine_until,
    })),
  });
}
