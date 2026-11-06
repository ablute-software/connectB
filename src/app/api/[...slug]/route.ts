// Prompt 933 — an /api path that no route answers: 404 as JSON, never the HTML page. The middleware answers the paths whose first segment no folder of src/app/api owns (no route could be there, with a session or
// without one); this answers the rest — a path inside a zone that has no such route, for a caller with a session (without one the zone sends them to /login first) — and every case when the middleware is off, since
// demo mode lets every request through. Next gives a specific route precedence over a catch-all, so no existing route changes: only the paths that used to fall through to the HTML 404 land here.
import { NextResponse } from 'next/server';
import { withoutViewer } from '@/lib/acting-org';

export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ ok: false, error: 'not_found', message: 'There is no such API route.' }, { status: 404 });

export const GET = notFound;
export const HEAD = notFound;
export const OPTIONS = notFound;
// A write to a route that does not exist writes nothing, and the answer is the same. The wrapper is only there so that src/lib/acting-org-guard.test.ts keeps its rule — no write handler left unwrapped — without an exception.
export const POST = withoutViewer(async function POST() { return notFound(); });
export const PUT = withoutViewer(async function PUT() { return notFound(); });
export const PATCH = withoutViewer(async function PATCH() { return notFound(); });
export const DELETE = withoutViewer(async function DELETE() { return notFound(); });
