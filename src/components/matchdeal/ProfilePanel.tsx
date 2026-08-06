'use client';
// Prompt 97 §5 — own profile, edit + completeness. "Sem mais decisões
// pendentes, podem construir." Required-field lists below match
// matchdeal_recompute_profile_completeness() exactly (confirmed live) —
// photo_url gates startup completeness but not investor, per that trigger.
// Prompt 98 — for startup profiles, name/description/founded_year/
// round_target_eur/revenue_eur/logo_url are now shown read-only, sourced
// from orgs (edited in Settings) instead of duplicated here. sectors/country
// stay editable on matchdeal_profiles per explicit pause (matchdeal_eligible_deck()
// matches on those, not orgs). website/description/photo_url on
// matchdeal_profiles are LEFT AS EDITABLE for now — they gate
// matchdeal_recompute_profile_completeness(), and photo_url in particular
// stores a raw URL while orgs.logo_url stores a data-room storage path, so
// swapping the source needs a format-reconciling sync trigger that hasn't
// been proposed/confirmed yet (mirrors the sectors/country trigger pattern
// once it is).
import { useEffect, useRef, useState } from 'react';
import { browserClient } from '@/lib/supabase';
import { computeProfilePrefill } from '@/lib/matchdeal-profile-prefill';

interface Profile {
  id: string; kind: 'startup' | 'investor'; is_complete: boolean; membership_id: string | null;
  entity_name: string | null; website: string | null; country: string | null; description: string | null;
  photo_url: string | null; sectors: string[]; investment_stage_sought: string | null; company_phase: string | null;
  target_round_amount: number | null; team_summary: string | null;
  representative_name: string | null; stages_invested: string[]; geographies: string[];
  specific_criteria: string | null; ticket_min: number | null; ticket_max: number | null;
  tam_eur: number | null; sam_eur: number | null; som_eur: number | null;
  revenue_projection_12mo_eur: number | null; revenue_projection_5yr_eur: number | null;
}

interface Org {
  id: string; name: string; description: string | null; one_liner: string | null;
  website: string | null; country: string | null;
  founded_year: number | null; round_target_eur: number | null; revenue_eur: number | null; logo_url: string | null;
}

// Prompt 125 Block B — how long "Use your Sherlock Deal logo" signs the
// logo for. A real signed URL (not a stored copy of the raw file) so it
// keeps resolving to whatever's actually at that storage path — genuinely
// stale only if the founder re-uploads their logo AFTER clicking this
// (uploadLogo in IdentityCard.tsx mints a brand-new random path per
// upload), which just means the photo silently stops loading until they
// click this button again. That's the one honest trade-off of picking
// "sign for a long time" over "resolve at render time in every place
// photo_url is ever displayed" (MatchDealDeck/MatchesPanel/
// InstantMessagePanel) — the latter is more correct but touches 3 more
// render sites for a gap that self-heals on the next click.
const LOGO_SIGNED_URL_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

const STAGE_OPTIONS = [
  { value: 'pre_seed', label: 'Pre-seed' }, { value: 'seed', label: 'Seed' },
  { value: 'series_a', label: 'Series A' }, { value: 'series_b_plus', label: 'Series B+' }, { value: 'growth', label: 'Growth' },
];
const PHASE_OPTIONS = [
  { value: 'concept', label: 'Concept' }, { value: 'prototype', label: 'Prototype' }, { value: 'pilot', label: 'Pilot' },
  { value: 'launch', label: 'Launch' }, { value: 'growth', label: 'Growth' },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-white/50">{label}</span>
      {children}
    </label>
  );
}

const inputCls = 'w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[13px] text-white placeholder:text-white/30';

export function ProfilePanel({ viewerProfileId, viewerKind }: { viewerProfileId: string; viewerKind: 'startup' | 'investor' }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [orgLogoUrl, setOrgLogoUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Bug fix (2026-08-06) — this used to be declared AFTER the `if (!profile)`
  // early return below, a conditional hook: the first render (profile still
  // null) ran one fewer hook than every render after the profile loads,
  // which crashes React with "Rendered more hooks than during the previous
  // render" the instant the profile actually arrives — 100% reproducible,
  // every account, every time. Every hook must run unconditionally on every
  // render; this one just needed to move up here with the others.
  const [logoBusy, setLogoBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await browserClient().from('matchdeal_profiles').select('*').eq('id', viewerProfileId).maybeSingle();
      setProfile(data as unknown as Profile);
    })();
  }, [viewerProfileId]);

  useEffect(() => {
    if (!profile || profile.kind !== 'startup' || !profile.membership_id) { setOrg(null); return; }
    (async () => {
      const { data } = await browserClient().from('orgs')
        .select('id, name, description, one_liner, website, country, founded_year, round_target_eur, revenue_eur, logo_url')
        .eq('id', profile.membership_id).maybeSingle();
      setOrg(data as unknown as Org);
    })();
  }, [profile?.membership_id, profile?.kind]);

  // Prompt 125 Block B — form-LEVEL prefill, not schema-level: the rejected
  // migration 0115 would have auto-synced orgs -> matchdeal_profiles
  // directly, which silently flips is_visible true the moment the profile
  // becomes complete (matchdeal_recompute_profile_completeness) — a
  // startup would become visible to investors with no act by the owner.
  // This only fills the LOCAL form state (never writes anything), and only
  // for fields that are still empty — the founder sees it, can edit it,
  // and their own explicit Save is what persists it and (if it completes
  // the profile) triggers visibility. Runs once per org load, not on every
  // keystroke — a guard ref stops it from re-firing and clobbering an
  // edit-in-progress if `org` merely re-renders.
  const prefillApplied = useRef(false);
  useEffect(() => {
    if (!profile || !org || profile.kind !== 'startup' || prefillApplied.current) return;
    prefillApplied.current = true;
    const { description, website, country } = computeProfilePrefill(profile, org);
    if (description !== profile.description || website !== profile.website || country !== profile.country) {
      setProfile((p) => (p ? { ...p, description, website, country } : p));
    }
  }, [profile, org]);

  useEffect(() => {
    if (!org?.logo_url) { setOrgLogoUrl(null); return; }
    browserClient().storage.from('data-room').createSignedUrl(org.logo_url, 3600)
      .then(({ data }) => setOrgLogoUrl(data?.signedUrl ?? null));
  }, [org?.logo_url]);

  if (!profile) {
    return <div className="flex flex-1 items-center justify-center"><p className="text-sm text-white/60">Loading your profile…</p></div>;
  }

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
  }

  // Bug fix (2026-08-06) — renamed from useSherlockDealLogo: a plain
  // function whose name starts with "use" reads as a hook to both React's
  // own conventions and the react-hooks/rules-of-hooks lint rule (which
  // would otherwise flag this as a second violation once the rule actually
  // runs — see the ESLint config note below). This applies a logo, it
  // isn't a hook.
  async function applySherlockDealLogo() {
    if (!org?.logo_url) return;
    setLogoBusy(true);
    try {
      const { data } = await browserClient().storage.from('data-room').createSignedUrl(org.logo_url, LOGO_SIGNED_URL_TTL_SECONDS);
      if (data?.signedUrl) set('photo_url', data.signedUrl);
    } finally {
      setLogoBusy(false);
    }
  }

  const required: { label: string; done: boolean }[] = viewerKind === 'startup'
    ? [
        { label: 'Photo', done: !!profile.photo_url },
        { label: 'Website', done: !!profile.website },
        { label: 'Sectors', done: profile.sectors.length > 0 },
        { label: 'Description', done: !!profile.description },
        { label: 'Country', done: !!profile.country },
        { label: 'Stage sought', done: !!profile.investment_stage_sought },
        { label: 'Company phase', done: !!profile.company_phase },
      ]
    : [
        { label: 'Representative name', done: !!profile.representative_name },
        { label: 'Entity name', done: !!profile.entity_name },
        { label: 'Stages invested', done: profile.stages_invested.length > 0 },
        { label: 'Geographies', done: profile.geographies.length > 0 },
        { label: 'Country', done: !!profile.country },
        { label: 'Website', done: !!profile.website },
      ];
  const doneCount = required.filter((r) => r.done).length;

  async function save() {
    if (!profile) return;
    setSaving(true);
    const { data, error } = await browserClient().from('matchdeal_profiles').update({
      entity_name: profile.entity_name, website: profile.website, country: profile.country, description: profile.description,
      photo_url: profile.photo_url, sectors: profile.sectors, investment_stage_sought: profile.investment_stage_sought,
      company_phase: profile.company_phase, target_round_amount: profile.target_round_amount, team_summary: profile.team_summary,
      representative_name: profile.representative_name, stages_invested: profile.stages_invested, geographies: profile.geographies,
      specific_criteria: profile.specific_criteria, ticket_min: profile.ticket_min, ticket_max: profile.ticket_max,
      tam_eur: profile.tam_eur, sam_eur: profile.sam_eur, som_eur: profile.som_eur,
      revenue_projection_12mo_eur: profile.revenue_projection_12mo_eur, revenue_projection_5yr_eur: profile.revenue_projection_5yr_eur,
    }).eq('id', profile.id).select('*').maybeSingle();
    setSaving(false);
    if (!error && data) { setProfile(data as unknown as Profile); setSavedAt(Date.now()); }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 pb-6">
      <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-3.5">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold text-white">{doneCount} of {required.length} complete</p>
          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
            profile.is_complete ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'
          }`}>
            {profile.is_complete ? 'Visible on DealDigger' : 'Not visible yet'}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {required.map((r) => (
            <span key={r.label} className={`rounded-full px-2 py-0.5 text-[10.5px] ${r.done ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-white/40'}`}>
              {r.done ? '✓ ' : '· '}{r.label}
            </span>
          ))}
        </div>
      </div>

      {viewerKind === 'startup' && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-white/50">From your Sherlock Deal profile</p>
            <a href="/settings?tab=company" className="text-[11px] font-semibold text-blue-300 hover:text-blue-200">Edit in settings →</a>
          </div>
          <div className="mt-2 flex items-start gap-3">
            {orgLogoUrl ? (
              <img src={orgLogoUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[11px] text-white/40">Logo</div>
            )}
            <div className="min-w-0">
              <p className="truncate text-[14px] font-bold text-white">{org?.name || '—'}</p>
              <p className="mt-0.5 line-clamp-2 text-[12px] text-white/50">{org?.description || 'No description yet'}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/5 py-2">
              <p className="text-[10px] uppercase text-white/40">Founded</p>
              <p className="text-[13px] font-semibold text-white">{org?.founded_year ?? '—'}</p>
            </div>
            <div className="rounded-xl bg-white/5 py-2">
              <p className="text-[10px] uppercase text-white/40">Round target</p>
              <p className="text-[13px] font-semibold text-white">{org?.round_target_eur ? `€${org.round_target_eur.toLocaleString()}` : '—'}</p>
            </div>
            <div className="rounded-xl bg-white/5 py-2">
              <p className="text-[10px] uppercase text-white/40">Revenue</p>
              <p className="text-[13px] font-semibold text-white">{org?.revenue_eur ? `€${org.revenue_eur.toLocaleString()}` : '—'}</p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {viewerKind === 'investor' && (
          <>
            <Field label="Representative name"><input className={inputCls} value={profile.representative_name ?? ''} onChange={(e) => set('representative_name', e.target.value)} /></Field>
            <Field label="Entity name"><input className={inputCls} value={profile.entity_name ?? ''} onChange={(e) => set('entity_name', e.target.value)} /></Field>
          </>
        )}
        {viewerKind === 'startup' && (
          <Field label="Photo URL">
            <div className="flex gap-2">
              <input className={inputCls} value={profile.photo_url ?? ''} onChange={(e) => set('photo_url', e.target.value)} placeholder="https://…" />
              {org?.logo_url && (
                <button type="button" onClick={() => void applySherlockDealLogo()} disabled={logoBusy}
                  className="shrink-0 whitespace-nowrap rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[12px] font-medium text-white/80 hover:bg-white/10 disabled:opacity-50">
                  {logoBusy ? 'Loading…' : 'Use your Sherlock Deal logo'}
                </button>
              )}
            </div>
          </Field>
        )}
        <Field label="Website"><input className={inputCls} value={profile.website ?? ''} onChange={(e) => set('website', e.target.value)} placeholder="https://…" /></Field>
        <Field label="Country"><input className={inputCls} value={profile.country ?? ''} onChange={(e) => set('country', e.target.value)} /></Field>
        <Field label="Description"><textarea rows={3} className={inputCls} value={profile.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>

        {viewerKind === 'startup' ? (
          <>
            <Field label="Sectors (comma-separated)">
              <input className={inputCls} value={profile.sectors.join(', ')} onChange={(e) => set('sectors', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
            </Field>
            <Field label="Stage sought">
              <select className={inputCls} value={profile.investment_stage_sought ?? ''} onChange={(e) => set('investment_stage_sought', e.target.value || null)}>
                <option value="">—</option>
                {STAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Company phase">
              <select className={inputCls} value={profile.company_phase ?? ''} onChange={(e) => set('company_phase', e.target.value || null)}>
                <option value="">—</option>
                {PHASE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Team summary"><textarea rows={2} className={inputCls} value={profile.team_summary ?? ''} onChange={(e) => set('team_summary', e.target.value)} /></Field>

            <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-white/50">Mini-pitch — market &amp; projections</p>
            <div className="grid grid-cols-3 gap-2">
              <Field label="TAM (€)"><input type="number" className={inputCls} value={profile.tam_eur ?? ''} onChange={(e) => set('tam_eur', e.target.value ? Number(e.target.value) : null)} /></Field>
              <Field label="SAM (€)"><input type="number" className={inputCls} value={profile.sam_eur ?? ''} onChange={(e) => set('sam_eur', e.target.value ? Number(e.target.value) : null)} /></Field>
              <Field label="SOM (€)"><input type="number" className={inputCls} value={profile.som_eur ?? ''} onChange={(e) => set('som_eur', e.target.value ? Number(e.target.value) : null)} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Revenue projection — 12mo (€)">
                <input type="number" className={inputCls} value={profile.revenue_projection_12mo_eur ?? ''} onChange={(e) => set('revenue_projection_12mo_eur', e.target.value ? Number(e.target.value) : null)} />
              </Field>
              <Field label="Revenue projection — 5yr (€)">
                <input type="number" className={inputCls} value={profile.revenue_projection_5yr_eur ?? ''} onChange={(e) => set('revenue_projection_5yr_eur', e.target.value ? Number(e.target.value) : null)} />
              </Field>
            </div>
          </>
        ) : (
          <>
            <Field label="Stages invested">
              <div className="flex flex-wrap gap-1.5">
                {STAGE_OPTIONS.map((o) => {
                  const checked = profile.stages_invested.includes(o.value);
                  return (
                    <button
                      key={o.value} type="button"
                      onClick={() => set('stages_invested', checked ? profile.stages_invested.filter((s) => s !== o.value) : [...profile.stages_invested, o.value])}
                      className={`rounded-full px-3 py-1.5 text-[12px] font-medium ${checked ? 'bg-emerald-500 text-white' : 'border border-white/15 text-white/60'}`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Geographies (comma-separated)">
              <input className={inputCls} value={profile.geographies.join(', ')} onChange={(e) => set('geographies', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
            </Field>
            <Field label="What you look for"><textarea rows={2} className={inputCls} value={profile.specific_criteria ?? ''} onChange={(e) => set('specific_criteria', e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ticket min (€)"><input type="number" className={inputCls} value={profile.ticket_min ?? ''} onChange={(e) => set('ticket_min', e.target.value ? Number(e.target.value) : null)} /></Field>
              <Field label="Ticket max (€)"><input type="number" className={inputCls} value={profile.ticket_max ?? ''} onChange={(e) => set('ticket_max', e.target.value ? Number(e.target.value) : null)} /></Field>
            </div>
          </>
        )}
      </div>

      <button
        type="button" onClick={() => void save()} disabled={saving}
        className="mt-5 w-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 py-3 text-[14px] font-bold text-white shadow-lg disabled:opacity-50"
      >
        {saving ? 'Saving…' : savedAt && Date.now() - savedAt < 2000 ? 'Saved ✓' : 'Save changes'}
      </button>
    </div>
  );
}
