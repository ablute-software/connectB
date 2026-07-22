// Returns the current user + resolved role, for the client shell to adapt navigation.
import { NextResponse } from 'next/server';
import { serverClient, resolveRole, authEnabled } from '@/lib/supabase-server';

export async function GET() {
  if (!authEnabled) return NextResponse.json({ authEnabled: false, user: null, role: 'none' });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ authEnabled: true, user: null, role: 'none' });
  const role = await resolveRole(user.id, user.email, sb);
  return NextResponse.json({ authEnabled: true, user: { id: user.id, email: user.email }, role });
}
