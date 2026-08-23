'use client';
// Company tab redesign — Identity card: legal/commercial name, logo,
// website, HQ, founding year, sector tags, one-liner, short description.
// Logo uploads into the existing `data-room` Storage bucket (no new
// bucket) under `${org_id}/logo/…`; org.logo_url stores that PATH, not a
// public URL — resolved to a signed URL here at render time (private
// bucket, same RLS every other data-room object uses).
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { browserClient } from '@/lib/supabase';
import { uploadAndVerifyFile } from '@/lib/vault-upload-client';
import { CompletenessField } from './CompletenessField';
import { SectorPicker, type SectorValue } from './SectorPicker';
import { ALL_SECTOR_NAMES } from '@/lib/sector-taxonomy';
import { INTRO_PITCH_MAX } from '@/lib/investor-interest-level';
import type { CompletenessField as Field } from '@/lib/companyCompleteness';
import type { CompanyPhase } from '@/lib/types';

// Prompt 85 Correction 1 — the 5 options are the spec's own wording,
// verbatim. Deliberately a different concept from RoundCard's Stage
// (pre-seed/seed/Series A/...): that's the funding round; this is how far
// along the product/company itself is, independent of fundraising status.
const CURRENT_PHASES: { value: CompanyPhase; label: string }[] = [
  { value: 'concept_idea', label: 'Concept / Idea' },
  { value: 'prototype', label: 'Prototype' },
  { value: 'pilot', label: 'Pilot' },
  { value: 'launch_early_adopters', label: 'Launch / Early Adopters' },
  { value: 'growth', label: 'Growth' },
];

export function IdentityCard({ canEdit, missing, flashId }: { canEdit: boolean; missing: Field[]; flashId: string | null }) {
  const { db, updateOrg } = useStore();
  const org = db.org;
  const missingIds = new Set(missing.map((f) => f.id));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [sectorDraft, setSectorDraft] = useState<SectorValue>({ sectors: [], other: null });
  const [sectorErr, setSectorErr] = useState('');
  const [logoSignedUrl, setLogoSignedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!org.logo_url) { setLogoSignedUrl(null); return; }
    browserClient().storage.from('data-room').createSignedUrl(org.logo_url, 3600)
      .then(({ data }) => setLogoSignedUrl(data?.signedUrl ?? null));
  }, [org.logo_url]);

  function startEdit() {
    setDraft({
      legal_name: org.legal_name ?? '', name: org.name ?? '', website: org.website ?? '',
      country: org.country ?? '', hq_city: org.hq_city ?? '', postal_code: org.postal_code ?? '',
      founded_year: org.founded_year != null ? String(org.founded_year) : '',
      one_liner: org.one_liner ?? '', description: org.description ?? '',
      intro_problem: org.intro_problem ?? '', intro_solution: org.intro_solution ?? '',
      current_phase: org.current_phase ?? '', revenue_eur: org.revenue_eur != null ? String(org.revenue_eur) : '',
    });
    // Only pre-check values that exist in the fixed taxonomy — pre-existing
    // free-text sectors (from before this rebuild) aren't force-mapped or
    // silently dropped; they stay in org.sectors untouched unless the
    // founder actively edits and saves (open product question: how to
    // migrate old free-text values — flagged back, not decided here).
    setSectorDraft({
      sectors: (org.sectors ?? []).filter((s) => ALL_SECTOR_NAMES.includes(s)),
      other: org.sectors_other ?? null,
    });
    setEditing(true);
  }

  function save() {
    if (sectorDraft.other !== null && !sectorDraft.other.trim()) {
      setSectorErr('Please specify the sector.');
      return;
    }
    setSectorErr('');
    const sectors = sectorDraft.sectors;
    const other = sectorDraft.other?.trim() || undefined;
    updateOrg({
      legal_name: draft.legal_name.trim() || undefined,
      name: draft.name.trim() || org.name,
      website: draft.website.trim() || undefined,
      country: draft.country.trim() || undefined,
      hq_city: draft.hq_city.trim() || undefined,
      postal_code: draft.postal_code.trim() || undefined,
      founded_year: draft.founded_year ? Number(draft.founded_year) : undefined,
      sectors,
      sectors_other: other,
      // Legacy single-value field, kept in sync so composer.ts /
      // readiness/ReviewPanel (which still read org.sector) never go stale.
      sector: [...sectors, ...(other ? [other] : [])].join(', ') || undefined,
      one_liner: draft.one_liner.trim() || undefined,
      description: draft.description.trim() || undefined,
      intro_problem: draft.intro_problem.trim() || undefined,
      intro_solution: draft.intro_solution.trim() || undefined,
      current_phase: (draft.current_phase || undefined) as CompanyPhase | undefined,
      revenue_eur: draft.revenue_eur ? Number(draft.revenue_eur) : undefined,
    });
    setEditing(false);
  }

  // Prompt 305 §A (follow-up finding, adversarial review) — this upload had
  // NO server-side validation at all: a raw client upload straight to
  // Storage, with org.logo_url set from whatever path the browser chose.
  // The most exposed of the gaps this prompt found — the resulting signed
  // URL isn't just shown on this founder's own Company tab, it's rendered
  // to INVESTORS via ProfilePanel.tsx/MatchDealDeck.tsx's "Use your
  // Sherlock Deal logo" path. Now reuses the exact same
  // uploadAndVerifyFile helper (magic-byte allowlist + VirusTotal,
  // reject-and-delete on failure) the Vault's own upload path uses —
  // never a second, less-secure upload mechanism.
  //
  // Known, accepted limitation: orgs has no per-field scan-status tracking
  // (unlike documents/matchdeal_profiles), so a genuinely new file that
  // comes back 'pending' isn't re-checked by the daily cron the way the
  // other five paths are — same residual window every 'pending' verdict in
  // this app already carries, just without a dedicated sweep for THIS one
  // field. The synchronous checks (type allowlist + known-malicious
  // rejection) still apply in full before logo_url is ever set.
  async function uploadLogo(file: File) {
    setUploadErr(''); setUploading(true);
    try {
      const verified = await uploadAndVerifyFile(org.id, file);
      updateOrg({ logo_url: verified.storagePath });
    } catch (e) {
      setUploadErr((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const input = (k: string, label: string, id: string, type = 'text') => (
    <CompletenessField id={id} label={label} missing={missingIds.has(id)} flashing={flashId === id}>
      <input type={type} value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
        className="rounded border border-gray-300 px-2 py-1 text-sm" />
    </CompletenessField>
  );

  return (
    <Card title="Identity" right={canEdit && !editing ? <button onClick={startEdit} className="text-xs text-cyan-700 hover:underline">Edit</button> : undefined}>
      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {input('legal_name', 'Legal name', 'identity.legal_name')}
            {input('name', 'Commercial name', 'identity.name')}
            {input('website', 'Website', 'identity.website')}
            {input('country', 'HQ country', 'identity.country')}
            {input('hq_city', 'HQ city', 'identity.hq_city')}
            {input('postal_code', 'Postal code', 'identity.postal_code')}
            {input('founded_year', 'Year founded', 'identity.founded_year', 'number')}
            {input('revenue_eur', 'Revenue (EUR)', 'identity.revenue', 'number')}
          </div>
          <CompletenessField id="identity.current_phase" label="Current phase" missing={missingIds.has('identity.current_phase')} flashing={flashId === 'identity.current_phase'}>
            <select value={draft.current_phase ?? ''} onChange={(e) => setDraft({ ...draft, current_phase: e.target.value })}
              className="rounded border border-gray-300 px-2 py-1 text-sm">
              <option value="">—</option>
              {CURRENT_PHASES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </CompletenessField>
          <CompletenessField id="identity.sectors" label="Select up to 6 sectors that apply to your company" missing={missingIds.has('identity.sectors')} flashing={flashId === 'identity.sectors'}>
            <SectorPicker value={sectorDraft} onChange={(v) => { setSectorDraft(v); setSectorErr(''); }} />
            {sectorErr && <p className="mt-1 text-xs text-[#B00000]">{sectorErr}</p>}
          </CompletenessField>
          <CompletenessField id="identity.one_liner" label="One-liner" missing={missingIds.has('identity.one_liner')} flashing={flashId === 'identity.one_liner'}>
            <input value={draft.one_liner ?? ''} onChange={(e) => setDraft({ ...draft, one_liner: e.target.value })}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
          </CompletenessField>
          {/* Prompt 325 — additional to the one-liner above, never
              required: the concrete "why click Interested" an investor
              sees at Discovery, before granting anything. */}
          <CompletenessField id="identity.intro_problem" label={`Intro pitch — problem (optional, max ${INTRO_PITCH_MAX} characters)`} missing={false} flashing={false}>
            <input value={draft.intro_problem ?? ''} maxLength={INTRO_PITCH_MAX}
              onChange={(e) => setDraft({ ...draft, intro_problem: e.target.value })}
              placeholder="e.g. Founders waste months chasing investors who were never a fit."
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
            <span className="mt-0.5 self-end text-[10px] text-gray-400">{(draft.intro_problem ?? '').length}/{INTRO_PITCH_MAX}</span>
          </CompletenessField>
          <CompletenessField id="identity.intro_solution" label="Intro pitch — solution (optional)" missing={false} flashing={false}>
            <input value={draft.intro_solution ?? ''} maxLength={INTRO_PITCH_MAX}
              onChange={(e) => setDraft({ ...draft, intro_solution: e.target.value })}
              placeholder="e.g. We match founders to investors by real sector and stage fit."
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
            <span className="mt-0.5 self-end text-[10px] text-gray-400">{(draft.intro_solution ?? '').length}/{INTRO_PITCH_MAX}</span>
          </CompletenessField>
          <CompletenessField id="identity.description" label="Short description (2-3 sentences)" missing={missingIds.has('identity.description')} flashing={flashId === 'identity.description'}>
            <textarea value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={3}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
          </CompletenessField>
          <div className="flex gap-2">
            <button onClick={save} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">Save</button>
            <button onClick={() => setEditing(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div id="identity.logo" className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50 transition-colors duration-700 ${flashId === 'identity.logo' ? 'ring-2 ring-amber-300' : ''}`}>
              {logoSignedUrl ? <img src={logoSignedUrl} alt="Logo" className="h-full w-full object-cover" /> : <span className="text-[10px] text-gray-300">No logo</span>}
            </div>
            {canEdit && (
              <div>
                <input ref={fileRef} type="file" accept="image/*" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} className="text-xs" />
                {uploading && <p className="text-[11px] text-gray-400">Uploading…</p>}
                {uploadErr && <p className="text-[11px] text-[#B00000]">{uploadErr}</p>}
                {missingIds.has('identity.logo') && <span className="mt-0.5 block text-[9px] font-semibold text-amber-700">needed for 100%</span>}
              </div>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {([
              ['identity.legal_name', 'Legal name', org.legal_name],
              ['identity.name', 'Commercial name', org.name],
              ['identity.website', 'Website', org.website],
              ['identity.hq_city', 'HQ city', org.hq_city],
              ['identity.country', 'HQ country', org.country],
              ['identity.postal_code', 'Postal code', org.postal_code],
              ['identity.founded_year', 'Founded', org.founded_year],
              ['identity.current_phase', 'Current phase', CURRENT_PHASES.find((p) => p.value === org.current_phase)?.label],
              ['identity.revenue', 'Revenue', org.revenue_eur != null ? `€${org.revenue_eur.toLocaleString('en-US')}` : undefined],
            ] as [string, string, string | number | undefined][]).map(([id, label, value]) => (
              <div key={id} id={id} className={`rounded p-1 transition-colors duration-700 ${flashId === id ? 'bg-amber-50 ring-2 ring-amber-300' : ''}`}>
                <dt className="flex items-center gap-1.5 text-xs text-gray-500">
                  {label}
                  {missingIds.has(id) && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">needed for 100%</span>}
                </dt>
                <dd>{value || '—'}</dd>
              </div>
            ))}
          </dl>
          <div id="identity.sectors" className={`rounded p-1 transition-colors duration-700 ${flashId === 'identity.sectors' ? 'bg-amber-50 ring-2 ring-amber-300' : ''}`}>
            <dt className="flex items-center gap-1.5 text-xs text-gray-500">
              Sectors
              {missingIds.has('identity.sectors') && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">needed for 100%</span>}
            </dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {(org.sectors?.length || org.sectors_other) ? (
                <>
                  {(org.sectors ?? []).map((s) => (
                    <span key={s} className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs text-cyan-800">{s}</span>
                  ))}
                  {org.sectors_other && <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-xs text-cyan-800">{org.sectors_other}</span>}
                </>
              ) : <span className="text-sm text-gray-400">—</span>}
            </dd>
          </div>
          <div id="identity.one_liner" className={`rounded p-1 text-sm transition-colors duration-700 ${flashId === 'identity.one_liner' ? 'bg-amber-50 ring-2 ring-amber-300' : ''}`}>
            {org.one_liner ? <p className="text-gray-700">{org.one_liner}</p> : missingIds.has('identity.one_liner') && (
              <p className="text-xs text-amber-700">One-liner needed for 100%</p>
            )}
          </div>
          {(org.intro_problem || org.intro_solution) && (
            <div id="identity.intro_pitch" className="rounded p-1 text-sm">
              {org.intro_problem && <p className="text-gray-700"><span className="font-semibold text-gray-500">Problem: </span>{org.intro_problem}</p>}
              {org.intro_solution && <p className="text-gray-700"><span className="font-semibold text-gray-500">Solution: </span>{org.intro_solution}</p>}
            </div>
          )}
          <div id="identity.description" className={`rounded p-1 text-xs transition-colors duration-700 ${flashId === 'identity.description' ? 'bg-amber-50 ring-2 ring-amber-300' : ''}`}>
            {org.description ? <p className="text-gray-500">{org.description}</p> : missingIds.has('identity.description') && (
              <p className="text-amber-700">Short description needed for 100%</p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
