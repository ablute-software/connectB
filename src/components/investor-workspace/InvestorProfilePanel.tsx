'use client';
// Investor Workspace shell (prompt 57), Zona 2 — About tab body. Two
// states: not linked to a real catalog entity yet (search + confirm, reuses
// the domain-match verdict from /api/portal/investor-profile/link), or
// linked (editable thesis form + completeness bar, same field set as
// migration 0056 added to matchdeal_profiles).
import { useEffect, useState } from 'react';
import { ColleaguesCard } from './ColleaguesCard';

interface Profile {
  sectors: string[]; geographies: string[]; stages_invested: string[]; instruments: string[];
  instrument_other: string | null; ticket_min: number | null; ticket_max: number | null;
  lead_or_colead: string | null; country: string | null;
  investments_per_year: number | null; capital_to_deploy_eur: number | null;
  usual_co_investors: string | null; exclusions_sectors: string[]; exclusions_notes: string | null;
  specific_criteria: string | null;
}
interface ProfileResponse {
  linked: boolean; entityName?: string | null; profile?: Profile; completeness?: number; sectorOptions?: string[];
  identityStatus?: 'verified' | 'pending_verification' | 'self_declared_individual';
}

const IDENTITY_BADGE: Record<string, { label: string; className: string }> = {
  verified: { label: 'Verified fund', className: 'bg-green-50 text-green-700' },
  pending_verification: { label: 'Pending verification', className: 'bg-amber-50 text-amber-700' },
  self_declared_individual: { label: 'Individual investor', className: 'bg-gray-100 text-gray-600' },
};

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
const INSTRUMENT_LABELS: Record<string, string> = { equity: 'Equity', safe: 'SAFE', convertible_note: 'Convertible note', venture_debt: 'Venture debt', grant: 'Grant / subsidy', revenue_based: 'Revenue-based' };

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
        We'll add it to our catalog as pending — you can keep going with your profile right away, and we'll verify it shortly.
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
      // longer blocks linking (link/route.ts always succeeds now); this
      // branch only ever fires for a genuine failure (network, entity
      // deleted, etc.), never "couldn't verify your domain."
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
        We verify this against your sign-in email's domain when we can. If it doesn't match automatically, you can still continue — we'll mark it pending and check manually.
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
        <button onClick={() => setShowBaFlow(true)} className="text-gray-400 hover:underline">I'm investing as an individual, not a firm</button>
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
        We couldn't automatically verify your firm. To activate full access, please upload a document showing your
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

export function InvestorProfilePanel({ onCompletenessChange, onEntityNameChange }: { onCompletenessChange?: (pct: number) => void; onEntityNameChange?: (name: string | null) => void }) {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    fetch('/api/portal/investor-profile').then((r) => r.json()).then((d: ProfileResponse) => {
      setData(d);
      if (d.profile) setDraft(d.profile);
      if (d.completeness != null) onCompletenessChange?.(d.completeness);
      onEntityNameChange?.(d.linked ? d.entityName ?? null : null);
    });
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await fetch('/api/portal/investor-profile', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft),
      });
      load();
    } finally { setSaving(false); }
  }

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  if (!data.linked) return <LinkEntityFlow onLinked={load} />;
  if (!draft) return <p className="text-sm text-gray-400">Loading…</p>;

  const sectorOptions = data.sectorOptions ?? [];

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">About {data.entityName}</h2>
            {data.identityStatus && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${IDENTITY_BADGE[data.identityStatus].className}`}>
                {IDENTITY_BADGE[data.identityStatus].label}
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

      <ColleaguesCard />

      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Ticket range (EUR)</label>
          <div className="flex gap-2">
            <input type="number" placeholder="Min" value={draft.ticket_min ?? ''} onChange={(e) => setDraft({ ...draft, ticket_min: e.target.value ? Number(e.target.value) : null })}
              className="w-32 rounded border border-gray-300 px-2 py-1 text-sm" />
            <input type="number" placeholder="Max" value={draft.ticket_max ?? ''} onChange={(e) => setDraft({ ...draft, ticket_max: e.target.value ? Number(e.target.value) : null })}
              className="w-32 rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Sectors invested in</label>
          <MultiSelect options={sectorOptions} selected={draft.sectors ?? []} onChange={(v) => setDraft({ ...draft, sectors: v })} />
        </div>

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

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Entity HQ
            <input value={draft.country ?? ''} onChange={(e) => setDraft({ ...draft, country: e.target.value })} placeholder="e.g. Portugal" className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Capital to deploy / yr (EUR, optional)
            <input type="number" value={draft.capital_to_deploy_eur ?? ''} onChange={(e) => setDraft({ ...draft, capital_to_deploy_eur: e.target.value ? Number(e.target.value) : null })} className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
          </label>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Investment geographies</label>
          <input value={(draft.geographies ?? []).join(', ')} onChange={(e) => setDraft({ ...draft, geographies: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            placeholder="e.g. Portugal, Spain, Europe" className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Stages</label>
          <MultiSelect options={STAGES.map((s) => STAGE_LABELS[s])} selected={(draft.stages_invested ?? []).map((s) => STAGE_LABELS[s] ?? s)}
            onChange={(labels) => setDraft({ ...draft, stages_invested: STAGES.filter((s) => labels.includes(STAGE_LABELS[s])) })} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Preferred instruments</label>
          <MultiSelect options={INSTRUMENTS.map((i) => INSTRUMENT_LABELS[i])} selected={(draft.instruments ?? []).map((i) => INSTRUMENT_LABELS[i] ?? i)}
            onChange={(labels) => setDraft({ ...draft, instruments: INSTRUMENTS.filter((i) => labels.includes(INSTRUMENT_LABELS[i])) })} />
        </div>

        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Usual co-investors (optional)
          <input value={draft.usual_co_investors ?? ''} onChange={(e) => setDraft({ ...draft, usual_co_investors: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
        </label>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">Exclusions — we never invest in</label>
          <MultiSelect options={sectorOptions} selected={draft.exclusions_sectors ?? []} onChange={(v) => setDraft({ ...draft, exclusions_sectors: v })} />
          <input value={draft.exclusions_notes ?? ''} onChange={(e) => setDraft({ ...draft, exclusions_notes: e.target.value })} placeholder="Anything else to exclude (free text)"
            className="mt-1.5 w-full rounded border border-gray-300 px-2 py-1 text-sm" />
        </div>

        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Thesis notes
          <textarea value={draft.specific_criteria ?? ''} onChange={(e) => setDraft({ ...draft, specific_criteria: e.target.value })} rows={3} className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-900" />
        </label>

        <button onClick={save} disabled={saving} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
