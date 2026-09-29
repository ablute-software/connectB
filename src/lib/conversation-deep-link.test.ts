import { describe, expect, it } from 'vitest';
import { conversationDeepLink, resolveConversationParams } from './conversation-deep-link';

describe('conversationDeepLink — Prompt 893 §A', () => {
  it('builds the new-form URL with tab+mode and passes through extra params', () => {
    expect(conversationDeepLink('ent-1', 'log', { person: 'p-1' })).toBe('/entities/ent-1?tab=conversation&mode=log&person=p-1');
  });

  it('omits undefined/empty extras rather than writing "undefined" into the URL', () => {
    expect(conversationDeepLink('ent-1', 'history', { classify: undefined })).toBe('/entities/ent-1?tab=conversation&mode=history');
  });

  it('mode=messages has no required extras', () => {
    expect(conversationDeepLink('ent-1', 'messages')).toBe('/entities/ent-1?tab=conversation&mode=messages');
  });
});

describe('resolveConversationParams — Prompt 893 §A, the ?rail= alias', () => {
  // Three forms named by the spec: the new tab=conversation&mode=log form,
  // the legacy rail=log alias, and rail=history (classify carried
  // separately by the caller, same as before — this function only owns
  // tab/mode/rail).
  it('form 1 — new ?tab=conversation&mode=log resolves directly, not flagged as a legacy alias', () => {
    const params = new URLSearchParams('tab=conversation&mode=log&person=p-1');
    expect(resolveConversationParams(params)).toEqual({ tab: 'conversation', mode: 'log', isLegacyRailAlias: false });
  });

  it('form 2 — legacy ?rail=log still resolves to the conversation tab, log mode, flagged as an alias', () => {
    const params = new URLSearchParams('rail=log&person=p-1');
    expect(resolveConversationParams(params)).toEqual({ tab: 'conversation', mode: 'log', isLegacyRailAlias: true });
  });

  it('form 3 — legacy ?rail=history&classify=1 still resolves to the conversation tab, history mode', () => {
    const params = new URLSearchParams('rail=history&classify=1');
    expect(resolveConversationParams(params)).toEqual({ tab: 'conversation', mode: 'history', isLegacyRailAlias: true });
  });

  it('no tab and no rail at all → tab null, mode null (a plain entity page visit)', () => {
    const params = new URLSearchParams('');
    expect(resolveConversationParams(params)).toEqual({ tab: null, mode: null, isLegacyRailAlias: false });
  });

  it('?tab= for one of the OTHER Zone-B tabs (no mode) is passed through untouched', () => {
    const params = new URLSearchParams('tab=people');
    expect(resolveConversationParams(params)).toEqual({ tab: 'people', mode: null, isLegacyRailAlias: false });
  });

  it('an unrecognized ?rail= value (neither history/log/messages) is not treated as an alias', () => {
    const params = new URLSearchParams('rail=bogus');
    expect(resolveConversationParams(params)).toEqual({ tab: null, mode: null, isLegacyRailAlias: false });
  });
});
