// Prompt 918 (I2) — the Eligibility step: read the rules of a call (with their sentences, problems, recipes and the import's suggestions) and replace them.
//
//   draft                 the rules are edited IN PLACE (the active version);
//   validated / scheduled locked, like the form ("Edit configuration" first);
//   open and later        the rules are FROZEN: a change makes a NEW version (the previous one stays, for the record), asks for an explicit confirmation naming how many applications will be evaluated
//                         again, and records the before and the after in the call's history;
//   archived              nothing changes.
// Only whoever may "Configure call" writes. Optimistic concurrency on the step's own revision (two people editing the rules never overwrite each other).
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { parseRulesPayload, type EligibilityRule } from '@/lib/calls/eligibility';
import { buildEligibilityView, rulesMode } from '@/lib/calls/eligibility-view';
import { enqueueReevaluation } from '@/lib/calls/eligibility-engine';
import { bumpRules, loadRecipes, loadRules, loadSuggestions, rulesAsText, writeRules } from '@/lib/calls/eligibility-store';
import { countApplications, loadFields, logCallEvent, loadCall } from '@/lib/calls/store';

export const dynamic = 'force-dynamic';

async function viewOf(admin: Parameters<typeof loadRules>[0], callId: string) {
  const call = (await loadCall(admin, callId))!;
  const version = call.eligibilityVersion ?? 1;
  const [fields, rules, recipes, counts] = await Promise.all([loadFields(admin, callId), loadRules(admin, callId, version), loadRecipes(admin, callId, version), countApplications(admin, callId)]);
  const suggestions = await loadSuggestions(admin, callId, rules);
  return buildEligibilityView({ call, fields, rules, recipes, suggestions, submitted: counts.submitted });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  return NextResponse.json({ ok: true, canManage: auth.promoter.canManage, ...(await viewOf(auth.admin, auth.call.id)) });
}

const sameRules = (a: EligibilityRule[], b: EligibilityRule[]) =>
  JSON.stringify(a.map((r) => [r.fieldId, r.kind, r.params, r.note])) === JSON.stringify(b.map((r) => [r.fieldId, r.kind, r.params, r.note]));

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const { call } = auth;
  const body = await req.json().catch(() => ({})) as { baseRev?: number; rules?: unknown; confirm?: boolean };
  const mode = rulesMode(call.status);
  if (mode === 'locked') return NextResponse.json({ ok: false, code: 'locked', error: 'The rules are locked. Use “Edit configuration” before the call opens.' }, { status: 409 });
  if (mode === 'archived') return NextResponse.json({ ok: false, code: 'locked', error: 'An archived call cannot be changed.' }, { status: 409 });
  if (!Number.isInteger(body.baseRev)) return NextResponse.json({ ok: false, error: 'Missing baseRev.' }, { status: 400 });

  const fields = await loadFields(auth.admin, call.id);
  const parsed = parseRulesPayload(body.rules, fields);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const version = call.eligibilityVersion ?? 1;
  const before = await loadRules(auth.admin, call.id, version);
  if (sameRules(before, parsed.rules)) return NextResponse.json({ ok: true, unchanged: true, ...(await viewOf(auth.admin, call.id)) });

  let newVersion: number | null = null;
  if (mode === 'versioned') {
    const counts = await countApplications(auth.admin, call.id);
    if (body.confirm !== true) {
      return NextResponse.json({
        ok: false, code: 'needs_confirm', submitted: counts.submitted, nextVersion: version + 1,
        error: `The rules are frozen because the call has opened. This change makes version ${version + 1} and evaluates the ${counts.submitted} submitted application${counts.submitted === 1 ? '' : 's'} again against it; every earlier result stays on record. Continue?`,
      }, { status: 409 });
    }
    newVersion = version + 1;
  }

  const bumped = await bumpRules(auth.admin, call, body.baseRev as number, newVersion);
  if (!bumped) return NextResponse.json({ ok: false, code: 'conflict', error: 'Someone else changed the rules. Reload to see their changes.' }, { status: 409 });
  try {
    await writeRules(auth.admin, call, bumped.version, parsed.rules, fields, auth.userId);
  } catch (e) {
    console.error('[calls] eligibility rules not saved:', (e as Error).message);
    return NextResponse.json({ ok: false, error: 'The rules could not be saved. Please try again.' }, { status: 500 });
  }
  const after = { ...call, eligibilityVersion: bumped.version, eligibilityRev: bumped.rev };
  // A new version: every submitted application is evaluated again against it (the earlier results stay as history).
  let requeued = 0;
  if (newVersion !== null) requeued = await enqueueReevaluation(auth.admin, call.id, bumped.version).catch((e) => { console.error('[calls] re-evaluation not queued:', (e as Error).message); return 0; });
  await logCallEvent(auth.admin, call.id, 'eligibility_rules_changed', auth.userId, {
    mode, version: bumped.version, requeued, before: rulesAsText(before, fields, call), after: rulesAsText(parsed.rules, fields, after),
  });
  return NextResponse.json({ ok: true, ...(await viewOf(auth.admin, call.id)) });
}
