// Prompt 905 — Calls, Stage 1: the vocabulary shared by the entity-side editor (905) and the applicant
// side (906). Pure types and constants, no I/O, importable from client and server alike
// (docs/calls/SPEC_CALLS_V2.md §5, §6, §8).

// Prompt 917 (I1): url, email and group are new. The first eight are the original kinds; a group is the only kind that holds other questions.

export const FIELD_KINDS = [
  'short_text', 'long_text', 'number', 'date', 'yes_no', 'single_choice', 'multiple_choice', 'file', 'url', 'email', 'group',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];
/** What the import may propose (Prompt 917, I2): every kind, the new ones included — each with its own rules in the prompt and in the sanitiser. */
export const AI_FIELD_KINDS = FIELD_KINDS;
/** The kinds a question INSIDE a group may be: everything except another group (one level only in v1). */
export const SIMPLE_KINDS = [
  'short_text', 'long_text', 'number', 'date', 'yes_no', 'single_choice', 'multiple_choice', 'file', 'url', 'email',
] as const;
export type SimpleKind = (typeof SIMPLE_KINDS)[number];

export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  number: 'Number',
  date: 'Date',
  yes_no: 'Yes/No',
  single_choice: 'Single choice',
  multiple_choice: 'Multiple choice',
  file: 'File',
  url: 'Link (URL)',
  email: 'Email',
  group: 'Repeatable group',
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

/** What a File question accepts. The entity chooses; the platform checks the real format of the bytes, never the extension alone. ZIP is never accepted. */
export const FILE_FORMAT_KEYS = ['pdf', 'word', 'excel', 'powerpoint', 'image'] as const;
export type FileFormatKey = (typeof FILE_FORMAT_KEYS)[number];
export const MAX_FILES_CEILING = 10;
/** A hint for the applicant about what link is expected; not a restriction. */
export const URL_HINTS = ['video', 'website', 'other'] as const;
export type UrlHint = (typeof URL_HINTS)[number];
export const URL_HINT_LABELS: Record<UrlHint, string> = { video: 'Video (YouTube, Vimeo…)', website: 'Website', other: 'Other' };

export interface FieldValidations {
  /** Long/short text: character limit. */
  maxLength?: number;
  /** Long text: word limit. */
  maxWords?: number;
  /** File: size limit in MB (PDF only). */
  maxFileMb?: number;
  /** Number: show the value with the call's currency under the input (e.g. "500 000 €"). */
  currency?: boolean;
  /** File: the formats accepted (default PDF only). */
  fileFormats?: FileFormatKey[];
  /** File: how many files the question takes, 1 to 10 (default 1; more than one shows "Add another file"). */
  maxFiles?: number;
  /** Link: what kind of link is expected (a hint). */
  urlHint?: UrlHint;
  /** Group: the repeatable entries and the questions in each. */
  group?: GroupConfig;
}

/** A question inside a group. Its id is a UUID (a file in a group is registered under it). No conditions inside groups in v1. */
export interface SubField {
  id: string;
  kind: SimpleKind;
  label: string;
  required: boolean;
  options: FieldOption[];
  validations: Omit<FieldValidations, 'group'>;
}
export type GroupDisplay = 'cards' | 'table';
export const MAX_GROUP_ENTRIES = 50;
export const MAX_GROUP_SUBFIELDS = 20;
export interface GroupConfig {
  /** What one entry is called: "Team member", "Competitor". */
  entryLabel: string;
  min: number;
  max: number;
  /** Table: the sub-questions are the columns and the entries the rows (on a narrow screen, cards). */
  display: GroupDisplay;
  subFields: SubField[];
  /** Table with the rows set by the entity: for each row, the text of its first columns (read-only for the applicant). Empty = the applicant adds the rows. */
  presetRows: string[][];
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
  validated: 'Validated · not published',
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
  /** Prompt 909: set when the call is archived (status 'archived'). */
  archivedAt: string | null;
  /** Prompt 907 (I5): "Contact email for applicants" — when set, the Reply-To of the emails of THIS call. */
  contactEmail?: string | null;
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

/** An answer, by field id. Text, link, email: string; number: digits; date: YYYY-MM-DD; yes/no: 'yes'|'no'; single: option id;
 *  multiple: option ids; file: one {fileName,size,…} (several when the question takes several: a list); group: a list of entries. */
export interface FileValue { fileName: string; size: number; mime?: string; fileId?: string; source?: 'upload' | 'vault' }
/** What a question inside a group holds (no group in a group). */
export type SimpleAnswer = string | string[] | FileValue | FileValue[] | null | undefined;
export interface GroupEntry { id: string; values: Record<string, SimpleAnswer> }
export type AnswerValue = SimpleAnswer | GroupEntry[];
export type Answers = Record<string, AnswerValue>;
