// Prompt 530 — "People & Access": one row per RELATIONSHIP, never one row
// per grant.
//
// The bug this file exists to kill: PeopleAccessPanel.tsx listed
// `db.grants.filter((g) => !g.person_id && !g.revoked_at)` directly, one
// <li> per row. A founder who shares 60 documents with one email address
// creates 60 access_grants rows (the grant model is deliberately
// fine-grained — one row per folder/document node, which is what makes
// per-document revoke possible), so the same investor appeared 60 times in
// the left column. The fix has to be at this level — the grouping the UI
// reads — not a `distinct` slapped on the render, or every other surface
// that walks grants keeps reproducing it.
//
// The hierarchy the panel needs, and the one the grant table only implies:
//
//   Entity / Investor → Person(s) / Recipient(s) → Folder(s) → Document grant(s)
//
// Grouping key, in order of strength:
//   1. the entity a granted person belongs to  → `entity:<id>`
//   2. a granted person with no entity at all  → `person:<id>`
//   3. an email that matches a known person    → resolved to 1 or 2
//  3b. an email registered as a Sherlock investor (Prompt 560):
//        → with a pipeline entity for their firm → `entity:<id>`, associated
//        → without one                           → stays by email, status `registered`
//   4. an email that matches nothing yet       → `guest:<email>`  (Por associar)
//
// Rule 3 is the guest → registered-investor continuity requirement in its
// only honest form: identity resolution, not a second record. The moment
// `investor@example.com` is recognised as John Smith at North Ventures
// (because a people row carries that email), his email-only grants join the
// North Ventures relationship instead of standing beside it as a duplicate.
// /api/portal/confirm-identity keeps invited_email on the row precisely so
// this stays possible after confirmation.
//
// Prompt 560 — rule 3 knew only ONE source of identities, and it was the
// wrong one. `people` rows belong to the FOUNDER's org: an investor creating
// a Sherlock account creates nothing there, so a recipient who registered
// with the very address she was invited at stayed "Por associar" forever.
// The header above promised "the guest → registered-investor continuity
// requirement"; the code delivered continuity only for investors the founder
// had already typed into their own CRM, which is the case that needed it
// least. Nuno hit exactly this: he shared, she signed up with the same
// address, and the row never moved.
//
// Rule 3b adds the other source — `matchdeal_investor_members`, where
// investors actually register — resolved server-side by
// /api/data-room/recipient-identities and passed in as `registeredByEmail`.
// It sits AFTER rule 3 deliberately: a `people` row is the founder's own
// statement about who this is, and it keeps winning.
//
// What 3b does NOT do: create a `people` row. Association is either through
// the pipeline entity (automatic, because the firm is already in this
// founder's pipeline and so is already theirs to see) or through the
// founder's explicit "Associate to…". An investor registering must never
// silently write into a founder's CRM.
import { grantStatus } from './access-grants';
import { computeCellEffect, findEffectiveGrantAmong, type MatrixGrant } from './people-access-matrix';
import type { TreeFolder } from './data-room';

export interface RelationshipGrant extends MatrixGrant {
  id: string;
  grantee_email?: string | null;
  invited_email?: string | null;
  invited_name?: string | null;
  confirmed_at?: string | null;
}

export interface RelationshipPerson {
  id: string;
  entity_id?: string;
  full_name: string;
  email_verified?: string | null;
  email_guess?: string | null;
}

export interface RelationshipAffiliation {
  person_id: string;
  entity_id?: string;
  current: boolean;
}

export interface RelationshipEntity {
  id: string;
  name: string;
}

export interface RelationshipDocument {
  id: string;
  folder_id?: string;
  visibility?: string;
}

/** `associated` = resolved to a real entity/person; `por_associar` = an
 *  external email nobody has been matched to yet (the amber state the panel
 *  has always used, kept by name); `registered` (Prompt 560) = the recipient
 *  has a Sherlock investor account but their firm is not in this founder's
 *  pipeline yet, so there is nothing to attach them TO. A third state, not a
 *  shade of the other two: "we know who this is, one click away from linked"
 *  is a different situation from "nobody has any idea who this is", and it
 *  has a different button. */
export type RelationshipStatus = 'associated' | 'por_associar' | 'registered';

/** What /api/data-room/recipient-identities knows about one shared email.
 *  `firmName` is deliberately optional and often absent — see that route for
 *  the exposure rule (a name is only ever revealed for an investor who
 *  confirmed to THIS org, or whose firm is already in its pipeline). */
export interface RegisteredIdentity {
  registered: true;
  firmName?: string | null;
  catalogEntityId?: string | null;
  /** The entity in THIS founder's pipeline that represents the firm, when
   *  one already exists. Its presence is what turns 3b into a real
   *  association rather than a label. */
  pipelineEntityId?: string | null;
}

export interface AccessRelationship {
  /** Stable selection key — also the React key. Survives adding/revoking
   *  grants, which is what stops the selected row from jumping or the panel
   *  from resetting after an access change. */
  key: string;
  kind: 'entity' | 'person' | 'guest';
  entityId?: string;
  /** What the row is called: entity name, else the person's / invitee's
   *  name, else the email itself. */
  name: string;
  /** The email under the name, only when it isn't already the name. */
  secondary?: string;
  status: RelationshipStatus;
  /** Every person in this relationship who actually holds a grant. */
  personIds: string[];
  personNames: string[];
  /** Emails granted directly (no person row) inside this relationship. */
  guestEmails: string[];
  /** Recipients, never grants: people with grants + unmatched emails. */
  peopleCount: number;
  /** Documents this relationship can currently reach — folder grants
   *  resolved down to the documents they actually cover, deduplicated,
   *  expired/revoked excluded. */
  fileCount: number;
  /** Non-revoked grants belonging to this relationship (expired included —
   *  the panel still has to show and be able to extend them). */
  grants: RelationshipGrant[];
  hasExpiredGrant: boolean;
  /** Pending guest invite: unconfirmed, unrevoked, invited by email. Drives
   *  "Copy guest link" / the guest-preview resend. */
  pendingInviteEmail?: string;
  /** Prompt 560 — set only on a `registered` row: the catalog entity behind
   *  the investor's firm, which "Add to pipeline" turns into a pipeline
   *  entity. Absent on every other row. */
  registeredCatalogEntityId?: string;
  registeredFirmName?: string;
  /** Lower-cased haystack for the type-ahead filter. */
  searchText: string;
}

function norm(email?: string | null): string | undefined {
  const t = email?.trim().toLowerCase();
  return t || undefined;
}

/** The email a grant was addressed to, whichever column carries it. */
export function grantEmail(g: RelationshipGrant): string | undefined {
  return norm(g.invited_email) ?? norm(g.grantee_email);
}

export interface BuildRelationshipsInput {
  entities: RelationshipEntity[];
  people: RelationshipPerson[];
  affiliations: RelationshipAffiliation[];
  grants: RelationshipGrant[];
  folders: TreeFolder[];
  documents: RelationshipDocument[];
  now: Date;
  /** Prompt 560 rule 3b. Keys are lower-cased emails. Absent entirely on a
   *  surface that has not fetched them (or before the route exists), which
   *  degrades to exactly the pre-560 behaviour — no row changes state
   *  because nothing is known about it. */
  registeredByEmail?: Record<string, RegisteredIdentity>;
}

/**
 * Counts the documents a set of grants currently reaches, using the very
 * same precedence the portal enforces (document > nearest folder ancestor).
 * A folder grant is worth every document under it, and a document covered
 * twice is still one document — "60 files granted" has to mean 60 files.
 *
 * Revoked and expired grants are excluded first, deliberately: this is the
 * "currently granted" count, and `resolveDocumentAccess`'s callers filter
 * exactly the same way before deciding what a recipient may open.
 */
export function countGrantedDocuments(
  grants: RelationshipGrant[], documents: RelationshipDocument[], folders: TreeFolder[], now: Date,
): number {
  const live = grants.filter((g) => {
    const s = grantStatus(g, now);
    return s !== 'revoked' && s !== 'expired';
  });
  if (live.length === 0) return 0;
  let count = 0;
  for (const doc of documents) {
    const effective = findEffectiveGrantAmong(live, doc.id, doc.folder_id, folders);
    const effect = computeCellEffect(effective, now, doc.visibility);
    if (effect === 'shared' || effect === 'shared_pending_nda' || effect === 'shared_pending_confirmation') count += 1;
  }
  return count;
}

/**
 * Groups every non-revoked grant into one row per relationship.
 *
 * Only relationships that actually have grants come out of here — an entity
 * in the pipeline with no access at all is not an access relationship, and
 * the panel merges those in separately (they are reachable through search,
 * exactly as before, and show "no access yet" rather than a fake count).
 */
export function buildAccessRelationships(input: BuildRelationshipsInput): AccessRelationship[] {
  const { entities, people, affiliations, grants, folders, documents, now, registeredByEmail } = input;

  const entityName = new Map(entities.map((e) => [e.id, e.name]));
  const personById = new Map(people.map((p) => [p.id, p]));

  // A person's entity: their current affiliation first (the richer model),
  // falling back to the base entity_id — the same pair PeopleAccessPanel
  // and WhoHasAccessPanel already resolve people by, not a third rule.
  const entityOfPerson = new Map<string, string | undefined>();
  for (const p of people) entityOfPerson.set(p.id, p.entity_id || undefined);
  for (const a of affiliations) {
    if (a.current && a.entity_id) entityOfPerson.set(a.person_id, a.entity_id);
  }

  // Email → person. This is the whole of "identity resolution, not
  // duplication": a guest email that any known person already carries stops
  // being a guest the moment that people row exists.
  const personByEmail = new Map<string, RelationshipPerson>();
  for (const p of people) {
    for (const e of [norm(p.email_verified), norm(p.email_guess)]) {
      if (e && !personByEmail.has(e)) personByEmail.set(e, p);
    }
  }

  interface Bucket {
    key: string; kind: AccessRelationship['kind']; entityId?: string;
    personIds: Set<string>; guestEmails: Set<string>; emails: Set<string>;
    invitedNames: Set<string>; grants: RelationshipGrant[];
    pendingInviteEmail?: string;
    /** Prompt 560 — the registered identity behind this bucket, when the
     *  bucket exists only because of an email that turned out to belong to a
     *  Sherlock investor. Never set on a bucket resolved by rule 1/2/3. */
    registered?: RegisteredIdentity;
  }
  const buckets = new Map<string, Bucket>();

  function bucketFor(key: string, kind: AccessRelationship['kind'], entityId?: string): Bucket {
    let b = buckets.get(key);
    if (!b) {
      b = { key, kind, entityId, personIds: new Set(), guestEmails: new Set(), emails: new Set(), invitedNames: new Set(), grants: [] };
      buckets.set(key, b);
    }
    return b;
  }

  for (const g of grants) {
    if (g.revoked_at) continue;
    const email = grantEmail(g);

    // The grant's person: its own person_id, or the person that owns the
    // email it was addressed to.
    const person = (g.person_id ? personById.get(g.person_id) : undefined) ?? (email ? personByEmail.get(email) : undefined);

    let bucket: Bucket;
    if (person) {
      const entId = entityOfPerson.get(person.id);
      bucket = entId && entityName.has(entId)
        ? bucketFor(`entity:${entId}`, 'entity', entId)
        : bucketFor(`person:${person.id}`, 'person');
      bucket.personIds.add(person.id);
    } else if (g.person_id) {
      // person_id set but the row isn't loaded (filtered/partial store) —
      // still one relationship, never one per grant.
      bucket = bucketFor(`person:${g.person_id}`, 'person');
      bucket.personIds.add(g.person_id);
    } else if (email) {
      // Rule 3b (Prompt 560) — reached only when no `people` row claimed the
      // email, so the founder's own CRM still wins whenever it has an answer.
      const identity = registeredByEmail?.[email];
      const pipelineEntityId = identity?.pipelineEntityId;
      if (pipelineEntityId && entityName.has(pipelineEntityId)) {
        // Their firm is already in this founder's pipeline: this is a real
        // association, and the grants join that entity's row rather than
        // standing beside it — the same "resolution, never a second row"
        // principle rule 3 states, applied to the source rule 3 didn't know.
        bucket = bucketFor(`entity:${pipelineEntityId}`, 'entity', pipelineEntityId);
        bucket.guestEmails.add(email);
      } else {
        bucket = bucketFor(`guest:${email}`, 'guest');
        bucket.guestEmails.add(email);
        // Registered, but there is nothing in this pipeline to attach them
        // to yet. The row says so and offers "Add to pipeline"; it is not
        // "Por associar", because we do know who this is.
        if (identity) bucket.registered = identity;
      }
    } else {
      // No person, no email: nothing identifies a recipient. Keyed by the
      // grant so it stays visible and fixable rather than silently dropped.
      bucket = bucketFor(`grant:${g.id}`, 'guest');
    }

    if (email) bucket.emails.add(email);
    if (g.invited_name?.trim()) bucket.invitedNames.add(g.invited_name.trim());
    bucket.grants.push(g);
    if (!bucket.pendingInviteEmail && g.invited_email && !g.confirmed_at && !g.revoked_at) {
      bucket.pendingInviteEmail = norm(g.invited_email);
    }
  }

  const out: AccessRelationship[] = [];
  for (const b of buckets.values()) {
    const personNames = [...b.personIds].map((id) => personById.get(id)?.full_name).filter((n): n is string => !!n);
    const guestEmails = [...b.guestEmails];
    const emails = [...b.emails];

    const name = b.entityId
      ? (entityName.get(b.entityId) as string)
      : personNames[0] ?? [...b.invitedNames][0] ?? guestEmails[0] ?? emails[0] ?? 'Unknown recipient';
    // Prompt 560 — a registered investor's firm name, when the route was
    // allowed to reveal it, replaces the bare email as the row's subtitle.
    // Without a name the row still says "Registered investor", which is the
    // honest amount to say: we know they have an account, we are not
    // entitled to tell this founder where they work.
    const registeredSuffix = b.registered
      ? (b.registered.firmName ? `Registered investor · ${b.registered.firmName}` : 'Registered investor')
      : undefined;
    const secondary = registeredSuffix ?? emails.find((e) => e !== name.toLowerCase());

    // Recipients, never grants (acceptance §6): the people who hold grants,
    // plus each unmatched email, which is exactly one person each.
    const peopleCount = b.personIds.size + guestEmails.length;

    out.push({
      key: b.key,
      kind: b.kind,
      entityId: b.entityId,
      name,
      secondary,
      status: b.kind !== 'guest' ? 'associated' : b.registered ? 'registered' : 'por_associar',
      // Prompt 560 — what "Add to pipeline" needs, and the only reason the
      // catalog id crosses into the client at all.
      registeredCatalogEntityId: b.registered?.catalogEntityId ?? undefined,
      registeredFirmName: b.registered?.firmName ?? undefined,
      personIds: [...b.personIds],
      personNames,
      guestEmails,
      peopleCount: peopleCount || 1,
      fileCount: countGrantedDocuments(b.grants, documents, folders, now),
      grants: b.grants,
      hasExpiredGrant: b.grants.some((g) => grantStatus(g, now) === 'expired'),
      pendingInviteEmail: b.pendingInviteEmail,
      // Every identifying string the row carries, including the emails of
      // its people that no grant happened to spell out — typing an
      // investor's address has to find them whether the founder shared with
      // the person record or with the address.
      searchText: [
        name, ...personNames, ...emails, ...b.invitedNames,
        ...[...b.personIds].flatMap((id) => {
          const p = personById.get(id);
          return [p?.email_verified, p?.email_guess].filter((e): e is string => !!e);
        }),
      ].join(' ').toLowerCase(),
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Case-insensitive, matches while typing, across every identifying field
 *  the row already carries (entity name, person names, emails). */
export function matchesRelationshipQuery(rel: Pick<AccessRelationship, 'searchText'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return rel.searchText.includes(q);
}
