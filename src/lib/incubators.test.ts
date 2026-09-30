// Prompt I-01 — a metade pura das incubadoras: níveis (v4 §5.1), acesso por
// estado × nível (D6), graduação (D6b), transições do lado da incubadora, e o
// texto literal que o prompt fixa. As regras reais vivem no SQL; estes testes
// fixam o espelho que a interface usa.
import { describe, expect, it } from 'vitest';
import {
  ALSO_INVESTS_NOTICE, LEVEL_COMING_SOON_TEXT, SHARING_LEVELS, DEFAULT_SHARING_LEVEL,
  defaultLevelNotice, endReasonRequired, endRelationshipConfirmText, founderCanChooseLevel,
  incubatorCanSetStatus, incubatorErrorText, levelAfterGraduation, relationshipGivesAccess,
  slugifyIncubatorName, incubatorInvitePath, INCUBATOR_INVITE_CONTINUE_PATH, maskInviteEmail, inviteEmailMismatchText,
  PROGRAMS_READ_ONLY_NOTE, INCUBATOR_KINDS, RELATIONSHIP_STATUS_LABEL, inviteEmailMatches, type RelationshipStatus,
} from './incubators';
import { can } from './permissions';

describe('níveis de partilha (v4 §5.1, refinamento do D19)', () => {
  it('o modelo tem 0–4, por esta ordem', () => {
    expect(SHARING_LEVELS.map((l) => l.level)).toEqual([0, 1, 2, 3, 4]);
  });
  it('0–2 activos, 3–4 visíveis mas desactivados', () => {
    expect(SHARING_LEVELS.filter((l) => l.enabled).map((l) => l.level)).toEqual([0, 1, 2]);
    expect(SHARING_LEVELS.filter((l) => !l.enabled).map((l) => l.level)).toEqual([3, 4]);
  });
  it('o defeito ao aceitar é 1 · Perfil (D2)', () => {
    expect(DEFAULT_SHARING_LEVEL).toBe(1);
    expect(SHARING_LEVELS[1].label).toBe('1 · Profile');
  });
  it('founderCanChooseLevel aceita 0–2 e recusa 3, 4, negativos e fracções', () => {
    expect([0, 1, 2].every(founderCanChooseLevel)).toBe(true);
    expect([3, 4, -1, 1.5, 5].some(founderCanChooseLevel)).toBe(false);
  });
  it('o texto de "em breve" (inglês, I-01b §C)', () => {
    expect(LEVEL_COMING_SOON_TEXT).toBe('Coming soon — sharing documents and fundraising arrives with its own controls');
    expect(incubatorErrorText('level_coming_soon')).toBe(LEVEL_COMING_SOON_TEXT);
  });
});

describe('acesso por estado × nível (espelho de incubator_can_view, D6)', () => {
  const statuses: RelationshipStatus[] = ['active', 'paused', 'graduated', 'ended'];
  it('active e graduated dão acesso até ao nível partilhado; paused e ended nunca', () => {
    for (const st of statuses) {
      for (let shared = 0; shared <= 4; shared++) {
        for (let req = 0; req <= 4; req++) {
          const expected = (st === 'active' || st === 'graduated') && shared >= req;
          expect(relationshipGivesAccess(st, shared, req)).toBe(expected);
        }
      }
    }
  });
  it('sem período de graça: ended com nível 4 não vê nem o nível 0', () => {
    expect(relationshipGivesAccess('ended', 4, 0)).toBe(false);
    expect(relationshipGivesAccess('paused', 4, 0)).toBe(false);
  });
});

describe('graduação (D6b) e transições do lado da incubadora', () => {
  it('graduar desce para 1 se estava acima, e nunca sobe', () => {
    expect(levelAfterGraduation(2)).toBe(1);
    expect(levelAfterGraduation(4)).toBe(1);
    expect(levelAfterGraduation(1)).toBe(1);
    expect(levelAfterGraduation(0)).toBe(0);
  });
  it('active ⇄ paused, active → graduated; nada de/para ended', () => {
    expect(incubatorCanSetStatus('active', 'paused')).toBe(true);
    expect(incubatorCanSetStatus('paused', 'active')).toBe(true);
    expect(incubatorCanSetStatus('active', 'graduated')).toBe(true);
    expect(incubatorCanSetStatus('paused', 'graduated')).toBe(false);
    expect(incubatorCanSetStatus('graduated', 'active')).toBe(false);
    expect(incubatorCanSetStatus('active', 'ended')).toBe(false);
    expect(incubatorCanSetStatus('ended', 'active')).toBe(false);
  });
  it('terminar: a incubadora tem de dar a razão, o founder não', () => {
    expect(endReasonRequired('incubator')).toBe(true);
    expect(endReasonRequired('founder')).toBe(false);
  });
});

describe('texto literal (I-01 §C.2, §C.4, D3, D6 — em inglês desde o I-01b §C)', () => {
  it('aviso do nível por defeito', () => {
    expect(defaultLevelNotice('Startup Braga')).toBe(
      'By accepting, Startup Braga will see your public profile, your sourced company facts and your roadmap (level 1 · Profile). You can change this at any time in Settings › Programmes, and end the relationship whenever you want.',
    );
  });
  it('aviso D3', () => {
    expect(ALSO_INVESTS_NOTICE).toBe('This organisation is also an investor on Sherlock. What you share here is for the programme, not for the investment committee; the platform never joins the two sides.');
  });
  it('confirmação de fim de relação', () => {
    expect(endRelationshipConfirmText('Startup Braga')).toBe('Startup Braga loses access immediately. It keeps the reports and notes it has already produced.');
  });
  it('nota de só-leitura para manager/member (I-01b §B)', () => {
    expect(PROGRAMS_READ_ONLY_NOTE).toBe('Only owners and admins can accept invites, change sharing or end a programme.');
  });
  it('códigos de erro desconhecidos caem numa mensagem genérica, nunca no código cru', () => {
    expect(incubatorErrorText('xpto')).toBe('Something went wrong. Please try again.');
    expect(incubatorErrorText(undefined)).toBe('Something went wrong. Please try again.');
  });
  it('nenhum texto de interface ficou em português', () => {
    const all = [
      ...SHARING_LEVELS.flatMap((l) => [l.name, l.label, l.includes]), ...INCUBATOR_KINDS.map((k) => k.label),
      ...Object.values(RELATIONSHIP_STATUS_LABEL), LEVEL_COMING_SOON_TEXT, ALSO_INVESTS_NOTICE, PROGRAMS_READ_ONLY_NOTE,
      defaultLevelNotice('X'), endRelationshipConfirmText('X'), inviteEmailMismatchText('ab…@x.pt', 'X'),
      ...['invite_not_found', 'invite_expired', 'no_open_org', 'not_allowed', 'reason_required', 'invite_email_mismatch'].map(incubatorErrorText),
    ].join(' ');
    expect(all).not.toMatch(/\b(convite|relação|partilh|incubadora|razão|nível|programa|aceitar|podes)\b/i);
  });
});

describe('e-mail convidado (I-01b §A) e owner/admin (I-01b §B)', () => {
  it('máscara igual à do SQL: 2 caracteres + …@ + domínio', () => {
    expect(maskInviteEmail('nuno@startup.pt')).toBe('nu…@startup.pt');
    expect(maskInviteEmail('n@x.io')).toBe('n…@x.io');
    expect(maskInviteEmail('sem-arroba')).toBeNull();
    expect(maskInviteEmail(null)).toBeNull();
  });
  it('mensagem de e-mail diferente, com a incubadora', () => {
    expect(inviteEmailMismatchText('nu…@startup.pt', 'Startup Braga')).toBe(
      'This invite was sent to nu…@startup.pt. Sign in with that email, or ask Startup Braga to send the invite to the address you use.',
    );
  });
  it('manage_programs: owner e admin sim; manager, member e sem papel não', () => {
    expect(can('owner', 'manage_programs')).toBe(true);
    expect(can('admin', 'manage_programs')).toBe(true);
    expect(can('manager', 'manage_programs')).toBe(false);
    expect(can('member', 'manage_programs')).toBe(false);
    expect(can(null, 'manage_programs')).toBe(false);
  });
});

describe('helpers', () => {
  it('slug sem acentos nem símbolos', () => {
    expect(slugifyIncubatorName('Incubadora de Braga — Ideias & Negócios')).toBe('incubadora-de-braga-ideias-negocios');
    expect(slugifyIncubatorName('   ')).toBe('organisation');
  });
  it('o token vai no path; o desvio de login usa um path fixo, sem token', () => {
    expect(incubatorInvitePath('abc_DEF-123')).toBe('/invite/incubator/abc_DEF-123');
    expect(INCUBATOR_INVITE_CONTINUE_PATH).not.toContain('?');
  });
});

describe('check-email do signup (I-01b, 30/09): a mesma comparação do SQL', () => {
  it('ignora maiúsculas e espaços; qualquer outro endereço não conta', () => {
    expect(inviteEmailMatches('nuno@startup.pt', '  Nuno@Startup.PT ')).toBe(true);
    expect(inviteEmailMatches('nuno@startup.pt', 'nuno@startup.com')).toBe(false);
    expect(inviteEmailMatches('nuno@startup.pt', '')).toBe(false);
    expect(inviteEmailMatches(null, 'nuno@startup.pt')).toBe(false);
  });
});
