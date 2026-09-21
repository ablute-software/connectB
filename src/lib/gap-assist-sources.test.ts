import { describe, expect, it } from 'vitest';
import {
  isTeamGap, formatTeamProfiles, selectTeamDocumentCandidates, isAllowedLinkedInUrl, looksLikeUsableLinkedInContent,
  relevantPeopleForLinkedIn, isRoundGap, selectRoundDocumentCandidates, suggestRoundDocument, insufficientAnswerMessage,
  type TeamProfile, type CandidateDoc, type LinkedInTargetPerson, type ExtractedDocumentInfo,
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

describe('isRoundGap', () => {
  it('is true only for G6', () => {
    expect(isRoundGap('G6')).toBe(true);
  });
  it('is false for team gaps and everything else, including G4', () => {
    expect(isRoundGap('G3')).toBe(false);
    expect(isRoundGap('G3b')).toBe(false);
    expect(isRoundGap('G3c')).toBe(false);
    expect(isRoundGap('G4')).toBe(false);
    expect(isRoundGap('G1')).toBe(false);
    expect(isRoundGap('G7')).toBe(false);
  });
});

describe('selectRoundDocumentCandidates', () => {
  const base: CandidateDoc = { id: '1', name: 'file.pdf', storagePath: 'org/file.pdf', folderName: null, portalSection: null, malwareScanStatus: 'clean' };

  it('picks a document whose extracted type matches "business plan"', () => {
    const docs: CandidateDoc[] = [{ ...base, id: 'a', name: 'SherlockDeal Plano de Negocios.pdf' }];
    const types = new Map([['a', 'business plan']]);
    expect(selectRoundDocumentCandidates(docs, types, 3).map((d) => d.id)).toEqual(['a']);
  });

  it('matches investor deck / pitch deck / financial model too', () => {
    const docs: CandidateDoc[] = [
      { ...base, id: 'a', name: 'deck.pdf' }, { ...base, id: 'b', name: 'pitch.pdf' }, { ...base, id: 'c', name: 'model.pdf' },
    ];
    const types = new Map([['a', 'Investor Deck'], ['b', 'pitch deck'], ['c', 'financial model (5yr)']]);
    expect(selectRoundDocumentCandidates(docs, types, 3).map((d) => d.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('excludes a document with no extraction on file at all', () => {
    const docs: CandidateDoc[] = [{ ...base, id: 'a', name: 'unread.pdf' }];
    expect(selectRoundDocumentCandidates(docs, new Map(), 3)).toEqual([]);
  });

  it('excludes a document whose extracted type is unrelated (e.g. a grant agreement)', () => {
    const docs: CandidateDoc[] = [{ ...base, id: 'a', name: 'grant.pdf' }];
    const types = new Map([['a', 'grant agreement']]);
    expect(selectRoundDocumentCandidates(docs, types, 3)).toEqual([]);
  });

  it('never returns a document that failed the malware-scan gate, even with a matching type', () => {
    const docs: CandidateDoc[] = [{ ...base, id: 'a', name: 'plan.pdf', malwareScanStatus: 'pending' }];
    const types = new Map([['a', 'business plan']]);
    expect(selectRoundDocumentCandidates(docs, types, 3)).toEqual([]);
  });

  it('caps the result to maxDocs', () => {
    const docs: CandidateDoc[] = [1, 2, 3].map((n) => ({ ...base, id: String(n), name: `plan-${n}.pdf` }));
    const types = new Map(docs.map((d) => [d.id, 'business plan']));
    expect(selectRoundDocumentCandidates(docs, types, 2)).toHaveLength(2);
  });
});

describe('suggestRoundDocument', () => {
  it('returns null when nothing is even remotely relevant — never invents a suggestion', () => {
    const docs: ExtractedDocumentInfo[] = [
      { documentId: 'a', documentName: 'grant.pdf', documentType: 'grant agreement', updatedAt: '2026-09-21T20:36:30Z' },
    ];
    expect(suggestRoundDocument(docs)).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(suggestRoundDocument([])).toBeNull();
  });

  it('returns the one relevant document when there is exactly one', () => {
    const docs: ExtractedDocumentInfo[] = [
      { documentId: 'a', documentName: 'grant.pdf', documentType: 'grant agreement', updatedAt: '2026-09-20T10:00:00Z' },
      { documentId: 'b', documentName: 'SherlockDeal Plano de Negocios.pdf', documentType: 'business plan', updatedAt: '2026-09-21T20:36:30Z' },
    ];
    expect(suggestRoundDocument(docs)?.documentId).toBe('b');
  });

  it('prefers the most recently extracted match when several are relevant', () => {
    const docs: ExtractedDocumentInfo[] = [
      { documentId: 'old', documentName: 'old-deck.pdf', documentType: 'pitch deck', updatedAt: '2026-01-01T00:00:00Z' },
      { documentId: 'new', documentName: 'new-plan.pdf', documentType: 'business plan', updatedAt: '2026-09-21T20:36:30Z' },
    ];
    expect(suggestRoundDocument(docs)?.documentId).toBe('new');
  });

  it('ignores a document with a null documentType', () => {
    const docs: ExtractedDocumentInfo[] = [{ documentId: 'a', documentName: 'unclassified.pdf', documentType: null, updatedAt: '2026-09-21T20:36:30Z' }];
    expect(suggestRoundDocument(docs)).toBeNull();
  });
});

describe('insufficientAnswerMessage', () => {
  it('keeps the original generic sentence, byte-identical, when there is no suggestion', () => {
    expect(insufficientAnswerMessage(null)).toBe('Nothing on file yet answers this — you\'ll need to fill it in yourself.');
  });

  it('names the document when there is a suggestion', () => {
    const suggestion: ExtractedDocumentInfo = { documentId: 'b', documentName: 'SherlockDeal Plano de Negocios.pdf', documentType: 'business plan', updatedAt: '2026-09-21T20:36:30Z' };
    const message = insufficientAnswerMessage(suggestion);
    expect(message).toContain('SherlockDeal Plano de Negocios.pdf');
    expect(message.toLowerCase()).not.toBe('nothing on file yet answers this — you\'ll need to fill it in yourself.');
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
