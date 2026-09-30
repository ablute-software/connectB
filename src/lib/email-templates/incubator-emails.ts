// Prompt I-01 §C.5 — the four incubator e-mails. Plain text, PT, no
// elaborate HTML in this prompt: the HTML part is the shared
// transactionalTemplate shell around the same text (escaped). Pure builders
// — the sending (resend.ts + email_send_log) is incubator-email-server.ts.
import { defaultLevelNotice } from '../incubators';

export interface BuiltEmail { subject: string; text: string; heading: string; body: string; ctaLabel?: string; ctaUrl?: string }

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The incubator's name leads — it is her brand that makes the invite
// trustworthy (I-01 §C.5).
export function startupInviteEmail(v: {
  incubatorName: string; startupName: string | null; url: string;
  voucher?: { planLabel: string; months: number | null } | null;
}): BuiltEmail {
  // "a Alfa" when the stub has a name, "a tua startup" when it does not —
  // never "a a tua startup".
  const startup = v.startupName?.trim() ? `a ${v.startupName.trim()}` : 'a tua startup';
  const subject = `${v.incubatorName} convidou ${startup} para o Sherlock Deal`;
  const voucherLine = v.voucher
    ? `\nO convite inclui um voucher: plano ${v.voucher.planLabel}${v.voucher.months ? ` durante ${v.voucher.months} meses` : ''}, oferecido pela ${v.incubatorName}.\n`
    : '';
  const body = [
    `A ${v.incubatorName} convidou ${startup} para acompanhar o programa no Sherlock Deal.`,
    voucherLine.trim(),
    defaultLevelNotice(v.incubatorName),
    'Nada fica ligado até aceitares.',
  ].filter(Boolean).join('\n\n');
  const text = `${body}\n\nAbrir o convite: ${v.url}\n\nO link é pessoal e expira em 30 dias.`;
  return { subject, text, heading: `${v.incubatorName} convidou-te`, body, ctaLabel: 'Ver o convite', ctaUrl: v.url };
}

export function memberInviteEmail(v: { incubatorName: string; role: 'owner' | 'manager'; url: string }): BuiltEmail {
  const roleLabel = v.role === 'owner' ? 'owner' : 'gestor(a)';
  const subject = `Convite para a equipa da ${v.incubatorName} no Sherlock Deal`;
  const body = `Foste convidado(a) como ${roleLabel} do workspace da ${v.incubatorName} no Sherlock Deal. Entra com este e-mail para aceitar.`;
  const text = `${body}\n\nAceitar o convite: ${v.url}\n\nO link é pessoal e expira em 14 dias.`;
  return { subject, text, heading: `Equipa da ${v.incubatorName}`, body, ctaLabel: 'Aceitar', ctaUrl: v.url };
}

// To the founder, when the incubator ends the relationship (with its reason).
export function relationshipEndedByIncubatorEmail(v: { incubatorName: string; reason: string; url: string }): BuiltEmail {
  const subject = `A ${v.incubatorName} terminou a relação com a tua startup`;
  const body = `A ${v.incubatorName} terminou a relação no Sherlock Deal. A partir de agora deixa de ter acesso ao que partilhavas com ela.\n\nRazão indicada: ${v.reason}`;
  const text = `${body}\n\nVer os teus programas: ${v.url}`;
  return { subject, text, heading: 'Relação terminada', body, ctaLabel: 'Ver programas', ctaUrl: v.url };
}

// To the incubator, when the founder ends it (no reason if none was given).
export function relationshipEndedByFounderEmail(v: { startupName: string; reason: string | null; url: string }): BuiltEmail {
  const subject = `A ${v.startupName} terminou a relação com o programa`;
  const body = `A ${v.startupName} terminou a relação no Sherlock Deal. O acesso vivo aos dados da startup terminou de imediato; os relatórios e notas que já produziram ficam convosco.`
    + (v.reason ? `\n\nRazão indicada: ${v.reason}` : '');
  const text = `${body}\n\nAbrir o portfolio: ${v.url}`;
  return { subject, text, heading: 'Relação terminada', body, ctaLabel: 'Abrir o portfolio', ctaUrl: v.url };
}
