'use client';
// Investor Workspace shell (prompt 57), Zona 2 — About tab body. Two
// states: not linked to a real catalog entity yet (search + confirm, reuses
// the domain-match verdict from /api/portal/investor-profile/link), or
// linked (editable thesis form + completeness bar, same field set as
// migration 0056 added to matchdeal_profiles).
import { Suspense, useEffect, useState } from 'react';
import { ColleaguesCard } from './ColleaguesCard';
import { IDENTITY_BADGE_CLASS, IDENTITY_BADGE_LABEL, type IdentityStatus } from '@/lib/investor-identity';
import { VouchingCard } from './VouchingCard';
import { TagInput } from './TagInput';
import { TicketAmountSlider } from '../TicketAmountSlider';
import { VisibilityToggle } from '../VisibilityToggle';
import { INSTRUMENT_LABELS } from '@/lib/investor-taxonomy';
import { SectorPicker } from '@/components/company/SectorPicker';
import { Tabs, type TabItem } from '@/components/ui';
import { useTabParam } from '@/lib/use-tab';
import { ImportTab } from './about-tabs/ImportTab';
import { AutomationsTab } from './about-tabs/AutomationsTab';
import { AppAccessTab } from './about-tabs/AppAccessTab';
import { PhotosMediaTab } from './about-tabs/PhotosMediaTab';
import { MatchDealHistoryTab } from './about-tabs/MatchDealHistoryTab';

interface Profile {
  sectors: string[]; geographies: string[]; stages_invested: string[]; instruments: string[];
  instrument_other: string | null; ticket_min: number | null; ticket_max: number | null;
  lead_or_colead: string | null; country: string | null;
  investments_per_year: number | null; capital_to_deploy_eur: number | null;
  usual_co_investors: string | null; exclusions_sectors: string[]; exclusions_notes: string | null;
  specific_criteria: string | null; focus_keywords: string[];
  // Prompt 110 Block D — five founder-first-call questions (migration 0107).
  accepts_cold_contact: boolean | null; typical_decision_weeks: number | null;
  decision_process: string | null; does_follow_on: boolean | null; takes_board_seat: string | null;
  // Prompt 421 §F — the firm logo, a pre-existing matchdeal_profiles column
  // (migration 0053) this route only just started exposing to the
  // investor's own edit form (Photos & media tab).
  photo_url: string | null;
}

// Prompt 80 addenda — the closed list Nuno actually asked for: categories a
// firm typically excludes by POLICY (moral/legal), not by market
// preference, which is why this is a separate constant from
// SECTOR_TAXONOMY/sectorOptions rather than reusing "Sectors invested in"'s
// list. "human ethics" (his own wording) is decomposed into concrete,
// selectable items per his follow-up instruction.
//
// Deliberately CLOSED, no free-text escape hatch (resolved 2026-07-31,
// mini_prompt_resolucao_lista_11_exclusions): "opção de livre escrita" in
// his follow-up described focus_keywords below, not this field — a legal/
// ethical exclusion list stays curated, an investor can't type in an
// arbitrary 12th item. An earlier version of this component wired a
// TagInput onto this picker too; that was a misreading of the same chat
// line and has been removed.
const EXCLUSION_PRESETS = [
  'Adult content / pornography', 'Defense & weapons', 'Gambling', 'Tobacco', 'Alcohol',
  'Predatory lending / payday loans', 'Fossil fuels extraction', 'Animal testing (non-medical)',
  'Child labor', 'Discrimination', 'Mass surveillance',
];

function ExclusionsPicker({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
  function toggle(preset: string) {
    const k = preset.toLowerCase();
    const has = selected.some((s) => s.toLowerCase() === k);
    onChange(has ? selected.filter((s) => s.toLowerCase() !== k) : [...selected, preset]);
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {EXCLUSION_PRESETS.map((p) => {
        const active = selected.some((s) => s.toLowerCase() === p.toLowerCase());
        return (
          <button key={p} type="button" onClick={() => toggle(p)}
            className={`rounded-full border px-2.5 py-1 text-xs ${active ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490] font-medium' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {p}
          </button>
        );
      })}
    </div>
  );
}
// Exported so InvestorWorkspaceShell can fetch this same endpoint itself
// (see that file's own header comment for why) without duplicating or
// drifting from this shape.
export interface ProfileResponse {
  linked: boolean; entityName?: string | null; profile?: Profile; completeness?: number; sectorOptions?: string[];
  identityStatus?: IdentityStatus;
  // Prompt 156 — migration 0156.
  pipelineConfirmedAt?: string | null;
  // Prompt 421 §D.2 — migration 0267.
  notifyNewEligibleStartup?: boolean;
}

// Bloco 4 placeholder legal text — EXACT strings from the prompt, never a
// "finalized" version. See self-declare/route.ts's own header: do not edit
// this copy without an explicit instruction, and never call it production-
// ready without a lawyer's review.
const BA_ACK_TEXT = 'I confirm I am acting as an individual investor and not as a regulated entity. [Placeholder — legal copy pending review].';
// This one's exact wording (no bracket) is the prompt's own example text,
// not a compliance record like BA_ACK_TEXT above — the UI adds a separate
// "placeholder" caption around it rather than folding a marker into the
// sentence itself.
const BA_WARNING_TEXT = 'As an individual investor, some platform features may be limited compared to verified funds.';

const STAGES = ['pre_seed', 'seed', 'series_a', 'series_b_plus', 'growth'];
const STAGE_LABELS: Record<string, string> = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth' };
const INSTRUMENTS = ['equity', 'safe', 'convertible_note', 'venture_debt', 'grant', 'revenue_based'];

// Prompt 144 §4 — the redesign's own grouping headers. Every one of the
// form's ~17 existing fields lands in exactly one section below; nothing
// removed, nothing added, just given a home. "Team & Contact" doesn't map
// onto a literal contact-person field (none exists in this editable
// Profile — representative_name/linkedin are read-only, set via entity
// linking, not part of this form) — Cold contact fits there instead, since
// it IS a contact preference. This mapping is my own judgment call, not
// dictated field-by-field by the prompt; flagged in the delivery report.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-100 pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function MultiSelect({ options, selected, onChange }: { options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o])}
          className={`rounded-full border px-2.5 py-1 text-xs ${selected.includes(o) ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490] font-medium' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

// Identity verification Fase A (prompt 63), Bloco 1 — "My firm isn't
// listed." A small inline form rather than a separate screen, so it stays
// one click away from the search box it's an alternative to.
function AddFirmForm({ onLinked, onCancel }: { onLinked: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!name.trim()) { setErr('Firm name is required.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/portal/investor-profile/add-firm', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), website: website.trim() || undefined }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not add firm.'); return; }
      onLinked();
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
      <p className="text-xs text-gray-500">
        We&apos;ll add it to our catalog as pending — you can keep going with your profile right away, and we&apos;ll verify it shortly.
      </p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Firm name"
        className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website (optional)"
        className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      {err && <p className="mt-1.5 text-xs text-[#B00000]">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button onClick={submit} disabled={busy} className="rounded-lg bg-[#0E7490] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {busy ? 'Adding…' : 'Add my firm'}
        </button>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:underline">Cancel</button>
      </div>
    </div>
  );
}

// Bloco 4 — Business Angel without a company. Checkbox text and popup
// warning are BOTH placeholders — see the constants above and this
// component's own comment: never treat this copy as final.
function BusinessAngelFlow({ onLinked, onCancel }: { onLinked: () => void; onCancel: () => void }) {
  const [isIndividual, setIsIndividual] = useState(false);
  const [acked, setAcked] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function toggleAck(checked: boolean) {
    setAcked(checked);
    if (checked) setShowWarning(true);
  }

  async function submit() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/portal/investor-profile/self-declare', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ackText: BA_ACK_TEXT }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not save.'); return; }
      onLinked();
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={isIndividual} onChange={(e) => setIsIndividual(e.target.checked)} className="mt-0.5" />
        <span>I am investing as an individual (Business Angel), not through a company</span>
      </label>
      {isIndividual && (
        <label className="mt-2 flex items-start gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={acked} onChange={(e) => toggleAck(e.target.checked)} className="mt-0.5" />
          <span>{BA_ACK_TEXT}</span>
        </label>
      )}
      {showWarning && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p>{BA_WARNING_TEXT}</p>
          <p className="mt-1 text-[10px] text-amber-600">(Placeholder text — pending legal review.)</p>
          <div className="mt-2 flex gap-2">
            <button onClick={submit} disabled={busy} className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
              {busy ? 'Saving…' : 'Continue as individual investor'}
            </button>
            <button onClick={() => { setShowWarning(false); setAcked(false); }} className="text-xs text-gray-500 hover:underline">Back</button>
          </div>
        </div>
      )}
      {err && <p className="mt-1.5 text-xs text-[#B00000]">{err}</p>}
      {!isIndividual && <button onClick={onCancel} className="mt-2 block text-xs text-gray-400 hover:underline">Cancel</button>}
    </div>
  );
}

function LinkEntityFlow({ onLinked }: { onLinked: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: string; name: string; website: string | null }[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [showAddFirm, setShowAddFirm] = useState(false);
  const [showBaFlow, setShowBaFlow] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/portal/catalog-search?q=${encodeURIComponent(q.trim())}`).then((r) => r.json())
        .then((d) => setResults(d.results ?? [])).finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function link(id: string) {
    setLinking(id); setErr('');
    try {
      const res = await fetch('/api/portal/investor-profile/link', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ catalog_entity_id: id }),
      });
      const body = await res.json();
      // Identity verification Fase A (prompt 63) — a domain mismatch no
      // longer blocks linking, never "couldn't verify your domain."
      // Prompt 497 — it CAN now fail on the firm's seat limit (409):
      // body.error already carries the full "you're on <plan>, which
      // includes N seats" explanation, so it renders as-is here; the
      // structured body.seatLimit is there for a richer treatment later
      // (an upgrade CTA) without re-parsing the sentence.
      if (!body.ok) { setErr(body.error ?? 'Could not link.'); return; }
      onLinked();
    } finally { setLinking(null); }
  }

  if (showAddFirm) return <AddFirmForm onLinked={onLinked} onCancel={() => setShowAddFirm(false)} />;
  if (showBaFlow) return <BusinessAngelFlow onLinked={onLinked} onCancel={() => setShowBaFlow(false)} />;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-gray-900">Which firm are you with?</h2>
      <p className="mt-1 text-xs text-gray-400">
        We verify this against your sign-in email&apos;s domain when we can. If it doesn&apos;t match automatically, you can still continue — we&apos;ll mark it pending and check manually.
      </p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by firm name…"
        className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      {searching && <p className="mt-2 text-xs text-gray-400">Searching…</p>}
      {results.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {results.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
              <div><span className="font-medium text-gray-900">{r.name}</span>{r.website && <span className="ml-2 text-xs text-gray-400">{r.website}</span>}</div>
              <button onClick={() => link(r.id)} disabled={linking === r.id}
                className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                {linking === r.id ? 'Checking…' : 'This is us'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}

      <div className="mt-4 flex flex-wrap gap-3 border-t border-gray-100 pt-3 text-xs">
        <button onClick={() => setShowAddFirm(true)} className="text-[#0E7490] hover:underline">None of these — add my firm</button>
        <button onClick={() => setShowBaFlow(true)} className="text-gray-400 hover:underline">I&apos;m investing as an individual, not a firm</button>
      </div>
    </div>
  );
}

// Identity verification Fase A (prompt 63), Bloco 3 — "we couldn't
// automatically verify your firm." Shown whenever identity_status is
// pending_verification, regardless of how the investor got there (a
// domain-mismatched search pick, or a self-added new firm).
function VerificationUploadCard() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  async function upload() {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/portal/investor-profile/upload-document', { method: 'POST', body: form });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not upload.'); return; }
      setDone(true);
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-sm font-semibold text-gray-900">Strengthen your verification</h2>
      <p className="mt-1 text-xs text-gray-600">
        We couldn&apos;t automatically verify your firm. To activate full access, please upload a document showing your
        registered activity (certificate of incorporation, business registry extract, or local equivalent).
      </p>
      {done ? (
        <p className="mt-2 text-xs font-medium text-green-700">Uploaded — pending review.</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs" />
          <button onClick={upload} disabled={!file || busy} className="rounded-lg bg-[#0E7490] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
            {busy ? 'Uploading…' : 'Upload document'}
          </button>
        </div>
      )}
      {err && <p className="mt-1.5 text-xs text-[#B00000]">{err}</p>}
    </div>
  );
}

// Prompt 421 §A.1 — Company · Import · Automations · App access ·
// Photos & media · MatchDeal, same useTabParam(?tab=) pattern settings/
// page.tsx already uses — never local-only state, so a tab is linkable and
// survives refresh/back-forward. No "Roadmap": that tab is about a
// startup's own product timeline, which doesn't apply to an investor.
const ABOUT_TABS: TabItem[] = [
  { key: 'company', label: 'Company' },
  { key: 'import', label: 'Import' },
  { key: 'automations', label: 'Automations' },
  { key: 'access', label: 'App access' },
  { key: 'photos', label: 'Photos & media' },
  { key: 'matchdeal', label: 'MatchDeal' },
];

function InvestorProfilePanelInner({ onCompletenessChange, onEntityNameChange, onIdentityStatusChange }: {
  onCompletenessChange?: (pct: number) => void; onEntityNameChange?: (name: string | null) => void;
  onIdentityStatusChange?: (status: IdentityStatus | null) => void;
}) {
  const [tab, setTab] = useTabParam('company');
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  // Prompt 121 §2.2 — save() used to ignore the server's response entirely:
  // no ok:false check, no error surfaced, and the unconditional load() that
  // followed silently re-fetched over whatever the user had just typed
  // whenever the POST had actually failed (403/500/validation). saveError
  // shows the failure; saveState drives a brief "Saved" confirmation,
  // cleared on the next save attempt (not on every keystroke — that would
  // require threading a "dirty" flag through every one of this form's ~20
  // field setters for no real benefit).
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved'>('idle');

  function load() {
    fetch('/api/portal/investor-profile').then((r) => r.json()).then((d: ProfileResponse) => {
      setData(d);
      if (d.profile) setDraft(d.profile);
      if (d.completeness != null) onCompletenessChange?.(d.completeness);
      onEntityNameChange?.(d.linked ? d.entityName ?? null : null);
      onIdentityStatusChange?.(d.linked ? d.identityStatus ?? null : null);
    });
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!draft) return;
    setSaving(true); setSaveError(null); setSaveState('idle');
    try {
      const res = await fetch('/api/portal/investor-profile', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        setSaveError(body.error ?? 'Something went wrong — please try again.');
        return;
      }
      // Use what the server actually wrote, rather than firing a second GET
      // that could itself race a concurrent edit.
      if (body.profile) {
        setDraft(body.profile as Profile);
        setData((d) => (d ? { ...d, profile: body.profile, completeness: body.completeness ?? d.completeness } : d));
        if (body.completeness != null) onCompletenessChange?.(body.completeness);
      }
      setSaveState('saved');
    } catch {
      setSaveError('Network error — please try again.');
    } finally { setSaving(false); }
  }

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  if (!data.linked) return <LinkEntityFlow onLinked={load} />;
  if (!draft) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="max-w-2xl space-y-4">
      <VisibilityToggle kind="investor" />
      <div data-tour-id="investor-about-completeness" className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">About {data.entityName}</h2>
            {data.identityStatus && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${IDENTITY_BADGE_CLASS[data.identityStatus]}`}>
                {IDENTITY_BADGE_LABEL[data.identityStatus]}
              </span>
            )}
          </div>
          <span className="text-xs font-medium text-gray-500">{data.completeness}% complete</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-gray-100">
          <div className="h-1.5 rounded-full bg-[#0E7490] transition-all" style={{ width: `${data.completeness}%` }} />
        </div>
      </div>

      {data.identityStatus === 'pending_verification' && <VerificationUploadCard />}
      {data.identityStatus && data.identityStatus !== 'verified' && <VouchingCard />}

      <Tabs items={ABOUT_TABS} active={tab} onChange={setTab} />

      {tab === 'company' && <CompanyTab draft={draft} setDraft={setDraft} save={save} saving={saving} saveState={saveState} saveError={saveError} />}
      {tab === 'import' && <ImportTab />}
      {tab === 'automations' && <AutomationsTab initialNotifyNewEligibleStartup={data.notifyNewEligibleStartup ?? false} />}
      {tab === 'access' && <AppAccessTab />}
      {tab === 'photos' && <PhotosMediaTab draft={draft} setDraft={setDraft} save={save} saving={saving} saveState={saveState} saveError={saveError} />}
      {tab === 'matchdeal' && <MatchDealHistoryTab />}
    </div>
  );
}

// Prompt 421 §B — pure migration: every Section below is unchanged content/
// logic, just given a home. Extracted to its own component (rather than
// inlined in the tab switch above) only so the parent's return stays
// readable — no new state, no new props beyond what the form already needed.
function CompanyTab({ draft, setDraft, save, saving, saveState, saveError }: {
  draft: Profile; setDraft: (p: Profile) => void; save: () => void; saving: boolean;
  saveState: 'idle' | 'saved'; saveError: string | null;
}) {
  return (
    <div>
      <div data-tour-id="investor-about-form" className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
        <Section title="General Information">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Entity HQ
            <input value={draft.country ?? ''} onChange={(e) => setDraft({ ...draft, country: e.target.value })} placeholder="e.g. Portugal" className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Round role</label>
            <div className="flex gap-3 text-sm">
              {(['lead', 'co_lead', 'both'] as const).map((v) => (
                <label key={v} className="flex items-center gap-1.5">
                  <input type="radio" checked={draft.lead_or_colead === v} onChange={() => setDraft({ ...draft, lead_or_colead: v })} />
                  {v === 'lead' ? 'Leads' : v === 'co_lead' ? 'Follows' : 'Both'}
                </label>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Investment Strategy">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Thesis notes
            <textarea value={draft.specific_criteria ?? ''} onChange={(e) => setDraft({ ...draft, specific_criteria: e.target.value })} rows={3} className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
          </label>
        </Section>

        <Section title="Ticket & Budget">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Ticket range (EUR)</label>
            <div className="grid grid-cols-2 gap-4">
              <TicketAmountSlider label="Min" value={draft.ticket_min}
                onChange={(v) => setDraft({ ...draft, ticket_min: draft.ticket_max != null && v > draft.ticket_max ? draft.ticket_max : v })} />
              <TicketAmountSlider label="Max" value={draft.ticket_max}
                onChange={(v) => setDraft({ ...draft, ticket_max: draft.ticket_min != null && v < draft.ticket_min ? draft.ticket_min : v })} />
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Yearly investment budget (EUR, optional)
            <input type="number" value={draft.capital_to_deploy_eur ?? ''} onChange={(e) => setDraft({ ...draft, capital_to_deploy_eur: e.target.value ? Number(e.target.value) : null })} className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
          </label>
        </Section>

        <Section title="Geography">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Investment geographies</label>
            <input value={(draft.geographies ?? []).join(', ')} onChange={(e) => setDraft({ ...draft, geographies: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="e.g. Portugal, Spain, Europe" className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
        </Section>

        <Section title="Sectors & Stages">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Sectors invested in</label>
            {/* Prompt 176 §A.2 — same grouped picker the startup side uses
                (SectorPicker.tsx, sector-taxonomy.ts), not the old flat
                MultiSelect + 22-value investor-only taxonomy. No per-firm
                cap (max=Infinity — a mandate can legitimately span most of
                the taxonomy) and no "Other" free-text (allowOther=false —
                this profile has no sibling column to hold it); `other` is
                always null here and never written back. */}
            <SectorPicker value={{ sectors: draft.sectors ?? [], other: null }}
              onChange={(v) => setDraft({ ...draft, sectors: v.sectors })}
              max={Infinity} allowOther={false} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Stages</label>
            <MultiSelect options={STAGES.map((s) => STAGE_LABELS[s])} selected={(draft.stages_invested ?? []).map((s) => STAGE_LABELS[s] ?? s)}
              onChange={(labels) => setDraft({ ...draft, stages_invested: STAGES.filter((s) => labels.includes(STAGE_LABELS[s])) })} />
          </div>
        </Section>

        {/* Prompt 110 Block D — the "first call" questions the deck's Block
            A cheque slide now surfaces. All five optional, all null by
            default (migration 0107 is purely additive). */}
        <Section title="Current Mandate">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Preferred instruments</label>
            <MultiSelect options={INSTRUMENTS.map((i) => INSTRUMENT_LABELS[i])} selected={(draft.instruments ?? []).map((i) => INSTRUMENT_LABELS[i] ?? i)}
              onChange={(labels) => setDraft({ ...draft, instruments: INSTRUMENTS.filter((i) => labels.includes(INSTRUMENT_LABELS[i])) })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              Typical decision time (weeks, optional)
              <input type="number" min={0} value={draft.typical_decision_weeks ?? ''} onChange={(e) => setDraft({ ...draft, typical_decision_weeks: e.target.value ? Number(e.target.value) : null })} className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-gray-500">
              Who decides (optional)
              <input value={draft.decision_process ?? ''} onChange={(e) => setDraft({ ...draft, decision_process: e.target.value })} placeholder="e.g. Full partnership vote" className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
            </label>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Follow-on</label>
            <div className="flex gap-3 text-sm">
              {([[true, 'Reserves for follow-on'], [false, 'First cheque only']] as const).map(([v, label]) => (
                <label key={String(v)} className="flex items-center gap-1.5">
                  <input type="radio" checked={draft.does_follow_on === v} onChange={() => setDraft({ ...draft, does_follow_on: v })} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Board seat</label>
            <div className="flex gap-3 text-sm">
              {(['always', 'sometimes', 'never'] as const).map((v) => (
                <label key={v} className="flex items-center gap-1.5">
                  <input type="radio" checked={draft.takes_board_seat === v} onChange={() => setDraft({ ...draft, takes_board_seat: v })} />
                  {v === 'always' ? 'Always' : v === 'sometimes' ? 'Sometimes' : 'Never'}
                </label>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Usual co-investors (optional)
            <input value={draft.usual_co_investors ?? ''} onChange={(e) => setDraft({ ...draft, usual_co_investors: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
          </label>
        </Section>

        <Section title="Exclusions">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Exclusions — we never invest in</label>
            <ExclusionsPicker selected={draft.exclusions_sectors ?? []} onChange={(v) => setDraft({ ...draft, exclusions_sectors: v })} />
            <input value={draft.exclusions_notes ?? ''} onChange={(e) => setDraft({ ...draft, exclusions_notes: e.target.value })} placeholder="Anything else to exclude (free text)"
              className="mt-1.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
        </Section>

        <Section title="Team & Contact">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Cold contact</label>
            <div className="flex gap-3 text-sm">
              {([[true, 'Open to cold approaches'], [false, 'Warm intros only']] as const).map(([v, label]) => (
                <label key={String(v)} className="flex items-center gap-1.5">
                  <input type="radio" checked={draft.accepts_cold_contact === v} onChange={() => setDraft({ ...draft, accepts_cold_contact: v })} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Additional Information">
          {/* Prompt 80 addenda — deliberately NOT read by the match-score
              function or any scoring path (see matchdeal-match-score.ts /
              investor-pipeline.ts, both untouched by this field). Wiring
              these keywords into matching is its own future decision, not
              an implicit side effect of adding this input. */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Focus keywords (optional)</label>
            <TagInput tags={draft.focus_keywords ?? []} onChange={(v) => setDraft({ ...draft, focus_keywords: v })}
              placeholder="e.g. health, agriculture, fintech B2B…" />
          </div>
        </Section>

        <div className="flex items-center gap-2 border-t border-gray-100 pt-4">
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

// Prompt 421 §A.1 — useTabParam (inside InvestorProfilePanelInner) calls
// next/navigation's useSearchParams, which Next.js requires a Suspense
// boundary above during static rendering — settings/page.tsx's own
// SettingsPage/SettingsInner split is the exact same shape, applied here
// instead of touching InvestorWorkspaceShell.tsx (which never needed to
// know this component now reads a URL param).
export function InvestorProfilePanel(props: {
  onCompletenessChange?: (pct: number) => void; onEntityNameChange?: (name: string | null) => void;
  onIdentityStatusChange?: (status: IdentityStatus | null) => void;
}) {
  return <Suspense fallback={null}><InvestorProfilePanelInner {...props} /></Suspense>;
}
