// Prompt I-01 §C.5 — os quatro e-mails: assunto, marca da incubadora em
// destaque, a frase do nível 1, a razão só quando existe.
import { describe, expect, it } from 'vitest';
import {
  escapeHtml, memberInviteEmail, relationshipEndedByFounderEmail, relationshipEndedByIncubatorEmail, startupInviteEmail,
} from './incubator-emails';
import { defaultLevelNotice } from '../incubators';

describe('e-mails das incubadoras', () => {
  it('convite à startup: assunto do prompt, nível 1, link', () => {
    const e = startupInviteEmail({ incubatorName: 'Startup Braga', startupName: 'Alfa', url: 'https://x/invite/incubator/T' });
    expect(e.subject).toBe('Startup Braga convidou a Alfa para o Sherlock Deal');
    expect(e.text).toContain(defaultLevelNotice('Startup Braga'));
    expect(e.text).toContain('https://x/invite/incubator/T');
    expect(e.text).not.toContain('voucher');
  });
  it('convite com voucher menciona plano e duração', () => {
    const e = startupInviteEmail({ incubatorName: 'Inc', startupName: null, url: 'u', voucher: { planLabel: 'Garage', months: 12 } });
    expect(e.subject).toBe('Inc convidou a tua startup para o Sherlock Deal');
    expect(e.text).toContain('plano Garage durante 12 meses');
  });
  it('convite de membro', () => {
    expect(memberInviteEmail({ incubatorName: 'Inc', role: 'manager', url: 'u' }).subject).toBe('Convite para a equipa da Inc no Sherlock Deal');
  });
  it('fim pela incubadora leva a razão ao founder', () => {
    expect(relationshipEndedByIncubatorEmail({ incubatorName: 'Inc', reason: 'Programa encerrado', url: 'u' }).text).toContain('Razão indicada: Programa encerrado');
  });
  it('fim pelo founder: sem razão se ele não deu', () => {
    expect(relationshipEndedByFounderEmail({ startupName: 'Alfa', reason: null, url: 'u' }).text).not.toContain('Razão');
    expect(relationshipEndedByFounderEmail({ startupName: 'Alfa', reason: 'Mudámos de programa', url: 'u' }).text).toContain('Razão indicada: Mudámos de programa');
  });
  it('escapeHtml', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
});
