import { describe, expect, it } from 'vitest';
import {
  isTeamGap, formatTeamProfiles, selectTeamDocumentCandidates, isAllowedLinkedInUrl, looksLikeUsableLinkedInContent,
  relevantPeopleForLinkedIn, type TeamProfile, type CandidateDoc, type LinkedInTargetPerson,
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
