// Prompt 918 B — the orchestration of one badge verification, with every side effect passed in (the charge, the evidence PDF, the page
// fetch, the logo check, the model, the usage log), so the ORDER that matters — charge first, nothing at all if the wallet says no, a
// verified verdict only with a public source — is proved by tests instead of by reading a route. The route wires the real ones.
import {
  resolveBadgeVerification, normalizeSourceUrl,
  type BadgeVerificationStatus, type CompanyBadge,
} from './company-badges';
import {
  buildVerifyRequest, chooseSource, collectSearchResultUrls, estimatePdfTokens, extractPageSignals, parseVerdict, pickLogoCandidate,
  type PageSignals, type Verdict,
} from './company-badge-verification';

export type PageFetchResult = { ok: true; finalUrl: string; html: string } | { ok: false; reason: string };

export interface VerifyDeps {
  /** chargeAiAction(sb, orgId, 'badge_verification') — the first thing that runs. */
  charge: () => Promise<{ ok: boolean; reason: string | null }>;
  loadEvidencePdf: () => Promise<Uint8Array | null>;
  fetchPage: (url: string) => Promise<PageFetchResult>;
  /** HEAD (or a capped GET) proving the URL is an image under 2 MB. */
  imageOk: (url: string) => Promise<boolean>;
  callModel: (body: Record<string, unknown>) => Promise<{ content: unknown[]; usage: unknown }>;
  logUsage: (usage: unknown) => Promise<void>;
  now?: () => Date;
}

/** Checked BEFORE the charge: a request that cannot run must not cost anything. */
export function verifyPreflight(badge: Pick<CompanyBadge, 'verification_status' | 'source_url'>): { ok: true } | { ok: false; status: 400 | 409; error: string } {
  if (badge.verification_status === 'verified') {
    return { ok: false, status: 409, error: 'This badge is already verified. Change its name, year or source link to verify it again.' };
  }
  if (badge.source_url && !normalizeSourceUrl(badge.source_url)) {
    return { ok: false, status: 400, error: 'The source link is not a valid public web address. Fix it or remove it, then verify again.' };
  }
  return { ok: true };
}

export type VerifyOutcome =
  | { kind: 'refused'; error: string }
  | {
    kind: 'done';
    status: BadgeVerificationStatus; note: string;
    /** The columns to write — the verdict's own fields only; a source is stored only with a `verified` verdict. */
    update: Record<string, unknown>;
    telemetry: { searchUses: number; pageRead: boolean; pageTruncated: boolean; estimatedInputTokens: number };
  };

/** First candidate whose address says "logo" — the only guess made without the model's help; a photo is never taken for a logo. */
export function heuristicLogoCandidate(candidates: string[]): string | null {
  return candidates.find((u) => /logo/i.test(u)) ?? null;
}

export async function runBadgeVerification(
  args: { badge: Pick<CompanyBadge, 'name' | 'description' | 'year' | 'kind' | 'source_url'>; orgName: string; model: string },
  deps: VerifyDeps,
): Promise<VerifyOutcome> {
  // 1. THE CHARGE, before anything that costs: no fetch, no PDF read, no model if the wallet refuses.
  const charge = await deps.charge();
  if (!charge.ok) return { kind: 'refused', error: charge.reason ?? 'Not enough AI credits for this check.' };

  const founderUrl = args.badge.source_url ? normalizeSourceUrl(args.badge.source_url) : null;

  // 2. What the founder gave us: their evidence PDF and the page their link leads to.
  const pdfBytes = await deps.loadEvidencePdf();
  const pdf = pdfBytes ? { base64: Buffer.from(pdfBytes).toString('base64'), tokens: estimatePdfTokens(pdfBytes) } : null;

  let page: (PageSignals & { finalUrl: string }) | null = null;
  if (founderUrl) {
    const fetched = await deps.fetchPage(founderUrl);
    if (fetched.ok) page = { ...extractPageSignals(fetched.html, fetched.finalUrl), finalUrl: fetched.finalUrl };
  }

  // 3. The question, inside the budget.
  const request = buildVerifyRequest({
    model: args.model, orgName: args.orgName,
    badge: { name: args.badge.name, description: args.badge.description, year: args.badge.year, kind: args.badge.kind },
    founderUrl,
    page: page ? { finalUrl: page.finalUrl, title: page.title, siteName: page.siteName, text: page.text, logoCandidates: page.logoCandidates } : null,
    pdf,
  });
  const telemetry = { searchUses: request.searchUses, pageRead: !!page, pageTruncated: request.pageTruncated, estimatedInputTokens: request.estimatedInputTokens };

  // 4. The model.
  const response = await deps.callModel(request.body);
  await deps.logUsage(response.usage);

  const verdict: Verdict = parseVerdict(response.content)
    ?? { foundCredibleConfirmation: false, foundContradiction: false, note: 'The AI did not return a verdict.', sourceUrl: null, sourceTitle: null, logoUrl: null };

  // 5. The source: only one the model could not have invented.
  const chosen = chooseSource({
    confirmed: verdict.foundCredibleConfirmation && !verdict.foundContradiction,
    founderUrl, founderFinalUrl: page?.finalUrl ?? null, founderPageRead: !!page,
    modelUrl: verdict.sourceUrl, searchUrls: collectSearchResultUrls(response.content),
  });

  const resolved = resolveBadgeVerification({
    foundCredibleConfirmation: verdict.foundCredibleConfirmation, foundContradiction: verdict.foundContradiction,
    note: verdict.note, sourceUrl: chosen?.url ?? null,
  });

  if (resolved.status !== 'verified' || !chosen) {
    return { kind: 'done', status: resolved.status, note: resolved.note, telemetry, update: {
      verification_status: resolved.status, verification_note: resolved.note, verified_at: null,
    } };
  }

  // 6. Verified: the title of the source, and a logo that survives a real check.
  let signals: PageSignals | null = page && (chosen.foundBy === 'founder') ? page : null;
  if (!signals) {
    const sourcePage = await deps.fetchPage(chosen.url);
    if (sourcePage.ok) signals = extractPageSignals(sourcePage.html, sourcePage.finalUrl);
  }
  const candidates = signals?.logoCandidates ?? [];
  const logoPick = pickLogoCandidate(verdict.logoUrl, candidates) ?? heuristicLogoCandidate(candidates);
  const logoUrl = logoPick && (await deps.imageOk(logoPick)) ? logoPick : null;
  const now = (deps.now?.() ?? new Date()).toISOString();

  return { kind: 'done', status: 'verified', note: resolved.note, telemetry, update: {
    verification_status: 'verified', verification_note: resolved.note, verified_at: now,
    source_url: chosen.url, source_found_by: chosen.foundBy, source_title: verdict.sourceTitle ?? signals?.title ?? null, logo_url: logoUrl,
  } };
}
