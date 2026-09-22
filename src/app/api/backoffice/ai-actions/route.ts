// Prompt 706 Bloco C.3 — list every ai_actions row, for the backoffice
// editor (name, cost, needs_confirmation, and the enabled "kill switch").
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data, error } = await admin.from('ai_actions').select('*').order('category').order('label');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, actions: data });
}
