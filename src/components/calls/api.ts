// Prompt 905 — the browser side of /api/calls: small typed wrappers, so the editor never builds a URL or reads
// a response by hand. Every call returns {ok, status, body}; nothing throws on a refusal.
import type { CallStatus, PromoterKind } from '@/lib/calls/types';
import type { Call, CallPhase, FormField } from '@/lib/calls/types';
import type { CallSummary, ReadinessIssue, availableActions } from '@/lib/calls/lifecycle';
import type { ImportMode, ImportSource } from '@/lib/calls/form-import';
import type { TeamPayload } from '@/lib/calls/team-payload';
import type { Proposal, ProposalFieldItem, ProposalGeneral, ProposalPhaseItem } from '@/lib/calls/ai-import/proposal';
import type { SourceKind } from '@/lib/calls/ai-import/limits';

export interface PromoterInfo { kind: PromoterKind; id: string; name: string; canManage: boolean }

export interface CallListItem extends Call { effectiveStatus: CallStatus; applications: number; applicationsTotal: number; fields: number; phases: number; canConfigure: boolean }

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
  summary: CallSummary;
  actions: ReturnType<typeof availableActions>;
  applications: { submitted: number; inProgress: number; withdrawn: number; total: number };
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

export const callsApi = {
  access: () => call<{ promoters: PromoterInfo[] }>('/api/calls/access'),
  list: (kind: PromoterKind) => call<{ promoter: PromoterInfo; calls: CallListItem[] }>(`/api/calls?kind=${kind}`),
  create: (kind: PromoterKind, name?: string) => call<{ call: Call }>('/api/calls', send('POST', { kind, name })),
  get: (id: string) => call<CallState>(`/api/calls/${id}`),
  patchGeneral: (id: string, baseVersion: number, patch: Record<string, unknown>) => call<CallState>(`/api/calls/${id}`, send('PATCH', { baseVersion, ...patch })),
  putPhases: (id: string, baseVersion: number, phases: Pick<CallPhase, 'id' | 'name' | 'startsOn' | 'endsOn'>[]) =>
    call<CallState>(`/api/calls/${id}/phases`, send('PUT', { baseVersion, phases })),
  putForm: (id: string, baseVersion: number, fields: FormField[]) => call<CallState>(`/api/calls/${id}/form`, send('PUT', { baseVersion, fields })),
  duplicate: (id: string) => call<{ call: Call }>(`/api/calls/${id}/duplicate`, send('POST')),
  act: (id: string, action: 'confirm' | 'edit' | 'publish' | 'extend' | 'close' | 'archive', extra: { closesAt?: string } = {}) =>
    call<CallState>(`/api/calls/${id}/action`, send('POST', { action, ...extra })),
  /** Prompt 909 (I2): the calls the form can be imported from, and the fields of one of them to look at. */
  importSources: (id: string, previewId?: string) =>
    call<{ sources: ImportSource[]; preview?: { id: string; name: string; currency: string; fields: FormField[] } }>(
      `/api/calls/${id}/import-form${previewId ? `?preview=${encodeURIComponent(previewId)}` : ''}`),
  importForm: (id: string, body: { sourceCallId: string; mode: ImportMode; baseVersion: number; confirmReplace?: boolean }) =>
    call<CallState & { import: { imported: number; mode: ImportMode; from: string; warnings: string[] } }>(`/api/calls/${id}/import-form`, send('POST', body)),
  /** Prompt 909 (I3): the team of a call, and one change at a time (the server answers with the whole picture). */
  team: (id: string) => call<TeamPayload>(`/api/calls/${id}/team`),
  teamAction: (id: string, body: Record<string, unknown>) => call<TeamPayload>(`/api/calls/${id}/team`, send('POST', body)),
  /** Prompt 909 (I4): the import from documents. The upload is multipart, so it does not go through call(). */
  importFromDocuments: async (id: string, form: FormData): Promise<ApiResult<{ run: { id: string; status: string; proposal: Proposal } }>> => {
    try {
      const res = await fetch(`/api/calls/${id}/import-ai`, { method: 'POST', body: form });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; code?: string; run: { id: string; status: string; proposal: Proposal } };
      return { ok: res.ok && body.ok !== false, status: res.status, body };
    } catch {
      return { ok: false, status: 0, body: { error: 'We could not reach the server. Check your connection and try again.', code: 'network' } as never };
    }
  },
  sourceDocuments: (id: string) =>
    call<{ documents: { id: string; kind: SourceKind; mimeType?: string; fileName: string; sizeBytes: number; pages: number | null; createdAt: string; publicToApplicants?: boolean }[]; foundLater: { eligibility: string[]; evaluation: string[] } }>(`/api/calls/${id}/import-ai`),
  applyImport: (id: string, runId: string, body: { baseVersion: number; fieldsMode: 'add' | 'replace'; accepted: { general?: ProposalGeneral; phases?: ProposalPhaseItem[]; fields?: ProposalFieldItem[] } }) =>
    call<CallState & { applied: { general: boolean; phases: number; fields: number } }>(`/api/calls/${id}/import-ai/${runId}`, send('POST', { action: 'apply', ...body })),
  discardImport: (id: string, runId: string) => call<{ discarded: boolean }>(`/api/calls/${id}/import-ai/${runId}`, send('POST', { action: 'discard' })),
  setSourceDocumentPublic: (id: string, docId: string, publicToApplicants: boolean) =>
    call<Record<string, never>>(`/api/calls/${id}/source-documents/${docId}`, send('PATCH', { publicToApplicants })),
  deleteSourceDocument: (id: string, docId: string) => call<Record<string, never>>(`/api/calls/${id}/source-documents/${docId}`, { method: 'DELETE' }),
  /** Delete a call nobody applied to (the server decides). */
  remove: (id: string) => call<{ deleted: boolean; name: string }>(`/api/calls/${id}/action`, send('POST', { action: 'delete' })),
};
