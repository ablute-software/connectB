// Prompt 706 Bloco C.1 — list every plan (built-in + custom) and create a
// new custom one. Same shape as the Promo Codes screen's own collection
// route (GET + POST here, PATCH/DELETE on the [key] route) — the closest
// existing "list of editable named records + create button" precedent in
// this backoffice.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAdminAction } from '@/lib/audit';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data, error } = await admin.from('plans').select('*').order('is_custom').order('key');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, plans: data });
}

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { key, label, monthlyAiCredits } = await req.json().catch(() => ({})) as {
    key?: string; label?: string; monthlyAiCredits?: number;
  };
  if (!key?.trim() || !label?.trim()) return NextResponse.json({ ok: false, error: 'Key and label are required.' }, { status: 400 });
  if (!/^[a-z0-9_]+$/.test(key)) return NextResponse.json({ ok: false, error: 'Key must be lowercase letters, digits, underscores only.' }, { status: 400 });
  if (!Number.isInteger(monthlyAiCredits) || (monthlyAiCredits as number) < 0) {
    return NextResponse.json({ ok: false, error: 'Monthly AI credits must be a non-negative whole number.' }, { status: 400 });
  }

  // Custom plans only, from this route — the three built-in tiers (idea/
  // garage/motherfunding) are seeded by the migration and edited via PATCH
  // on the [key] route, never re-created here.
  const { data, error } = await admin.from('plans')
    .insert({ key, label, monthly_ai_credits: monthlyAiCredits, is_custom: true })
    .select('*').single();
  if (error) {
    if (error.code === '23505') return NextResponse.json({ ok: false, error: `A plan with key "${key}" already exists.` }, { status: 409 });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  await logAdminAction(admin, { adminUserId: userId, action: 'ai_plan_create', subjectType: 'plans', subjectId: key, detail: { label, monthlyAiCredits } });
  return NextResponse.json({ ok: true, plan: data });
}
