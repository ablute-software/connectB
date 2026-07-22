'use client';
// Shared StoreApi contract + React context. Both the demo (localStorage) and
// Supabase-backed providers implement this exact interface and publish to this
// same context, so useStore() and every consuming page are agnostic to which
// backend is mounted.
import { createContext, useContext } from 'react';
import type {
  AccessGrant, Automation, Channel, Classification, Db,
  DocumentItem, Entity, Interaction, InvestorSubmission, OverrideRule,
  PassReasonCategory, RelationshipStage, TaskItem,
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
  overrides?: { rule: OverrideRule; justification: string }[];
  ai_generated?: boolean;
};

export interface StoreApi {
  db: Db;
  logInteraction: (input: LogInput) => Interaction;
  classifyInteraction: (id: string, c: Classification, cat?: PassReasonCategory, reason?: string) => void;
  toggleTask: (id: string) => void;
  addTask: (t: Omit<TaskItem, 'id' | 'done'>) => void;
  setEntityStatus: (id: string, status: Db['entities'][0]['status'], reason?: string) => void;
  setInterest: (id: string, eur: number | undefined) => void;
  resolveHardFilter: (id: string, status: 'resolved_ok' | 'resolved_blocked') => void;
  setDoNotContact: (personId: string) => void;
  addDocument: (d: Omit<DocumentItem, 'id'>) => void;
  addGrant: (g: Omit<AccessGrant, 'id' | 'granted_at'>) => void;
  revokeGrant: (id: string) => void;
  recordDemoView: (documentId: string, viewerEmail: string) => void;
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
}

export const StoreCtx = createContext<StoreApi | null>(null);

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}
