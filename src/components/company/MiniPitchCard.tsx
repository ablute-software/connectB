'use client';
// Prompt 334 — the MatchDeal mini-pitch: 5 auto-generated slides synthesized
// from the claims registry + profile fields. This card is the founder's own
// console for it: gate status (what's missing, with a link to fix it —
// never an opaque "not eligible"), a preview, and Generate/Activate.
//
// Prompt 379 — three changes, all driven by the founder's own test of the
// new MatchDeal tab:
//  §B the preview now renders the SHARED MiniPitchDeck — literally the same
//     component the investor's dossier uses — instead of a grey text list,
//     so "what I see" and "what they see" cannot drift.
//  §C each slide is editable inline; an edit is stored as a founder override
//     (founderEdited) that a later regeneration must ASK about, never
//     silently overwrite.
//  §D one optional image per slide, chosen from the org's own Photos & media
//     library. Content personalisation only — see MiniPitchSlideView's own
//     header for the product decision on why layout is NOT configurable.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { authEnabled } from '@/lib/supabase';
import { MiniPitchDeck, MINI_PITCH_SLIDE_LABEL, type MiniPitchSlideKind } from '@/components/mini-pitch/MiniPitchSlideView';

interface GateField { key: string; label: string; href: string }
interface Gate { eligible: boolean; missing: GateField[] }
interface Slide {
  kind: MiniPitchSlideKind; title?: string; body: string; claimIds?: string[];
  founderEdited?: boolean; mediaId?: string; imageUrl?: string | null; imageCaption?: string | null;
}
interface Pitch { slides: Slide[]; generatedAt: string; activatedAt: string | null; stale: boolean }
interface MediaItem { id: string; caption: string; url: string }
interface RegenChoice { kind: MiniPitchSlideKind; hadFounderEdit: boolean; kept: boolean }

const ACTIVATION_COPY = 'A mini-pitch is generated automatically from your company profile and the Vault documents '
  + "you've marked as shareable at the lightest level — it's what an investor sees first. The more information you "
  + 'provide, the better your chances of the perfect match, and the smoother the process continues once an investor '
  + 'shows interest.';

export function MiniPitchCard({ canEdit }: { canEdit: boolean }) {
  const [gate, setGate] = useState<Gate | null>(null);
  const [pitch, setPitch] = useState<Pitch | null>(null);
  const [mediaLibrary, setMediaLibrary] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showActivationCopy, setShowActivationCopy] = useState(false);
  const [editingKind, setEditingKind] = useState<MiniPitchSlideKind | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string; mediaId: string | null }>({ title: '', body: '', mediaId: null });
  // §C.3 — after a regeneration that replaced hand-edited slides, the
  // founder is asked per slide whether to keep their own version.
  const [replacedEdits, setReplacedEdits] = useState<MiniPitchSlideKind[]>([]);

  function load() {
    // Demo mode has no real org/claims for the server route to read from —
    // same "nothing meaningful to compute" case as BadgesCard's own guard.
    if (!authEnabled) return;
    fetch('/api/mini-pitch').then((r) => r.json()).then((b) => {
      if (!b.ok) return;
      setGate(b.gate);
      setPitch(b.pitch);
      setMediaLibrary(b.mediaLibrary ?? []);
    }).catch(() => {});
  }
  useEffect(load, []);

  function generate(activate: boolean, keepKinds: MiniPitchSlideKind[] = []) {
    setBusy(true); setError(''); setReplacedEdits([]);
    fetch('/api/mini-pitch', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ activate, keepKinds }),
    })
      .then((r) => r.json()).then((b) => {
        if (!b.ok) { setError(b.error ?? 'Could not generate the mini-pitch.'); return; }
        if (b.configured === false) { setError(b.message); return; }
        setShowActivationCopy(false);
        // Anything the founder had edited that this run replaced becomes an
        // explicit question, not a silent loss.
        const replaced = ((b.choices ?? []) as RegenChoice[]).filter((c) => c.hadFounderEdit && !c.kept).map((c) => c.kind);
        setReplacedEdits(replaced);
        load();
      })
      .catch(() => setError('Could not reach the server — try again.'))
      .finally(() => setBusy(false));
  }

  function startEdit(slide: Slide) {
    setEditingKind(slide.kind);
    setDraft({ title: slide.title ?? '', body: slide.body, mediaId: slide.mediaId ?? null });
  }

  function saveEdit() {
    if (!editingKind) return;
    setBusy(true); setError('');
    fetch('/api/mini-pitch', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ editSlide: { kind: editingKind, title: draft.title, body: draft.body, mediaId: draft.mediaId } }),
    })
      .then((r) => r.json()).then((b) => {
        if (!b.ok) { setError(b.error ?? 'Could not save this slide.'); return; }
        setEditingKind(null);
        load();
      })
      .catch(() => setError('Could not reach the server — try again.'))
      .finally(() => setBusy(false));
  }

  if (!canEdit && !pitch?.activatedAt) return null;
  if (!gate) return null;

  const slides = pitch?.slides ?? [];
  const editingSlide = editingKind ? slides.find((s) => s.kind === editingKind) : null;

  return (
    <Card title="MatchDeal mini-pitch">
      {/* §E — one line of context, so the tab says what it is. */}
      <p className="text-xs text-gray-500">
        This is an investor&apos;s first contact with you on MatchDeal — 5 slides generated from your own facts,
        reviewed by you.
      </p>

      {!gate.eligible ? (
        <>
          <p className="mt-2 text-sm text-gray-500">A few things are missing before a mini-pitch can be generated:</p>
          <ul className="mt-1.5 space-y-1">
            {gate.missing.map((m) => (
              <li key={m.key} className="text-sm">
                {/* §A — Link (client nav) rather than <a>, so the ?flash=
                    parameter is handled by the settings page without a full
                    reload; each href now points at the exact field. */}
                <Link href={m.href} className="text-[#0E7490] hover:underline">{m.label}</Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="mt-2 space-y-2">
          {pitch?.stale && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
              Your profile or claims changed since this was last generated — regenerate to keep it current.
            </p>
          )}

          {replacedEdits.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
              This regeneration replaced {replacedEdits.length} slide{replacedEdits.length === 1 ? '' : 's'} you had
              edited by hand ({replacedEdits.map((k) => MINI_PITCH_SLIDE_LABEL[k]).join(', ')}).
              <button disabled={busy} onClick={() => generate(false, replacedEdits)}
                className="ml-2 font-medium underline disabled:opacity-40">
                Keep my versions instead
              </button>
            </div>
          )}

          {slides.length > 0 ? (
            <>
              <p className="text-[11px] font-medium text-gray-500">
                Exactly as an investor sees it
                {pitch?.activatedAt
                  ? <span className="ml-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">live</span>
                  : <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">preview</span>}
                {pitch?.stale && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">stale</span>}
              </p>
              <MiniPitchDeck
                slides={slides.map((s) => ({
                  kind: s.kind, title: s.title, body: s.body, imageUrl: s.imageUrl, imageCaption: s.imageCaption,
                }))}
                footnote=""
                headerRight={(i) => (canEdit && slides[i] ? (
                  <button onClick={() => startEdit(slides[i])} className="text-[11px] font-medium text-[#0E7490] hover:underline">
                    Edit
                  </button>
                ) : null)}
                renderSlideExtra={(i) => {
                  const s = slides[i];
                  if (!s) return null;
                  return (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-gray-400">
                      {s.founderEdited && <span className="rounded-full bg-[#E8F4F8] px-1.5 py-0.5 text-[#0E7490]">your wording</span>}
                      {s.claimIds && s.claimIds.length > 0 && <span>from {s.claimIds.length} claim{s.claimIds.length === 1 ? '' : 's'}</span>}
                      {s.mediaId && !s.imageUrl && <span className="text-amber-700">image no longer available — slide still shows</span>}
                    </div>
                  );
                }}
              />
            </>
          ) : (
            <p className="text-sm text-gray-400">No mini-pitch generated yet.</p>
          )}

          {/* §C — the inline editor for one slide. */}
          {editingSlide && (
            <div className="rounded-lg border border-[#0E7490] bg-[#E8F4F8]/40 p-3">
              <p className="text-xs font-semibold text-gray-800">Editing: {MINI_PITCH_SLIDE_LABEL[editingSlide.kind]}</p>
              <input autoComplete="off" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Title (optional)" className="mt-1.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
              <textarea autoComplete="off" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={3}
                className="mt-1.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />

              <p className="mt-2 text-[11px] font-medium text-gray-500">Image (optional) — from your Photos &amp; media</p>
              {mediaLibrary.length === 0 ? (
                <p className="mt-1 text-[11px] text-gray-400">
                  No usable images yet — add some in the <span className="font-medium">Photos &amp; media</span> tab.
                </p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <button onClick={() => setDraft({ ...draft, mediaId: null })}
                    className={`rounded-lg border px-2 py-1 text-[11px] ${draft.mediaId === null ? 'border-[#0E7490] bg-white text-[#0E7490]' : 'border-gray-200 text-gray-500'}`}>
                    No image
                  </button>
                  {mediaLibrary.map((m) => (
                    <button key={m.id} onClick={() => setDraft({ ...draft, mediaId: m.id })} title={m.caption}
                      className={`overflow-hidden rounded-lg border ${draft.mediaId === m.id ? 'border-[#0E7490] ring-2 ring-[#0E7490]' : 'border-gray-200'}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.url} alt={m.caption} className="h-12 w-16 object-cover" />
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-2 flex gap-2">
                <button disabled={busy || !draft.body.trim()} onClick={saveEdit}
                  className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                  {busy ? 'Saving…' : 'Save slide'}
                </button>
                <button onClick={() => setEditingKind(null)} className="text-xs text-gray-500 hover:underline">Cancel</button>
              </div>
            </div>
          )}

          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-[#B00000]">{error}</p>}

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <button disabled={busy} onClick={() => generate(false)}
                className="rounded-lg border border-[#0E7490] px-3 py-1.5 text-xs font-medium text-[#0E7490] hover:bg-[#E8F4F8] disabled:opacity-40">
                {busy ? 'Working…' : pitch ? 'Regenerate preview' : 'Preview mini-pitch'}
              </button>
              {pitch && !pitch.activatedAt && (
                showActivationCopy ? (
                  <button disabled={busy} onClick={() => generate(true)}
                    className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                    {busy ? 'Working…' : 'Yes — activate for investors'}
                  </button>
                ) : (
                  <button onClick={() => setShowActivationCopy(true)}
                    className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white">
                    Activate for investors
                  </button>
                )
              )}
              {pitch?.activatedAt && (
                <span className="text-[11px] text-emerald-700">Live — investors who reach Level 1 with you see this.</span>
              )}
            </div>
          )}
          {showActivationCopy && <p className="text-[11px] text-gray-500">{ACTIVATION_COPY}</p>}
        </div>
      )}
    </Card>
  );
}
