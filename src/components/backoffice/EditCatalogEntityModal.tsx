'use client';
// Prompt 584 §C — direct dossier editor: there was no way for an admin to
// edit an already-published catalog_entities row at all before this (the
// merge tool only fills empty fields, catalog_candidate_edited only
// touches a pre-promotion pipeline row, catalog_update has been used once
// ever, only for verification_status). Talks to the purpose-built
// GET/PATCH at /api/backoffice/catalog/entities/[id] — that route diffs
// before/after itself and refuses to write when the profile is claimed,
// so this component stays a thin form, not a second copy of that logic.
//
// Portal-to-body + fixed inset, same reasoning as AccountActionPanel
// (see its own header comment): an ancestor with backdrop-filter/
// transform silently becomes the containing block for a fixed
// descendant. A fresh component rather than reusing AccountActionPanel
// directly — that one's body is shape-locked for a single-reason
// destructive confirm (cascade lines + one textarea), not an arbitrary
// multi-field form.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const STAGE_OPTIONS = ['', 'pre_seed', 'seed', 'series_a', 'later', 'other'] as const;

type Fields = {
  name: string; website: string; thesis: string; sectors: string[];
  stage_min: string; stage_max: string; check_min_eur: number | null; check_max_eur: number | null;
  hq_city: string; hq_country: string; geographies: string[];
  email: string; phone: string; address: string; postal_code: string;
  key_people: string; general_partner_emails: string; aum: string;
  current_funds: string; latest_fund: string; last_investment_found: string; notes: string;
};

const EMPTY_FIELDS: Fields = {
  name: '', website: '', thesis: '', sectors: [], stage_min: '', stage_max: '',
  check_min_eur: null, check_max_eur: null, hq_city: '', hq_country: '', geographies: [],
  email: '', phone: '', address: '', postal_code: '', key_people: '', general_partner_emails: '',
  aum: '', current_funds: '', latest_fund: '', last_investment_found: '', notes: '',
};

function toFields(raw: Record<string, unknown>): Fields {
  const str = (k: keyof Fields) => (raw[k] as string | null) ?? '';
  const arr = (k: keyof Fields) => (raw[k] as string[] | null) ?? [];
  return {
    name: str('name'), website: str('website'), thesis: str('thesis'), sectors: arr('sectors'),
    stage_min: str('stage_min'), stage_max: str('stage_max'),
    check_min_eur: (raw.check_min_eur as number | null) ?? null, check_max_eur: (raw.check_max_eur as number | null) ?? null,
    hq_city: str('hq_city'), hq_country: str('hq_country'), geographies: arr('geographies'),
    email: str('email'), phone: str('phone'), address: str('address'), postal_code: str('postal_code'),
    key_people: str('key_people'), general_partner_emails: str('general_partner_emails'),
    aum: str('aum'), current_funds: str('current_funds'), latest_fund: str('latest_fund'),
    last_investment_found: str('last_investment_found'), notes: str('notes'),
  };
}

function splitList(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

const inputCls = 'w-full rounded border border-gray-300 px-2 py-1 text-xs';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      {children}
    </label>
  );
}

export function EditCatalogEntityModal({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [claimed, setClaimed] = useState(false);
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/backoffice/catalog/entities/${id}`).then((r) => r.json()).then((body) => {
      if (cancelled) return;
      if (body.ok === false) { setError(body.error); setLoading(false); return; }
      setFields(toFields(body.fields));
      setClaimed(!!body.claimed);
      setLoading(false);
    }).catch(() => { if (!cancelled) { setError('Failed to load.'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id]);

  function set<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  async function save() {
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/backoffice/catalog/entities/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...fields, stage_min: fields.stage_min || null, stage_max: fields.stage_max || null }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? 'Could not save.');
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-lg flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-800">Edit dossier</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : claimed ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              This profile has been claimed by its owner — direct editing is disabled.
            </p>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                <Field label="Name"><input value={fields.name} onChange={(e) => set('name', e.target.value)} className={inputCls} autoComplete="off" /></Field>
                <Field label="Website"><input value={fields.website} onChange={(e) => set('website', e.target.value)} className={inputCls} autoComplete="off" /></Field>
                <Field label="Thesis"><textarea value={fields.thesis} onChange={(e) => set('thesis', e.target.value)} className={inputCls} rows={3} /></Field>
                <Field label="Sectors (comma-separated)"><input value={fields.sectors.join(', ')} onChange={(e) => set('sectors', splitList(e.target.value))} className={inputCls} autoComplete="off" /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Stage min">
                    <select value={fields.stage_min} onChange={(e) => set('stage_min', e.target.value)} className={inputCls}>
                      {STAGE_OPTIONS.map((s) => <option key={s} value={s}>{s || '—'}</option>)}
                    </select>
                  </Field>
                  <Field label="Stage max">
                    <select value={fields.stage_max} onChange={(e) => set('stage_max', e.target.value)} className={inputCls}>
                      {STAGE_OPTIONS.map((s) => <option key={s} value={s}>{s || '—'}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Check min (EUR)">
                    <input type="number" value={fields.check_min_eur ?? ''} onChange={(e) => set('check_min_eur', e.target.value === '' ? null : Number(e.target.value))} className={inputCls} autoComplete="off" />
                  </Field>
                  <Field label="Check max (EUR)">
                    <input type="number" value={fields.check_max_eur ?? ''} onChange={(e) => set('check_max_eur', e.target.value === '' ? null : Number(e.target.value))} className={inputCls} autoComplete="off" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="HQ city"><input value={fields.hq_city} onChange={(e) => set('hq_city', e.target.value)} className={inputCls} autoComplete="off" /></Field>
                  <Field label="HQ country"><input value={fields.hq_country} onChange={(e) => set('hq_country', e.target.value)} className={inputCls} autoComplete="off" /></Field>
                </div>
                <Field label="Geographies (comma-separated)"><input value={fields.geographies.join(', ')} onChange={(e) => set('geographies', splitList(e.target.value))} className={inputCls} autoComplete="off" /></Field>
              </div>

              <div className="space-y-2 border-t border-gray-100 pt-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Email"><input value={fields.email} onChange={(e) => set('email', e.target.value)} className={inputCls} autoComplete="off" /></Field>
                  <Field label="Phone"><input value={fields.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} autoComplete="off" /></Field>
                </div>
                <Field label="Address"><input value={fields.address} onChange={(e) => set('address', e.target.value)} className={inputCls} autoComplete="off" /></Field>
                <Field label="Postal code"><input value={fields.postal_code} onChange={(e) => set('postal_code', e.target.value)} className={inputCls} autoComplete="off" /></Field>
                <Field label="Key people"><textarea value={fields.key_people} onChange={(e) => set('key_people', e.target.value)} className={inputCls} rows={2} /></Field>
                <Field label="General partner emails"><textarea value={fields.general_partner_emails} onChange={(e) => set('general_partner_emails', e.target.value)} className={inputCls} rows={2} /></Field>
              </div>

              <div className="space-y-2 border-t border-gray-100 pt-3">
                <Field label="AUM"><input value={fields.aum} onChange={(e) => set('aum', e.target.value)} className={inputCls} autoComplete="off" /></Field>
                <Field label="Current funds"><input value={fields.current_funds} onChange={(e) => set('current_funds', e.target.value)} className={inputCls} autoComplete="off" /></Field>
                <Field label="Latest fund"><input value={fields.latest_fund} onChange={(e) => set('latest_fund', e.target.value)} className={inputCls} autoComplete="off" /></Field>
                <Field label="Last investment found"><input value={fields.last_investment_found} onChange={(e) => set('last_investment_found', e.target.value)} className={inputCls} autoComplete="off" /></Field>
              </div>

              <div className="border-t border-gray-100 pt-3">
                <Field label="Notes"><textarea value={fields.notes} onChange={(e) => set('notes', e.target.value)} className={inputCls} rows={3} /></Field>
              </div>

              {error && <p className="text-xs text-[#B00000]">{error}</p>}
            </div>
          )}
        </div>
        {!loading && !claimed && (
          <div className="flex justify-end gap-2 border-t border-gray-100 px-4 py-3">
            <button onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs">Cancel</button>
            <button disabled={saving} onClick={() => void save()} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
