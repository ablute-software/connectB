// Prompt 922 (I4) — the board as a file (CSV or Excel), only for whoever has "Final decision". One row per application: rank, reference, startup, evaluations, average, deviation, the average of each criterion, the flags and
// the decision. No comment is ever exported — neither the evaluators' comments nor the private notes — and a cell that a spreadsheet would read as a formula is kept as text. The export is recorded in the call's events.
import * as XLSX from 'xlsx';
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { boardCsv, boardTable, safeCell } from '@/lib/calls/eval-board';
import { loadBoard } from '@/lib/calls/eval-board-store';
import { NOT_READY_BODY, evaluationReady } from '@/lib/calls/eval-grid-store';

export const dynamic = 'force-dynamic';

const fileName = (name: string, ext: string): string => `${name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'call'}-evaluation.${ext}`;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  if (!auth.perms.final_decision) return NextResponse.json({ ok: false, error: 'You do not have the “Final decision & selection overrides” permission on this call.' }, { status: 403 });
  if (!(await evaluationReady(auth.admin))) return NextResponse.json(NOT_READY_BODY, { status: 503 });
  const format = new URL(req.url).searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  const board = await loadBoard(auth.admin, auth.call);
  await auth.admin.from('call_events').insert({ call_id: auth.call.id, application_id: null, event: 'eval_exported', actor_user_id: auth.userId, detail: { format, rows: board.rows.length } });
  const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  if (format === 'csv') return new Response(boardCsv(board.rows, board.criteria), { status: 200, headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${fileName(auth.call.name, 'csv')}"` } });
  const { header, body } = boardTable(board.rows, board.criteria);
  const ws = XLSX.utils.aoa_to_sheet([header, ...body.map((r) => r.map((c) => (typeof c === 'string' ? safeCell(c) : c)))]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Evaluation');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Response(new Uint8Array(buf), { status: 200, headers: { ...headers, 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${fileName(auth.call.name, 'xlsx')}"` } });
}
