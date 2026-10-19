'use client';
// Prompt 918 (Adenda 1, C) — the General step's "Cover image" and "Logo" of the call. The cover is a wide image for the top of the first page the applicant sees (shown here at 16:9, the way it is
// cropped); the logo is the entity's — taken from the entity's own profile when it has one, or uploaded here (and, when the person confirms it, kept in the profile too when the profile has
// none). PNG, JPG or WebP, up to 5 MB; the server checks the type on the bytes and refuses SVG. They can be changed in any state of the call (not archived): they are the page's face, not its configuration.
import { useRef, useState } from 'react';
import { callsApi, type CallState } from './api';
import { MEDIA_ACCEPT, MEDIA_MAX_BYTES, MEDIA_REFUSED_FORMAT } from '@/lib/calls/media-limits';

type Branding = NonNullable<CallState['branding']>;
const BTN = 'min-h-[36px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40';

export function CallMediaFields({ callId, branding, disabled, onState }: { callId: string; branding: Branding | undefined; disabled: boolean; onState: (s: CallState) => void }) {
  const [busy, setBusy] = useState<'cover' | 'logo' | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const coverInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const b = branding ?? { coverUrl: null, logoUrl: null, logoSource: null, profileLogoUrl: null };

  async function upload(kind: 'cover' | 'logo', file: File | undefined) {
    if (!file) return;
    setError(''); setNote('');
    // Said before anything is sent (the server checks again, on the bytes).
    if (file.size > MEDIA_MAX_BYTES) { setError('The image is too large (5 MB at most).'); return; }
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) { setError(MEDIA_REFUSED_FORMAT); return; }
    // A logo for an entity whose profile has none can be kept in the profile too — only if the person says so.
    const saveToProfile = kind === 'logo' && !b.profileLogoUrl && window.confirm('Your organisation’s profile has no logo yet. Also keep this one as the logo of your profile?');
    setBusy(kind);
    const r = await callsApi.uploadMedia(callId, kind, file, saveToProfile);
    setBusy(null);
    if (!r.ok) { setError(r.body.error ?? 'We could not save the image. Please try again.'); return; }
    onState(r.body as unknown as CallState);
    const profile = (r.body as { profile?: string | null }).profile;
    if (profile === 'saved') setNote('Saved here and in your organisation’s profile.');
    else if (profile === 'already_has_one') setNote('Saved for this call. Your profile already has a logo, so it was not changed.');
    else if (profile === 'not_possible') setNote('Saved for this call. It could not be kept in your profile from here.');
  }
  async function remove(kind: 'cover' | 'logo') {
    setError(''); setNote(''); setBusy(kind);
    const r = await callsApi.removeMedia(callId, kind);
    setBusy(null);
    if (!r.ok) { setError(r.body.error ?? 'We could not remove the image. Please try again.'); return; }
    onState(r.body as unknown as CallState);
  }

  return (
    <fieldset className="rounded-lg border border-gray-200 p-4" data-testid="call-media">
      <legend className="px-1 text-xs font-semibold text-gray-700">First page of the call</legend>
      <p className="text-[11px] text-gray-400">What an applicant sees first: a cover, your logo and the call’s title. PNG, JPG or WebP, up to 5 MB.</p>

      <div className="mt-3 grid gap-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div data-testid="cover-field">
          <span className="block text-xs font-semibold text-gray-700">Cover image <span className="font-normal text-gray-400">(optional)</span></span>
          <div className="mt-1 aspect-video w-full overflow-hidden rounded-lg border border-gray-200 bg-gradient-to-br from-[#0E7490] to-[#164e63]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {b.coverUrl ? <img src={b.coverUrl} alt="Cover of the call, as it will be cropped (16:9)" className="h-full w-full object-cover" data-testid="cover-preview" />
              : <span className="flex h-full items-center justify-center px-3 text-center text-[11px] text-white/80" data-testid="cover-empty">No cover: the page shows a band in the colour of the platform.</span>}
          </div>
          <p className="mt-1 text-[11px] text-gray-400">Shown wide, 16:9: keep what matters in the middle.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input ref={coverInput} type="file" accept={MEDIA_ACCEPT} className="sr-only" tabIndex={-1} data-testid="cover-file" aria-label="Cover image file"
              onChange={(e) => { void upload('cover', e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" className={BTN} disabled={disabled || busy !== null} onClick={() => coverInput.current?.click()} data-testid="cover-upload">{busy === 'cover' ? 'Uploading…' : b.coverUrl ? 'Replace cover' : 'Upload cover'}</button>
            {b.coverUrl && <button type="button" className={BTN} disabled={disabled || busy !== null} onClick={() => void remove('cover')} data-testid="cover-remove">Remove</button>}
          </div>
        </div>

        <div data-testid="logo-field">
          <span className="block text-xs font-semibold text-gray-700">Logo of your organisation</span>
          <div className="mt-1 flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {b.logoUrl ? <img src={b.logoUrl} alt="Logo of your organisation" className="max-h-full max-w-full object-contain" data-testid="logo-preview" />
              : <span className="px-2 text-center text-[11px] text-gray-400" data-testid="logo-empty">No logo yet</span>}
          </div>
          <p className="mt-1 text-[11px] text-gray-400" data-testid="logo-source">
            {b.logoSource === 'profile' ? 'From your organisation’s profile.' : b.logoSource === 'call' ? 'Uploaded for this call.' : 'Your profile has none: upload one, or the name is shown instead.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input ref={logoInput} type="file" accept={MEDIA_ACCEPT} className="sr-only" tabIndex={-1} data-testid="logo-file" aria-label="Logo file"
              onChange={(e) => { void upload('logo', e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" className={BTN} disabled={disabled || busy !== null} onClick={() => logoInput.current?.click()} data-testid="logo-upload">{busy === 'logo' ? 'Uploading…' : b.logoSource === 'call' ? 'Replace logo' : 'Upload a logo'}</button>
            {b.logoSource === 'call' && <button type="button" className={BTN} disabled={disabled || busy !== null} onClick={() => void remove('logo')} data-testid="logo-remove">Remove</button>}
          </div>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-[#B00000]" data-testid="media-error">{error}</p>}
      {note && <p role="status" className="mt-3 text-xs text-emerald-700" data-testid="media-note">{note}</p>}
    </fieldset>
  );
}
