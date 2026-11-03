// Prompt 927 (F) — the General tab says IN the page when the name is taken: the sentence, a link to the call that has it (not for a deleted one) and free names to pick from.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GeneralTab } from './GeneralTab';
import type { Call } from '@/lib/calls/types';

const call = { id: 'c1', name: 'INNOV-ID', description: null, opensAt: null, closesAt: null, timezone: 'Europe/Lisbon', visibility: 'unlisted', limitUnit: 'project', allowMultiple: false, contentLanguage: 'en', currency: 'EUR', status: 'draft', promoterKind: 'catalog_entity', promoterId: 'p', configVersion: 1 } as unknown as Call;
const html = (nameClash?: Parameters<typeof GeneralTab>[0]['nameClash']) => renderToStaticMarkup(createElement(GeneralTab, { call, promoterName: 'Firm', disabled: false, onChange: () => {}, nameClash }));

describe('the name was refused', () => {
  it('nothing is shown while the name is free', () => {
    expect(html(null)).not.toContain('name-clash');
    expect(html(undefined)).not.toContain('aria-invalid');
  });
  it('the sentence, the way to the call that has the name, and the free names', () => {
    const out = html({ error: 'There is already a call named «INNOV-ID» in your organisation.', existing: { id: '9b2f6c1e-0000-4000-8000-000000000001', name: 'INNOV-ID', deleted: false }, suggestions: ['INNOV-ID 2026', 'INNOV-ID — 2nd edition'] });
    expect(out).toContain('There is already a call named «INNOV-ID» in your organisation.');
    expect(out).toContain('?call=9b2f6c1e-0000-4000-8000-000000000001');
    expect(out).toContain('Open it');
    expect(out).toContain('INNOV-ID 2026');
    expect(out).toContain('INNOV-ID — 2nd edition');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('role="alert"');
  });
  it('a deleted call has no link (it cannot be opened), only the sentence and the free names', () => {
    const out = html({ error: 'There is already a call named «Pitch» in your organisation (in Deleted calls).', existing: { id: 'd', name: 'Pitch', deleted: true }, suggestions: ['Pitch 2026'] });
    expect(out).not.toContain('Open it');
    expect(out).toContain('in Deleted calls');
    expect(out).toContain('Pitch 2026');
  });
});
