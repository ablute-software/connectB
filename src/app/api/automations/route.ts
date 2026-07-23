// Automation engine tick — production entry point (Vercel cron).
// vercel.json schedules: { "crons": [{ "path": "/api/automations", "schedule": "0 * * * *" }] }
//
// In demo mode the same logic runs client-side (store.runAutomationTick). When Supabase
// is connected, this route: loads the org's data with the service role, evaluates the
// triggers in src/lib/rules.ts, writes automation_runs, executes full_auto runs whose
// pre-flight is green (email via Resend only, verified addresses only), and logs
// executed runs as interactions.
import { NextResponse } from 'next/server';

export async function GET() {
  const configured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!configured) {
    return NextResponse.json({
      ok: false,
      message: 'Database not configured — engine runs in demo mode (client-side tick from the Outbox page).',
    });
  }
  // TODO: implement server-side tick — see src/lib/rules.ts (pure functions, ready to reuse).
  return NextResponse.json({ ok: true, message: 'Engine tick placeholder — not yet wired to the real database.' });
}
