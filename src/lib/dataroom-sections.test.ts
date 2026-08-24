import { describe, it, expect } from 'vitest';
import { groupDocumentsBySection, PORTAL_SECTIONS } from './dataroom-sections';

describe('groupDocumentsBySection', () => {
  it('root-only grant + sectioned subfolder docs — each section lists its own docs (Prompt 350 §A regression)', () => {
    // Mirrors the production shape: the grant is on the root folder
    // (portal_section null), and every real document lives several levels
    // under it in a sectioned subfolder — exactly the "In preparation x6
    // despite full authorization" bug.
    const folders = [
      { id: 'root', parent_id: null, portal_section: null },
      { id: 'start-here', parent_id: 'root', portal_section: 'start_here' },
      { id: 'financial', parent_id: 'root', portal_section: 'financial' },
    ];
    const documents = [
      { id: 'd1', folder_id: 'start-here' },
      { id: 'd2', folder_id: 'financial' },
      { id: 'd3', folder_id: 'financial' },
    ];
    const sections = groupDocumentsBySection(folders, documents);
    expect(sections.find((s) => s.key === 'start_here')?.documents.map((d) => d.id)).toEqual(['d1']);
    expect(sections.find((s) => s.key === 'financial')?.documents.map((d) => d.id)).toEqual(['d2', 'd3']);
    expect(sections.find((s) => s.key === 'team_governance')?.documents).toEqual([]);
  });

  it('climbs ancestors when a document\'s direct folder has no portal_section', () => {
    const folders = [
      { id: 'root', parent_id: null, portal_section: null },
      { id: 'traction', parent_id: 'root', portal_section: 'traction_commercial' },
      { id: 'traction-sub', parent_id: 'traction', portal_section: null },
    ];
    const documents = [{ id: 'd1', folder_id: 'traction-sub' }];
    const sections = groupDocumentsBySection(folders, documents);
    expect(sections.find((s) => s.key === 'traction_commercial')?.documents.map((d) => d.id)).toEqual(['d1']);
  });

  it('a document in a folder with no sectioned ancestor lands in "Other documents", never disappears', () => {
    const folders = [
      { id: 'root', parent_id: null, portal_section: null },
      { id: 'misc', parent_id: 'root', portal_section: null },
    ];
    const documents = [{ id: 'd1', folder_id: 'misc' }];
    const sections = groupDocumentsBySection(folders, documents);
    const totalPlaced = sections.reduce((n, s) => n + s.documents.length, 0);
    expect(totalPlaced).toBe(1);
    const other = sections.find((s) => s.key === 'other');
    expect(other?.label).toBe('Other documents');
    expect(other?.documents.map((d) => d.id)).toEqual(['d1']);
  });

  it('omits the "Other documents" section entirely when every document resolves to a real section', () => {
    const folders = [{ id: 'f', parent_id: null, portal_section: 'start_here' }];
    const documents = [{ id: 'd1', folder_id: 'f' }];
    const sections = groupDocumentsBySection(folders, documents);
    expect(sections.find((s) => s.key === 'other')).toBeUndefined();
    expect(sections).toHaveLength(PORTAL_SECTIONS.length);
  });

  it('is defensive against a cyclic parent_id chain — never hangs, resolves to no section', () => {
    const folders = [
      { id: 'a', parent_id: 'b', portal_section: null },
      { id: 'b', parent_id: 'a', portal_section: null },
    ];
    const documents = [{ id: 'd1', folder_id: 'a' }];
    const sections = groupDocumentsBySection(folders, documents);
    expect(sections.find((s) => s.key === 'other')?.documents.map((d) => d.id)).toEqual(['d1']);
  });

  it('handles a document with no folder_id at all (direct grant, no folder) by placing it in Other', () => {
    const documents = [{ id: 'd1', folder_id: null }];
    const sections = groupDocumentsBySection([], documents);
    expect(sections.find((s) => s.key === 'other')?.documents.map((d) => d.id)).toEqual(['d1']);
  });
});
