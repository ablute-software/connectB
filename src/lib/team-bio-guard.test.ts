import { describe, expect, it } from 'vitest';
import {
  checkBioLoss, removeFactSentencesFromBio, stripUnverifiedHqClaims, detectFoundedYearConflict, capConfidenceOnConflict,
} from './team-bio-guard';

describe('checkBioLoss — nunca gravar uma bio que perca informação da actual', () => {
  it('a fixture real: perder o PhD, o professorado e o instituto do Hugo Ferreira', () => {
    const current = 'PhD in Physics and a degree in Medicine from the University of Lisbon, currently an Associate '
      + 'Professor and principal investigator at the Institute of Biophysics and Biomedical Engineering, founder and '
      + 'C-level advisor of multiple start-ups.';
    const next = 'With a background in physics, he contributes to the scientific and technical development.';
    const result = checkBioLoss(current, next);
    expect(result.lost).toBe(true);
    expect(result.reasons.some((r) => r.includes('shorter'))).toBe(true);
  });

  it('bio nova mais curta dispara a guarda', () => {
    expect(checkBioLoss('A long detailed bio about Carla Dias and the RECARDI project.', 'Short bio.').lost).toBe(true);
  });

  it('bio nova que perde uma entidade nomeada dispara a guarda mesmo sendo mais longa', () => {
    const current = 'Carla Dias leads the RECARDI project.';
    const next = 'She leads a health innovation project with broad clinical partnerships across the region and beyond.';
    const result = checkBioLoss(current, next);
    expect(result.lost).toBe(true);
    expect(result.reasons.some((r) => r.toLowerCase().includes('recardi'))).toBe(true);
  });

  it('bio nova que perde uma data dispara a guarda', () => {
    const result = checkBioLoss('Joined the company in 2021 as CTO.', 'Joined the company as CTO of the founding team.');
    expect(result.lost).toBe(true);
    expect(result.reasons.some((r) => r.includes('date'))).toBe(true);
  });

  it('bio nova que preserva tudo (mais longa, mesmas entidades e data) não dispara nada', () => {
    const current = 'Carla Dias leads the RECARDI project, started in 2022.';
    const next = 'Carla Dias leads the RECARDI project, started in 2022, and also mentors two junior researchers on the team.';
    expect(checkBioLoss(current, next).lost).toBe(false);
  });

  it('sem bio actual, nunca há o que perder', () => {
    expect(checkBioLoss('', 'Any new bio at all.').lost).toBe(false);
  });
});

describe('removeFactSentencesFromBio — um facto não aprovado nunca vive na bio', () => {
  it('a fixture real: "based in Braga" e "ESTG" saem da bio, ficam só nos facts', () => {
    const bio = 'He leads technical development for the team. He is also based in Braga and teaches at ESTG.';
    const facts = ['based in Braga', 'ESTG'];
    const { bio: cleaned, removed } = removeFactSentencesFromBio(bio, facts);
    expect(cleaned).not.toMatch(/Braga|ESTG/i);
    expect(removed.length).toBeGreaterThan(0);
  });

  it('uma frase da bio sem sobreposição com nenhum facto fica intacta', () => {
    const bio = 'He has ten years of experience in embedded systems.';
    const { bio: cleaned } = removeFactSentencesFromBio(bio, ['Won an award in 2019']);
    expect(cleaned).toBe(bio);
  });

  it('sem factos nenhuns, a bio fica exactamente como estava', () => {
    const bio = 'Any bio text here.';
    expect(removeFactSentencesFromBio(bio, []).bio).toBe(bio);
  });
});

describe('stripUnverifiedHqClaims — a fixture real do Nuno: "Porto" nunca aparece sem fonte', () => {
  it('remove uma afirmação de sede que não bate com a cidade conhecida', () => {
    const bio = 'He leads the company from its headquarters in Porto. He has a strong technical background.';
    const { bio: cleaned, removed } = stripUnverifiedHqClaims(bio, 'Viana do Castelo');
    expect(cleaned).not.toMatch(/Porto/);
    expect(removed[0]).toMatch(/Porto/);
  });

  it('mantém a afirmação quando a cidade bate com a conhecida', () => {
    const bio = 'The company is based in Viana do Castelo.';
    const { bio: cleaned } = stripUnverifiedHqClaims(bio, 'Viana do Castelo');
    expect(cleaned).toBe(bio);
  });

  it('sem cidade conhecida, qualquer afirmação de sede é removida por prudência', () => {
    const { removed } = stripUnverifiedHqClaims('Based out of Lisbon.', null);
    expect(removed).toHaveLength(1);
  });

  it('bio sem nenhuma afirmação de sede fica intacta', () => {
    const bio = 'A strong background in physics and biomedical engineering.';
    expect(stripUnverifiedHqClaims(bio, 'Porto').bio).toBe(bio);
  });
});

describe('detectFoundedYearConflict — fixture founded_year=2020 + "founded in 2019"', () => {
  it('devolve o conflito com os dois valores, nunca assume que a app tem razão', () => {
    const conflict = detectFoundedYearConflict('Ablute was founded in 2019 in Portugal.', 2020);
    expect(conflict).toEqual({ webYear: 2019, appYear: 2020 });
  });

  it('sem menção a "founded", não é tratado como um facto de fundação', () => {
    expect(detectFoundedYearConflict('The team met in 2019 at a conference.', 2020)).toBeNull();
  });

  it('anos iguais não são conflito', () => {
    expect(detectFoundedYearConflict('Founded in 2020.', 2020)).toBeNull();
  });

  it('sem founded_year na app, nada a comparar', () => {
    expect(detectFoundedYearConflict('Founded in 2019.', null)).toBeNull();
  });
});

describe('capConfidenceOnConflict — confiança nunca é 100% num facto que contradiz dados próprios', () => {
  it('rebaixa uma confiança alta', () => {
    expect(capConfidenceOnConflict(1)).toBeLessThanOrEqual(0.5);
  });
  it('nunca sobe uma confiança já baixa', () => {
    expect(capConfidenceOnConflict(0.2)).toBe(0.2);
  });
});
