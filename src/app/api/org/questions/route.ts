// Investor Workspace Fase 3 (prompt 56), Bloco 1 — founder-side Q&A: see
// every question for the org, answer, optionally promote to FAQ.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { resendConfigured, sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';

export async function GET() {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ error: 'Not a member of any org.' }, { status: 403 });

  const { data: questions } = await sb.from('portal_questions').select('*').eq('org_id', member.org_id).order('created_at', { ascending: false });
  return NextResponse.json({ questions: questions ?? [] });
}

export async function PATCH(req: Request) {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { id?: string; answer?: string; is_faq?: boolean };
  const { id, answer, is_faq } = body;
  if (!id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });

  const { data: question } = await sb.from('portal_questions').select('org_id, asked_by_email').eq('id', id).maybeSingle();
  if (!question || question.org_id !== member.org_id) return NextResponse.json({ ok: false, error: 'Question not found.' }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (answer !== undefined) { patch.answer = answer; patch.answered_at = new Date().toISOString(); patch.answered_by = user.id; }
  if (is_faq !== undefined) patch.is_faq = is_faq;
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 });

  const { error } = await sb.from('portal_questions').update(patch).eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Bloco 1 point 4 — investor notified by email of the answer. Same
  // env-gated, best-effort pattern as every other transactional send in
  // this codebase: a missing/failed send never blocks the answer itself.
  if (answer !== undefined && resendConfigured) {
    await sendTransactionalEmail({
      to: question.asked_by_email,
      subject: 'Your question was answered',
      html: transactionalTemplate({
        heading: 'You have an answer', body: answer,
        ctaLabel: 'Open the portal', ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/portal`,
      }),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
