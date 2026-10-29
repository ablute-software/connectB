// Prompt 924 (Etapa 4, I3) — the final export: the results, the decisions and the contestations, as CSV or Excel, only for whoever has "Final decision". One row per published result. No comment, no private note and no
// evaluation is ever in it, and a cell that a spreadsheet would read as a formula is kept as text. Recorded in the call's events. Available on a completed call too (it is how the data is taken before it is deleted).
import * as XLSX from 'xlsx';
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { safeCell } from '@/lib/calls/eval-board';
import { RESULTS_NOT_READY, resultsReady } from '@/lib/calls/results-store';
import { finalRows } from '@/lib/calls/contestations-store';

export const dynamic = 'force-dynamic';

const fileName = (name: string, ext: string): string => `${name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'call'}-results.${ext}`;
const csvCell = (v: string | number): string => { const t = typeof v === 'string' ? safeCell(v) : String(v); return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  if (!auth.perms.final_decision) return NextResponse.json({ ok: false, error: 'You do not have the “Final decision & selection overrides” permission on this call.' }, { status: 403 });
  if (!(await resultsReady(auth.admin))) return NextResponse.json(RESULTS_NOT_READY, { status: 503 });
  const format = new URL(req.url).searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  const { header, body } = await finalRows(auth.admin, auth.call);
  await auth.admin.from('call_events').insert({ call_id: auth.call.id, application_id: null, event: 'results_exported', actor_user_id: auth.userId, detail: { format, rows: body.length } });
  const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  if (format === 'csv') {
    const text = `﻿${[header, ...body].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
    return new Response(text, { status: 200, headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${fileName(auth.call.name, 'csv')}"` } });
  }
  const ws = XLSX.utils.aoa_to_sheet([header, ...body.map((r) => r.map((c) => (typeof c === 'string' ? safeCell(c) : c)))]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Results');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Response(new Uint8Array(buf), { status: 200, headers: { ...headers, 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${fileName(auth.call.name, 'xlsx')}"` } });
}
