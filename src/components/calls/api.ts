// Prompt 905 — the browser side of /api/calls: small typed wrappers, so the editor never builds a URL or reads
// a response by hand. Every call returns {ok, status, body}; nothing throws on a refusal.
import type { EligibilityView } from '@/lib/calls/eligibility-view';
import type { GridView } from '@/lib/calls/eval-grid-view';
import type { DistributionMode, DistributionView } from '@/lib/calls/eval-assign-store';
import type { EvaluationPayload, MineCall } from '@/lib/calls/eval-store';
import type { Board } from '@/lib/calls/eval-board-store';
import type { Draft } from '@/lib/calls/eval-draft';
import type { GridProposal } from '@/lib/calls/eval-grid-reader';
import type { Criterion } from '@/lib/calls/eval-grid';
import type { CallStatus, PromoterKind } from '@/lib/calls/types';
import type { Call, CallPhase, FormField } from '@/lib/calls/types';
import type { CallSummary, ReadinessIssue, availableActions } from '@/lib/calls/lifecycle';
import type { ImportMode, ImportSource } from '@/lib/calls/form-import';
import type { TeamPayload } from '@/lib/calls/team-payload';
import type { Proposal, ProposalFieldItem, ProposalGeneral, ProposalPhaseItem } from '@/lib/calls/ai-import/proposal';
import type { SourceKind } from '@/lib/calls/ai-import/limits';
import { NETWORK_MESSAGE, importFailure } from '@/lib/calls/ai-import/client-errors';
import type { CloseReason } from '@/lib/calls/closing';

export interface PromoterInfo { kind: PromoterKind; id: string; name: string; canManage: boolean }

export interface CallListItem extends Call {
  effectiveStatus: CallStatus; applications: number; applicationsTotal: number; fields: number; phases: number; canConfigure: boolean;
  /** Prompt 917 (Adenda 1): a reading in progress, or a proposal waiting for review, and which run it is. */
  importRun?: { id: string; status: 'reading' | 'proposed' } | null;
}

/** Prompt 918 (Adenda 2, C): a deleted call in the "Deleted calls" list — restorable until `purgeAfter`. */
export interface DeletedCallItem { id: string; name: string; deletedAt: string | null; purgeAfter: string | null; daysLeft: number; canRestore: boolean; createdAt: string; timezone: string }

export interface CallEvent { id: number; event: string; actor_user_id: string | null; detail: Record<string, unknown>; created_at: string }

export interface CallState {
  ok: true;
  call: Call;
  effectiveStatus: CallStatus;
  promoterName: string;
  canManage: boolean;
  canManageTeam: boolean;
  phases: CallPhase[];
  fields: FormField[];
  issues: ReadinessIssue[];
  teamMembers?: number;
  eligibilityRules?: number;
  evalCriteria?: number;
  /** Prompt 918 (Adenda 1, C): the cover and logo the page will show, where the logo comes from, and the entity's own profile logo (if any). */
  branding?: { coverUrl: string | null; logoUrl: string | null; logoSource: 'call' | 'profile' | null; profileLogoUrl: string | null };
  summary: CallSummary;
  actions: ReturnType<typeof availableActions>;
  /** Prompt 918 (Adenda 3): why the call is closed — by its deadline, early on purpose, or deleted and restored; null while it is not closed. */
  closedReason?: CloseReason | null;
  applications: { submitted: number; total: number };
  events: CallEvent[];
}

export interface ApiResult<T> { ok: boolean; status: number; body: T & { error?: string; code?: string } }

async function call<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const body = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string; code?: string };
    return { ok: res.ok && body.ok !== false, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: { error: 'We could not reach the server. Check your connection and try again.', code: 'network' } as T & { error: string; code: string } };
  }
}

const send = (method: string, data?: unknown): RequestInit => ({ method, body: data === undefined ? undefined : JSON.stringify(data) });

/** What "Redistribute" would change, shown before anything is applied (the server writes nothing for it). */
export interface DistributionPreview {
  manual: boolean; warning: string | null; loads: Record<string, number>; newConflicts: number;
  remove: { applicationId: string; reference: string; userId: string; evaluator: string; why: string }[];
  add: { applicationId: string; reference: string; userId: string; evaluator: string }[];
  keptWithConflict: { applicationId: string; reference: string; userId: string; evaluator: string }[];
  shortfalls: { applicationId: string; reference: string; wanted: number; got: number }[];
}

export const callsApi = {
  access: () => call<{ promoters: PromoterInfo[] }>('/api/calls/access'),
  list: (kind: PromoterKind) => call<{ promoter: PromoterInfo; calls: CallListItem[]; deleted?: DeletedCallItem[] }>(`/api/calls?kind=${kind}`),
  create: (kind: PromoterKind, name?: string) => call<{ call: Call }>('/api/calls', send('POST', { kind, name })),
  get: (id: string) => call<CallState>(`/api/calls/${id}`),
  patchGeneral: (id: string, baseVersion: number, patch: Record<string, unknown>) => call<CallState>(`/api/calls/${id}`, send('PATCH', { baseVersion, ...patch })),
  putPhases: (id: string, baseVersion: number, phases: Pick<CallPhase, 'id' | 'name' | 'startsOn' | 'endsOn'>[]) =>
    call<CallState>(`/api/calls/${id}/phases`, send('PUT', { baseVersion, phases })),
  putForm: (id: string, baseVersion: number, fields: FormField[]) => call<CallState>(`/api/calls/${id}/form`, send('PUT', { baseVersion, fields })),
  duplicate: (id: string) => call<{ call: Call }>(`/api/calls/${id}/duplicate`, send('POST')),
  act: (id: string, action: 'confirm' | 'edit' | 'publish' | 'extend' | 'reopen' | 'close' | 'archive', extra: { closesAt?: string; confirmEarly?: boolean } = {}) =>
    call<CallState>(`/api/calls/${id}/action`, send('POST', { action, ...extra })),
  /** Prompt 909 (I2): the calls the form can be imported from, and the fields of one of them to look at. */
  importSources: (id: string, previewId?: string) =>
    call<{ sources: ImportSource[]; preview?: { id: string; name: string; currency: string; fields: FormField[] } }>(
      `/api/calls/${id}/import-form${previewId ? `?preview=${encodeURIComponent(previewId)}` : ''}`),
  importForm: (id: string, body: { sourceCallId: string; mode: ImportMode; baseVersion: number; confirmReplace?: boolean }) =>
    call<CallState & { import: { imported: number; mode: ImportMode; from: string; warnings: string[] } }>(`/api/calls/${id}/import-form`, send('POST', body)),
  /** Prompt 917 (Adenda 2, B4): turn a repeatable group shown as a table into a Table (transposed), drafts migrated; `confirm` once the entity has been told about submitted applications. */
  convertToTable: (id: string, fieldId: string, confirm = false) =>
    call<CallState & { converted: { label: string; summary: string; drafts: number; migrated: number; told: number; submitted: number } }>(`/api/calls/${id}/form/convert-to-table`, send('POST', { fieldId, confirm })),
  /** Prompt 918 (I2): the eligibility rules of a call (with their sentences, recipes and the import's suggestions), replacing them, discarding a suggestion, and turning an open requirement into a closed question. */
  eligibility: (id: string) => call<EligibilityView & { canManage: boolean }>(`/api/calls/${id}/eligibility`),
  saveEligibility: (id: string, baseRev: number, rules: unknown[], confirm = false) => call<EligibilityView & { unchanged?: boolean; submitted?: number; nextVersion?: number }>(`/api/calls/${id}/eligibility`, send('PUT', { baseRev, rules, confirm })),
  dismissSuggestion: (id: string, text: string) => call<Record<string, never>>(`/api/calls/${id}/eligibility/suggestion`, send('POST', { text })),
  closeOpenRule: (id: string, ruleId: string) => call<CallState & { added: { id: string; label: string } }>(`/api/calls/${id}/eligibility/close-question`, send('POST', { ruleId })),
  /** Prompt 922 (I1): the evaluation grid (criteria, weights, settings), read from a document by the platform's own reader, and the templates of the organisation. */
  evalGrid: (id: string) => call<GridView & { canManage: boolean }>(`/api/calls/${id}/eval-grid`),
  saveEvalGrid: (id: string, baseRev: number, criteria: unknown[], settings: unknown, confirm = false, importRunId: string | null = null) =>
    call<GridView & { unchanged?: boolean; nextVersion?: number }>(`/api/calls/${id}/eval-grid`, send('PUT', { baseRev, criteria, settings, confirm, ...(importRunId ? { importRunId } : {}) })),
  importEvalGrid: async (id: string, file: File) => {
    try {
      const form = new FormData(); form.append('file', file);
      const res = await fetch(`/api/calls/${id}/eval-grid/import`, { method: 'POST', body: form });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; runId: string; fileName: string; notice: string; proposal: GridProposal; criteria: unknown[] };
      return { ok: res.ok && body.ok !== false, status: res.status, body };
    } catch { return { ok: false, status: 0, body: { error: 'We could not reach the server. Check your connection and try again.', runId: '', fileName: '', notice: '', proposal: { criteria: [], scaleGuess: null, notes: [] } as GridProposal, criteria: [] as unknown[] } }; }
  },
  evalTemplates: (id: string) => call<{ templates: { id: string; name: string; criteria: number; createdAt: string }[] }>(`/api/calls/${id}/eval-grid/templates`),
  saveEvalTemplate: (id: string, name: string) => call<{ id: string; templates: { id: string; name: string; criteria: number; createdAt: string }[] }>(`/api/calls/${id}/eval-grid/templates`, send('POST', { name })),
  copyEvalTemplate: (id: string, templateId: string) => call<{ name: string; criteria: Criterion[] }>(`/api/calls/${id}/eval-grid/templates/${templateId}`, send('POST')),
  /** Prompt 922 (I3): the evaluator's side — one evaluation (read, autosave, submit, reopen, declare a conflict) and the list "My evaluations". */
  evaluation: (id: string, applicationId: string) => call<EvaluationPayload>(`/api/calls/${id}/evaluations/${applicationId}`),
  saveEvaluation: (id: string, applicationId: string, draft: Draft & { revision: number }) => call<{ revision: number; gradePercent: number | null }>(`/api/calls/${id}/evaluations/${applicationId}`, send('PUT', draft)),
  submitEvaluation: (id: string, applicationId: string, revision: number) => call<{ gradePercent: number | null; submittedAt: string }>(`/api/calls/${id}/evaluations/${applicationId}/submit`, send('POST', { revision })),
  reopenEvaluation: (id: string, applicationId: string, evaluatorUserId: string, reason: string) => call<object>(`/api/calls/${id}/evaluations/${applicationId}/reopen`, send('POST', { evaluatorUserId, reason })),
  declareConflict: (id: string, applicationId: string, note: string) => call<object>(`/api/calls/${id}/evaluations/${applicationId}/conflict`, send('POST', { note })),
  /** Prompt 922 (I4): the board of the evaluation (ranking, flags, decisions) and what an administrator does on it. */
  evaluationBoard: (id: string) => call<Board & { canDecide: boolean }>(`/api/calls/${id}/evaluation-board`),
  evaluationBoardAct: (id: string, body: { action: 'decide'; applicationId: string; decision: string | null; note?: string } | { action: 'close' } | { action: 'reopen' }) => call<Board & { canDecide: boolean }>(`/api/calls/${id}/evaluation-board`, send('POST', body)),
  myEvaluations: () => call<{ calls: MineCall[]; remaining: number }>('/api/calls/my-evaluations'),
  /** Prompt 922 (I2): the distribution of the applications among the evaluators (the administrator's screen) and every move on it. */
  distribution: (id: string) => call<DistributionView>(`/api/calls/${id}/distribution`),
  distributionMode: (id: string, mode: DistributionMode) => call<DistributionView>(`/api/calls/${id}/distribution`, send('POST', { action: 'mode', mode })),
  distributionPreview: (id: string) => call<DistributionPreview>(`/api/calls/${id}/distribution`, send('POST', { action: 'preview' })),
  distributionRedistribute: (id: string) => call<DistributionView & { added: number; removed: number }>(`/api/calls/${id}/distribution`, send('POST', { action: 'redistribute' })),
  distributionMove: (id: string, action: 'assign' | 'unassign', applicationId: string, userId: string) => call<DistributionView>(`/api/calls/${id}/distribution`, send('POST', { action, applicationId, userId })),
  /** Prompt 909 (I3): the team of a call, and one change at a time (the server answers with the whole picture). */
  team: (id: string) => call<TeamPayload>(`/api/calls/${id}/team`),
  teamAction: (id: string, body: Record<string, unknown>) => call<TeamPayload>(`/api/calls/${id}/team`, send('POST', body)),
  /** Prompt 909 (I4): the import from documents. The upload is multipart, so it does not go through call(). */
  /**
   * Prompt 909 (I4, Adenda 2): starts the reading of the documents. The route answers at once with a run in state "reading"; the proposal comes
   * later, from importRun(). An answer that is not JSON (a gateway timeout, an error page) gets its own sentence and keeps the HTTP code.
   */
  /** Prompt 918 (Adenda 1, C): the cover image or the logo of a call (multipart: the browser sets the content type), and removing it. */
  uploadMedia: async (id: string, kind: 'cover' | 'logo', file: File, saveToProfile = false): Promise<ApiResult<CallState & { profile?: string | null }>> => {
    const form = new FormData(); form.append('kind', kind); form.append('file', file); if (saveToProfile) form.append('saveToProfile', 'true');
    try {
      const res = await fetch(`/api/calls/${id}/media`, { method: 'POST', body: form });
      const body = (await res.json().catch(() => ({}))) as CallState & { error?: string; code?: string; profile?: string | null };
      return { ok: res.ok && (body as { ok?: boolean }).ok !== false, status: res.status, body };
    } catch { return { ok: false, status: 0, body: { error: 'We could not reach the server. Check your connection and try again.' } as never }; }
  },
  removeMedia: (id: string, kind: 'cover' | 'logo') => call<CallState>(`/api/calls/${id}/media?kind=${kind}`, { method: 'DELETE' }),
  importFromDocuments: async (id: string, form: FormData): Promise<ApiResult<{ run: { id: string; status: string }; runId?: string }> & { httpStatus: number | null }> => {
    try {
      const res = await fetch(`/api/calls/${id}/import-ai`, { method: 'POST', body: form });
      let parsed = true;
      const body = (await res.json().catch(() => { parsed = false; return {}; })) as { ok?: boolean; error?: string; code?: string; runId?: string; run: { id: string; status: string } };
      const ok = res.ok && parsed && body.ok !== false;
      if (!ok) { const f = importFailure(res.status, body, parsed); body.error = f.message; return { ok: false, status: res.status, body, httpStatus: f.httpStatus }; }
      return { ok, status: res.status, body, httpStatus: null };
    } catch {
      return { ok: false, status: 0, body: { error: NETWORK_MESSAGE, code: 'network' } as never, httpStatus: null };
    }
  },
  /** Where the reading is: reading (nothing else), proposed (with the proposal) or failed (with the sentence). */
  importRun: (id: string, runId: string) =>
    call<{ run: { id: string; status: 'reading' | 'proposed' | 'applied' | 'discarded' | 'failed'; startedAt: string; proposal?: Proposal; error?: string | null; code?: string | null } }>(`/api/calls/${id}/import-ai/${runId}`),
  /** The person's own unseen "proposal ready" / "could not read" notices (Adenda 2b). */
  importNotices: () => call<{ notices: { id: string; kind: 'import_ready' | 'import_failed'; title: string; body: string | null; callId: string; createdAt: string; runId: string | null }[] }>('/api/calls/import-notices'),
  markImportNoticesSeen: (target: { ids: string[] } | { callId: string }) => call<Record<string, never>>('/api/calls/import-notices', send('POST', target)),
  /** What the screen needs when it opens: a reading in progress, a proposal waiting, the last failure. */
  importState: (id: string) =>
    call<{ pending: { id: string; proposal: Proposal } | null; reading: { id: string; createdAt: string } | null; lastFailure: { id: string; message: string | null; code: string | null; at: string } | null }>(`/api/calls/${id}/import-ai`),
  sourceDocuments: (id: string) =>
    call<{ documents: { id: string; kind: SourceKind; mimeType?: string; fileName: string; sizeBytes: number; pages: number | null; createdAt: string; publicToApplicants?: boolean }[]; foundLater: { eligibility: string[]; evaluation: string[] } }>(`/api/calls/${id}/import-ai`),
  applyImport: (id: string, runId: string, body: { baseVersion: number; fieldsMode: 'add' | 'replace'; accepted: { general?: ProposalGeneral; phases?: ProposalPhaseItem[]; fields?: ProposalFieldItem[] } }) =>
    call<CallState & { applied: { general: boolean; phases: number; fields: number } }>(`/api/calls/${id}/import-ai/${runId}`, send('POST', { action: 'apply', ...body })),
  discardImport: (id: string, runId: string) => call<{ discarded: boolean }>(`/api/calls/${id}/import-ai/${runId}`, send('POST', { action: 'discard' })),
  setSourceDocumentPublic: (id: string, docId: string, publicToApplicants: boolean) =>
    call<Record<string, never>>(`/api/calls/${id}/source-documents/${docId}`, send('PATCH', { publicToApplicants })),
  deleteSourceDocument: (id: string, docId: string) => call<Record<string, never>>(`/api/calls/${id}/source-documents/${docId}`, { method: 'DELETE' }),
  /** Delete a call nobody applied to (the server decides). */
  /** Delete (Prompt 918, Adenda 2, C): the person has typed the call's name; the call goes to "Deleted calls" for 30 days. */
  remove: (id: string, confirmName: string) => call<{ deleted: boolean; name: string; purgeAfter: string; notified: number }>(`/api/calls/${id}/action`, send('POST', { action: 'delete', confirmName })),
  deleteImpact: (id: string) => call<{ name: string; isOpen: boolean; submitted: number; drafts: number; files: number }>(`/api/calls/${id}/delete-impact`),
  restore: (id: string) => call<{ restored: boolean; name: string; status: string }>(`/api/calls/${id}/restore`, send('POST', {})),
};
