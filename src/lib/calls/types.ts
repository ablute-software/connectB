// Prompt 905 — Calls, Stage 1: the vocabulary shared by the entity-side editor (905) and the applicant
// side (906). Pure types and constants, no I/O, importable from client and server alike
// (docs/calls/SPEC_CALLS_V2.md §5, §6, §8).

export const FIELD_KINDS = [
  'short_text', 'long_text', 'number', 'date', 'yes_no', 'single_choice', 'multiple_choice', 'file',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  number: 'Number',
  date: 'Date',
  yes_no: 'Yes/No',
  single_choice: 'Single choice',
  multiple_choice: 'Multiple choice',
  file: 'File (PDF)',
};

export const CHOICE_KINDS: readonly FieldKind[] = ['single_choice', 'multiple_choice'];
export const TEXT_KINDS: readonly FieldKind[] = ['short_text', 'long_text'];
export const isChoiceKind = (k: FieldKind) => CHOICE_KINDS.includes(k);

/** The platform data a field may be explicitly linked to (§6.4). Never inferred, always chosen. */
export const PLATFORM_MAPPINGS = [
  { key: 'company_name', label: 'Startup name' },
  { key: 'country', label: 'Country' },
  { key: 'person_name', label: "Applicant's name" },
  { key: 'person_role', label: "Applicant's role" },
  { key: 'sector', label: 'Sector' },
  { key: 'stage', label: 'Stage' },
  { key: 'website', label: 'Website' },
] as const;
export type PlatformMappingKey = (typeof PLATFORM_MAPPINGS)[number]['key'];
export const PLATFORM_MAPPING_KEYS: readonly string[] = PLATFORM_MAPPINGS.map((m) => m.key);
export const platformMappingLabel = (key: string | null | undefined): string | null =>
  PLATFORM_MAPPINGS.find((m) => m.key === key)?.label ?? null;
/** A mapped field holds text: the platform datum is a string. */
export const MAPPABLE_KINDS: readonly FieldKind[] = ['short_text', 'long_text', 'single_choice'];

export interface FieldOption { id: string; label: string }

export type ConditionOperator = 'equals' | 'not_equals' | 'is_answered' | 'is_empty';
export const CONDITION_OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: 'is', not_equals: 'is not', is_answered: 'is answered', is_empty: 'is empty',
};

/** Show this field only if the (earlier) field `fieldId` matches. `value` is an option id ('yes'/'no' for Yes/No). */
export interface FieldCondition { fieldId: string; operator: ConditionOperator; value?: string | null }

export interface FieldValidations {
  /** Long/short text: character limit. */
  maxLength?: number;
  /** Long text: word limit. */
  maxWords?: number;
  /** File: size limit in MB (PDF only). */
  maxFileMb?: number;
  /** Number: show the value with the call's currency under the input (e.g. "500 000 €"). */
  currency?: boolean;
}

export interface FormField {
  /** Stable. Eligibility, filters, distribution and quotas refer to this, never to the label or position. */
  id: string;
  page: number;
  position: number;
  kind: FieldKind;
  /** The question, or the document's name for a File. */
  label: string;
  instruction: string | null;
  required: boolean;
  options: FieldOption[];
  validations: FieldValidations;
  condition: FieldCondition | null;
  platformMapping: PlatformMappingKey | null;
  /** File only: free text for now (§6.6). */
  expectedType: string | null;
  /** File only: how old the document may be, in months. */
  maxAgeMonths: number | null;
}

export const DEFAULT_MAX_FILE_MB = 10;
export const MAX_FILE_MB_CEILING = 50;
export const MAX_NUMBER_DIGITS = 15;
export const YES_NO_OPTIONS: FieldOption[] = [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }];

export const CALL_STATUSES = [
  'draft', 'validated', 'scheduled', 'open', 'closed', 'evaluating', 'results_published', 'archived',
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  draft: 'Draft',
  validated: 'Confirmed',
  scheduled: 'Scheduled',
  open: 'Open',
  closed: 'Closed',
  evaluating: 'In evaluation',
  results_published: 'Results published',
  archived: 'Archived',
};

export type PromoterKind = 'catalog_entity' | 'incubator';
export type CallVisibility = 'listed' | 'unlisted';
export type LimitUnit = 'project' | 'legal_entity';

export interface Call {
  id: string;
  promoterKind: PromoterKind;
  promoterId: string;
  name: string;
  description: string | null;
  opensAt: string | null;
  closesAt: string | null;
  timezone: string;
  visibility: CallVisibility;
  limitUnit: LimitUnit;
  allowMultiple: boolean;
  contentLanguage: string;
  currency: string;
  status: CallStatus;
  linkToken: string | null;
  configVersion: number;
  validatedAt: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  duplicatedFrom: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CallPhase { id: string; position: number; name: string; startsOn: string | null; endsOn: string | null }

export const CONTENT_LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'pt', label: 'Português' }, { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' }, { code: 'de', label: 'Deutsch' }, { code: 'it', label: 'Italiano' },
] as const;
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'BRL'] as const;

/** An answer, by field id. Text: string; number: digits; date: YYYY-MM-DD; yes/no: 'yes'|'no'; single: option id;
 *  multiple: option ids; file: {fileName,size} (the upload itself belongs to Stage 906). */
export type AnswerValue = string | string[] | { fileName: string; size: number; mime?: string } | null | undefined;
export type Answers = Record<string, AnswerValue>;
