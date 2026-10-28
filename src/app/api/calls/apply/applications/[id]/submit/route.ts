// Prompt 907 (I3) — "Save & submit" (spec §14.2, §14.3). The server decides, on what it STORED:
//   - the key makes the request idempotent (a double click, a retry after a flaky network, two requests at once: ONE submission);
//   - the account is confirmed; the call still accepts submissions on the SERVER's clock; the limit per unit is respected;
//   - every shown required question is answered and valid, and every document is registered — if not, the answer lists each question and
//     the page it is on (a hidden required question never blocks);
//   - the files are copied into the submission (what was submitted never changes, whatever happens to the Vault afterwards);
//   - an immutable version (answers, documents, the form as it was) is written, in ONE transaction, by call_submit_application().
// Afterwards the application is read-only: nothing can be changed or added.
import { NextResponse } from 'next/server';
import { withActingOrg } from '@/lib/acting-org';
import { authApplication } from '@/lib/calls/applicant/auth';
import { fileReadable, findSubmissionByKey, freezeFile, loadFiles } from '@/lib/calls/applicant/store';
import { sanitizeAnswers } from '@/lib/calls/applicant/answers';
import { processApplicationNow } from '@/lib/calls/eligibility-engine';
import { filesInSubmission, formSnapshot, frozenPath, planSubmission, unreadableFileIssues } from '@/lib/calls/applicant/submit';
import { notifySubmissionReceived } from '@/lib/calls/applicant/notices';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const POST = withActingOrg(async function POST(req: Request, { params }: { params: { id: string } }) {
  const a = await authApplication(req, params.id);
  if (a.error) return a.error;
  const body = (await req.json().catch(() => ({}))) as { key?: unknown; baseRevision?: unknown };
  const key = typeof body.key === 'string' && body.key.trim().length >= 8 && body.key.length <= 100 ? body.key.trim() : null;
  if (!key) return NextResponse.json({ ok: false, error: 'An idempotency key is required.' }, { status: 400 });

  // The same request again: the answer is the original one, whatever has changed since.
  const prior = await findSubmissionByKey(a.admin, a.app.id, key);
  if (prior) return NextResponse.json({ ok: true, already: true, submittedAt: prior.submittedAt, reference: a.app.reference });
  if (a.app.status !== 'draft') return NextResponse.json({ ok: false, code: 'already_submitted', error: 'This application was already submitted.' }, { status: 409 });
  if (!a.emailConfirmed) return NextResponse.json({ ok: false, code: 'email_unconfirmed', error: 'Confirm your email before submitting.' }, { status: 403 });

  const { data: accepting } = await a.admin.rpc('call_accepting', { p_call: a.call.id });
  if (accepting !== true) return NextResponse.json({ ok: false, code: 'closed', error: 'This call is no longer accepting applications, so this draft can no longer be submitted.' }, { status: 409 });
  // What is submitted is what was saved: the browser must have saved what it shows (it does, right before asking).
  if (typeof body.baseRevision !== 'number' || body.baseRevision !== a.app.revision) {
    return NextResponse.json({ ok: false, code: 'conflict', error: 'This application changed in another window. Reload it and try again.' }, { status: 409 });
  }

  const files = await loadFiles(a.admin, a.app.id);
  const stored = sanitizeAnswers(a.fields, a.app.answers, files);
  const result = planSubmission(a.fields, stored, files);
  // EVERYTHING that blocks the submission is told at once: what is missing or wrong in every page and group, AND the documents that can no longer be read.
  const readable = await Promise.all(filesInSubmission(a.fields, stored, files).map(async (f) => ({ f, ok: await fileReadable(a.admin, files.find((x) => x.id === f.id)!) })));
  const unreadable = unreadableFileIssues(a.fields, stored, readable.filter((r) => !r.ok).map((r) => r.f));
  if (!result.ok || unreadable.length > 0) {
    const all = [...(result.ok ? [] : result.failures), ...unreadable].sort((x, y) => x.pageNumber - y.pageNumber);     // the order of the form (a stable sort: page by page)
    const failures = all.map((f) => ({ fieldId: f.fieldId, key: f.key, label: f.label, page: f.pageNumber, message: f.message }));
    return NextResponse.json({ ok: false, code: result.ok ? 'file_missing' : 'incomplete', error: result.ok ? unreadable[0].message : 'Some answers are missing.', failures }, { status: 409 });
  }

  // Freeze the documents: the copies that belong to the submitted version.
  const frozen = [];
  for (const f of result.plan.files) {
    const row = files.find((x) => x.id === f.id)!;
    const to = frozenPath(a.call.id, a.app.id, row.id, row.fileName);
    if (!(await freezeFile(a.admin, row, to))) {
      return NextResponse.json({ ok: false, code: 'file_missing', error: `We could not read “${row.fileName}”. Please attach it again.`, failures: [{ fieldId: row.fieldId, label: a.fields.find((q) => q.id === row.fieldId)?.label ?? row.fileName, page: 1, message: 'Please attach the document again.' }] }, { status: 409 });
    }
    frozen.push({ fieldId: row.fieldId, fileId: row.id, source: row.source, fileName: row.fileName, size: row.size, sha256: row.sha256, frozenPath: to, documentId: row.documentId ?? null, versionId: row.versionId, versionNumber: row.versionNumber ?? null });
  }

  const { data, error } = await a.admin.rpc('call_submit_application', {
    p_application: a.app.id, p_user: a.userId, p_key: key, p_answers: result.plan.answers, p_documents: frozen, p_form_snapshot: formSnapshot(a.call, a.fields),
  });
  const res = data as { ok?: boolean; reason?: string; already?: boolean; submitted_at?: string } | null;
  if (error || !res) return NextResponse.json({ ok: false, error: 'We could not submit. Please try again: nothing was lost.' }, { status: 500 });
  if (!res.ok) {
    const map: Record<string, [number, string, string]> = {
      not_accepting: [409, 'closed', 'This call is no longer accepting applications, so this draft can no longer be submitted.'],
      already_submitted: [409, 'already_submitted', 'This application was already submitted.'],
      unit_limit: [409, 'unit_limit', a.call.limitUnit === 'legal_entity' ? 'An application from your company was already submitted, and only one per company is accepted.' : 'Your startup already submitted an application, and only one per startup is accepted.'],
      not_found: [404, 'not_found', 'Application not found.'],
    };
    const [status, code, error2] = map[res.reason ?? ''] ?? [500, 'error', 'We could not submit. Please try again.'];
    return NextResponse.json({ ok: false, code, error: error2 }, { status });
  }
  // The receipt (email and in-app notice) goes out once, only for a submission that was just created, never for a repeat of the same request.
  if (res.already !== true) await notifySubmissionReceived(a.admin, a.call, a.app, a.userId).catch((e) => console.error('[calls] submission notice failed:', (e as Error).message));
  // Prompt 918 (I3): the task was written with the submission (a trigger); give it a first, bounded go so the result is usually there when the entity looks. A failure never touches the submission.
  if (res.already !== true) await processApplicationNow(a.admin, a.app.id).catch((e) => console.error('[calls] eligibility first run failed:', (e as Error).message));
  return NextResponse.json({ ok: true, already: res.already === true, submittedAt: res.submitted_at, reference: a.app.reference });
});
