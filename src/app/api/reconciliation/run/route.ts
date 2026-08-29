// Prompt 465 §B — the ONE explicit, awaited entry point for semantic
// reconciliation, replacing the two dead `if (await
// gapReconciliationsAvailable()) void runReconciliationForOrg(...)`
// fire-and-forget triggers removed from extractDocument itself (§A):
// confirmed in production that a promise left running after a serverless
// response is sent never gets to finish. From here on, reconciliation only
// ever runs because a caller that can wait for it explicitly asked —
// MarketDataPanel.tsx (§C, right after "Read my documents"), store-
// supabase.tsx's upload trigger (§A.1, chained via .then()), and the daily
// cron safety net (§D) for everything no client got around to requesting.
//
// Auth pattern matches the rest of src/app/api/company/ (team-watson-fill,
// ai-support, ...): serverClient → getUser → assertNotViewer → org_members.
//
// Known overlap, left alone on purpose: /api/blueprint/reconcile already
// does close to the same thing (an awaited runReconciliationForOrg, for the
// document-rename trigger) but without assertNotViewer, without
// maxDuration, and without this route's own always-log contract. Not
// touched here — consolidating the two is a candidate for its own prompt,
// not a decision to make silently inside this one.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { gapReconciliationsAvailable } from '@/lib/document-extraction-capability';
import { runReconciliationForOrg } from '@/lib/reconciliation';

export const maxDuration = 60;

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: true, ran: false, reason: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, ran: false, reason: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, ran: false, reason: 'No organization.' }, { status: 403 });
  const orgId = member.org_id as string;

  if (!(await gapReconciliationsAvailable())) return NextResponse.json({ ok: true, ran: false, reason: 'not configured' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  let outcome;
  try {
    outcome = await runReconciliationForOrg(admin, apiKey, orgId);
  } catch (e) {
    // Belt-and-braces: reconcileGapCandidates already catches its OWN model
    // call and reports it via outcome.error below, but an earlier step
    // (readExistingClaims, readReconcilableDocuments — outside that
    // try/catch) throwing should still end in a real response, never a bare
    // 500 that looks like silence from the caller's side.
    console.error(`[reconciliation/run] org=${orgId} threw:`, (e as Error).message);
    return NextResponse.json({ ok: false, ran: false, reason: (e as Error).message });
  }

  // Prompt 465 §B — never silent: every call logs its own outcome, so
  // "did reconciliation actually run, for which org" is always answerable
  // from the logs, not just inferred from an absence of new rows.
  if (outcome.error) {
    console.error(`[reconciliation/run] org=${orgId} failed:`, outcome.error);
    return NextResponse.json({ ok: false, ran: false, reason: outcome.error });
  }
  console.log(`[reconciliation/run] org=${orgId} ran=${outcome.ran} autoLinked=${outcome.autoLinked} suggested=${outcome.suggested} uncovered=${outcome.uncovered}`);
  return NextResponse.json({
    ok: true, ran: outcome.ran,
    autoLinked: outcome.autoLinked, suggested: outcome.suggested, uncovered: outcome.uncovered,
    reason: outcome.ran ? undefined : 'Nothing to reconcile — signature unchanged.',
  });
}
