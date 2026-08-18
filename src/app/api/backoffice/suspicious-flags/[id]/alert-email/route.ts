// Prompt 244/245 — action 1 of 3: "Enviar mail de alerta". Reuses Resend
// (resend.ts) like every other transactional email in this codebase.
// Minimal template for now — the prompt's own text says the final wording
// is confirmed later and shouldn't block building this.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { suspiciousFlagsAvailable } from '@/lib/suspicious-flags-capability';
import { resendConfigured, sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { BRAND_NAME } from '@/lib/brand';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;
  if (!(await suspiciousFlagsAvailable())) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });

  const { data: flag, error: flagErr } = await admin.from('suspicious_account_flags').select('id, email, company_name').eq('id', params.id).maybeSingle();
  if (flagErr) return NextResponse.json({ ok: false, error: flagErr.message }, { status: 500 });
  if (!flag) return NextResponse.json({ ok: false, error: 'Flag not found.' }, { status: 404 });
  if (!flag.email) return NextResponse.json({ ok: false, error: 'This flag has no email on file to alert.' }, { status: 400 });

  let emailId: string | undefined;
  if (resendConfigured) {
    const result = await sendTransactionalEmail({
      to: flag.email,
      subject: `${BRAND_NAME} — unusual activity on your account`,
      html: transactionalTemplate({
        heading: 'Unusual activity on your account',
        body: `We detected activity outside the usual pattern on your ${BRAND_NAME} account. `
          + `If you don't recognize this, reply to this email and we'll look into it right away.`,
      }),
    });
    if (!result.sent) return NextResponse.json({ ok: false, error: result.error ?? 'Email sending failed.' }, { status: 502 });
    emailId = result.id;
  } else {
    return NextResponse.json({ ok: false, error: 'Email sending is not available in this workspace yet.' }, { status: 200 });
  }

  const { error: logErr } = await admin.from('suspicious_account_flag_actions').insert({
    flag_id: params.id, action_type: 'alert_email', email_id: emailId ?? null, actor: userId,
  });
  if (logErr) return NextResponse.json({ ok: false, error: logErr.message }, { status: 500 });

  await admin.from('suspicious_account_flags').update({ status: 'actioned' }).eq('id', params.id);

  return NextResponse.json({ ok: true, emailId });
}
