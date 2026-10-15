'use client';
// Prompt 905 — ONE input per field type, as the applicant sees it. Used by the editor's preview now and by the
// applicant's form in Prompt 906, so the two can never drift: numbers accept digits only and show the formatted
// value underneath, files accept PDF only, Yes/No starts with no answer, conditions are handled by the parent.
import { formatNumberDisplay, sanitizeNumberInput } from '@/lib/calls/form-logic';
import { acceptAttr, fileFormatsOf, fileValues, formatsText, maxFileMbOf, maxFilesOf } from '@/lib/calls/field-config';
import { URL_HINT_LABELS, platformMappingLabel, type AnswerValue, type FormField, type SimpleAnswer, type SubField } from '@/lib/calls/types';
import { GroupInput } from './GroupInput';

const BASE = 'block w-full rounded-lg border px-3 py-2 text-sm disabled:bg-gray-50';

export function FieldInput({ field, value, error, currency, disabled, onChange, fileControl, fileControlFor, idSuffix, compact, showAllErrors }: {
  field: FormField; value: AnswerValue; error?: string; currency: string; disabled?: boolean; onChange: (v: AnswerValue) => void;
  /** Prompt 907: the applicant's own document control (upload / Vault), replacing the editor preview's plain file input. */
  fileControl?: React.ReactNode;
  /** Prompt 917: the same, for a File question INSIDE an entry of a repeatable group. */
  fileControlFor?: (sub: SubField, entryId: string, entryValue: SimpleAnswer) => React.ReactNode;
  /** A question repeats inside the entries of a group: its ids must not repeat with it. */
  idSuffix?: string;
  /** In a table cell: the control alone (its label is the column header). */
  compact?: boolean;
  /** Test mode / after a failed attempt: show every problem inside a group, not only what was typed wrong. */
  showAllErrors?: boolean;
}) {
  const border = error ? 'border-[#B00000]' : 'border-gray-300';
  const id = `f-${field.id}${idSuffix ? `-${idSuffix}` : ''}`;
  const aria = compact ? field.label : undefined;
  const text = typeof value === 'string' ? value : '';
  const mapped = platformMappingLabel(field.platformMapping);

  let control: React.ReactNode;
  switch (field.kind) {
    case 'short_text':
      control = <input id={id} aria-label={aria} autoComplete="off" className={`${BASE} ${border}`} value={text} disabled={disabled} maxLength={field.validations.maxLength} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'url':
      control = (
        <>
          <input id={id} aria-label={aria} type="url" inputMode="url" autoComplete="off" className={`${BASE} ${border}`} value={text} disabled={disabled} placeholder="https://" maxLength={2000} onChange={(e) => onChange(e.target.value)} />
          {field.validations.urlHint && !compact && <p className="mt-1 text-[11px] text-gray-400" data-testid="url-hint">A link to a {URL_HINT_LABELS[field.validations.urlHint].toLowerCase()}, starting with https://</p>}
        </>
      );
      break;
    case 'email':
      control = <input id={id} aria-label={aria} type="email" inputMode="email" autoComplete="off" className={`${BASE} ${border}`} value={text} disabled={disabled} maxLength={254} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'group':
      control = <GroupInput field={field} value={value} currency={currency} disabled={disabled} showAllErrors={showAllErrors} onChange={onChange} fileControlFor={fileControlFor} />;
      break;
    case 'long_text':
      control = (
        <>
          <textarea id={id} autoComplete="off" rows={4} className={`${BASE} ${border}`} value={text} disabled={disabled} maxLength={field.validations.maxLength} onChange={(e) => onChange(e.target.value)} />
          {(field.validations.maxLength || field.validations.maxWords) && (
            <p className="mt-1 text-[11px] text-gray-400">
              {field.validations.maxLength ? `${text.length} / ${field.validations.maxLength} characters` : ''}
              {field.validations.maxWords ? `${field.validations.maxLength ? ' · ' : ''}${text.trim() ? text.trim().split(/\s+/).length : 0} / ${field.validations.maxWords} words` : ''}
            </p>
          )}
        </>
      );
      break;
    case 'number':
      control = (
        <>
          <input id={id} aria-label={aria} inputMode="numeric" pattern="[0-9]*" autoComplete="off" className={`${BASE} ${border}`} value={text} disabled={disabled}
            placeholder="Digits only" onChange={(e) => onChange(sanitizeNumberInput(e.target.value))}
            // A minus sign, a comma, a dot or a letter never even reaches the field.
            onKeyDown={(e) => { if (e.key.length === 1 && !/\d/.test(e.key) && !e.ctrlKey && !e.metaKey) e.preventDefault(); }} />
          <p className="mt-1 min-h-[1rem] text-xs font-medium text-gray-600" data-testid="number-formatted" aria-live="polite">
            {formatNumberDisplay(text, field.validations.currency ? currency : null)}
          </p>
        </>
      );
      break;
    case 'date':
      control = <input id={id} aria-label={aria} type="date" autoComplete="off" className={`${BASE} ${border}`} value={text} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'yes_no':
      control = (
        <div className="flex gap-4" role="radiogroup" aria-labelledby={`${id}-label`}>
          {field.options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name={id} checked={value === o.id} disabled={disabled} onChange={() => onChange(o.id)} /> {o.label}
            </label>
          ))}
        </div>
      );
      break;
    case 'single_choice':
      control = (
        <div className="space-y-1.5" role="radiogroup" aria-labelledby={`${id}-label`}>
          {field.options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name={id} checked={value === o.id} disabled={disabled} onChange={() => onChange(o.id)} /> {o.label || <i className="text-gray-400">(empty option)</i>}
            </label>
          ))}
        </div>
      );
      break;
    case 'multiple_choice': {
      const chosen = Array.isArray(value) ? (value as unknown[]).filter((x): x is string => typeof x === 'string') : [];
      control = (
        <div className="space-y-1.5">
          {field.options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={chosen.includes(o.id)} disabled={disabled}
                onChange={(e) => onChange(e.target.checked ? [...chosen, o.id] : chosen.filter((x) => x !== o.id))} /> {o.label || <i className="text-gray-400">(empty option)</i>}
            </label>
          ))}
        </div>
      );
      break;
    }
    case 'file': {
      const formats = fileFormatsOf(field.validations);
      const maxFiles = maxFilesOf(field.validations);
      const chosen = fileValues(value);
      control = fileControl ?? (
        <div>
          <input id={id} aria-label={aria} type="file" multiple={maxFiles > 1} accept={acceptAttr(formats)} disabled={disabled} data-testid="file-input"
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[#E8F4F8] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[#0E7490]"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []).map((f) => ({ fileName: f.name, size: f.size, mime: f.type || undefined }));
              // The reference is kept even when it is not an accepted format or too many, so validation can say why — nothing is uploaded here.
              onChange(maxFiles > 1 ? (picked.length ? picked : null) : picked[0] ?? null);
            }} />
          <p className="mt-1 text-[11px] text-gray-400">
            {formatsText(formats)} only, up to {maxFileMbOf(field.validations)} MB{maxFiles > 1 ? ` each · up to ${maxFiles} files` : ''}
            {field.maxAgeMonths ? ` · issued within the last ${field.maxAgeMonths} month${field.maxAgeMonths === 1 ? '' : 's'}` : ''}
            {field.expectedType ? ` · ${field.expectedType}` : ''}
          </p>
          {chosen.length > 0 && <p className="mt-1 text-xs text-gray-600">Selected: {chosen.map((f) => f.fileName).join(', ')}</p>}
        </div>
      );
      break;
    }
  }

  if (compact) {
    return (
      <div data-testid="field" data-field-id={field.id}>
        {control}
        {error && <p role="alert" className="mt-1 text-xs text-[#B00000]" data-testid="field-error">{error}</p>}
      </div>
    );
  }
  return (
    <div data-testid="field" data-field-id={field.id}>
      <p id={`${id}-label`} className="text-sm font-medium text-gray-900">
        {field.label}{field.required && <span className="ml-0.5 text-[#B00000]" aria-label="required">*</span>}
      </p>
      {field.instruction && <p className="mt-0.5 text-xs text-gray-500">{field.instruction}</p>}
      {mapped && !disabled && <p className="mt-0.5 text-[11px] text-[#0E7490]">🔗 Prefilled from your profile ({mapped}) — you can edit it</p>}
      <div className="mt-1.5">{control}</div>
      {error && <p role="alert" className="mt-1 text-xs text-[#B00000]" data-testid="field-error">{error}</p>}
    </div>
  );
}
