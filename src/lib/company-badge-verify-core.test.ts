// Prompt 918 B — one badge verification end to end, every side effect a spy: what runs first, what never runs when the wallet says no,
// and when a verdict may become "verified".
import { describe, expect, it } from 'vitest';
import { NO_STABLE_SOURCE_NOTE } from './company-badges';
import { CONTEXT_TOKEN_CAP } from './company-badge-verification';
import { heuristicLogoCandidate, runBadgeVerification, verifyPreflight, type VerifyDeps } from './company-badge-verify-core';

const FOUNDER_URL = 'https://www.altice.pt/premios/2023';
const PAGE_HTML = `<html><head><title>Altice Innovation Awards 2023 — winners</title>
  <meta property="og:image" content="https://cdn.altice.pt/logo.png"><meta name="twitter:image" content="https://cdn.altice.pt/share.jpg"></head>
  <body><h1>Winners</h1><p>Inclui category: Mob2is.</p></body></html>`;

interface Calls { order: string[]; modelBodies: Record<string, unknown>[]; fetched: string[]; imageChecked: string[]; usage: unknown[] }

function setup(over: Partial<VerifyDeps> & {
  verdict?: Record<string, unknown> | null; searchUrls?: string[]; page?: string | null; chargeOk?: boolean; pdf?: Uint8Array | null; imageValid?: boolean;
} = {}) {
  const calls: Calls = { order: [], modelBodies: [], fetched: [], imageChecked: [], usage: [] };
  const deps: VerifyDeps = {
    charge: over.charge ?? (async () => { calls.order.push('charge'); return over.chargeOk === false ? { ok: false, reason: 'AI credits limit reached for this month — resets on 2026-11-01, or upgrade your plan.' } : { ok: true, reason: null }; }),
    loadEvidencePdf: over.loadEvidencePdf ?? (async () => { calls.order.push('pdf'); return over.pdf ?? null; }),
    fetchPage: over.fetchPage ?? (async (url) => {
      calls.order.push('page'); calls.fetched.push(url);
      return over.page === null ? { ok: false as const, reason: 'network_error' } : { ok: true as const, finalUrl: url, html: over.page ?? PAGE_HTML };
    }),
    imageOk: over.imageOk ?? (async (u) => { calls.order.push('image'); calls.imageChecked.push(u); return over.imageValid ?? true; }),
    callModel: over.callModel ?? (async (body) => {
      calls.order.push('model'); calls.modelBodies.push(body);
      const content: unknown[] = [];
      if (over.searchUrls) content.push({ type: 'web_search_tool_result', content: over.searchUrls.map((url) => ({ type: 'web_search_result', url })) });
      if (over.verdict !== null) content.push({ type: 'tool_use', name: 'report_verification', input: over.verdict ?? { found_credible_confirmation: true, found_contradiction: false, note: 'Winner, Inclui category', source_url: FOUNDER_URL, source_title: 'Altice Innovation Awards 2023 — winners', logo_url: 'https://cdn.altice.pt/logo.png' } });
      return { content, usage: { input_tokens: 9000, output_tokens: 300 } };
    }),
    logUsage: over.logUsage ?? (async (u) => { calls.order.push('log'); calls.usage.push(u); }),
    now: () => new Date('2026-10-15T12:00:00.000Z'),
  };
  const badge = { name: 'Altice Innovation Awards', description: null as string | null, year: 2023, kind: 'award' as const, source_url: FOUNDER_URL as string | null };
  return { calls, deps, badge, run: (b = badge) => runBadgeVerification({ badge: b, orgName: 'Mob2is', model: 'claude-sonnet-4-5' }, deps) };
}

describe('a carteira manda: a cobrança é a primeira coisa, e sem saldo não corre mais nada (B.4)', () => {
  it('charge antes de ler o PDF, antes de abrir a página, antes do modelo, antes de registar o uso', async () => {
    const t = setup();
    await t.run();
    expect(t.calls.order[0]).toBe('charge');
    expect(t.calls.order.indexOf('charge')).toBeLessThan(t.calls.order.indexOf('pdf'));
    expect(t.calls.order.indexOf('charge')).toBeLessThan(t.calls.order.indexOf('page'));
    expect(t.calls.order.indexOf('charge')).toBeLessThan(t.calls.order.indexOf('model'));
    expect(t.calls.order.indexOf('model')).toBeLessThan(t.calls.order.indexOf('log'));
  });

  it('carteira recusa (a zero) -> "refused" com a frase da carteira; nem PDF, nem página, nem modelo, nem registo', async () => {
    const t = setup({ chargeOk: false });
    const out = await t.run();
    expect(out).toEqual({ kind: 'refused', error: 'AI credits limit reached for this month — resets on 2026-11-01, or upgrade your plan.' });
    expect(t.calls.order).toEqual(['charge']);
  });

  it('o charge devolve ok:false sem razão -> mesmo assim recusa, com uma frase legível', async () => {
    const t = setup({ charge: async () => ({ ok: false, reason: null }) });
    const out = await t.run();
    expect(out).toMatchObject({ kind: 'refused' });
    expect((out as { error: string }).error.length).toBeGreaterThan(10);
  });
});

describe('verifyPreflight — o que não pode correr não custa (antes do charge)', () => {
  it('já verificado -> 409; fonte inválida -> 400; o resto passa', () => {
    expect(verifyPreflight({ verification_status: 'verified', source_url: FOUNDER_URL })).toMatchObject({ ok: false, status: 409 });
    expect(verifyPreflight({ verification_status: 'unverified', source_url: 'javascript:alert(1)' })).toMatchObject({ ok: false, status: 400 });
    expect(verifyPreflight({ verification_status: 'unverified', source_url: FOUNDER_URL })).toEqual({ ok: true });
    expect(verifyPreflight({ verification_status: 'disputed', source_url: null })).toEqual({ ok: true });
  });
});

describe('o veredicto: verified só com confirmação E uma fonte que o modelo não podia ter inventado (B.3)', () => {
  it('link do founder + página lida + confirmação -> verified: fonte do founder, título, logótipo validado, data', async () => {
    const t = setup();
    const out = await t.run();
    expect(out).toMatchObject({ kind: 'done', status: 'verified' });
    expect((out as { update: object }).update).toEqual({
      verification_status: 'verified', verification_note: 'Winner, Inclui category', verified_at: '2026-10-15T12:00:00.000Z',
      source_url: FOUNDER_URL, source_found_by: 'founder', source_title: 'Altice Innovation Awards 2023 — winners', logo_url: 'https://cdn.altice.pt/logo.png',
    });
    expect(t.calls.fetched).toEqual([FOUNDER_URL]);
    expect(t.calls.imageChecked).toEqual(['https://cdn.altice.pt/logo.png']);
  });

  it('confirmação a citar um endereço inventado -> unverified com a nota "no stable public source", e NENHUM campo de fonte é escrito', async () => {
    const t = setup({ verdict: { found_credible_confirmation: true, found_contradiction: false, note: 'Seems right', source_url: 'https://made-up.example/awards' } });
    const out = await t.run();
    expect(out).toMatchObject({ kind: 'done', status: 'unverified', note: NO_STABLE_SOURCE_NOTE });
    expect((out as { update: Record<string, unknown> }).update).toEqual({ verification_status: 'unverified', verification_note: NO_STABLE_SOURCE_NOTE, verified_at: null });
  });

  it('sem link do founder: a fonte tem de ser uma que a pesquisa devolveu -> verified "sherlock", com título e logótipo da página encontrada', async () => {
    const found = 'https://noticias.sapo.pt/n/1';
    const t = setup({
      searchUrls: [found], page: PAGE_HTML.replace('og:image" content="https://cdn.altice.pt/logo.png"', 'og:image" content="https://cdn.sapo.pt/logo.svg"'),
      verdict: { found_credible_confirmation: true, found_contradiction: false, note: 'Reported by SAPO', source_url: found },
    });
    const out = await t.run({ ...t.badge, source_url: null });
    expect(out).toMatchObject({ kind: 'done', status: 'verified' });
    expect((out as { update: Record<string, unknown> }).update).toMatchObject({ source_url: found, source_found_by: 'sherlock', source_title: 'Altice Innovation Awards 2023 — winners', logo_url: 'https://cdn.sapo.pt/logo.svg' });
    // the page behind the found source is read AFTER the verdict, by us, for the title and the logo — never before the model, never without a source
    expect(t.calls.fetched).toEqual([found]);
    expect(t.calls.order.indexOf('model')).toBeLessThan(t.calls.order.indexOf('page'));
  });

  it('confirmação sem nenhuma fonte (sem link, nada citado) -> unverified "no stable public source"', async () => {
    const t = setup({ verdict: { found_credible_confirmation: true, found_contradiction: false, note: 'Heard of it' } });
    const out = await t.run({ ...t.badge, source_url: null });
    expect(out).toMatchObject({ status: 'unverified', note: NO_STABLE_SOURCE_NOTE });
  });

  it('contradição -> disputed, com a nota; nenhum campo de fonte', async () => {
    const t = setup({ verdict: { found_credible_confirmation: false, found_contradiction: true, note: 'The public list shows 2022, not 2023', source_url: FOUNDER_URL } });
    const out = await t.run();
    expect(out).toMatchObject({ status: 'disputed' });
    expect((out as { update: Record<string, unknown> }).update).toEqual({ verification_status: 'disputed', verification_note: 'The public list shows 2022, not 2023', verified_at: null });
  });

  it('o modelo não chama a ferramenta -> unverified "did not return a verdict"; o uso ficou registado na mesma', async () => {
    const t = setup({ verdict: null });
    const out = await t.run();
    expect(out).toMatchObject({ status: 'unverified', note: 'The AI did not return a verdict.' });
    expect(t.calls.usage).toHaveLength(1);
  });

  it('um logótipo que não passa a verificação de imagem nunca é guardado (o badge fica verified, sem logótipo)', async () => {
    const t = setup({ imageValid: false });
    const out = await t.run();
    expect(out).toMatchObject({ status: 'verified' });
    expect((out as { update: Record<string, unknown> }).update.logo_url).toBeNull();
  });

  it('um logótipo que o modelo escolheu fora da lista da página é ignorado; sem escolha, só se aceita um com "logo" no endereço', async () => {
    const t1 = setup({ verdict: { found_credible_confirmation: true, found_contradiction: false, note: 'ok', source_url: FOUNDER_URL, logo_url: 'https://evil.example/pixel.png' } });
    const o1 = await t1.run();
    expect((o1 as { update: Record<string, unknown> }).update.logo_url).toBe('https://cdn.altice.pt/logo.png'); // heuristic: the address says "logo"
    expect(t1.calls.imageChecked).not.toContain('https://evil.example/pixel.png');

    const t2 = setup({ page: PAGE_HTML.replace('logo.png', 'share-banner.png'), verdict: { found_credible_confirmation: true, found_contradiction: false, note: 'ok', source_url: FOUNDER_URL } });
    const o2 = await t2.run();
    expect((o2 as { update: Record<string, unknown> }).update.logo_url).toBeNull(); // a photo is never taken for a logo
    expect(heuristicLogoCandidate(['https://x.org/a.jpg', 'https://x.org/brand/LOGO-dark.svg'])).toBe('https://x.org/brand/LOGO-dark.svg');
  });

  it('a página do founder não abre -> segue sem ela (3 pesquisas), e uma confirmação sem fonte citada NÃO usa o link que não foi lido', async () => {
    const t = setup({ page: null, verdict: { found_credible_confirmation: true, found_contradiction: false, note: 'Believe so' } });
    const out = await t.run();
    expect(out).toMatchObject({ status: 'unverified', note: NO_STABLE_SOURCE_NOTE, telemetry: { pageRead: false, searchUses: 3 } });
  });
});

describe('o orçamento (B.1): pesquisas e tecto de 30k', () => {
  it('com a página lida, 1 pesquisa; sem link, 3', async () => {
    const withLink = setup();
    await withLink.run();
    const uses = (b: Record<string, unknown>) => (b.tools as { name: string; max_uses?: number }[]).find((x) => x.name === 'web_search')?.max_uses;
    expect(uses(withLink.calls.modelBodies[0])).toBe(1);
    const noLink = setup();
    await noLink.run({ ...noLink.badge, source_url: null });
    expect(uses(noLink.calls.modelBodies[0])).toBe(3);
  });

  it('um fixture com uma página longa e um PDF: o pedido montado fica abaixo de 30k tokens, o texto foi cortado, o PDF segue inteiro', async () => {
    const longHtml = `<html><head><title>List</title></head><body>${Array.from({ length: 9000 }, (_, i) => `<p>Winner ${i}: a long line describing the company and the category it won.</p>`).join('')}</body></html>`;
    const pdf = new TextEncoder().encode('%PDF-1.7\n' + '2 0 obj << /Type /Page >> endobj\n'.repeat(4) + 'evidence '.repeat(200));
    const t = setup({ page: longHtml, pdf });
    const out = await t.run();
    expect(out).toMatchObject({ kind: 'done', telemetry: { pageRead: true, pageTruncated: true } });
    const telemetry = (out as { telemetry: { estimatedInputTokens: number } }).telemetry;
    expect(telemetry.estimatedInputTokens).toBeLessThanOrEqual(CONTEXT_TOKEN_CAP);
    const content = (t.calls.modelBodies[0].messages as { content: { type: string; source?: { data: string } }[] }[])[0].content;
    expect(content.find((b) => b.type === 'document')?.source?.data).toBe(Buffer.from(pdf).toString('base64'));
  });
});
