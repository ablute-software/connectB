'use client';
// Prompt 97 §5 — own profile, edit + completeness. "Sem mais decisões
// pendentes, podem construir." Required-field lists below match
// matchdeal_recompute_profile_completeness() exactly (confirmed live) —
// photo_url gates startup completeness but not investor, per that trigger.
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase';

interface Profile {
  id: string; kind: 'startup' | 'investor'; is_complete: boolean;
  entity_name: string | null; website: string | null; country: string | null; description: string | null;
  photo_url: string | null; sectors: string[]; investment_stage_sought: string | null; company_phase: string | null;
  target_round_amount: number | null; team_summary: string | null;
  representative_name: string | null; stages_invested: string[]; geographies: string[];
  specific_criteria: string | null; ticket_min: number | null; ticket_max: number | null;
}

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
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await browserClient().from('matchdeal_profiles').select('*').eq('id', viewerProfileId).maybeSingle();
      setProfile(data as unknown as Profile);
    })();
  }, [viewerProfileId]);

  if (!profile) {
    return <div className="flex flex-1 items-center justify-center"><p className="text-sm text-white/60">Loading your profile…</p></div>;
  }

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
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

      <div className="mt-4 space-y-3">
        {viewerKind === 'investor' && (
          <Field label="Representative name"><input className={inputCls} value={profile.representative_name ?? ''} onChange={(e) => set('representative_name', e.target.value)} /></Field>
        )}
        <Field label="Entity name"><input className={inputCls} value={profile.entity_name ?? ''} onChange={(e) => set('entity_name', e.target.value)} /></Field>
        {viewerKind === 'startup' && (
          <Field label="Photo URL"><input className={inputCls} value={profile.photo_url ?? ''} onChange={(e) => set('photo_url', e.target.value)} placeholder="https://…" /></Field>
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
            <Field label="Target round amount (€)">
              <input type="number" className={inputCls} value={profile.target_round_amount ?? ''} onChange={(e) => set('target_round_amount', e.target.value ? Number(e.target.value) : null)} />
            </Field>
            <Field label="Team summary"><textarea rows={2} className={inputCls} value={profile.team_summary ?? ''} onChange={(e) => set('team_summary', e.target.value)} /></Field>
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
