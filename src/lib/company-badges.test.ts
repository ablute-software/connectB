import { describe, expect, it } from 'vitest';
import {
  BADGES_FOUNDER_INTRO, BADGES_INVESTOR_DISCLAIMER, BADGE_VERIFIED_LABEL, EDITED_NOTE, NO_STABLE_SOURCE_NOTE, REVERIFY_TO_ATTACH_SOURCE_NOTE,
  badgeHasLogo, badgeLogoSource, badgeStatusLine, buildBadgePatch, findMatchingClaimForBadge, formatBadgeDate, founderBadgeLogoPath, isOwnStoragePath,
  normalizeSourceUrl, parseBadgeKind, projectBadgesForInvestor, resolveBadgeVerification, sourceDomain,
  type BadgeBeforeEdit, type BadgeForProjection,
} from './company-badges';
import type { CompanyClaim } from './types';

function claim(id: string, over: Partial<CompanyClaim> = {}): Pick<CompanyClaim, 'id' | 'statement' | 'status' | 'evidenceClass'> {
  return { id, statement: 'placeholder', status: 'proposed', evidenceClass: 4, ...over };
}

describe('resolveBadgeVerification — verified só com confirmação real E uma fonte pública (Prompt 918 B.3)', () => {
  const src = 'https://www.altice.pt/premios/2023';

  it('confirmação credível + fonte -> verified', () => {
    expect(resolveBadgeVerification({ foundCredibleConfirmation: true, foundContradiction: false, note: 'Listed as a winner', sourceUrl: src }))
      .toEqual({ status: 'verified', note: 'Listed as a winner' });
  });

  it('confirmação SEM fonte guardável -> unverified, com a nota exacta do prompt (nunca verified sem nada para mostrar ao investidor)', () => {
    for (const sourceUrl of [null, '', 'not a url', 'http://localhost/x', 'https://10.0.0.5/page']) {
      expect(resolveBadgeVerification({ foundCredibleConfirmation: true, foundContradiction: false, note: 'Found it', sourceUrl }))
        .toEqual({ status: 'unverified', note: NO_STABLE_SOURCE_NOTE });
    }
    expect(NO_STABLE_SOURCE_NOTE).toBe('Confirmed in search but no stable public source — add a link');
  });

  it('nada encontrado -> unverified (nunca um default silencioso a verified), com ou sem fonte', () => {
    expect(resolveBadgeVerification({ foundCredibleConfirmation: false, foundContradiction: false, note: 'No credible source found.', sourceUrl: src }))
      .toEqual({ status: 'unverified', note: 'No credible source found.' });
  });

  it('contradição activa -> disputed, mesmo que também haja confirmação parcial e mesmo sem fonte', () => {
    expect(resolveBadgeVerification({ foundCredibleConfirmation: true, foundContradiction: true, note: 'Year does not match.', sourceUrl: src }))
      .toEqual({ status: 'disputed', note: 'Year does not match.' });
    expect(resolveBadgeVerification({ foundCredibleConfirmation: false, foundContradiction: true, note: 'Another winner.', sourceUrl: null }).status).toBe('disputed');
  });
});

describe('normalizeSourceUrl / sourceDomain — a link a founder can stand behind', () => {
  it('aceita páginas http(s) em nomes de host reais e limpa o fragmento', () => {
    expect(normalizeSourceUrl('https://www.altice.pt/premios/2023#vencedores')).toBe('https://www.altice.pt/premios/2023');
    expect(normalizeSourceUrl('  altice.pt/awards ')).toBe('https://altice.pt/awards');
    expect(normalizeSourceUrl('http://example.org/news?id=7')).toBe('http://example.org/news?id=7');
  });

  it.each([
    null, undefined, 42, '', '   ', 'ftp://example.org/a', 'javascript:alert(1)', 'https://user:pass@example.org/a',
    'https://localhost/a', 'https://127.0.0.1/a', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/a', 'https://intranet/a', 'https://printer.local/a',
    `https://example.org/${'a'.repeat(2100)}`,
  ])('recusa %s', (bad) => {
    expect(normalizeSourceUrl(bad as unknown)).toBeNull();
  });

  it('o domínio é o que o founder e o investor lêem ao lado de "source:"', () => {
    expect(sourceDomain('https://www.altice.pt/premios/2023')).toBe('altice.pt');
    expect(sourceDomain('https://noticias.sapo.pt/x')).toBe('noticias.sapo.pt');
    expect(sourceDomain(null)).toBeNull();
    expect(sourceDomain('not a url')).toBeNull();
  });
});

describe('parseBadgeKind', () => {
  it('conhece os quatro tipos e o resto cai em award', () => {
    expect(['award', 'certification', 'programme', 'recognition'].map(parseBadgeKind)).toEqual(['award', 'certification', 'programme', 'recognition']);
    expect(parseBadgeKind('trophy')).toBe('award');
    expect(parseBadgeKind(undefined)).toBe('award');
  });
});

describe('buildBadgePatch — o que uma edição escreve, e quando volta a unverified (B.5)', () => {
  const verified: BadgeBeforeEdit = { name: 'Altice Innovation Awards', year: 2023, source_url: 'https://www.altice.pt/premios/2023', verification_status: 'verified', source_found_by: 'founder' };

  it('mudar nome, ano ou fonte de um verified tira-o do investor: unverified, sem data, sem título, sem logótipo encontrado', () => {
    for (const body of [{ name: 'Altice Awards' }, { year: 2024 }, { sourceUrl: 'https://altice.pt/outra' }, { sourceUrl: null }]) {
      const { patch, resetsVerification } = buildBadgePatch(verified, body);
      expect(resetsVerification, JSON.stringify(body)).toBe(true);
      expect(patch).toMatchObject({ verification_status: 'unverified', verified_at: null, verification_note: EDITED_NOTE, source_title: null, logo_url: null });
    }
  });

  it('descrição, tipo, logótipo, documento e claim NÃO mexem na verificação; o mesmo valor (com espaços) também não', () => {
    for (const body of [{ description: 'x' }, { kind: 'programme' }, { logoStoragePath: 'p/logo.png' }, { evidenceDocumentId: 'd1' }, { linkedClaimId: 'c1' }, { name: '  Altice Innovation Awards ' }, { year: 2023 }]) {
      const { patch, resetsVerification } = buildBadgePatch(verified, body);
      expect(resetsVerification, JSON.stringify(body)).toBe(false);
      expect('verification_status' in patch).toBe(false);
    }
  });

  it('um disputed que muda nome/ano/fonte também volta a unverified; um unverified fica como está (nada a repor)', () => {
    expect(buildBadgePatch({ ...verified, verification_status: 'disputed' }, { year: 2022 }).resetsVerification).toBe(true);
    expect(buildBadgePatch({ ...verified, verification_status: 'unverified' }, { year: 2022 }).resetsVerification).toBe(false);
  });

  it('o founder NUNCA escreve o veredicto: nota, data, estado, título e logótipo encontrado não são campos aceites', () => {
    const { patch } = buildBadgePatch({ ...verified, verification_status: 'unverified' }, {
      name: 'x', verification_status: 'verified', verified_at: '2026-10-15', verification_note: 'trust me', source_title: 'T', logo_url: 'https://e.org/l.png',
    } as never);
    expect(patch).toEqual({ name: 'x' });
  });

  it('a fonte dada pelo founder é guardada normalizada e marcada "founder"; uma fonte inválida fica a null (e conta como mudança)', () => {
    const unverified: BadgeBeforeEdit = { ...verified, verification_status: 'unverified', source_url: null, source_found_by: null };
    expect(buildBadgePatch(unverified, { sourceUrl: 'altice.pt/awards' }).patch).toMatchObject({ source_url: 'https://altice.pt/awards', source_found_by: 'founder' });
    // 'javascript:' não é um endereço público: com uma fonte já guardada, apaga-a (mudança); sem nenhuma, não há nada a mudar
    expect(buildBadgePatch({ ...unverified, source_url: 'https://altice.pt/awards', source_found_by: 'founder' }, { sourceUrl: 'javascript:alert(1)' }).patch)
      .toMatchObject({ source_url: null, source_found_by: null });
    expect('source_url' in buildBadgePatch(unverified, { sourceUrl: 'javascript:alert(1)' }).patch).toBe(false);
  });

  it('reenviar o MESMO link (o formulário envia sempre o que mostra) não muda quem o encontrou: um link do Sherlock continua do Sherlock', () => {
    const bySherlock: BadgeBeforeEdit = { ...verified, source_found_by: 'sherlock' };
    const { patch, resetsVerification } = buildBadgePatch(bySherlock, { sourceUrl: 'https://www.altice.pt/premios/2023', description: 'nova descrição' });
    expect(resetsVerification).toBe(false);
    expect('source_url' in patch).toBe(false);
    expect('source_found_by' in patch).toBe(false);
    expect(patch).toEqual({ description: 'nova descrição' });
    // o mesmo link escrito de outra maneira (sem https://, com espaços) normaliza para o guardado → também não é mudança
    expect(buildBadgePatch(bySherlock, { sourceUrl: '  www.altice.pt/premios/2023 ' }).resetsVerification).toBe(false);
  });
});

describe('isOwnStoragePath — o logótipo carregado é sempre da própria org (a rota que o serve assina com a service role)', () => {
  const org = '5ead0ea1-d6bb-4354-b1e7-300df91ca33e';
  it('aceita um ficheiro dentro da pasta da org', () => {
    expect(isOwnStoragePath(org, `${org}/a690337a-logo.png`)).toBe(true);
    expect(isOwnStoragePath(org, `${org}/sub/folder/logo.png`)).toBe(true);
  });
  it('recusa outra org, a raiz, subir de pasta, barras trocadas, vazios e o que não é texto', () => {
    for (const p of [
      '7c1a5974-000b-4dd2-8632-87f99250cf68/x.png', `${org}`, `${org}/`, `${org}/../7c1a5974/x.png`, `${org}/./x.png`, `${org}//x.png`,
      `${org}\\x.png`, `${org}x/y.png`, '', `/${org}/x.png`, `${org}/${'a'.repeat(600)}`,
    ]) expect(isOwnStoragePath(org, p), p).toBe(false);
    for (const p of [null, undefined, 42, {}, ['x']]) expect(isOwnStoragePath(org, p)).toBe(false);
    expect(isOwnStoragePath('', 'x/y.png')).toBe(false);
  });
});

describe('badgeHasLogo', () => {
  it('upload, ou um logótipo encontrado que seja um endereço público; senão ícone', () => {
    expect(badgeHasLogo({ logoStoragePath: 'o/l.png' })).toBe(true);
    expect(badgeHasLogo({ logoUrl: 'https://cdn.altice.pt/l.png' })).toBe(true);
    expect(badgeHasLogo({ logoUrl: 'javascript:alert(1)' })).toBe(false);
    expect(badgeHasLogo({ logoUrl: 'http://127.0.0.1/l.png' })).toBe(false);
    expect(badgeHasLogo({})).toBe(false);
  });
});

describe('badgeStatusLine — a copy do cartão do founder (C.2), palavra por palavra', () => {
  const fmt = (iso: string) => `fmt(${iso.slice(0, 10)})`;
  const base = { verification_note: null, verified_at: null, source_url: null };

  it('unverified', () => {
    expect(badgeStatusLine({ ...base, verification_status: 'unverified' }, fmt)).toEqual({ tone: 'private', text: 'Private — not shown to investors until verified' });
  });
  it('disputed leva a nota', () => {
    expect(badgeStatusLine({ ...base, verification_status: 'disputed', verification_note: 'Won in 2022, not 2023' }, fmt))
      .toEqual({ tone: 'contradicted', text: 'Private — contradicted by public sources: Won in 2022, not 2023' });
    expect(badgeStatusLine({ ...base, verification_status: 'disputed' }, fmt).text).toBe('Private — contradicted by public sources');
  });
  it('verified: data e domínio da fonte', () => {
    expect(badgeStatusLine({ ...base, verification_status: 'verified', verified_at: '2026-10-14T10:51:46Z', source_url: 'https://www.altice.pt/premios/2023' }, fmt))
      .toEqual({ tone: 'visible', text: 'Visible to investors · verified fmt(2026-10-14) · source: altice.pt' });
  });
  it('um "verified" sem fonte ou sem data nunca se apresenta como visível', () => {
    expect(badgeStatusLine({ ...base, verification_status: 'verified', verified_at: '2026-10-14T10:51:46Z' }, fmt).tone).toBe('private');
    expect(badgeStatusLine({ ...base, verification_status: 'verified', source_url: 'https://altice.pt/x' }, fmt).tone).toBe('private');
  });
});

describe('as frases fixas', () => {
  it('o texto do investor diz "confirmed against" e nunca garante (918 D.2)', () => {
    expect(BADGES_INVESTOR_DISCLAIMER).toBe("Shown only after Sherlock confirmed each one against public sources and the founder's documents.");
    expect(BADGES_INVESTOR_DISCLAIMER).toMatch(/confirmed .*against/);
    expect(BADGES_INVESTOR_DISCLAIMER).not.toMatch(/guarant|certif|validat/i);
  });
  it('o texto do topo do cartão do founder (C.3)', () => {
    expect(BADGES_FOUNDER_INTRO).toBe('Investors only see badges Sherlock has confirmed against public sources and your documents. Add the link to the award page or a public news piece to speed up verification.');
  });
  it('a nota do backfill da migração é a mesma que o código usa', () => {
    expect(REVERIFY_TO_ATTACH_SOURCE_NOTE).toBe('Re-verify to attach a public source');
  });
  it('a etiqueta do investor e o formato da data (dd Mon yyyy, em UTC: todos leem o mesmo dia)', () => {
    expect(`${BADGE_VERIFIED_LABEL} · ${formatBadgeDate('2026-10-14T10:51:46.58+00:00')}`).toBe('Verified by Sherlock · 14 Oct 2026');
    expect(formatBadgeDate('2026-01-05T00:00:00Z')).toBe('05 Jan 2026');
    expect(formatBadgeDate('2026-12-31T23:59:59Z')).toBe('31 Dec 2026');
    expect(formatBadgeDate('not a date')).toBe('');
    expect(formatBadgeDate(null)).toBe('');
    expect(formatBadgeDate(undefined)).toBe('');
  });
});

describe('badgeLogoSource — upload do founder > logótipo encontrado > ícone do tipo (C.4)', () => {
  it('a ordem', () => {
    expect(badgeLogoSource({ logo_storage_path: 'p/a.png', logo_url: 'https://e.org/l.png' })).toBe('upload');
    expect(badgeLogoSource({ logo_storage_path: null, logo_url: 'https://e.org/l.png' })).toBe('found');
    expect(badgeLogoSource({ logo_storage_path: null, logo_url: null })).toBe('icon');
    expect(badgeLogoSource({ logoStoragePath: 'p/a.png', logoUrl: null })).toBe('upload');
  });
});

describe('findMatchingClaimForBadge — reutiliza findDuplicateCandidate (Prompt 311), nunca uma segunda heurística', () => {
  // O caso real Carla Dias/WomenTechEU, recriado como fixture — o mesmo
  // facto já existia como 3 claims desconectados; um badge para o mesmo
  // prémio tem de encontrar essa correspondência.
  const CARLA_PROFILE = claim('c-profile', { statement: 'Carla Dias, CTO. Woman In Tech EU warded', evidenceClass: 5, status: 'accepted' });
  const CARLA_ROADMAP = claim('c-roadmap', { statement: '2022 — WomenTechEU prize', evidenceClass: 5, status: 'accepted' });
  const UNRELATED = claim('c-other', { statement: 'Onboarded a Fortune 500 pilot customer', evidenceClass: 5, status: 'accepted' });

  it('encontra o par quando o badge descreve o mesmo prémio/pessoa', () => {
    const match = findMatchingClaimForBadge({ name: 'WomenTechEU Award', description: 'Awarded to Carla Dias, 2022' }, [CARLA_PROFILE, CARLA_ROADMAP, UNRELATED]);
    expect(match).not.toBeNull();
    expect([CARLA_PROFILE.statement, CARLA_ROADMAP.statement]).toContain(match!.statement);
  });

  it('sem correspondência, devolve null', () => {
    expect(findMatchingClaimForBadge({ name: 'YCombinator W23', description: null }, [UNRELATED])).toBeNull();
  });

  it('pool vazia, devolve null sem lançar', () => {
    expect(findMatchingClaimForBadge({ name: 'Any award', description: null }, [])).toBeNull();
  });
});

describe('projectBadgesForInvestor — SÓ os verificados, com fonte (Prompt 918 D; inverte a regra do 326 §E)', () => {
  const verified: BadgeForProjection = {
    id: 'b1', name: 'Altice Innovation Awards', year: 2023, kind: 'award', verificationStatus: 'verified',
    sourceUrl: 'https://www.altice.pt/premios/2023', sourceTitle: 'Altice Innovation Awards 2023 — winners', verifiedAt: '2026-10-14T10:51:46.58Z',
    logoStoragePath: null, logoUrl: null,
  };

  it('um verified com fonte passa, com os campos pedidos e mais nenhum', () => {
    expect(projectBadgesForInvestor([verified])).toEqual([{
      id: 'b1', name: 'Altice Innovation Awards', kind: 'award', year: 2023, logoUrl: null,
      sourceUrl: 'https://www.altice.pt/premios/2023', sourceTitle: 'Altice Innovation Awards 2023 — winners', verifiedAt: '2026-10-14T10:51:46.58Z',
    }]);
  });

  it('unverified e disputed NUNCA aparecem — nem sozinhos, nem misturados, nem em contagem', () => {
    const mixed: BadgeForProjection[] = [
      { ...verified, id: 'u', verificationStatus: 'unverified' },
      { ...verified, id: 'v' },
      { ...verified, id: 'd', verificationStatus: 'disputed' },
    ];
    expect(projectBadgesForInvestor([{ ...verified, verificationStatus: 'unverified' }])).toEqual([]);
    expect(projectBadgesForInvestor([{ ...verified, verificationStatus: 'disputed' }])).toEqual([]);
    expect(projectBadgesForInvestor(mixed).map((b) => b.id)).toEqual(['v']);
  });

  it('um "verified" sem fonte válida ou sem data não é mostrado (a tabela já o recusa; isto é o cinto e os suspensórios)', () => {
    expect(projectBadgesForInvestor([{ ...verified, sourceUrl: null }])).toEqual([]);
    expect(projectBadgesForInvestor([{ ...verified, sourceUrl: 'javascript:alert(1)' }])).toEqual([]);
    expect(projectBadgesForInvestor([{ ...verified, verifiedAt: null }])).toEqual([]);
  });

  it('a saída nunca tem nota de verificação, documento de prova, descrição, claim, nem estado', () => {
    const [out] = projectBadgesForInvestor([{ ...verified, verificationNote: 'internal', evidenceDocumentId: 'doc', description: 'free text', linkedClaimId: 'c' } as never]);
    for (const k of ['verification_note', 'verificationNote', 'evidence_document_id', 'evidenceDocumentId', 'description', 'linkedClaimId', 'verificationStatus', 'logoStoragePath']) {
      expect(k in out, k).toBe(false);
    }
  });

  it('o logótipo sai SEMPRE pela nossa rota (o do upload e o encontrado): o investidor nunca recebe um URL de storage nem o endereço de um terceiro', () => {
    // upload > encontrado é decidido pela rota; aqui só importa que há logótipo e que o URL é nosso
    expect(projectBadgesForInvestor([{ ...verified, logoStoragePath: 'org/logo.png', logoUrl: 'https://e.org/l.png' }])[0].logoUrl).toBe('/api/portal/badge-logo/b1');
    expect(projectBadgesForInvestor([{ ...verified, logoUrl: 'https://cdn.altice.pt/logo.png' }])[0].logoUrl).toBe('/api/portal/badge-logo/b1');
    // sem upload e sem um logótipo encontrado que seja um endereço público → null → ícone do tipo
    expect(projectBadgesForInvestor([{ ...verified, logoUrl: 'javascript:alert(1)' }])[0].logoUrl).toBeNull();
    expect(projectBadgesForInvestor([{ ...verified, logoUrl: null, logoStoragePath: null }])[0].logoUrl).toBeNull();
    for (const b of projectBadgesForInvestor([{ ...verified, logoStoragePath: 'org/logo.png', logoUrl: 'https://e.org/l.png' }, { ...verified, id: 'b2', logoUrl: 'https://cdn.altice.pt/logo.png' }])) {
      expect(b.logoUrl).not.toMatch(/supabase|storage|https?:\/\//i);
    }
  });

  it('a pré-visualização do founder passa a rota dele; o resto da projeção é o mesmo', () => {
    expect(projectBadgesForInvestor([{ ...verified, logoStoragePath: 'org/logo.png' }], founderBadgeLogoPath)[0].logoUrl).toBe('/api/company-badges/b1/logo');
    expect(projectBadgesForInvestor([{ ...verified, logoUrl: 'https://cdn.altice.pt/logo.png' }], (id) => `/x/${id}`)[0].logoUrl).toBe('/x/b1');
  });

  it('a ordem de entrada mantém-se', () => {
    const list = ['a', 'b', 'c'].map((id) => ({ ...verified, id }));
    expect(projectBadgesForInvestor(list).map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });
});
