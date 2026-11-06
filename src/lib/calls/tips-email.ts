import 'server-only';
// Prompt 929 (B) — the email of the tips: sent by Sherlock Deal (never in the name of the entity, never with its reply address), separate from the entity's own reply, in the language of the call. It carries the
// sentences chosen by the engine (up to 3) and the invitation to complete the startup profile — or ONLY the invitation when there is nothing clear to say. It carries no score, no position, no number of criteria, no
// name of a criterion, no evaluator and no comment: it is built from the model sentences and the name of the call, and nothing else. The footer has the link that stops these emails ("Stop receiving tips").
import { sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { preferenceToken } from '@/lib/email-preferences';
import { emailLinkFor } from './applicant/notices';
import { INVITATION, TIPS_TEXT, type TipLanguage } from './tips-templates';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const REPLY: Record<TipLanguage, string> = { en: 'The organisation has already sent you its reply.', pt: 'A organização já lhe enviou a sua resposta.' };

export interface TipsEmail { subject: string; html: string; text: string }

/** The email, built (also used for the preview the team sees before publishing: what is previewed is what is sent). */
export function buildTipsEmail(opts: { callName: string; language: TipLanguage; sentences: string[]; userId: string }): TipsEmail {
  const t = TIPS_TEXT[opts.language];
  const origin = emailLinkFor({ linkToken: null });
  const token = preferenceToken(opts.userId, 'tips_opt_out');
  const stop = token ? `${origin}/api/email/unsubscribe?t=${encodeURIComponent(token)}` : null;
  const has = opts.sentences.length > 0;
  const lead = has ? t.intro : REPLY[opts.language];
  const list = opts.sentences.map((s) => `• ${s}`);
  const heading = has ? t.heading : t.appTitle;
  const bodyHtml = [esc(lead), ...(has ? [list.map(esc).join('<br>')] : []), esc(INVITATION[opts.language])].join('<br><br>');
  const footer = `${stop ? `<a href="${esc(stop)}" style="color: #6B7280;">${esc(t.unsubscribe)}</a> · ` : ''}${esc(t.footerNote)}`;
  return {
    subject: t.subject(opts.callName),
    html: transactionalTemplate({ heading: esc(heading), body: bodyHtml, ctaLabel: esc(t.cta), ctaUrl: `${origin}/settings`, footer }),
    text: [heading, '', lead, ...(has ? ['', ...list] : []), '', INVITATION[opts.language], '', `${t.cta}: ${origin}/settings`, ...(stop ? ['', `${t.unsubscribe}: ${stop}`] : []), t.footerNote].join('\n'),
  };
}

/** Sends it. Never throws: a failed email is reported so the caller can try again later. */
export async function sendTipsEmail(to: string, email: TipsEmail): Promise<boolean> {
  try {
    const res = await sendTransactionalEmail({ to, subject: email.subject, html: email.html, text: email.text, context: { kind: 'other' } });
    return res.sent === true;
  } catch (e) {
    console.error('[calls] the tips email failed:', (e as Error).message);
    return false;
  }
}
