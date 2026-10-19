'use client';
// Prompt 905 — Calls editor, tab "General" (spec §5.1): name, description, who promotes it, opening and closing
// with an EXPLICIT time zone, listing, the application limit, language and currency. Everything autosaves; the
// opening/closing are typed as wall-clock time in the chosen zone and stored as the instant they mean.
import { useMemo } from 'react';
import { RichTextEditor } from '@/components/RichTextEditor';
import { CallMediaFields } from './CallMediaFields';
import type { CallState } from './api';
import { CONTENT_LANGUAGES, CURRENCIES, type Call } from '@/lib/calls/types';
import { timeZoneOptions, utcToWall, wallToUtcIso } from '@/lib/calls/tz';

const FIELD = 'block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500';
const LABEL = 'block text-xs font-semibold text-gray-700';
const HINT = 'mt-1 text-[11px] text-gray-400';

export type GeneralPatch = Partial<Pick<Call, 'name' | 'description' | 'opensAt' | 'closesAt' | 'timezone' | 'visibility' | 'limitUnit' | 'allowMultiple' | 'contentLanguage' | 'currency'>>;

export function GeneralTab({ call, promoterName, disabled, presentationDisabled, branding, onState, onChange }: {
  call: Call; promoterName: string; disabled: boolean; onChange: (patch: GeneralPatch) => void;
  /** The description, cover image and logo may change in more states than the rest (after validation, even once open): false while the person can edit them. Defaults to `disabled`. */
  presentationDisabled?: boolean;
  branding?: CallState['branding'];
  onState?: (s: CallState) => void;
}) {
  const presentationLocked = presentationDisabled ?? disabled;
  const zones = useMemo(() => timeZoneOptions(), []);

  // The wall-clock time shown in the chosen zone. Changing the zone keeps what was TYPED (the wall time) and
  // re-reads it in the new zone — the preview line under each field says which instant that is.
  const opensWall = utcToWall(call.opensAt, call.timezone);
  const closesWall = utcToWall(call.closesAt, call.timezone);

  function setWall(key: 'opensAt' | 'closesAt', wall: string) {
    if (!wall) { onChange({ [key]: null }); return; }
    const iso = wallToUtcIso(wall, call.timezone);
    if (iso) onChange({ [key]: iso });
  }
  function setZone(tz: string) {
    onChange({
      timezone: tz,
      opensAt: opensWall ? wallToUtcIso(opensWall, tz) ?? call.opensAt : call.opensAt,
      closesAt: closesWall ? wallToUtcIso(closesWall, tz) ?? call.closesAt : call.closesAt,
    });
  }
  const utcLine = (iso: string | null) => (iso ? `= ${utcToWall(iso, 'UTC').replace('T', ' ')} UTC` : '');
  const order = call.opensAt && call.closesAt && Date.parse(call.closesAt) <= Date.parse(call.opensAt);

  return (
    <div className="max-w-2xl space-y-5" data-testid="general-tab">
      <div>
        <label className={LABEL} htmlFor="call-name">Name</label>
        <input id="call-name" data-jump="name" autoComplete="off" className={FIELD} value={call.name} disabled={disabled} maxLength={200}
          onChange={(e) => onChange({ name: e.target.value })} />
      </div>
      <div>
        <span className={LABEL} id="call-description-label">Description</span>
        <div className="mt-1"><RichTextEditor id="call-description" labelledBy="call-description-label" value={call.description ?? ''} disabled={presentationLocked}
          placeholder="What is this call for, and who should apply?" onChange={(html) => onChange({ description: html || null })} /></div>
        <p className={HINT}>Bold, lists, headings, links and a few colours. Applicants see it on the first page of the call.</p>
      </div>
      {onState && <CallMediaFields callId={call.id} branding={branding} disabled={presentationLocked} onState={onState} />}
      <div>
        <span className={LABEL}>Promoting organisation</span>
        <p className="mt-1 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{promoterName}</p>
      </div>

      <fieldset className="rounded-lg border border-gray-200 p-4">
        <legend className="px-1 text-xs font-semibold text-gray-700">Opening and closing</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="call-opens">Applications open</label>
            <input id="call-opens" data-jump="opens" type="datetime-local" autoComplete="off" className={FIELD} value={opensWall} disabled={disabled}
              onChange={(e) => setWall('opensAt', e.target.value)} />
            <p className={HINT}>{utcLine(call.opensAt)}</p>
          </div>
          <div>
            <label className={LABEL} htmlFor="call-closes">Applications close</label>
            <input id="call-closes" data-jump="closes" type="datetime-local" autoComplete="off" className={FIELD} value={closesWall} disabled={disabled}
              onChange={(e) => setWall('closesAt', e.target.value)} />
            <p className={HINT}>{utcLine(call.closesAt)}</p>
          </div>
        </div>
        <div className="mt-4">
          <label className={LABEL} htmlFor="call-tz">Time zone</label>
          <select id="call-tz" className={FIELD} value={call.timezone} disabled={disabled} onChange={(e) => setZone(e.target.value)}>
            {!zones.includes(call.timezone) && <option value={call.timezone}>{call.timezone}</option>}
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
          <p className={HINT}>The times above are read in this zone. Candidates see the zone spelled out next to every date.</p>
        </div>
        {order && <p role="alert" className="mt-3 text-xs text-[#B00000]">The call must close after it opens.</p>}
      </fieldset>

      <fieldset className="rounded-lg border border-gray-200 p-4">
        <legend className="px-1 text-xs font-semibold text-gray-700">Who can see it</legend>
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="radio" name="visibility" checked={call.visibility === 'listed'} disabled={disabled} onChange={() => onChange({ visibility: 'listed' })} className="mt-1" />
            <span><b>Listed</b> — appears in the Open calls of every startup.<span className={`${HINT} block`}>The default.</span></span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="visibility" checked={call.visibility === 'unlisted'} disabled={disabled} onChange={() => onChange({ visibility: 'unlisted' })} className="mt-1" />
            <span><b>Closed</b> — reachable only through its link.</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-gray-200 p-4" data-testid="applications-limit">
        <legend className="px-1 text-xs font-semibold text-gray-700">Applications</legend>
        <p className="text-sm font-medium text-gray-800" id="count-by-label">Count applications by</p>
        <div role="radiogroup" aria-labelledby="count-by-label" className="mt-1 space-y-1 text-sm">
          <label className="flex min-h-[44px] items-center gap-2 sm:min-h-0">
            <input type="radio" name="limit-unit" checked={call.limitUnit === 'project'} disabled={disabled} onChange={() => onChange({ limitUnit: 'project' })} />
            <span>Project / startup</span>
          </label>
          <label className="flex min-h-[44px] items-center gap-2 sm:min-h-0">
            <input type="radio" name="limit-unit" checked={call.limitUnit === 'legal_entity'} disabled={disabled} onChange={() => onChange({ limitUnit: 'legal_entity' })} />
            <span>Legal entity (company)</span>
          </label>
        </div>
        <p className="mt-4 text-sm font-medium text-gray-800" id="can-submit-label">Each one can submit</p>
        <div role="radiogroup" aria-labelledby="can-submit-label" className="mt-1 space-y-1 text-sm">
          <label className="flex min-h-[44px] items-center gap-2 sm:min-h-0">
            <input type="radio" name="allow-multiple" checked={!call.allowMultiple} disabled={disabled} onChange={() => onChange({ allowMultiple: false })} />
            <span>Only one application</span>
          </label>
          <label className="flex min-h-[44px] items-center gap-2 sm:min-h-0">
            <input type="radio" name="allow-multiple" checked={call.allowMultiple} disabled={disabled} onChange={() => onChange({ allowMultiple: true })} />
            <span>More than one application</span>
          </label>
        </div>
        <p className={HINT}>With more than one, each application keeps its own form, documents, status, evaluations and result. Projects without an incorporated company can apply: no company data is required unless you ask for it.</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="call-lang">Language of the call</label>
          <select id="call-lang" className={FIELD} value={call.contentLanguage} disabled={disabled} onChange={(e) => onChange({ contentLanguage: e.target.value })}>
            {CONTENT_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <p className={HINT}>The language you write the questions in. The platform interface stays in English.</p>
        </div>
        <div>
          <label className={LABEL} htmlFor="call-currency">Currency</label>
          <select id="call-currency" className={FIELD} value={call.currency} disabled={disabled} onChange={(e) => onChange({ currency: e.target.value })}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <p className={HINT}>Used by amount fields.</p>
        </div>
      </div>
    </div>
  );
}
