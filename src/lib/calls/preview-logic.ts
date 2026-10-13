// Prompt 909 (I5) — the pure logic behind the two ways of looking at a form in the editor:
//   · PREVIEW = only to see. Every page and every question is reachable, nothing is required or validated; what the
//     applicant will be asked is written under each field (required, "Digits only", "PDF only, max 10 MB"), and a
//     question with a display condition says when it is shown. A switch applies the conditions.
//   · TEST = exactly as the applicant will fill it: required enforced, conditions live, validations, "Next" blocked
//     while something is missing, and a final check at the end listing what is missing. Answers live in the browser
//     only and are never sent anywhere.
// Pure and client-safe, so the rules are tested without a browser.
import { visibleFields, visiblePages, validateAnswers, validatePage } from './form-logic';
import { orderFields } from './form-logic';
import {
  DEFAULT_MAX_FILE_MB, MAX_FILE_MB_CEILING, MAX_NUMBER_DIGITS, platformMappingLabel,
  type Answers, type FormField,
} from './types';

// --- What is written under a field ------------------------------------------------------------------------------------

/** The rules of a field in plain words, as the applicant will meet them. Empty = nothing to say beyond the label. */
export function validationHints(field: FormField): string[] {
  const out: string[] = [];
  if (field.required) out.push('Required');
  switch (field.kind) {
    case 'short_text':
    case 'long_text':
      if (field.validations.maxLength) out.push(`Up to ${field.validations.maxLength} characters`);
      if (field.validations.maxWords) out.push(`Up to ${field.validations.maxWords} words`);
      break;
    case 'number':
      out.push(`Digits only (up to ${MAX_NUMBER_DIGITS})`);
      if (field.validations.currency) out.push('Shown with the call’s currency');
      break;
    case 'date': out.push('A real date'); break;
    case 'yes_no': out.push('Yes or No'); break;
    case 'single_choice': out.push('Choose one'); break;
    case 'multiple_choice': out.push('Choose one or more'); break;
    case 'file': {
      const mb = Math.min(field.validations.maxFileMb ?? DEFAULT_MAX_FILE_MB, MAX_FILE_MB_CEILING);
      out.push(`PDF only, max ${mb} MB`);
      if (field.expectedType) out.push(`Expected: ${field.expectedType}`);
      if (field.maxAgeMonths) out.push(`Issued within the last ${field.maxAgeMonths} month${field.maxAgeMonths === 1 ? '' : 's'}`);
      break;
    }
  }
  const mapped = platformMappingLabel(field.platformMapping);
  if (mapped) out.push(`Pre-filled from the applicant’s ${mapped.toLowerCase()}`);
  return out;
}

/** "Shown when “Is the company incorporated?” = Yes" for a question with a display condition; null otherwise. */
export function conditionNote(field: FormField, all: FormField[]): string | null {
  const c = field.condition;
  if (!c) return null;
  const controller = all.find((f) => f.id === c.fieldId);
  if (!controller) return 'Shown when a deleted question is answered';
  const q = `“${controller.label}”`;
  const value = controller.options.find((o) => o.id === c.value)?.label ?? c.value ?? '…';
  switch (c.operator) {
    case 'equals': return `Shown when ${q} = ${value}`;
    case 'not_equals': return `Shown when ${q} ≠ ${value}`;
    case 'is_answered': return `Shown when ${q} is answered`;
    case 'is_empty': return `Shown when ${q} is not answered`;
  }
}

// --- Pages --------------------------------------------------------------------------------------------------------------

/**
 * The pages the PREVIEW shows. By default ALL of them, every question, conditional ones included. With the switch on
 * ("Show as an applicant would see it") only what the answers so far make visible.
 */
export function previewPages(fields: FormField[], applicantView: boolean, answers: Answers): { page: number; fields: FormField[] }[] {
  if (applicantView) return visiblePages(fields, answers);
  const out: { page: number; fields: FormField[] }[] = [];
  for (const f of orderFields(fields)) {
    const last = out[out.length - 1];
    if (last && last.page === f.page) last.fields.push(f); else out.push({ page: f.page, fields: [f] });
  }
  return out;
}

// --- Test mode -------------------------------------------------------------------------------------------------------------

export interface FinalIssue { fieldId: string; label: string; page: number; pageNumber: number; message: string }

/** The final check: everything still missing or wrong in the questions that are shown, in the order of the form. */
export function finalCheck(fields: FormField[], answers: Answers): FinalIssue[] {
  const errors = validateAnswers(fields, answers);
  const pages = visiblePages(fields, answers).map((p) => p.page);
  return visibleFields(fields, answers).filter((f) => errors[f.id]).map((f) => ({
    fieldId: f.id, label: f.label, page: f.page, pageNumber: pages.indexOf(f.page) + 1, message: errors[f.id],
  }));
}

export type TestStep =
  | { kind: 'blocked'; errors: Record<string, string> }
  | { kind: 'next'; index: number }
  | { kind: 'final'; issues: FinalIssue[] };

/**
 * What "Next" does in test mode, from the page the person is on: blocked while anything on this page is missing; to the
 * next page otherwise; and on the last page, the final check (which may still list things, e.g. after going back).
 */
export function testStep(fields: FormField[], answers: Answers, pageIndex: number): TestStep {
  const pages = visiblePages(fields, answers);
  const index = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const current = pages[index];
  const errors = current ? validatePage(fields, answers, current.page) : {};
  if (Object.keys(errors).length > 0) return { kind: 'blocked', errors };
  if (index < pages.length - 1) return { kind: 'next', index: index + 1 };
  return { kind: 'final', issues: finalCheck(fields, answers) };
}

export const TEST_BANNER = 'Test mode — nothing is saved or submitted';
