// Prompt 904 §A.3 — the controls the 12/10 report named must be recognised as "writes"; the read-only ones must not.
import { describe, expect, it } from 'vitest';
import { isMutatingControlText, VIEWER_READ_ONLY_TOOLTIP } from './viewer-readonly-controls';

describe('isMutatingControlText', () => {
  it.each([
    'Accept selected (18)', 'Accept', 'Reject', 'Edit', 'Save', 'Save thesis', 'Create invite', 'Post update', 'Post',
    'Change password', 'Suggest a stronger version', 'Research this hypothesis', '+ Add contact', 'Create link',
    'Delete', 'Send', 'Upload', 'Invite teammates',
  ])('%s is a write: greyed, with the tooltip', (label) => {
    expect(isMutatingControlText(label)).toBe(true);
  });

  it.each([
    'Credits', 'Buy credits', 'Postcode', 'Overview', 'Documents', 'Market data', 'Readiness', 'Filter', 'Close', 'Show more',
    'Copy link', 'EXIT VIEWER MODE', 'Support', 'My Network',
  ])('%s is not', (label) => {
    expect(isMutatingControlText(label)).toBe(false);
  });

  it('the tooltip is the sentence the prompt asks for', () => {
    expect(VIEWER_READ_ONLY_TOOLTIP).toBe('Read-only in Developer Viewer');
  });
});
