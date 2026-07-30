// PLAN-02/03 — back-office queue for Private Detective (4th investor plan)
// contact requests. Same requirePlatformAdmin() gate as every other
// backoffice route.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

const STATUSES = ['new', 'under_review', 'contacted', 'proposal_sent', 'converted', 'closed'] as const;

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: requests, error } = await admin.from('investor_plan_contact_requests')
    .select('id, created_at, first_name, last_name, email, investor_type, firm_name, message, firm_website, linkedin, status, internal_notes')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, requests: requests ?? [] });
}

export async function PATCH(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const body = await req.json().catch(() => ({})) as { id?: string; status?: string; internal_notes?: string };
  const { id, status, internal_notes } = body;
  if (!id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
  if (status !== undefined && !(STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ ok: false, error: 'Invalid status.' }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status !== undefined) update.status = status;
  if (internal_notes !== undefined) update.internal_notes = internal_notes;

  const { error } = await admin.from('investor_plan_contact_requests').update(update).eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
