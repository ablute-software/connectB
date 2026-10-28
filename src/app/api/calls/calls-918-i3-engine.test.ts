// Prompt 918 (I3) — the internal engine, its queue and the people's corrections, over the stateful fake database (which models the trigger that writes a submission AND its task together, and
// claim_call_tasks): each rule kind on real files (PDFs with a text layer made here), Fit / Not a fit / To validate with the evidence, a scanned PDF to a person, a TECHNICAL failure that never becomes an
// incumprimento (retried with a back-off, then shown as a technical failure), a stuck task taken again, idempotence, a new rules version evaluating everything again while keeping the history,
// corrections that recompute the rest and are kept as examples, and the isolation between calls.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';

let db: CallsDb;
let storage: FakeStorage;
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db, storage) }));
vi.mock('@/lib/supabase-server', () => ({ authEnabled: true, serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));

import { aggregate, claimTasks, enqueueReevaluation, failTask, processQueue } from '@/lib/calls/eligibility-engine';
import { accuracy, correctRule, flagApplication, reclassify } from '@/lib/calls/eligibility-review';
import { loadRecipes, writeRules } from '@/lib/calls/eligibility-store';
import { newField } from '@/lib/calls/form-builder';
import { rowToCall } from '@/lib/calls/mappers';
import type { EligibilityRule } from '@/lib/calls/eligibility';
import type { FormField } from '@/lib/calls/types';

const FIRM = '11111111-1111-4111-8111-111111111111';
const CALL_A = '22222222-2222-4222-8222-22222222222a';
const CALL_B = '22222222-2222-4222-8222-22222222222b';
const DAY = 86_400_000;
const Q = (n: number, tag = 'a') => `${n}0000000-0000-4000-8000-00000000000${tag === 'a' ? 1 : 2}`;
const ids = (tag: 'a' | 'b') => ({ sector: Q(1, tag), raised: Q(2, tag), cert: Q(3, tag), name: Q(4, tag), tax: Q(5, tag), impact: Q(6, tag) });

const CERT = `CERTIDÃO PERMANENTE
Conservatória do Registo Comercial de Lisboa
Codigo de acesso: 1234-5678-9012
Matricula e NIPC: 513456789
Firma: Acme Robotics, Lda.
Certidao emitida em 12/09/2026. Valida ate 12/03/2027.`;
const INVOICE = 'Fatura n 2026/12. Total a pagar: 120,00 EUR. Obrigado pela preferencia. Fatura emitida para o cliente. Pagamento por transferencia. Fatura.';

async function pdf(text: string | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  if (text) { const font = await doc.embedFont(StandardFonts.Helvetica); text.split('\n').forEach((l, i) => page.drawText(l.normalize('NFD').replace(/[̀-ͯ]/g, ''), { x: 40, y: 780 - i * 18, size: 12, font })); }
  return new Uint8Array(await doc.save());
}

function fields(tag: 'a' | 'b'): FormField[] {
  const i = ids(tag);
  return [
    { ...newField('single_choice', 1, 0), id: i.sector, label: 'Sector', options: [{ id: 'o-health', label: 'Health' }, { id: 'o-energy', label: 'Energy' }, { id: 'o-other', label: 'Other' }] },
    { ...newField('number', 1, 1), id: i.raised, label: 'Amount you are raising' },
    { ...newField('file', 2, 0), id: i.cert, label: 'Permanent Certificate', instruction: 'Issued less than 3 months ago.' },
    { ...newField('short_text', 1, 2), id: i.name, label: 'Company name' },
    { ...newField('short_text', 1, 3), id: i.tax, label: 'Tax ID (NIF)' },
    { ...newField('long_text', 1, 4), id: i.impact, label: 'Social impact' },
  ];
}
const rules = (tag: 'a' | 'b', which: ('options' | 'number' | 'cert' | 'present' | 'right' | 'authentic' | 'open')[]): EligibilityRule[] => {
  const i = ids(tag);
  const all: Record<string, Omit<EligibilityRule, 'id' | 'position' | 'note'>> = {
    options: { fieldId: i.sector, kind: 'options', params: { accepted: ['o-health', 'o-energy'], mode: 'any' } },
    number: { fieldId: i.raised, kind: 'number', params: { op: 'lte', value: 500000 } },
    cert: { fieldId: i.cert, kind: 'doc_valid', params: { maxAgeMonths: null, matchName: i.name, matchTaxId: i.tax } },
    present: { fieldId: i.cert, kind: 'doc_present', params: {} },
    right: { fieldId: i.cert, kind: 'doc_right', params: { docType: null } },
    authentic: { fieldId: i.cert, kind: 'doc_authentic', params: {} },
    open: { fieldId: i.impact, kind: 'open', params: { text: 'Has a social impact' } },
  };
  return which.map((k, n) => ({ id: `3000000${n}-0000-4000-8000-0000000000${tag === 'a' ? 'a' : 'b'}${n}`, position: n, note: null, ...all[k] } as EligibilityRule));
};

const callRow = (id: string, name: string) => ({
  id, promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, incubator_id: null, name, description: 'x', status: 'open', opens_at: new Date(Date.now() - 20 * DAY).toISOString(), closes_at: new Date(Date.now() + 20 * DAY).toISOString(),
  timezone: 'Europe/Lisbon', visibility: 'unlisted', limit_unit: 'project', allow_multiple: false, content_language: 'en', currency: 'EUR', link_token: `tok-${name}-0123456789abcdef`, config_version: 3, eligibility_version: 1, eligibility_rev: 0,
  created_by: 'ana', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
});
const admin = () => fakeCallsAdmin(db, storage);
const callOf = (id: string) => rowToCall(db.tables.calls.find((c) => c.id === id)!);

async function setup(callId: string, tag: 'a' | 'b', which: Parameters<typeof rules>[1]) {
  db.tables.calls.push(callRow(callId, tag === 'a' ? 'Call A' : 'Call B'));
  const f = fields(tag);
  db.tables.call_form_fields.push(...f.map((x) => ({ call_id: callId, id: x.id, page: x.page, position: x.position, kind: x.kind, label: x.label, instruction: x.instruction, required: false, options: x.options, validations: x.validations, condition: null, platform_mapping: null, expected_type: null, max_age_months: null })));
  await writeRules(admin(), callOf(callId), 1, rules(tag, which), f, 'ana');
  return f;
}

let n = 0;
/** A submitted application with its frozen document — and, as the trigger does, its task. */
async function submit(callId: string, tag: 'a' | 'b', answers: Record<string, unknown>, file: Uint8Array | null, fileName = 'certidao.pdf') {
  const i = ids(tag); n++;
  const appId = `00000000-0000-4000-8000-${String(900 + n).padStart(12, '0')}`; const subId = `00000000-0000-4000-8000-${String(1900 + n).padStart(12, '0')}`;
  db.tables.call_applications.push({ id: appId, call_id: callId, status: 'submitted', startup_org_id: null, applicant_user_id: 'u1', draft_answers: {}, current_submission_id: subId, reference: `REF-${n}`, unit_key: `u:${n}`, submitted_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_at: new Date().toISOString() });
  const path = `calls/${callId}/applications/${appId}/frozen/f${n}.pdf`;
  if (file) storage.objects.set(path, { bytes: file });
  db.tables.call_application_submissions.push({ id: subId, application_id: appId, version: 1, answers, documents: file || fileName === 'missing.pdf' ? [{ fieldId: i.cert, fileId: `f${n}`, fileName, frozenPath: path }] : [], form_snapshot: {}, submitted_by: 'u1', submitted_at: new Date().toISOString(), idempotency_key: `k${n}` });
  db.tables.call_processing_tasks.push({ id: `00000000-0000-4000-8000-${String(2900 + n).padStart(12, '0')}`, call_id: callId, application_id: appId, submission_id: subId, kind: 'eligibility', rules_version: 1, status: 'queued', attempts: 0, max_attempts: 5, run_after: new Date(Date.now() - 1000).toISOString(), created_at: new Date(Date.now() - 1000 + n).toISOString(), locked_at: null, last_error: null });
  return { appId, subId };
}
const good = (tag: 'a' | 'b') => { const i = ids(tag); return { [i.sector]: 'o-health', [i.raised]: '300000', [i.name]: 'Acme Robotics, Lda', [i.tax]: '513456789', [i.cert]: { fileName: 'certidao.pdf', size: 1 } }; };
const current = (appId: string) => db.tables.call_application_eligibility.find((r) => r.application_id === appId && r.is_current);
const results = (appId: string) => (current(appId)!.rule_results as { kind: string; outcome: string; reason: string; evidence?: { quote?: string; page?: number } }[]);

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  db = callsDb(); storage = { objects: new Map() }; n = 0; db.nowMs = undefined;
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('putting the verdicts together', () => {
  it('a clear failure is Not a fit; otherwise any doubt is To validate; otherwise Fit — and a person\'s decision on a rule replaces the engine\'s', () => {
    const r = (ruleId: string, outcome: 'pass' | 'fail' | 'validate') => ({ ruleId, outcome, reason: `${ruleId}:${outcome}` });
    expect(aggregate([r('a', 'pass'), r('b', 'pass')]).status).toBe('fit');
    expect(aggregate([r('a', 'pass'), r('b', 'validate')]).status).toBe('to_validate');
    expect(aggregate([r('a', 'fail'), r('b', 'validate')]).status).toBe('not_fit');
    expect(aggregate([r('a', 'fail'), r('b', 'pass')], { a: { outcome: 'pass' } }).status).toBe('fit');
    expect(aggregate([]).reason).toContain('no eligibility rules');
  });
});

describe('evaluating a submission on real files', () => {
  it('FIT: every rule met, with the quote and the page of the document as evidence', async () => {
    await setup(CALL_A, 'a', ['options', 'number', 'cert']);
    const { appId } = await submit(CALL_A, 'a', good('a'), await pdf(CERT));
    const run = await processQueue(admin());
    expect(run).toMatchObject({ claimed: 1, done: 1, requeued: 0, technicalFailures: 0 });
    expect(current(appId)).toMatchObject({ status: 'fit', source: 'engine', rules_version: 1 });
    const doc = results(appId).find((r) => r.kind === 'doc_valid')!;
    expect(doc.outcome).toBe('pass');
    expect(doc.evidence?.page).toBe(1);
    expect(db.tables.call_processing_tasks[0]).toMatchObject({ status: 'done' });
  });

  it('NOT A FIT only for a clear, objective reason: the number over the limit; a document that is another kind of document', async () => {
    await setup(CALL_A, 'a', ['options', 'number', 'right']);
    const over = await submit(CALL_A, 'a', { ...good('a'), [ids('a').raised]: '500001' }, await pdf(CERT));
    const invoice = await submit(CALL_A, 'a', good('a'), await pdf('Instituto da Seguranca Social\nDeclaracao de situacao contributiva regularizada. A entidade nao e devedora. Seguranca Social Direta.'));
    await processQueue(admin(), { limit: 10 });
    expect(current(over.appId)).toMatchObject({ status: 'not_fit' });
    expect(current(over.appId)!.reason).toContain('outside the limit');
    expect(current(invoice.appId)).toMatchObject({ status: 'not_fit' });
    expect(current(invoice.appId)!.reason).toContain('Social security');
  });

  it('a document older than the limit is Not a fit; the tax ID printed on it that is not the declared one too; a different company name is only a doubt', async () => {
    const f = await setup(CALL_A, 'a', ['cert']);
    const i = ids('a');
    // a 2-month limit on the certificate (issued 12/09/2026, submitted "now" = 2026-10-27 in this clock: 1 month; so make the limit 0)
    await writeRules(admin(), callOf(CALL_A), 1, [{ ...rules('a', ['cert'])[0], params: { maxAgeMonths: 1, matchName: i.name, matchTaxId: i.tax } as never }], f, 'ana');
    const old = await submit(CALL_A, 'a', good('a'), await pdf(CERT.replace('12/09/2026', '12/01/2026')));
    const wrongTax = await submit(CALL_A, 'a', { ...good('a'), [i.tax]: '999999999' }, await pdf(CERT));
    const otherName = await submit(CALL_A, 'a', { ...good('a'), [i.name]: 'Totally Different Brand' }, await pdf(CERT));
    await processQueue(admin(), { limit: 10 });
    expect(current(old.appId)).toMatchObject({ status: 'not_fit' });
    expect(current(wrongTax.appId)).toMatchObject({ status: 'not_fit' });
    expect(current(otherName.appId)).toMatchObject({ status: 'to_validate' });
  });

  it('TO VALIDATE: a scanned PDF (image only) is never read; an open requirement; an authentic-document rule is always a person (with the access code)', async () => {
    await setup(CALL_A, 'a', ['options', 'right', 'open']);
    const scanned = await submit(CALL_A, 'a', good('a'), await pdf(null));
    await processQueue(admin());
    expect(current(scanned.appId)).toMatchObject({ status: 'to_validate' });
    expect(current(scanned.appId)!.reason).toContain('Scanned file (image): text cannot be read automatically.');
    await setup(CALL_B, 'b', ['authentic']);
    const auth = await submit(CALL_B, 'b', good('b'), await pdf(CERT));
    await processQueue(admin());
    expect(current(auth.appId)).toMatchObject({ status: 'to_validate' });
    expect(current(auth.appId)!.reason).toContain('1234-5678-9012');
    expect(current(auth.appId)!.reason).toContain('Portal da Empresa');
  });

  it('no document attached to a document rule is a clear failure; a call with no rules is a Fit', async () => {
    await setup(CALL_A, 'a', ['right']);
    const none = await submit(CALL_A, 'a', good('a'), null);
    await processQueue(admin());
    expect(current(none.appId)).toMatchObject({ status: 'not_fit' });
    await setup(CALL_B, 'b', []);
    const free = await submit(CALL_B, 'b', good('b'), null);
    await processQueue(admin());
    expect(current(free.appId)).toMatchObject({ status: 'fit' });
  });
});

describe('the queue', () => {
  it('a submission and its task are written together (the real submit models the trigger): never an application without a task', async () => {
    await setup(CALL_A, 'a', ['number']);
    const { appId } = await submit(CALL_A, 'a', good('a'), null);
    expect(db.tables.call_processing_tasks.filter((t) => t.application_id === appId)).toHaveLength(1);
  });

  it('a TECHNICAL failure (the stored file cannot be read) is never an incumprimento: no result is written, the task goes back with a back-off, and after the last attempt it is a "technical failure"', async () => {
    await setup(CALL_A, 'a', ['cert']);
    const { appId } = await submit(CALL_A, 'a', good('a'), null, 'missing.pdf');
    const t = db.tables.call_processing_tasks[0];
    for (let attempt = 1; attempt <= 4; attempt++) {
      const run = await processQueue(admin(), { now: new Date() });
      expect(run).toMatchObject({ claimed: 1, requeued: 1, done: 0 });
      expect(t).toMatchObject({ status: 'queued', attempts: attempt });
      expect(Date.parse(t.run_after as string)).toBeGreaterThan(Date.now());     // the back-off
      t.run_after = new Date(Date.now() - 1000).toISOString();
    }
    const last = await processQueue(admin());
    expect(last).toMatchObject({ claimed: 1, technicalFailures: 1 });
    expect(t).toMatchObject({ status: 'technical_failure', attempts: 5 });
    expect(String(t.last_error)).toContain('Could not read the stored file');
    expect(current(appId)).toBeUndefined();                                         // no verdict: never Not a fit
    expect(db.tables.call_application_eligibility).toHaveLength(0);
  });

  it('a task still waiting for its time is not taken; one stuck in Processing for too long is taken again', async () => {
    await setup(CALL_A, 'a', ['number']);
    await submit(CALL_A, 'a', good('a'), null);
    const t = db.tables.call_processing_tasks[0];
    t.run_after = new Date(Date.now() + 60_000).toISOString();
    expect((await claimTasks(admin(), 5)).length).toBe(0);
    Object.assign(t, { status: 'processing', locked_at: new Date(Date.now() - 20 * 60_000).toISOString(), run_after: new Date(Date.now() - 1000).toISOString(), attempts: 1 });
    const again = await claimTasks(admin(), 5, 10);
    expect(again).toHaveLength(1);
    expect(t.attempts).toBe(2);
    Object.assign(t, { status: 'processing', locked_at: new Date().toISOString() });
    expect((await claimTasks(admin(), 5, 10)).length).toBe(0);                      // not stuck: running now
  });

  it('is idempotent: evaluating the same submission twice leaves ONE current result', async () => {
    await setup(CALL_A, 'a', ['number']);
    const { appId } = await submit(CALL_A, 'a', good('a'), null);
    await processQueue(admin());
    const t = db.tables.call_processing_tasks[0]; Object.assign(t, { status: 'queued', run_after: new Date(Date.now() - 1000).toISOString() });
    await processQueue(admin());
    expect(db.tables.call_application_eligibility.filter((r) => r.application_id === appId)).toHaveLength(1);
  });

  it('a call that was deleted is skipped, not failed', async () => {
    await setup(CALL_A, 'a', ['number']);
    await submit(CALL_A, 'a', good('a'), null);
    Object.assign(db.tables.calls[0], { deleted_at: new Date().toISOString() });
    expect(await processQueue(admin())).toMatchObject({ claimed: 1, done: 1 });
    expect(db.tables.call_application_eligibility).toHaveLength(0);
  });

  it('failing the last attempt records the reason; the requeue waits longer each time', async () => {
    const t = { id: 't', call_id: 'c', application_id: 'a', submission_id: 's', rules_version: 1, attempts: 1, max_attempts: 5 };
    db.tables.call_processing_tasks.push({ ...t, status: 'processing', run_after: null });
    const now = new Date('2026-10-27T10:00:00Z');
    expect(await failTask(admin(), t, 'boom', now)).toBe('requeued');
    expect(db.tables.call_processing_tasks[0].run_after).toBe('2026-10-27T10:01:00.000Z');
    expect(await failTask(admin(), { ...t, attempts: 3 }, 'boom', now)).toBe('requeued');
    expect(db.tables.call_processing_tasks[0].run_after).toBe('2026-10-27T10:15:00.000Z');
  });
});

describe('a new rules version evaluates everything again — and keeps the history', () => {
  it('queues a task per submitted application for the new version; the earlier result stays as history', async () => {
    const f = await setup(CALL_A, 'a', ['number']);
    const a = await submit(CALL_A, 'a', good('a'), null);
    await processQueue(admin());
    expect(current(a.appId)).toMatchObject({ status: 'fit', rules_version: 1 });
    // the entity freezes the rules at opening and then tightens the number: version 2
    await writeRules(admin(), callOf(CALL_A), 2, [{ ...rules('a', ['number'])[0], params: { op: 'lte', value: 100000 } as never }], f, 'ana');
    Object.assign(db.tables.calls[0], { eligibility_version: 2 });
    expect(await enqueueReevaluation(admin(), CALL_A, 2)).toBe(1);
    expect(await enqueueReevaluation(admin(), CALL_A, 2)).toBe(1);                   // asking twice does not duplicate
    expect(db.tables.call_processing_tasks.filter((t) => t.rules_version === 2)).toHaveLength(1);
    await processQueue(admin());
    expect(current(a.appId)).toMatchObject({ status: 'not_fit', rules_version: 2 });
    const history = db.tables.call_application_eligibility.filter((r) => r.application_id === a.appId);
    expect(history.map((r) => [r.rules_version, r.is_current])).toEqual([[1, false], [2, true]]);
  });
});

describe('what a person can correct', () => {
  async function evaluated(which: Parameters<typeof rules>[1], answers = good('a'), file: Uint8Array | null = null) {
    await setup(CALL_A, 'a', which);
    const s = await submit(CALL_A, 'a', answers, file);
    await processQueue(admin());
    return s.appId;
  }
  const ruleIdOf = (appId: string, kind: string) => (current(appId)!.rule_results as { ruleId: string; kind: string }[]).find((r) => r.kind === kind)!.ruleId;

  it('correcting a rule recomputes the rest: the application does NOT become a Fit while another rule fails; with the other fixed it does', async () => {
    const appId = await evaluated(['options', 'number'], { ...good('a'), [ids('a').sector]: 'o-other', [ids('a').raised]: '999999' });
    expect(current(appId)).toMatchObject({ status: 'not_fit' });
    const r1 = await correctRule(admin(), callOf(CALL_A), appId, { ruleId: ruleIdOf(appId, 'options'), outcome: 'pass', justification: 'Other counts as Health here', actor: 'ana' });
    expect(r1).toMatchObject({ ok: true, status: 'not_fit' });                          // the number still fails
    const r2 = await correctRule(admin(), callOf(CALL_A), appId, { ruleId: ruleIdOf(appId, 'number'), outcome: 'pass', justification: 'Rounded amount accepted', actor: 'ana' });
    expect(r2).toMatchObject({ ok: true, status: 'fit' });
    expect(current(appId)).toMatchObject({ status: 'fit', source: 'human' });
    expect(db.tables.call_application_eligibility.filter((r) => r.application_id === appId)).toHaveLength(3);   // engine + two corrections, history kept
  });

  it('every correction is kept as an example: the rule, what the engine said and why, what the person decided, who, why, and whether it is an exception of this call', async () => {
    const appId = await evaluated(['number'], { ...good('a'), [ids('a').raised]: '500001' });
    await correctRule(admin(), callOf(CALL_A), appId, { ruleId: ruleIdOf(appId, 'number'), outcome: 'pass', justification: 'Board approved an exception', actor: 'ana', callException: true });
    expect(db.tables.call_eligibility_corrections).toMatchObject([{
      call_id: CALL_A, application_id: appId, rule_kind: 'number', engine_outcome: 'fail', human_outcome: 'pass', author_user_id: 'ana', justification: 'Board approved an exception', is_call_exception: true, rules_version: 1,
    }]);
    expect(String(db.tables.call_eligibility_corrections[0].engine_reason)).toContain('outside the limit');
  });

  it('a correction without a reason is refused; an unknown rule is refused; before the first evaluation there is nothing to correct', async () => {
    const appId = await evaluated(['number']);
    expect(await correctRule(admin(), callOf(CALL_A), appId, { ruleId: ruleIdOf(appId, 'number'), outcome: 'fail', justification: '   ', actor: 'ana' })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await correctRule(admin(), callOf(CALL_A), appId, { ruleId: 'nope', outcome: 'fail', justification: 'x', actor: 'ana' })).toMatchObject({ ok: false, code: 'unknown_rule' });
    expect(await reclassify(admin(), callOf(CALL_A), 'no-eval', { status: 'fit', justification: 'x', actor: 'ana' })).toMatchObject({ ok: false, code: 'not_ready' });
    expect(db.tables.call_eligibility_corrections).toHaveLength(0);
  });

  it('reclassifying the whole application (also from To validate) and flagging one for validation', async () => {
    const appId = await evaluated(['open']);
    expect(current(appId)).toMatchObject({ status: 'to_validate' });
    expect(await reclassify(admin(), callOf(CALL_A), appId, { status: 'fit', justification: 'Read it: it has social impact', actor: 'ana' })).toMatchObject({ ok: true, status: 'fit' });
    expect(current(appId)!.reason).toContain('Reclassified by a person');
    const flag = await flagApplication(admin(), callOf(CALL_A), appId, { reason: 'Looks like a duplicate of another startup', actor: 'bob' });
    expect(flag).toMatchObject({ ok: true, status: 'to_validate' });
    expect(current(appId)).toMatchObject({ status: 'to_validate', source: 'flag' });
    expect(db.tables.call_eligibility_corrections.map((c) => c.human_outcome)).toEqual(['fit', 'to_validate']);
    expect(await flagApplication(admin(), callOf(CALL_A), appId, { reason: ' ', actor: 'bob' })).toMatchObject({ ok: false });
  });
});

describe('each call is isolated', () => {
  it('the rules and the recipes of call A are never used for call B: the same kind of document, in two calls, is checked by each one\'s own rules', async () => {
    await setup(CALL_A, 'a', ['cert']);
    await setup(CALL_B, 'b', []);                                                     // B has no rules at all
    const a = await submit(CALL_A, 'a', { ...good('a'), [ids('a').tax]: '999999999' }, await pdf(CERT));
    const b = await submit(CALL_B, 'b', { ...good('b'), [ids('b').tax]: '999999999' }, await pdf(CERT));
    await processQueue(admin(), { limit: 10 });
    expect(current(a.appId)).toMatchObject({ status: 'not_fit' });                    // A's rule compares the tax ID
    expect(current(b.appId)).toMatchObject({ status: 'fit' });                        // B has none: nothing of A leaks in
    expect((await loadRecipes(admin(), CALL_B, 1))).toHaveLength(0);
    expect((await loadRecipes(admin(), CALL_A, 1))).toHaveLength(1);
    expect(current(b.appId)!.call_id).toBe(CALL_B);
  });
});

describe('how the engine is doing (for the back office)', () => {
  it('the hit rate by kind of rule and by kind of document: a correction counts against the engine, an exception of a call does not', () => {
    const res = [
      ...Array.from({ length: 8 }, () => ({ ruleKind: 'number', docType: null, outcome: 'pass' as const })),
      ...Array.from({ length: 4 }, () => ({ ruleKind: 'doc_valid', docType: 'permanent_certificate', outcome: 'pass' as const })),
    ];
    const cor = [
      { ruleKind: 'number', docType: null, engineOutcome: 'pass', humanOutcome: 'fail', callException: false },
      { ruleKind: 'number', docType: null, engineOutcome: 'fail', humanOutcome: 'pass', callException: true },       // an exception of the call: not an engine error
      { ruleKind: 'doc_valid', docType: 'permanent_certificate', engineOutcome: 'validate', humanOutcome: 'pass', callException: false },
      { ruleKind: null, docType: null, engineOutcome: null, humanOutcome: 'fit', callException: false },               // whole application: not a rule
    ];
    const a = accuracy(res, cor);
    expect(a.byRule.find((r) => r.key === 'number')).toMatchObject({ decisions: 8, corrected: 1, accuracy: 87.5 });
    expect(a.byDocument.find((r) => r.key === 'permanent_certificate')).toMatchObject({ decisions: 4, corrected: 1, accuracy: 75 });
  });
});
