import { describe, expect, it } from 'vitest';
import {
  isTeamGap, formatTeamProfiles, selectTeamDocumentCandidates, isAllowedLinkedInUrl, looksLikeUsableLinkedInContent,
  relevantPeopleForLinkedIn, rankTeamDocuments, selectWithinPageBudget, MAX_ATTACHED_PDF_PAGES,
  type TeamProfile, type CandidateDoc, type PageAwareDoc, type LinkedInTargetPerson,
} from './gap-assist-sources';
import type { Gap } from './company-gaps';

describe('isTeamGap', () => {
  it('is true for G3/G3b/G3c', () => {
    expect(isTeamGap('G3')).toBe(true);
    expect(isTeamGap('G3b')).toBe(true);
    expect(isTeamGap('G3c')).toBe(true);
  });
  it('is false for non-team gaps', () => {
    expect(isTeamGap('G1')).toBe(false);
    expect(isTeamGap('G4')).toBe(false);
    expect(isTeamGap('G6')).toBe(false);
    expect(isTeamGap('G7')).toBe(false);
  });
});

describe('formatTeamProfiles', () => {
  it('returns empty string for no people', () => {
    expect(formatTeamProfiles([])).toBe('');
  });
  it('includes name, founder tag, title, bio and linkedin when present', () => {
    const people: TeamProfile[] = [
      { fullName: 'Jane Doe', title: 'CEO', isFounder: true, bio: 'Ex-Google PM.', linkedinUrl: 'https://linkedin.com/in/jane' },
    ];
    const out = formatTeamProfiles(people);
    expect(out).toContain('Jane Doe (Founder) — CEO');
    expect(out).toContain('Bio on file: "Ex-Google PM."');
    expect(out).toContain('LinkedIn on file: https://linkedin.com/in/jane');
  });
  it('omits bio/linkedin lines when absent, never fabricates them', () => {
    const people: TeamProfile[] = [{ fullName: 'John Roe', title: null, isFounder: false, bio: null, linkedinUrl: null }];
    const out = formatTeamProfiles(people);
    expect(out).toBe('- John Roe');
    expect(out).not.toContain('Bio on file');
    expect(out).not.toContain('LinkedIn on file');
  });
});

describe('selectTeamDocumentCandidates', () => {
  const base: CandidateDoc = { id: '1', name: 'file.pdf', storagePath: 'org/file.pdf', folderName: null, portalSection: null, malwareScanStatus: 'clean' };

  it('excludes non-clean scan statuses entirely (pending, flagged, not_scanned, null)', () => {
    const docs: CandidateDoc[] = [
      { ...base, id: 'a', malwareScanStatus: 'pending' },
      { ...base, id: 'b', malwareScanStatus: 'flagged' },
      { ...base, id: 'c', malwareScanStatus: 'not_scanned' },
      { ...base, id: 'd', malwareScanStatus: null },
    ];
    expect(selectTeamDocumentCandidates(docs, 5)).toEqual([]);
  });

  it('excludes non-pdf files even when clean', () => {
    const docs: CandidateDoc[] = [{ ...base, id: 'a', name: 'deck.pptx', storagePath: 'org/deck.pptx' }];
    expect(selectTeamDocumentCandidates(docs, 5)).toEqual([]);
  });

  it('prioritizes portal_section=team_governance over everything else', () => {
    const docs: CandidateDoc[] = [
      { ...base, id: 'a', name: 'random.pdf', portalSection: null },
      { ...base, id: 'b', name: 'unrelated.pdf', portalSection: 'financial' },
      { ...base, id: 'c', name: 'jane-cv.pdf', portalSection: 'team_governance' },
    ];
    const out = selectTeamDocumentCandidates(docs, 5);
    expect(out.map((d) => d.id)).toEqual(['c']);
  });

  it('falls back to name/folder-name matching when no portal_section signal exists', () => {
    const docs: CandidateDoc[] = [
      { ...base, id: 'a', name: 'pitch-deck.pdf', folderName: 'Investor materials' },
      { ...base, id: 'b', name: 'resume-jane.pdf', folderName: null },
      { ...base, id: 'c', name: 'contract.pdf', folderName: 'Team' },
    ];
    const out = selectTeamDocumentCandidates(docs, 5);
    expect(out.map((d) => d.id).sort()).toEqual(['b', 'c']);
  });

  it('falls back to every clean PDF only when neither signal finds anything', () => {
    const docs: CandidateDoc[] = [
      { ...base, id: 'a', name: 'pitch-deck.pdf', folderName: 'Investor materials' },
      { ...base, id: 'b', name: 'financials.pdf', folderName: 'Finance' },
    ];
    const out = selectTeamDocumentCandidates(docs, 5);
    expect(out.map((d) => d.id).sort()).toEqual(['a', 'b']);
  });

  it('caps the result to maxDocs', () => {
    const docs: CandidateDoc[] = [1, 2, 3, 4].map((n) => ({ ...base, id: String(n), name: `cv-${n}.pdf` }));
    expect(selectTeamDocumentCandidates(docs, 2)).toHaveLength(2);
  });
});

// Prompt 718 Part D — the actual fix for the G3 draft timeout: a document
// COUNT cap let one 40-page deck through as easily as a one-page CV; a
// PAGE budget doesn't.
describe('rankTeamDocuments — Prompt 718 Part D: tier first, then fewest known pages first', () => {
  const basePage: PageAwareDoc = { id: '1', name: 'file.pdf', storagePath: 'org/file.pdf', folderName: null, portalSection: null, malwareScanStatus: 'clean', totalPages: null };

  it('excludes non-clean and non-pdf exactly like selectTeamDocumentCandidates does', () => {
    const docs: PageAwareDoc[] = [
      { ...basePage, id: 'a', malwareScanStatus: 'pending' },
      { ...basePage, id: 'b', name: 'deck.pptx', storagePath: 'org/deck.pptx' },
    ];
    expect(rankTeamDocuments(docs)).toEqual([]);
  });

  it('team_governance always ranks before a name match, which always ranks before the rest', () => {
    const docs: PageAwareDoc[] = [
      { ...basePage, id: 'rest', name: 'financials.pdf', totalPages: 1 },
      { ...basePage, id: 'name', name: 'jane-cv.pdf', totalPages: 1 },
      { ...basePage, id: 'gov', name: 'unrelated.pdf', portalSection: 'team_governance', totalPages: 1 },
    ];
    expect(rankTeamDocuments(docs).map((d) => d.id)).toEqual(['gov', 'name', 'rest']);
  });

  it('within the same tier, fewest KNOWN pages first', () => {
    const docs: PageAwareDoc[] = [
      { ...basePage, id: 'big', name: 'team-a.pdf', totalPages: 20 },
      { ...basePage, id: 'small', name: 'team-b.pdf', totalPages: 2 },
    ];
    expect(rankTeamDocuments(docs).map((d) => d.id)).toEqual(['small', 'big']);
  });

  it('an unknown page count sorts LAST within its own tier — riskiest to attach blind', () => {
    const docs: PageAwareDoc[] = [
      { ...basePage, id: 'unknown', name: 'team-a.pdf', totalPages: null },
      { ...basePage, id: 'known', name: 'team-b.pdf', totalPages: 5 },
    ];
    expect(rankTeamDocuments(docs).map((d) => d.id)).toEqual(['known', 'unknown']);
  });
});

describe('selectWithinPageBudget — Prompt 718 Part D: an unextracted doc counts as the FULL cap', () => {
  it('keeps adding ranked docs while the running total stays within budget', () => {
    const docs = [{ id: 'a', totalPages: 5 }, { id: 'b', totalPages: 5 }, { id: 'c', totalPages: 5 }];
    expect(selectWithinPageBudget(docs, 15).map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('skips a document that would push the total over budget, but keeps checking the rest', () => {
    const docs = [{ id: 'a', totalPages: 10 }, { id: 'b', totalPages: 10 }, { id: 'c', totalPages: 3 }];
    expect(selectWithinPageBudget(docs, 15).map((d) => d.id)).toEqual(['a', 'c']);
  });

  it('an unknown page count (null) costs the FULL budget — only ever selected alone', () => {
    const docs = [{ id: 'unknown', totalPages: null }, { id: 'known', totalPages: 2 }];
    expect(selectWithinPageBudget(docs, 15).map((d) => d.id)).toEqual(['unknown']);
  });

  it('a known-cheap doc first, THEN an unknown one, only keeps the cheap one — the unknown no longer fits', () => {
    const docs = [{ id: 'known', totalPages: 2 }, { id: 'unknown', totalPages: null }];
    expect(selectWithinPageBudget(docs, 15).map((d) => d.id)).toEqual(['known']);
  });

  it('defaults to MAX_ATTACHED_PDF_PAGES (15) when no explicit budget is passed', () => {
    expect(MAX_ATTACHED_PDF_PAGES).toBe(15);
    const docs = [{ id: 'a', totalPages: 15 }, { id: 'b', totalPages: 1 }];
    expect(selectWithinPageBudget(docs).map((d) => d.id)).toEqual(['a']);
  });
});

describe('isAllowedLinkedInUrl', () => {
  it('accepts linkedin.com and subdomains over https', () => {
    expect(isAllowedLinkedInUrl('https://linkedin.com/in/jane')).toBe(true);
    expect(isAllowedLinkedInUrl('https://www.linkedin.com/in/jane')).toBe(true);
    expect(isAllowedLinkedInUrl('https://pt.linkedin.com/in/jane')).toBe(true);
  });
  it('rejects non-linkedin domains — never an open fetch to an arbitrary host', () => {
    expect(isAllowedLinkedInUrl('https://evil.example.com/linkedin.com')).toBe(false);
    expect(isAllowedLinkedInUrl('https://notlinkedin.com/in/jane')).toBe(false);
    expect(isAllowedLinkedInUrl('https://linkedin.com.evil.com/in/jane')).toBe(false);
  });
  it('rejects non-https', () => {
    expect(isAllowedLinkedInUrl('http://linkedin.com/in/jane')).toBe(false);
  });
  it('rejects malformed/missing values without throwing', () => {
    expect(isAllowedLinkedInUrl('not a url')).toBe(false);
    expect(isAllowedLinkedInUrl(null)).toBe(false);
    expect(isAllowedLinkedInUrl(undefined)).toBe(false);
    expect(isAllowedLinkedInUrl('')).toBe(false);
  });
});

describe('relevantPeopleForLinkedIn', () => {
  const people: LinkedInTargetPerson[] = [
    { fullName: 'Jane Doe', title: 'CEO', linkedinUrl: 'https://linkedin.com/in/jane' },
    { fullName: 'John Roe', title: 'CTO', linkedinUrl: 'https://linkedin.com/in/john' },
    { fullName: 'Alex Fin', title: 'CFO', linkedinUrl: null },
  ];
  const baseGap = { severity: 'high' as const, message: '', relatedClaimIds: [] };

  it('G3 (no single target) considers every team member', () => {
    const gap: Gap = { ...baseGap, rule: 'G3' };
    expect(relevantPeopleForLinkedIn(gap, people).map((p) => p.fullName)).toEqual(['Jane Doe', 'John Roe', 'Alex Fin']);
  });

  it('G3b narrows to exactly the named founder — never anyone else\'s profile', () => {
    const gap: Gap = { ...baseGap, rule: 'G3b', meta: { founderName: 'Jane Doe' } };
    expect(relevantPeopleForLinkedIn(gap, people).map((p) => p.fullName)).toEqual(['Jane Doe']);
  });

  it('G3b with an unmatched founderName targets nobody', () => {
    const gap: Gap = { ...baseGap, rule: 'G3b', meta: { founderName: 'Nobody Here' } };
    expect(relevantPeopleForLinkedIn(gap, people)).toEqual([]);
  });

  it('G3c narrows to people whose title matches the function — technical', () => {
    const gap: Gap = { ...baseGap, rule: 'G3c', meta: { functionKey: 'technical', functionLabel: 'technical' } };
    expect(relevantPeopleForLinkedIn(gap, people).map((p) => p.fullName)).toEqual(['John Roe']);
  });

  it('G3c narrows to people whose title matches the function — financial', () => {
    const gap: Gap = { ...baseGap, rule: 'G3c', meta: { functionKey: 'financial', functionLabel: 'financial' } };
    expect(relevantPeopleForLinkedIn(gap, people).map((p) => p.fullName)).toEqual(['Alex Fin']);
  });

  it('G3c with an unknown functionKey targets nobody rather than falling back to everyone', () => {
    const gap: Gap = { ...baseGap, rule: 'G3c', meta: { functionKey: 'marketing', functionLabel: 'marketing' } };
    expect(relevantPeopleForLinkedIn(gap, people)).toEqual([]);
  });
});

describe('looksLikeUsableLinkedInContent', () => {
  it('rejects short content', () => {
    expect(looksLikeUsableLinkedInContent('short')).toBe(false);
  });
  it('rejects content with login-wall markers even if long', () => {
    const html = `<title>LinkedIn Login, Sign in | LinkedIn</title>${'x'.repeat(1000)} Sign in to LinkedIn to continue`;
    expect(looksLikeUsableLinkedInContent(html)).toBe(false);
  });
  it('rejects an authwall page', () => {
    const html = `<div class="authwall">${'y'.repeat(900)}</div>`;
    expect(looksLikeUsableLinkedInContent(html)).toBe(false);
  });
  it('accepts long content with no login markers', () => {
    const html = `<html><body>${'Jane Doe is a startup founder with 10 years of experience. '.repeat(30)}</body></html>`;
    expect(looksLikeUsableLinkedInContent(html)).toBe(true);
  });
});
