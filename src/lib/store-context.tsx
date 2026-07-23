'use client';
// Shared StoreApi contract + React context. Both the demo (localStorage) and
// Supabase-backed providers implement this exact interface and publish to this
// same context, so useStore() and every consuming page are agnostic to which
// backend is mounted.
import { createContext, useContext } from 'react';
import type {
  AccessGrant, ActionType, Automation, Channel, Classification, CompanyFact, Db,
  Direction, DocumentItem, Entity, FolderKind, Interaction, InvestorSubmission, Nda, Org, OverrideRule,
  PassReasonCategory, Person, PersonAffiliation, RelationshipStage, TaskItem,
} from './types';

export type LogInput = {
  entity_id: string;
  person_id?: string;
  direction: 'out' | 'in';
  channel: Channel;
  content: string;
  sent_from?: string;
  document_id?: string;
  classification?: Classification;
  pass_reason_category?: PassReasonCategory;
  pass_reason?: string;
  next_action?: string;
  next_action_due?: string;
  // The founder's chosen "tipo de compromisso" for the next_action task,
  // pre-filled by relationship.ts's recommendedActionType() on /log.
  next_action_type?: ActionType;
  overrides?: { rule: OverrideRule; justification: string }[];
  ai_generated?: boolean;
};

export interface StoreApi {
  db: Db;
  logInteraction: (input: LogInput) => Interaction;
  // classifiedBy: stamps who currently owns this classification (migration
  // 0021). Always written verbatim, including when omitted — exactly like
  // cat/reason above — so any manual reclassification (the normal call
  // shape, no 5th arg) automatically clears a prior 'ai'/'mechanical' tag
  // back to undefined. The entity/person side effects below are unchanged
  // by who or what is calling this.
  classifyInteraction: (id: string, c: Classification, cat?: PassReasonCategory, reason?: string, classifiedBy?: 'ai' | 'mechanical') => void;
  // Overnight block Task B2 — needs_review triage. Deliberately separate
  // from classifyInteraction (not a new parameter on it) so reviewing the
  // flag never changes that function's existing entity-status side
  // effects — this only ever touches the one boolean.
  clearNeedsReview: (interactionId: string) => void;
  // Needs-review redesign — capability-gated on capabilities.needsReviewAi
  // (migration 0021). Lets a human edit imported text directly (typos,
  // garbled OCR) without touching classification/needs_review at all.
  updateInteractionContent: (id: string, content: string) => void;
  // Needs-review triage toolkit — generic field-level patch (occurred_at,
  // channel, direction, classification, content, needs_review, classified_by,
  // person_id). Deliberately WITHOUT classifyInteraction's entity-status
  // side effects: these are historical imported memories, and one old
  // "interested" reply shouldn't flip the entity's live pipeline status.
  // The single write path all dossier triage actions (and their undos) use.
  updateInteraction: (id: string, patch: Partial<Interaction>) => void;
  // Plain historical-interaction insert — a memory the import never
  // captured (e.g. a remembered remote meeting). NOT logInteraction: no
  // contact lock, no follow-up task, no status transition — it's backfill,
  // not a fresh send. Returns the created row.
  addInteraction: (input: {
    entity_id: string; person_id?: string; occurred_at: string;
    direction: Direction; channel: Channel; content: string; classification?: Classification;
  }) => Interaction;
  // Undo primitives for the triage toolkit (un-add a backfilled interaction,
  // un-create a person routed from an item). Never used for real pipeline
  // deletion — only to reverse a just-performed triage action.
  removeInteraction: (id: string) => void;
  removePerson: (id: string) => void;
  // Sends an auto-applied (ai/mechanical) row back to the human queue —
  // one click, per the founder's explicit "revertible" requirement.
  // Classification is left as-is (still visible/prefillable); only the
  // ownership tag and the flag change.
  revertToNeedsReview: (interactionId: string) => void;
  // The metadata-card routine (§ needs-review redesign): fills ONLY empty
  // entity fields (never overwrites a founder-verified value), appends the
  // full original text as a dated note, and clears needs_review on the
  // source interaction — all in one atomic action, since these three things
  // only ever happen together.
  applyMetadataCard: (
    entityId: string, interactionId: string,
    parsed: { emailDomain?: string; website?: string },
    noteText: string, classifiedBy: 'ai' | 'mechanical',
  ) => void;
  toggleTask: (id: string) => void;
  addTask: (t: Omit<TaskItem, 'id' | 'done'>) => void;
  // Batch 3 B — edit Organisation data (name, sender, caps, onboarding
  // fields). Owner+admin only; enforced server-side in /api/org/update (the
  // Supabase provider posts there), the UI just gates the form.
  updateOrg: (patch: Partial<Org>) => void;
  setEntityStatus: (id: string, status: Db['entities'][0]['status'], reason?: string) => void;
  setInterest: (id: string, eur: number | undefined) => void;
  resolveHardFilter: (id: string, status: 'resolved_ok' | 'resolved_blocked') => void;
  // Generic field-level patch, used by the entity contact-info edit card
  // (batch 2 item 1) and by the conflict compare popover's "usar importado"
  // (batch 2 item 4) — one write path for both, not two ad-hoc ones.
  updateEntity: (id: string, patch: Partial<Entity>) => void;
  updatePerson: (id: string, patch: Partial<Person>) => void;
  setDoNotContact: (personId: string) => void;
  // Quick-create from /log's "Outra pessoa…" (batch 2 item 3) — attached to
  // the entity immediately so the interaction can be saved without
  // friction. Always created with identity_verified: false; seniority_rank
  // defaults to least-senior-so-far at this entity. Returns the new row so
  // the caller can select it immediately.
  addPerson: (p: {
    entity_id: string; full_name: string; role?: string; gender?: string;
    linkedin_url?: string; email_guess?: string; phone?: string;
  }) => Person;
  addDocument: (d: Omit<DocumentItem, 'id'>) => void;
  // Data Room V2 (F1): removes the Storage object (when storage_path is
  // set) and the documents row. Irreversible — the UI must confirm before
  // calling this. Any access_grants scoped to this document are cleaned up
  // by the DB's own cascade (documents(id) on delete cascade), not here.
  deleteDocument: (id: string) => void;
  renameDocument: (id: string, name: string) => void;
  // Capability-gated on capabilities.documentDetails (migration 0022).
  updateDocumentDetails: (id: string, details: string) => void;
  // Data Room v3 (E5). moveDocumentToFolder: drag a document onto a folder.
  // reorderDocuments: persist a new order within a folder (migration 0027).
  // replaceDocumentFile: swap the underlying file, keeping the same row/
  // details/grants; removes the old storage object and records the swap.
  moveDocumentToFolder: (docId: string, folderId: string | undefined) => void;
  reorderDocuments: (folderId: string | undefined, orderedIds: string[]) => void;
  replaceDocumentFile: (docId: string, newStoragePath: string) => void;
  // Data Room V2 (F3) — org-scoped folder management. createFolder appends
  // at the end of its new siblings; deleteFolder throws (caught by the UI)
  // if the folder still has children and moveContentsToParent is false —
  // the founder chooses explicitly rather than a silent cascade delete.
  createFolder: (name: string, parentId: string | undefined, kind: FolderKind) => void;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string, moveContentsToParent: boolean) => void;
  addGrant: (g: Omit<AccessGrant, 'id' | 'granted_at'>) => void;
  revokeGrant: (id: string) => void;
  // Data Room V2 (F5) — capability-gated on capabilities.ndaSystem
  // (migration 0023). The actual upload + AI cross-check happen server-side
  // in /api/data-room/nda-upload (needs ANTHROPIC_API_KEY, never exposed to
  // the client); this action just syncs the already-persisted result
  // (the new nda row + which of this grantee's active nda_required grants
  // just got unlocked) into local state so the UI updates instantly without
  // a full refetch.
  recordNdaUpload: (nda: Nda, unlockedGrantIds: string[]) => void;
  // Records a document view — used by the real portal flow (both live
  // Supabase mode via /api/portal/view, and demo mode's local mirror here).
  recordDocumentView: (documentId: string, viewerEmail: string) => void;
  toggleAutomation: (id: string) => void;
  setAutomationMode: (id: string, mode: Automation['mode']) => void;
  runAutomationTick: () => number;
  approveRun: (id: string) => void;
  rejectRun: (id: string) => void;
  updateRunDraft: (id: string, draft: string) => void;
  resetDemo: () => void;
  // v3: packs / catalog / back-office
  unlockPack: (packId: string) => number;
  submitInvestor: (payload: InvestorSubmission['payload']) => void;
  reviewSubmission: (id: string, decision: 'approved' | 'rejected', notes?: string) => void;
  // IRM_SPEC §4e: relationship roadmap overlay
  setRelationshipStage: (entityId: string, stage: RelationshipStage) => void;
  setNextStepTask: (entityId: string, taskId: string | undefined) => void;
  // IRM_SPEC §1c: multi-affiliation people
  addAffiliation: (a: Omit<PersonAffiliation, 'id' | 'current'>) => void;
  endAffiliation: (id: string) => void;
  // §1c data-quality fix: some imported "entities" are really individual
  // people (solo angels) mistyped as an organization — see DECISIONS.md
  // "Entities that are people". Creates a real Person + an independent
  // (entity_id-less) angel PersonAffiliation, migrates any interactions
  // already logged against this entity to that person, and relabels the
  // entity's type — the entity row itself is kept as the person's
  // technical "home" (Person.entity_id/Interaction.entity_id stay non-null).
  convertEntityToPerson: (entityId: string) => void;
  // Dismisses the "looks like a person" sweep suggestion without converting
  // — stamps last_verified so it stops being flagged.
  markEntityVerified: (entityId: string) => void;

  // IRM_SPEC §11 — Company Canon. Capability-gated: the Company nav link and
  // page only render when /api/me reports capabilities.companyCanon, so
  // these are only ever called from a UI that has already confirmed the
  // migration is applied.
  addCompanyFact: (f: Omit<CompanyFact, 'id' | 'created_at' | 'updated_at'>) => void;
  confirmCompanyFact: (id: string) => void;
  editAndConfirmCompanyFact: (id: string, statement: string) => void;
  rejectCompanyFact: (id: string) => void;
  // Facts are never deleted, only superseded (§11a) — creates a new
  // confirmed fact and points the old one's superseded_by at it.
  supersedeCompanyFact: (oldId: string, newStatement: string) => void;
}

export const StoreCtx = createContext<StoreApi | null>(null);

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
