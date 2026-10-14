'use client';
// Prompt 907 (I2) — a "document" question as the applicant answers it (spec §6.6): attach a PDF — upload it, or choose one from the Vault.
// Upload goes straight from the browser to the startup's own storage folder (a serverless function cannot take a large body) and is then
// verified on the server (a real PDF by its bytes, the question's size limit, the malware scan). A Vault document is authorised in the
// name of the call and pins the version that exists now; if a newer version appears before submission the applicant is offered it, with a
// confirmation, and nothing changes until they say so.
import { useRef, useState } from 'react';
import { browserClient } from '@/lib/supabase';
import { DEFAULT_MAX_FILE_MB, MAX_FILE_MB_CEILING, type FormField } from '@/lib/calls/types';
import { applicantApi } from '@/lib/calls/applicant/client';
import type { FileRef } from '@/lib/calls/applicant/answers';

export type StateFile = FileRef & { newer?: { versionNumber: number; fileName: string } };

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'document.pdf';

export function FileQuestion({ field, applicationId, orgId, file, disabled, onAttached, onRemoved, onUpdated }: {
  field: FormField; applicationId: string; orgId: string; file: StateFile | null; disabled: boolean;
  onAttached: (file: StateFile) => void; onRemoved: (fileId: string, revision?: number) => void; onUpdated: (file: StateFile) => void;
}) {
  const maxMb = Math.min(field.validations.maxFileMb ?? DEFAULT_MAX_FILE_MB, MAX_FILE_MB_CEILING);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [vault, setVault] = useState<{ id: string; name: string; version: number; sizeBytes: number | null }[] | null>(null);
  const [picking, setPicking] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(f: File) {
    setError('');
    if (!f.name.toLowerCase().endsWith('.pdf') || (f.type && f.type !== 'application/pdf')) { setError('Only PDF files are accepted.'); return; }
    if (f.size > maxMb * 1024 * 1024) { setError(`The file is too large (maximum ${maxMb} MB).`); return; }
    setBusy('Uploading…');
    try {
      const path = `${orgId}/calls/${applicationId}/${crypto.randomUUID()}-${safeName(f.name)}`;
      const { error: upErr } = await browserClient().storage.from('data-room').upload(path, f);
      if (upErr) { setError('We could not upload the file. Please try again.'); return; }
      setBusy('Checking…');
      const r = await applicantApi.attachUpload(applicationId, field.id, path, f.name);
      if (!r.ok) { setError(r.body.error ?? 'We could not attach the file.'); return; }
      onAttached({ ...r.body.file } as StateFile);
    } catch {
      setError('We could not upload the file. Check your connection and try again.');
    } finally { setBusy(''); if (input.current) input.current.value = ''; }
  }

  async function openVault() {
    setError(''); setPicking(true);
    if (vault) return;
    setBusy('Loading your Vault…');
    const r = await applicantApi.vault(applicationId);
    setBusy('');
    if (!r.ok) { setError(r.body.error ?? 'We could not read your Vault.'); setPicking(false); return; }
    setVault(r.body.documents);
  }

  async function choose(documentId: string) {
    setError(''); setBusy('Attaching…');
    const r = await applicantApi.attachVault(applicationId, field.id, documentId);
    setBusy('');
    if (!r.ok) { setError(r.body.error ?? 'We could not attach that document.'); return; }
    setPicking(false);
    onAttached({ ...r.body.file } as StateFile);
  }

  async function remove() {
    if (!file) return;
    setError(''); setBusy('Removing…');
    const r = await applicantApi.removeFile(applicationId, file.id);
    setBusy('');
    if (!r.ok) { setError(r.body.error ?? 'We could not remove the file.'); return; }
    onRemoved(file.id, r.body.revision);
  }

  async function takeNewer() {
    if (!file?.newer) return;
    if (!window.confirm(`Replace “${file.fileName}” (version ${file.versionNumber}) with version ${file.newer.versionNumber} from your Vault? The draft will use the new version.`)) return;
    setError(''); setBusy('Updating…');
    const r = await applicantApi.refreshFile(applicationId, file.id);
    setBusy('');
    if (!r.ok) { setError(r.body.error ?? 'We could not update the document.'); return; }
    onUpdated({ ...r.body.file } as StateFile);
  }

  return (
    <div data-testid="file-question">
      <p className="text-[11px] text-gray-400">
        PDF only, up to {maxMb} MB
        {field.maxAgeMonths ? ` · issued within the last ${field.maxAgeMonths} month${field.maxAgeMonths === 1 ? '' : 's'}` : ''}
        {field.expectedType ? ` · ${field.expectedType}` : ''}
      </p>
      {file ? (
        <div className="mt-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm" data-testid="attached-file">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate"><b className="text-gray-900">{file.fileName}</b> <span className="text-xs text-gray-500">· {sizeText(file.size)} · {file.source === 'vault' ? `from your Vault (version ${file.versionNumber ?? 1})` : 'uploaded'}</span></span>
            {!disabled && <button type="button" onClick={() => void remove()} disabled={!!busy} className="shrink-0 text-xs text-[#B00000] hover:underline">Remove</button>}
          </div>
          {file.newer && !disabled && (
            <p className="mt-1.5 text-xs text-amber-800" data-testid="newer-version">
              A newer version of this document is in your Vault (version {file.newer.versionNumber}).{' '}
              <button type="button" onClick={() => void takeNewer()} disabled={!!busy} className="font-semibold underline">Use the new version</button>
              {' '}or keep this one: nothing changes unless you confirm.
            </p>
          )}
        </div>
      ) : null}
      {!disabled && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <label className={`cursor-pointer rounded-lg bg-[#E8F4F8] px-3 py-1.5 text-sm font-medium text-[#0E7490] ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            {file ? 'Replace with a file' : 'Upload a PDF'}
            <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" data-testid="file-input" disabled={!!busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          </label>
          <button type="button" onClick={() => void openVault()} disabled={!!busy} data-testid="choose-from-vault"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">Choose from your Vault</button>
          {busy && <span className="text-xs text-gray-500" role="status">{busy}</span>}
        </div>
      )}
      {picking && vault && (
        <div className="mt-2 rounded-lg border border-gray-200 p-2" data-testid="vault-list">
          {vault.length === 0 ? <p className="px-1 py-1 text-xs text-gray-500">There are no PDF documents in your Vault yet.</p> : (
            <ul className="max-h-48 divide-y divide-gray-100 overflow-auto text-sm">
              {vault.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate">{d.name} <span className="text-xs text-gray-400">· version {d.version}{d.sizeBytes ? ` · ${sizeText(d.sizeBytes)}` : ''}</span></span>
                  <button type="button" onClick={() => void choose(d.id)} className="shrink-0 text-xs font-semibold text-[#0E7490] hover:underline">Attach</button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setPicking(false)} className="mt-1 px-1 text-xs text-gray-500 hover:underline">Close</button>
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-[#B00000]" data-testid="file-error">{error}</p>}
    </div>
  );
}
