// IRM_SPEC §9b — real-file (entities.csv/people.csv/interactions.csv)
// import, dry-run. Runs on the founder's own session — RLS scopes every
// read to their own org, same security posture as the generic /import
// commit route. Read-only: computes the plan, writes nothing.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { parseEntitiesCsv, parsePeopleCsv, parseInteractionsCsv, buildImportPlan } from '@/lib/structured-import';
import { withActingOrg, resolveActingOrg } from '@/lib/acting-org';

export const POST = withActingOrg(async function POST(req: Request) {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { entitiesCsv, peopleCsv, interactionsCsv } = await req.json() as {
    entitiesCsv?: string; peopleCsv?: string; interactionsCsv?: string;
  };
  if (!entitiesCsv || !peopleCsv || !interactionsCsv) {
    return NextResponse.json({ ok: false, error: 'entitiesCsv, peopleCsv, and interactionsCsv are all required.' }, { status: 400 });
  }

  const acting = await resolveActingOrg(req, user, sb);
  if (!acting.orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const [{ data: entities, error: entErr }, { data: people, error: pplErr }, { data: interactions, error: intErr }] = await Promise.all([
    sb.from('entities').select('*').eq('org_id', acting.orgId),
    sb.from('people').select('*').eq('org_id', acting.orgId),
    sb.from('interactions').select('entity_id, person_id, occurred_at, direction, channel, content').eq('org_id', acting.orgId),
  ]);
  if (entErr || pplErr || intErr) {
    return NextResponse.json({ ok: false, error: (entErr ?? pplErr ?? intErr)!.message }, { status: 500 });
  }

  let plan;
  try {
    plan = buildImportPlan(
      { entities: parseEntitiesCsv(entitiesCsv), people: parsePeopleCsv(peopleCsv), interactions: parseInteractionsCsv(interactionsCsv) },
      { entities: entities ?? [], people: people ?? [], interactions: interactions ?? [] },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Failed to parse/match: ${(e as Error).message}` }, { status: 400 });
  }

  return NextResponse.json({ ok: true, plan });
});
