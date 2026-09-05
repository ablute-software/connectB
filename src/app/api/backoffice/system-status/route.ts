// Prompt 576 Fase 2 §7 — the unified 4-signal list. The actual checks live
// in src/lib/system-status.ts so Attention (which surfaces only the
// non-ok ones) can call the exact same functions, never a second definition.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { getSystemSignals, type SystemSignal } from '@/lib/system-status';

export type { SystemSignal };

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const signals = await getSystemSignals(auth.admin);
  return NextResponse.json({ ok: true, signals });
}
