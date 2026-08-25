// Prompt 375 §B — "visível em lado nenhum silencioso": a 401/403 from
// VirusTotal must never disappear into a 'pending' status that looks like
// a normal in-progress scan. This gives the backoffice a live, on-demand
// answer to "is the scanner actually misconfigured right now" — a real
// credential check (checkVirusTotalKeyHealth), not a stored flag that
// could go stale.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { checkVirusTotalKeyHealth } from '@/lib/upload-security';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const health = await checkVirusTotalKeyHealth();
  return NextResponse.json(health);
}
