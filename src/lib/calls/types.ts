// Prompt 905 — Calls, Stage 1: the vocabulary shared by the entity-side editor (905) and the applicant
// side (906). Pure types and constants, no I/O, importable from client and server alike
// (docs/calls/SPEC_CALLS_V2.md §5, §6, §8).

// Prompt 917 (I1): url, email and group are new. The first eight are the original kinds; a group is the only kind that holds other questions.

export const FIELD_KINDS = [
  'short_text', 'long_text', 'number', 'date', 'yes_no', 'single_choice', 'multiple_choice', 'file', 'url', 'email', 'group', 'table',
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
  table: 'Table',
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
  /** Table (Prompt 917, Adenda 2, B): the headers of its rows and columns, the type of the cells, what the applicant may add, what is required. */
  table?: TableConfig;
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

// --- Table (Prompt 917, Adenda 2, B) ----------------------------------------------------------------------------------------------------------
// A grid with HEADERS: the entity sets the criteria down the first column (the rows) and the things compared along the first row (the columns); the applicant fills in the cells and — if the entity
// allows — adds columns (one more competitor) or rows (one more criterion), and removes only what they added. Unlike a repeatable group (a list of entries that each answer the same questions: team
// members), every cell here is addressed by BOTH its row and its column, by stable ids — never by position, so removing a column never shifts the others.
export const TABLE_CELL_KINDS = ['short_text', 'long_text', 'number', 'percent', 'amount'] as const;
export type TableCellKind = (typeof TABLE_CELL_KINDS)[number];
export const TABLE_CELL_KIND_LABELS: Record<TableCellKind, string> = { short_text: 'Short text', long_text: 'Long text', number: 'Number', percent: 'Percentage (%)', amount: 'Amount (currency)' };
export const MAX_TABLE_ROWS = 50;
export const MAX_TABLE_COLUMNS = 20;
export const MAX_TABLE_HEADER = 200;
export const MAX_TABLE_CELL_SHORT = 500;
export const MAX_TABLE_CELL_LONG = 5000;
export interface TableHeader { id: string; label: string }
/** What the applicant may add: how many in all (the entity's own included) and what a new one is called until they rename it ("Competitor #" gives "Competitor #3"). */
export interface TableAddRule { allowed: boolean; max: number; defaultName: string }
/** Which cells must be filled: none, every cell of the entity's columns, or only the first of them (e.g. the applicant's own company). */
export type TableRequired = 'none' | 'all' | 'first_column';
export interface TableConfig {
  /** The text in the top-left corner ("Relevant criteria"). Optional. */
  cornerTitle: string;
  /** The entity's rows (the first column). A header with no text is shown as its number. */
  rows: TableHeader[];
  /** The entity's columns (the first row). */
  columns: TableHeader[];
  /** The type of every cell, unless a row says otherwise. */
  cellKind: TableCellKind;
  /** A row of its own type ("Market share (%)" is a percentage), by row id. */
  rowKinds: Record<string, TableCellKind>;
  addColumns: TableAddRule;
  addRows: TableAddRule;
  required: TableRequired;
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
  /** Prompt 918 (Adenda 1, C): the cover image and a logo uploaded for this call (paths in the private bucket), and when each was set. */
  coverPath?: string | null; coverUpdatedAt?: string | null; logoPath?: string | null; logoUpdatedAt?: string | null;
  /** Prompt 918 (Adenda 2, C): set while the call is deleted — it can be restored until `purgeAfter` (30 days), then it is removed for good. */
  deletedAt?: string | null; deletedBy?: string | null; purgeAfter?: string | null;
  /** Prompt 918 (I2): the version of the eligibility rules in force (a change after the call opens makes a new one) and the revision counter of the step. */
  eligibilityVersion?: number; eligibilityRev?: number;
  /** Prompt 922 (Etapa 3): the version of the evaluation grid in force and the step's revision counter; when evaluation was closed ("Close evaluation"). */
  evalGridVersion?: number; evalGridRev?: number; evaluationClosedAt?: string | null; evaluationClosedBy?: string | null;
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
/** A column or a row the APPLICANT added to a table: its own id, the name they gave it (they may rename it) and who added it. */
export interface TableExtra { id: string; name: string; addedBy: 'applicant' }
/** A table's answer: the columns and rows the applicant added, and the cells, `cells[rowId][columnId]`. The entity's own headers are never in the answer — they come from the configuration. */
export interface TableAnswer { columns: TableExtra[]; rows: TableExtra[]; cells: Record<string, Record<string, string>> }
export type AnswerValue = SimpleAnswer | GroupEntry[] | TableAnswer;
export type Answers = Record<string, AnswerValue>;
