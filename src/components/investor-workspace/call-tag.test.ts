// Prompt 927 (A) — the tag on a pipeline card: "From call · C1", the name shortened when long and complete in the tooltip; a link only for whoever may open the application; the state only when it was sent.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CallTagChips } from './CallTagChips';

const html = (tags: Parameters<typeof CallTagChips>[0]['tags']) => renderToStaticMarkup(createElement(CallTagChips, { tags }));
const tag = (over: Partial<Parameters<typeof CallTagChips>[0]['tags'][number]> = {}) => ({ callId: 'c1', callName: 'C1', applicationId: 'a1', role: 'admin' as const, state: null, canOpen: true, ...over });

describe('the call tag on a pipeline card', () => {
  it('is short, and links to the application when the person may open it', () => {
    const out = html([tag()]);
    expect(out).toContain('From call · C1');
    expect(out).toContain('role="link"');
    expect(out).toContain('click to open the application');
  });
  it('shortens a long name and keeps the whole of it in the tooltip', () => {
    const out = html([tag({ callName: 'INNOV-ID — second edition 2027' })]);
    expect(out).toContain('From call · INNOV-ID — se…');
    expect(out).toContain('title="From call: INNOV-ID — second edition 2027');
  });
  it('shows the state only when it was sent, and is not a link for someone who may not open the application', () => {
    const out = html([tag({ state: 'Fit' }), tag({ callId: 'c2', callName: 'C2', canOpen: false, role: 'evaluator' })]);
    expect(out).toContain('From call · C1 · Fit');
    expect(out).toContain('From call · C2<');
    expect(out.match(/role="link"/g)).toHaveLength(1);
  });
  it('one tag per call', () => {
    expect((html([tag(), tag({ callId: 'c2', callName: 'C2' })]).match(/data-testid="call-tag"/g) ?? [])).toHaveLength(2);
  });
});
