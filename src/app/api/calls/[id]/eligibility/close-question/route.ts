// Prompt 918 (I2) — an open requirement becomes a CLOSED question (spec §7.1: avoid rules on open answers). The platform proposes it (a Yes/No question the applicant answers) and the entity accepts with a
// click: the question is added to the end of the form and the open rule is replaced by a Yes/No rule on it. Only while the call is being set up (the form is editable); the rule keeps the entity's own words.
//
//   POST { ruleId }
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { suggestClosedQuestion, type EligibilityRule } from '@/lib/calls/eligibility';
import { bumpRules, loadRules, writeRules, rulesAsText } from '@/lib/calls/eligibility-store';
import { appendField } from '@/lib/calls/form-builder';
import { buildCallState } from '@/lib/calls/state';
import { bumpConfig, loadFields, logCallEvent, replaceFields } from '@/lib/calls/store';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const { call } = auth;
  if (call.status !== 'draft') return NextResponse.json({ ok: false, code: 'locked', error: 'The form is locked, so a question cannot be added now. Use “Edit configuration” before the call opens.' }, { status: 409 });
  const body = await req.json().catch(() => ({})) as { ruleId?: string };
  const version = call.eligibilityVersion ?? 1;
  const rules = await loadRules(auth.admin, call.id, version);
  const open = rules.find((r) => r.id === body.ruleId && r.kind === 'open');
  if (!open) return NextResponse.json({ ok: false, error: 'That open requirement does not exist.' }, { status: 404 });

  const text = String((open.params as { text?: string }).text ?? '');
  const suggestion = suggestClosedQuestion(text);
  const fields = await loadFields(auth.admin, call.id);
  const { fields: next, added } = appendField(fields, 'yes_no');
  const withLabel = next.map((f) => (f.id === added.id ? { ...f, label: suggestion.label, required: true } : f));

  const bumpedConfig = await bumpConfig(auth.admin, call, call.configVersion);
  if (!bumpedConfig) return NextResponse.json({ ok: false, code: 'conflict', error: 'Someone else changed this call. Reload and try again.' }, { status: 409 });
  const bumped = await bumpRules(auth.admin, bumpedConfig, bumpedConfig.eligibilityRev ?? 0, null);
  if (!bumped) return NextResponse.json({ ok: false, code: 'conflict', error: 'Someone else changed the rules. Reload and try again.' }, { status: 409 });
  await replaceFields(auth.admin, call.id, withLabel);
  const replacement: EligibilityRule = { id: open.id, fieldId: added.id, kind: 'yes_no', params: { expected: suggestion.expected }, note: text, position: open.position };
  const nextRules = rules.map((r) => (r.id === open.id ? replacement : r));
  await writeRules(auth.admin, call, version, nextRules, withLabel, auth.userId);
  await logCallEvent(auth.admin, call.id, 'eligibility_open_rule_closed', auth.userId, { question: suggestion.label, before: rulesAsText([open], fields, call), after: rulesAsText([replacement], withLabel, call) });
  const fresh = { ...bumpedConfig, eligibilityRev: bumped.rev };
  return NextResponse.json({ ...(await buildCallState(auth.admin, fresh, auth.promoter)), added: { id: added.id, label: suggestion.label } });
}
