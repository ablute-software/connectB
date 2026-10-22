// Prompt 907 — who may touch an application, decided in ONE place and re-checked by every applicant route (never only by what the page
// shows). Layers, in order:
//   1. Calls are not switched off (CALLS_MODE=off -> 404, as if the routes did not exist);
//   2. a signed-in user (401) who belongs to a startup (403 startup_required) — resolved by resolveActingOrg, like every founder-side route
//      (a developer in a Developer Viewer session reads, never writes: withActingOrg refuses the write before the handler runs);
//   3. for a link token: the call behind it is published and has a form (else 404); for an application id: the application belongs to
//      the caller's startup — anything else is a 404, never a 403, so nobody learns that an application exists.
import 'server-only';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActingOrg } from '@/lib/acting-org';
import { callsMode } from '../mode';
import { loadCall, loadFields, promoterName } from '../store';
import type { Call, FormField } from '../types';
import { loadApplication, type ApplicationRow } from './store';
import { resolvePublicCall, serviceClient } from './link';

export type Gate<T> = ({ error?: undefined } & T) | { error: NextResponse };
const notFound = () => NextResponse.json({ ok: false }, { status: 404 });

interface Who { admin: SupabaseClient; userId: string; email: string | null; emailConfirmed: boolean; orgId: string }

async function whoAmI(req: Request): Promise<Gate<Who>> {
  if (callsMode() === 'off') return { error: notFound() };
  const admin = serviceClient();
  if (!admin) return { error: NextResponse.json({ ok: false, error: 'not configured' }, { status: 503 }) };
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  const acting = await resolveActingOrg(req, user, sb);
  if (!acting.orgId) return { error: NextResponse.json({ ok: false, code: 'startup_required', error: 'Create your startup first.' }, { status: 403 }) };
  return { admin, userId: user.id, email: user.email ?? null, emailConfirmed: !!user.email_confirmed_at, orgId: acting.orgId };
}

/** For a link token: the call must be published and have a form. */
export async function authApplicantByToken(req: Request, token: string): Promise<Gate<Who & { call: Call; fields: FormField[] }>> {
  const me = await whoAmI(req);
  if (me.error) return me;
  const found = await resolvePublicCall(me.admin, token);
  if (!found) return { error: notFound() };
  return { ...me, call: found.call, fields: found.fields };
}

/** For an application id: it must be the caller's startup's. */
export async function authApplication(req: Request, applicationId: string): Promise<Gate<Who & { call: Call; fields: FormField[]; app: ApplicationRow; promoter: string }>> {
  const me = await whoAmI(req);
  if (me.error) return me;
  const app = /^[0-9a-f-]{36}$/i.test(applicationId) ? await loadApplication(me.admin, applicationId) : null;
  if (!app || app.orgId !== me.orgId) return { error: notFound() };
  // A DELETED call (Prompt 918, Adenda 2, C) is still readable here — for the 30 days the applicant can look at what they submitted and download their files — but nothing can be started,
  // saved, uploaded or submitted on it: every request that is not a read answers 410.
  const call = await loadCall(me.admin, app.callId, { includeDeleted: true });
  if (!call) return { error: notFound() };
  if (call.deletedAt && req.method !== 'GET') return { error: NextResponse.json({ ok: false, code: 'call_deleted', error: 'This call is no longer available.' }, { status: 410 }) };
  const [fields, promoter] = await Promise.all([loadFields(me.admin, call.id), promoterName(me.admin, call.promoterKind, call.promoterId)]);
  return { ...me, call, fields, app, promoter };
}
