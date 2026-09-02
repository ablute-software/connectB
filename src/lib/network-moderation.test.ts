import { describe, expect, it } from 'vitest';
import {
  NETWORK_STRIKE_BAN_THRESHOLD, REPORTER_PRIVATE_FIELDS, buildContentSnapshot, describeBanState,
  resolveModerationEvidence, shouldBanForStrikes, strikeConsequenceLine, toStartupStrikeView,
} from './network-moderation';

// Prompt 531 — two things are worth pinning here above all else: that the
// 3-strike rule this task must NOT redefine is still 3, and that the shape
// the reported startup receives cannot carry reporter data.

describe('the existing strike→ban rule is preserved, not redefined', () => {
  it('the threshold is still 3', () => {
    expect(NETWORK_STRIKE_BAN_THRESHOLD).toBe(3);
  });

  it('bans at 3 and above, never below', () => {
    expect(shouldBanForStrikes(0)).toBe(false);
    expect(shouldBanForStrikes(1)).toBe(false);
    expect(shouldBanForStrikes(2)).toBe(false);
    expect(shouldBanForStrikes(3)).toBe(true);
    expect(shouldBanForStrikes(4)).toBe(true);
  });
});

describe('describeBanState — strike reversal and ban reversal stay distinct', () => {
  it('an unbanned actor below the threshold is simply fine', () => {
    expect(describeBanState({ activeStrikeCount: 1, suspendedAt: null }))
      .toEqual({ banned: false, banRequiredByStrikes: false, banNoLongerRequired: false });
  });

  it('a banned actor at the threshold is banned and still required to be', () => {
    expect(describeBanState({ activeStrikeCount: 3, suspendedAt: '2026-09-01T00:00:00Z' }))
      .toEqual({ banned: true, banRequiredByStrikes: true, banNoLongerRequired: false });
  });

  it('reversing a strike below the threshold does NOT silently lift the ban, but flags it', () => {
    // The product has a rule for applying a ban and none for lifting one.
    // Auto-lifting would be inventing policy; hiding the mismatch would be
    // worse. So: still banned, and visibly no longer required.
    expect(describeBanState({ activeStrikeCount: 2, suspendedAt: '2026-09-01T00:00:00Z' }))
      .toEqual({ banned: true, banRequiredByStrikes: false, banNoLongerRequired: true });
  });

  it('an actor at the threshold who was never banned is not reported as banned', () => {
    expect(describeBanState({ activeStrikeCount: 3, suspendedAt: null }).banned).toBe(false);
  });
});

describe('buildContentSnapshot', () => {
  const post = {
    id: 'p1', body: 'Hello network', kind: 'freeform', structured: null,
    target: 'all', created_at: '2026-08-01T10:00:00Z', author_actor_id: 'a1',
  };

  it('freezes the post as it was, with its author and publication date', () => {
    const snap = buildContentSnapshot(post, { authorName: 'ablute_' });
    expect(snap.postId).toBe('p1');
    expect(snap.body).toBe('Hello network');
    expect(snap.createdAt).toBe('2026-08-01T10:00:00Z');
    expect(snap.authorActorId).toBe('a1');
    expect(snap.authorName).toBe('ablute_');
  });

  it('carries a structured update payload rather than flattening it away', () => {
    const snap = buildContentSnapshot({ ...post, kind: 'update', structured: { team: 'Hired two engineers' } });
    expect(snap.structured).toEqual({ team: 'Hired two engineers' });
  });

  it('never invents a reporter field', () => {
    const snap = buildContentSnapshot(post) as unknown as Record<string, unknown>;
    for (const field of REPORTER_PRIVATE_FIELDS) expect(snap[field]).toBeUndefined();
  });
});

describe('toStartupStrikeView — the privacy boundary', () => {
  const snapshot = buildContentSnapshot(
    { id: 'p1', body: 'The reported post', kind: 'freeform', target: 'all', created_at: '2026-08-01T10:00:00Z', author_actor_id: 'a1' },
    { authorName: 'ablute_' },
  );
  const base = {
    id: 's1', appliedAt: '2026-08-05T09:00:00Z', status: 'active' as const,
    contentRemoved: false, snapshot, appeal: null,
  };

  it('carries none of the reporter-private fields', () => {
    const view = toStartupStrikeView(base) as unknown as Record<string, unknown>;
    for (const field of REPORTER_PRIVATE_FIELDS) expect(view[field]).toBeUndefined();
  });

  it('exposes exactly the allowed keys and nothing else', () => {
    expect(Object.keys(toStartupStrikeView(base)).sort()).toEqual([
      'appeal', 'appliedAt', 'canAppeal', 'content', 'contentRemoved', 'outcome', 'status', 'strikeId',
    ]);
  });

  it('serialises with no reporter trace anywhere in the JSON', () => {
    // The real leak vector is a nested object nobody re-checked, so assert
    // on the wire format, not just the top level.
    const json = JSON.stringify(toStartupStrikeView(base)).toLowerCase();
    for (const needle of ['reporter', 'ticket', 'spam', 'reason']) expect(json).not.toContain(needle);
  });

  it('states SherlockDeal\'s own outcome, never a reporter complaint', () => {
    expect(toStartupStrikeView(base).outcome).toContain('SherlockDeal found this content in breach');
  });

  it('says so when the content was also removed', () => {
    expect(toStartupStrikeView({ ...base, contentRemoved: true }).outcome).toContain('removed it from My Network');
  });

  it('still shows the content after removal, so the startup can identify it', () => {
    const view = toStartupStrikeView({ ...base, contentRemoved: true });
    expect(view.content?.body).toBe('The reported post');
    expect(view.content?.createdAt).toBe('2026-08-01T10:00:00Z');
  });

  it('offers Contest on an active strike with no appeal yet', () => {
    expect(toStartupStrikeView(base).canAppeal).toBe(true);
  });

  it('does not offer a second appeal once one exists', () => {
    const view = toStartupStrikeView({ ...base, appeal: { status: 'pending', createdAt: '2026-08-06T00:00:00Z', decidedAt: null } });
    expect(view.canAppeal).toBe(false);
    expect(view.appeal).toEqual({ status: 'pending', submittedAt: '2026-08-06T00:00:00Z', decidedAt: null });
  });

  it('does not offer an appeal on a strike that is already reversed', () => {
    expect(toStartupStrikeView({ ...base, status: 'reversed' }).canAppeal).toBe(false);
  });

  it('tells the startup plainly when a strike was reversed', () => {
    expect(toStartupStrikeView({ ...base, status: 'reversed' }).outcome).toContain('reversed');
  });

  it('never leaks an internal decision note through the appeal projection', () => {
    const withDecision = toStartupStrikeView({
      ...base, status: 'reversed',
      appeal: { status: 'reversed', createdAt: '2026-08-06T00:00:00Z', decidedAt: '2026-08-07T00:00:00Z' },
    });
    expect(Object.keys(withDecision.appeal!).sort()).toEqual(['decidedAt', 'status', 'submittedAt']);
  });
});

describe('strikeConsequenceLine', () => {
  it('counts down to the real threshold', () => {
    expect(strikeConsequenceLine(1, false)).toBe('1 of 3 strikes. 2 more would suspend your My Network access (your SherlockDeal account is not affected).');
  });

  it('says My Network only, never the whole account', () => {
    expect(strikeConsequenceLine(3, true)).toContain('SherlockDeal account is not affected');
    expect(strikeConsequenceLine(3, true)).toContain('My Network access is currently suspended');
  });

  it('never names a reporter or a reason', () => {
    for (const n of [0, 1, 2, 3, 5]) {
      const line = strikeConsequenceLine(n, n >= 3).toLowerCase();
      expect(line).not.toContain('report');
    }
  });
});


// Prompt 533 §44 — the moderator must SEE the reported content. These pin
// the four resolution cases the brief names, plus the privacy serialization.

const POST = { id: 'post-1', body: 'ORIGINAL MODERATION SNAPSHOT TEST', kind: 'freeform', target: 'all', created_at: '2026-09-02T14:35:00Z', author_actor_id: 'a1' };
const SNAP = buildContentSnapshot(POST, { authorName: 'zz-test Startup' });
const LIVE_UNCHANGED = { body: POST.body, createdAt: POST.created_at, deletedAt: null, moderationRemovedAt: null };

describe('resolveModerationEvidence — the moderator sees content, never a UUID', () => {
  it('resolves a NEW report from its snapshot', () => {
    const e = resolveModerationEvidence({ snapshot: SNAP, live: LIVE_UNCHANGED, contentId: 'post-1', capturedAt: '2026-09-02T15:02:00Z' });
    expect(e.source).toBe('snapshot');
    expect(e.body).toBe('ORIGINAL MODERATION SNAPSHOT TEST');
    expect(e.authorName).toBe('zz-test Startup');
    expect(e.publishedAt).toBe('2026-09-02T14:35:00Z');
    expect(e.liveStatus).toBe('unchanged');
  });

  it('HISTORICAL report with no snapshot resolves from the live post (§9/§15)', () => {
    // This is the case the previous pass missed: every report already in the
    // queue has no snapshot, and the panel rendered no content at all.
    const e = resolveModerationEvidence({
      snapshot: null, live: { body: 'A pre-snapshot post', createdAt: '2026-08-01T09:00:00Z', deletedAt: null, moderationRemovedAt: null },
      contentId: 'post-old', authorName: 'zz-test Startup',
    });
    expect(e.source).toBe('live_post');
    expect(e.body).toBe('A pre-snapshot post');
    expect(e.authorName).toBe('zz-test Startup');
    expect(e.unavailableReason).toBeNull();
  });

  it('SNAPSHOT IMMUTABILITY: an edit after the report never replaces the evidence (§13)', () => {
    const e = resolveModerationEvidence({
      snapshot: SNAP,
      live: { body: 'EDITED AFTER REPORT', createdAt: POST.created_at, deletedAt: null, moderationRemovedAt: null },
      contentId: 'post-1',
    });
    expect(e.body).toBe('ORIGINAL MODERATION SNAPSHOT TEST');
    expect(e.liveStatus).toBe('edited');
    expect(e.liveBody).toBe('EDITED AFTER REPORT'); // shown alongside, never instead
  });

  it('DELETED CONTENT: the snapshot stays reviewable after the author deletes (§14)', () => {
    const e = resolveModerationEvidence({
      snapshot: SNAP,
      live: { body: POST.body, createdAt: POST.created_at, deletedAt: '2026-09-02T16:00:00Z', moderationRemovedAt: null },
      contentId: 'post-1',
    });
    expect(e.source).toBe('snapshot');
    expect(e.body).toBe('ORIGINAL MODERATION SNAPSHOT TEST');
    expect(e.liveStatus).toBe('author_deleted');
  });

  it('the snapshot survives BACK-OFFICE removal too (§19/§20)', () => {
    const e = resolveModerationEvidence({
      snapshot: SNAP,
      live: { body: POST.body, createdAt: POST.created_at, deletedAt: '2026-09-02T16:00:00Z', moderationRemovedAt: '2026-09-02T16:00:00Z' },
      contentId: 'post-1',
    });
    expect(e.body).toBe('ORIGINAL MODERATION SNAPSHOT TEST');
    expect(e.liveStatus).toBe('moderation_removed');
  });

  it('hard-deleted post with no snapshot is TRUTHFULLY unavailable, never the UUID (§15/§29)', () => {
    const e = resolveModerationEvidence({ snapshot: null, live: null, contentId: 'post-gone' });
    expect(e.source).toBe('unavailable');
    expect(e.body).toBeNull();
    expect(e.unavailableReason).toContain('no longer available');
    // The id survives only as secondary metadata — it is not the content.
    expect(e.contentId).toBe('post-gone');
  });

  it('keeps the content id as secondary metadata, not as the body', () => {
    const e = resolveModerationEvidence({ snapshot: SNAP, live: LIVE_UNCHANGED, contentId: 'post-1' });
    expect(e.contentId).toBe('post-1');
    expect(e.body).not.toContain('post-1');
    expect(e.body).not.toContain('network_post:');
  });

  it('models media as a list so a post with several images shows all of them (§6)', () => {
    // Empty today — network_posts is text-only — but the shape is a list,
    // never a single "first image".
    expect(resolveModerationEvidence({ snapshot: SNAP, live: LIVE_UNCHANGED, contentId: 'post-1' }).media).toEqual([]);
  });
});

describe('§44 startup privacy serialization, against the evidence path', () => {
  it('the startup-facing view of a struck post carries content but no reporter trace', () => {
    const view = toStartupStrikeView({
      id: 's1', appliedAt: '2026-09-02T16:00:00Z', status: 'active',
      contentRemoved: true, snapshot: SNAP, appeal: null,
    });
    expect(view.content?.body).toBe('ORIGINAL MODERATION SNAPSHOT TEST');
    const json = JSON.stringify(view).toLowerCase();
    for (const needle of ['reporter', 'ticket', 'spam', 'reason']) expect(json).not.toContain(needle);
  });
});
