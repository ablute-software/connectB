// Prompt I-01 — a metade pura das incubadoras: níveis (v4 §5.1), acesso por
// estado × nível (D6), graduação (D6b), transições do lado da incubadora, e o
// texto literal que o prompt fixa. As regras reais vivem no SQL; estes testes
// fixam o espelho que a interface usa.
import { describe, expect, it } from 'vitest';
import {
  ALSO_INVESTS_NOTICE, LEVEL_COMING_SOON_TEXT, SHARING_LEVELS, DEFAULT_SHARING_LEVEL,
  defaultLevelNotice, endReasonRequired, endRelationshipConfirmText, founderCanChooseLevel,
  incubatorCanSetStatus, incubatorErrorText, levelAfterGraduation, relationshipGivesAccess,
  slugifyIncubatorName, incubatorInvitePath, INCUBATOR_INVITE_CONTINUE_PATH, type RelationshipStatus,
} from './incubators';

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
    expect(SHARING_LEVELS[1].label).toBe('1 · Perfil');
  });
  it('founderCanChooseLevel aceita 0–2 e recusa 3, 4, negativos e fracções', () => {
    expect([0, 1, 2].every(founderCanChooseLevel)).toBe(true);
    expect([3, 4, -1, 1.5, 5].some(founderCanChooseLevel)).toBe(false);
  });
  it('o texto de "em breve" é o literal do prompt', () => {
    expect(LEVEL_COMING_SOON_TEXT).toBe('Disponível em breve — a partilha de documentos e da angariação chega com controlos próprios');
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

describe('texto literal (I-01 §C.2, §C.4, D3, D6)', () => {
  it('aviso do nível por defeito', () => {
    expect(defaultLevelNotice('Startup Braga')).toBe(
      'Ao aceitar, a Startup Braga passa a ver o teu perfil público, os factos da empresa com fonte e o roadmap (nível 1 · Perfil). Podes mudar isto a qualquer momento em Definições › Programas, e terminar a relação quando quiseres.',
    );
  });
  it('aviso D3', () => {
    expect(ALSO_INVESTS_NOTICE).toBe('Esta organização também é investidora na Sherlock. O que partilhas aqui é para o programa, não para o comité de investimento; a plataforma não cruza os dois lados.');
  });
  it('confirmação de fim de relação', () => {
    expect(endRelationshipConfirmText('Startup Braga')).toBe('A Startup Braga perde o acesso de imediato. Mantém os relatórios e notas que já produziu.');
  });
  it('códigos de erro desconhecidos caem numa mensagem genérica, nunca no código cru', () => {
    expect(incubatorErrorText('xpto')).toBe('Algo correu mal. Tenta de novo.');
    expect(incubatorErrorText(undefined)).toBe('Algo correu mal. Tenta de novo.');
  });
});

describe('helpers', () => {
  it('slug sem acentos nem símbolos', () => {
    expect(slugifyIncubatorName('Incubadora de Braga — Ideias & Negócios')).toBe('incubadora-de-braga-ideias-negocios');
    expect(slugifyIncubatorName('   ')).toBe('incubadora');
  });
  it('o token vai no path; o desvio de login usa um path fixo, sem token', () => {
    expect(incubatorInvitePath('abc_DEF-123')).toBe('/invite/incubator/abc_DEF-123');
    expect(INCUBATOR_INVITE_CONTINUE_PATH).not.toContain('?');
  });
});
