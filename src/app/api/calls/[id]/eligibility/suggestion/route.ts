// Prompt 918 (I2) — "Suggested rules": the entity discards what the import left for the eligibility step; it does not come back. (Accepting one is just creating the rule: nothing becomes a rule without a click.)
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { dismissSuggestion } from '@/lib/calls/eligibility-store';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({})) as { text?: unknown };
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return NextResponse.json({ ok: false, error: 'Nothing to discard.' }, { status: 400 });
  await dismissSuggestion(auth.admin, auth.call.id, text, auth.userId);
  return NextResponse.json({ ok: true });
}
