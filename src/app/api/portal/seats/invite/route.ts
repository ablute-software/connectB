// Prompt 904 Part C — the firm's administrator reserves a seat for an email. Blocked, with the reason,
// when the plan's seats are all taken or reserved. Never says whether the email has an account.
import { NextResponse } from 'next/server';
import { authSeatAdmin } from '@/lib/investor-firm-seats-guard';
import { inviteToSeat } from '@/lib/investor-firm-seats';
import { makeSeatStore } from '@/lib/investor-firm-seats-store';
import { sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { APP_URL, BRAND_NAME } from '@/lib/brand';

export async function POST(req: Request) {
  const auth = await authSeatAdmin();
  if (auth.error) return auth.error;
  const { admin, ctx } = auth;
  const body = await req.json().catch(() => ({})) as { email?: string };

  const result = await inviteToSeat(makeSeatStore(admin), { entityId: ctx.entityId, email: body.email ?? '', actor: ctx.userId });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });

  // Best-effort: the seat is reserved whether or not the email goes out.
  const { data: entity } = await admin.from('catalog_entities').select('name').eq('id', ctx.entityId).maybeSingle();
  const firm = (entity?.name as string | undefined) ?? 'your firm';
  const sent = await sendTransactionalEmail({
    to: (body.email ?? '').trim().toLowerCase(),
    subject: `${firm} reserved a seat for you on ${BRAND_NAME}`,
    html: transactionalTemplate({
      heading: `You have a seat at ${firm}`,
      body: `${firm} reserved a seat for you on ${BRAND_NAME}. Sign up (or sign in) with this email address, search for ${firm} and claim its profile — it will be approved automatically.`,
      ctaLabel: 'Get started', ctaUrl: `${APP_URL}/login`,
      footer: 'If you were not expecting this, you can ignore this email.',
    }),
    context: { kind: 'other' },
  }).catch(() => ({ sent: false }));
  return NextResponse.json({ ok: true, emailSent: !!sent.sent });
}
