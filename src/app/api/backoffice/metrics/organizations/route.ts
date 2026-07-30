import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { actionLists, startupOrgRows, investorOrgRows } from '@/lib/backoffice-metrics';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [lists, startups, investors] = await Promise.all([actionLists(admin), startupOrgRows(admin), investorOrgRows(admin)]);

  return NextResponse.json({ ok: true, lists, startups, investors });
}
