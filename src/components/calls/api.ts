// Prompt 905 — the browser side of /api/calls: small typed wrappers, so the editor never builds a URL or reads
// a response by hand. Every call returns {ok, status, body}; nothing throws on a refusal.
import type { CallStatus, PromoterKind } from '@/lib/calls/types';
import type { Call, CallPhase, FormField } from '@/lib/calls/types';
import type { CallSummary, ReadinessIssue, availableActions } from '@/lib/calls/lifecycle';

export interface PromoterInfo { kind: PromoterKind; id: string; name: string; canManage: boolean }

export interface CallListItem extends Call { effectiveStatus: CallStatus; applications: number; fields: number; phases: number }

export interface CallEvent { id: number; event: string; actor_user_id: string | null; detail: Record<string, unknown>; created_at: string }

export interface CallState {
  ok: true;
  call: Call;
  effectiveStatus: CallStatus;
  promoterName: string;
  canManage: boolean;
  phases: CallPhase[];
  fields: FormField[];
  issues: ReadinessIssue[];
  summary: CallSummary;
  actions: ReturnType<typeof availableActions>;
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
  act: (id: string, action: 'confirm' | 'edit' | 'publish' | 'extend' | 'close', extra: { closesAt?: string } = {}) =>
    call<CallState>(`/api/calls/${id}/action`, send('POST', { action, ...extra })),
};
