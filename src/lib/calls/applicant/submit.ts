// Prompt 907 (I3) — the final check of a submission (spec §14.2), as a pure function the server runs on what it STORED (never on what the
// browser says it has): the shown questions only, required ones answered, every document registered, every value valid. A required question
// hidden by its condition never blocks. The result is either the list of what is missing — each with the name of the question and the page it
// is on, counted among the pages the applicant sees — or exactly what will be stored: the answers (hidden ones pruned: what the applicant
// could not see is never submitted) and the files those answers stand for.
import { finalCheck, type FinalIssue } from '../preview-logic';
import { pruneHiddenAnswers } from '../form-logic';
import { fileIdsInAnswers } from '../field-config';
import type { Answers, Call, FormField } from '../types';
import type { FileRef } from './answers';

export interface SubmissionPlan {
  answers: Answers;
  /** The files that belong to the submitted version (only those of questions that are shown and answered). */
  files: FileRef[];
}

export type FinalResult = { ok: true; plan: SubmissionPlan } | { ok: false; failures: FinalIssue[] };

export function planSubmission(fields: FormField[], stored: Answers, files: FileRef[]): FinalResult {
  const answers = pruneHiddenAnswers(fields, stored);
  const failures = finalCheck(fields, answers);
  if (failures.length > 0) return { ok: false, failures };
  // Every file the submitted answers point at: File questions, several files in one question, and Files inside the entries of a group.
  const used = new Set<string>(fileIdsInAnswers(fields, answers));
  return { ok: true, plan: { answers, files: files.filter((f) => used.has(f.id)) } };
}

/** The form as it was when it was submitted: what the questions said, so a submitted application can always be read as it was answered. */
export function formSnapshot(call: Pick<Call, 'id' | 'name' | 'configVersion' | 'currency' | 'timezone'>, fields: FormField[], at: Date = new Date()) {
  return {
    callId: call.id, callName: call.name, configVersion: call.configVersion, currency: call.currency, timezone: call.timezone, capturedAt: at.toISOString(),
    fields: fields.map((f) => ({ id: f.id, page: f.page, position: f.position, kind: f.kind, label: f.label, instruction: f.instruction, required: f.required, options: f.options, validations: f.validations, condition: f.condition, platformMapping: f.platformMapping })),
  };
}

/** Where a file of a submitted application lives for good: a copy that belongs to the submission, independent of the Vault and of the applicant's folder. */
export const frozenPath = (callId: string, applicationId: string, fileId: string, fileName = ''): string =>
  `calls/${callId}/applications/${applicationId}/frozen/${fileId}${/.[a-z0-9]{1,5}$/i.exec(fileName)?.[0].toLowerCase() ?? '.pdf'}`;
