import { describe, expect, it } from 'vitest';
import {
  buildAccessRelationships, countGrantedDocuments, matchesRelationshipQuery,
  type RelationshipGrant,
} from './data-room-access-relationships';

// Prompt 530 — the duplicated-entity bug had no test because the grouping
// it needed did not exist: the panel read access_grants rows straight into
// the left column. These tests pin the invariant that replaced it — one row
// per relationship, whatever the grant count.

const NOW = new Date('2026-09-02T00:00:00.000Z');
const PAST = '2026-08-01T00:00:00.000Z';
const FUTURE = '2026-12-31T00:00:00.000Z';

const FOLDERS = [
  { id: 'root' },
  { id: 'financials', parent_id: 'root' },
  { id: 'legal', parent_id: 'root' },
  { id: 'annexes', parent_id: 'financials' },
];
const DOCUMENTS = [
  { id: 'd1', folder_id: 'financials' },
  { id: 'd2', folder_id: 'financials' },
  { id: 'd3', folder_id: 'annexes' },
  { id: 'd4', folder_id: 'legal' },
  { id: 'd5', folder_id: 'legal', visibility: 'due_diligence' },
];

let seq = 0;
function grant(over: Partial<RelationshipGrant>): RelationshipGrant {
  seq += 1;
  return { id: `g${seq}`, nda_required: false, ...over } as RelationshipGrant;
}

function build(over: Partial<Parameters<typeof buildAccessRelationships>[0]> = {}) {
  return buildAccessRelationships({
    entities: [{ id: 'e1', name: 'North Ventures' }],
    people: [
      { id: 'p1', entity_id: 'e1', full_name: 'John Smith', email_verified: 'john@north.vc' },
      { id: 'p2', entity_id: 'e1', full_name: 'Maria Doe', email_guess: 'maria@north.vc' },
    ],
    affiliations: [],
    grants: [],
    folders: FOLDERS,
    documents: DOCUMENTS,
    now: NOW,
    ...over,
  });
}

describe('buildAccessRelationships — one row per relationship, never one per grant', () => {
  it('60 document grants to one unknown email produce ONE entity row', () => {
    const grants = Array.from({ length: 60 }, (_, i) =>
      grant({ invited_email: 'investor@example.com', document_id: `doc-${i}` }));
    const rels = build({ grants });
    expect(rels).toHaveLength(1);
    expect(rels[0].kind).toBe('guest');
    expect(rels[0].name).toBe('investor@example.com');
    expect(rels[0].status).toBe('por_associar');
    expect(rels[0].peopleCount).toBe(1);
    expect(rels[0].grants).toHaveLength(60);
  });

  it('two people at the same entity are one row with 2 people', () => {
    const rels = build({
      grants: [grant({ person_id: 'p1', folder_id: 'financials' }), grant({ person_id: 'p2', folder_id: 'legal' })],
    });
    expect(rels).toHaveLength(1);
    expect(rels[0].name).toBe('North Ventures');
    expect(rels[0].peopleCount).toBe(2);
    expect(rels[0].personNames.sort()).toEqual(['John Smith', 'Maria Doe']);
  });

  it('adding more grants to the same recipient never adds a row', () => {
    const one = build({ grants: [grant({ person_id: 'p1', document_id: 'd1' })] });
    const three = build({
      grants: [
        grant({ person_id: 'p1', document_id: 'd1' }),
        grant({ person_id: 'p1', document_id: 'd2' }),
        grant({ person_id: 'p1', document_id: 'd4' }),
      ],
    });
    expect(one).toHaveLength(1);
    expect(three).toHaveLength(1);
    expect(three[0].fileCount).toBe(3);
  });

  it('a revoked grant is not a relationship', () => {
    const rels = build({ grants: [grant({ invited_email: 'gone@example.com', document_id: 'd1', revoked_at: PAST })] });
    expect(rels).toHaveLength(0);
  });

  it('uses the current affiliation entity over the base entity_id', () => {
    const rels = build({
      entities: [{ id: 'e1', name: 'North Ventures' }, { id: 'e2', name: 'South Capital' }],
      affiliations: [{ person_id: 'p1', entity_id: 'e2', current: true }],
      grants: [grant({ person_id: 'p1', document_id: 'd1' })],
    });
    expect(rels[0].name).toBe('South Capital');
  });
});

describe('guest → registered investor continuity', () => {
  it('an email that matches a known person joins that entity, it does not duplicate it', () => {
    const rels = build({
      grants: [
        grant({ person_id: 'p1', document_id: 'd1' }),
        grant({ invited_email: 'john@north.vc', document_id: 'd2' }),
      ],
    });
    expect(rels).toHaveLength(1);
    expect(rels[0].name).toBe('North Ventures');
    expect(rels[0].status).toBe('associated');
    expect(rels[0].fileCount).toBe(2);
  });

  it('matching is case-insensitive on the email', () => {
    const rels = build({ grants: [grant({ invited_email: 'JOHN@North.VC', document_id: 'd1' })] });
    expect(rels).toHaveLength(1);
    expect(rels[0].name).toBe('North Ventures');
  });

  it('a confirmed invite stops being a pending guest invite', () => {
    const rels = build({ grants: [grant({ invited_email: 'new@example.com', document_id: 'd1', confirmed_at: PAST })] });
    expect(rels[0].pendingInviteEmail).toBeUndefined();
  });

  it('an unconfirmed invite exposes the email the guest link belongs to', () => {
    const rels = build({ grants: [grant({ invited_email: 'new@example.com', document_id: 'd1' })] });
    expect(rels[0].pendingInviteEmail).toBe('new@example.com');
  });
});

describe('countGrantedDocuments — files, not grants', () => {
  it('a folder grant counts every document under it, including subfolders', () => {
    expect(countGrantedDocuments([grant({ person_id: 'p1', folder_id: 'financials' })], DOCUMENTS, FOLDERS, NOW)).toBe(3);
  });

  it('the root grant reaches everything except a due-diligence document', () => {
    // d5 is due_diligence — only a document-level grant can ever open it.
    expect(countGrantedDocuments([grant({ person_id: 'p1', folder_id: 'root' })], DOCUMENTS, FOLDERS, NOW)).toBe(4);
  });

  it('a document covered by both a folder grant and its own grant counts once', () => {
    const grants = [grant({ person_id: 'p1', folder_id: 'financials' }), grant({ person_id: 'p1', document_id: 'd1' })];
    expect(countGrantedDocuments(grants, DOCUMENTS, FOLDERS, NOW)).toBe(3);
  });

  it('expired and revoked grants do not inflate the count', () => {
    const grants = [
      grant({ person_id: 'p1', document_id: 'd1' }),
      grant({ person_id: 'p1', document_id: 'd2', expires_at: PAST }),
      grant({ person_id: 'p1', document_id: 'd4', revoked_at: PAST }),
    ];
    expect(countGrantedDocuments(grants, DOCUMENTS, FOLDERS, NOW)).toBe(1);
  });

  it('a grant that expires in the future still counts', () => {
    expect(countGrantedDocuments([grant({ person_id: 'p1', document_id: 'd1', expires_at: FUTURE })], DOCUMENTS, FOLDERS, NOW)).toBe(1);
  });

  it('10 + 3 = 13 and revoking 2 leaves 11', () => {
    const docs = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, folder_id: 'legal' }));
    const ten = Array.from({ length: 10 }, (_, i) => grant({ person_id: 'p1', document_id: `x${i}` }));
    expect(countGrantedDocuments(ten, docs, FOLDERS, NOW)).toBe(10);
    const thirteen = [...ten, ...[10, 11, 12].map((i) => grant({ person_id: 'p1', document_id: `x${i}` }))];
    expect(countGrantedDocuments(thirteen, docs, FOLDERS, NOW)).toBe(13);
    const eleven = thirteen.map((g, i) => (i < 2 ? { ...g, revoked_at: PAST } : g));
    expect(countGrantedDocuments(eleven, docs, FOLDERS, NOW)).toBe(11);
  });

  it('an expired relationship keeps its row but counts zero files', () => {
    const rels = build({ grants: [grant({ invited_email: 'old@example.com', document_id: 'd1', expires_at: PAST })] });
    expect(rels).toHaveLength(1);
    expect(rels[0].fileCount).toBe(0);
    expect(rels[0].hasExpiredGrant).toBe(true);
  });
});

describe('matchesRelationshipQuery', () => {
  const rels = build({
    grants: [grant({ person_id: 'p1', document_id: 'd1' }), grant({ invited_email: 'someone@example.com', document_id: 'd2' })],
  });
  const north = rels.find((r) => r.name === 'North Ventures')!;
  const guest = rels.find((r) => r.kind === 'guest')!;

  it('matches the entity name case-insensitively', () => {
    expect(matchesRelationshipQuery(north, 'north')).toBe(true);
    expect(matchesRelationshipQuery(north, 'NORTH')).toBe(true);
  });

  it('matches a person name inside the entity', () => {
    expect(matchesRelationshipQuery(north, 'john')).toBe(true);
  });

  it('matches part of an email', () => {
    expect(matchesRelationshipQuery(north, 'north.vc')).toBe(true);
    expect(matchesRelationshipQuery(guest, 'someone@')).toBe(true);
  });

  it('an empty query restores everything', () => {
    expect(matchesRelationshipQuery(north, '')).toBe(true);
    expect(matchesRelationshipQuery(guest, '   ')).toBe(true);
  });

  it('no match is no match', () => {
    expect(matchesRelationshipQuery(north, 'zzz')).toBe(false);
  });
});
