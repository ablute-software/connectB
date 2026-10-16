// The build this server is serving, for the "new version available" banner (src/components/NewVersionBanner.tsx). Public (the banner also shows on the login page),
// read-only, never cached by the browser, the edge or a proxy: a cached answer would hide the very change it exists to report. It carries nothing but the build id.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? null }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
