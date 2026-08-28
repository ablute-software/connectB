'use client';
// Prompt 421 §F — a small mirror of the founder side's PhotosMediaCard,
// scoped to firm identity only (no product/roadmap, which don't apply to
// an investor). The founder version is a real upload pipeline (content-
// sniffed, malware-scanned, multi-item gallery by category) — building
// that same infrastructure for a single firm logo would be a much bigger
// lift than "small mirror" asks for. This reuses the existing
// matchdeal_profiles.photo_url column (migration 0053) via a plain URL
// field instead: same shared draft/save the Company tab already uses, so
// no new persistence path either.
interface PhotoDraft { photo_url: string | null }

export function PhotosMediaTab<T extends PhotoDraft>({ draft, setDraft, save, saving, saveState, saveError }: {
  draft: T; setDraft: (p: T) => void; save: () => void; saving: boolean;
  saveState: 'idle' | 'saved'; saveError: string | null;
}) {
  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Photos & media</h2>
        <p className="mt-1 text-xs text-gray-500">Your firm&apos;s logo, shown wherever your profile appears to founders.</p>

        <label className="mt-3 flex flex-col gap-1 text-xs text-gray-500">
          Firm logo URL
          <input value={draft.photo_url ?? ''} onChange={(e) => setDraft({ ...draft, photo_url: e.target.value })}
            placeholder="https://…" className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
        </label>
        {draft.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={draft.photo_url} alt="Firm logo preview" className="mt-2 h-16 w-16 rounded-lg border border-gray-200 object-contain" />
        )}

        <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
          <button onClick={save} disabled={saving} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saveState === 'saved' && !saveError && <span className="text-xs font-medium text-green-700">✓ Saved</span>}
          {saveError && <span className="text-xs font-medium text-[#B00000]">Couldn&apos;t save — {saveError}</span>}
        </div>
      </div>
    </div>
  );
}
