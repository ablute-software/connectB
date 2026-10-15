// Prompt 907 — the browser side of /api/calls/apply/*: small typed wrappers, so the form never builds a URL or reads a response by hand.
// Every call returns { ok, status, body }; nothing throws on a refusal, and a network failure is a result (status 0), never an exception —
// the form keeps what is on screen and offers to try again (spec §14.1).
import type { Answers } from '../types';
import type { ApplicationState } from './store';

export interface ApiResult<T> { ok: boolean; status: number; body: T & { error?: string; code?: string } }

const NETWORK = 'We could not reach the server. Check your connection and try again.';

async function call<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const body = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string; code?: string };
    return { ok: res.ok && body.ok !== false, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: { error: NETWORK, code: 'network' } as T & { error: string; code: string } };
  }
}
const send = (method: string, data?: unknown): RequestInit => ({ method, body: data === undefined ? undefined : JSON.stringify(data) });

export type StateBody = { state: ApplicationState; page: number };
export interface FileBody { file: { id: string; fieldId: string; entryId?: string | null; source: 'upload' | 'vault'; fileName: string; size: number; versionNumber?: number | null; documentId?: string | null }; answer: unknown }
export interface SubmitFailure { fieldId: string; label: string; page: number; message: string }

export const applicantApi = {
  start: (token: string, startNew = false) => call<StateBody & { created: boolean }>(`/api/calls/apply/${encodeURIComponent(token)}/start`, send('POST', { new: startNew })),
  get: (id: string) => call<StateBody>(`/api/calls/apply/applications/${id}`),
  save: (id: string, body: { answers: Answers; lastPage: number; baseRevision: number }) => call<{ revision: number }>(`/api/calls/apply/applications/${id}`, send('PUT', body)),
  vault: (id: string) => call<{ documents: { id: string; name: string; version: number; sizeBytes: number | null }[] }>(`/api/calls/apply/applications/${id}/vault`),
  // `entryId`: the entry of a repeatable group the file belongs to (Prompt 917); absent for a File question of the form itself.
  attachUpload: (id: string, fieldId: string, storagePath: string, fileName: string, entryId?: string) =>
    call<FileBody>(`/api/calls/apply/applications/${id}/files`, send('POST', { fieldId, entryId, kind: 'upload', storagePath, fileName })),
  attachVault: (id: string, fieldId: string, documentId: string, entryId?: string) =>
    call<FileBody>(`/api/calls/apply/applications/${id}/files`, send('POST', { fieldId, entryId, kind: 'vault', documentId })),
  removeFile: (id: string, fileId: string) => call<{ revision?: number }>(`/api/calls/apply/applications/${id}/files/${fileId}`, send('DELETE')),
  refreshFile: (id: string, fileId: string) => call<Pick<FileBody, 'file'>>(`/api/calls/apply/applications/${id}/files/${fileId}/refresh`, send('POST')),
  submit: (id: string, key: string, baseRevision: number) =>
    call<{ submittedAt: string; reference: string | null; already: boolean; failures?: SubmitFailure[] }>(`/api/calls/apply/applications/${id}/submit`, send('POST', { key, baseRevision })),
};
