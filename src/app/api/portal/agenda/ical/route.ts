// Investor Workspace Agenda — iCal export (Prompt 83 Bloco 5, the one
// documented omission from Prompt 59/74). Session-gated download, same
// security model as the Pipeline/Archive CSV export (prompt 62.4) — not a
// webcal:// subscription feed. InvestorAgendaPanel.tsx's own prior comment
// flagged a live subscription as needing a stable per-investor secret token
// (generation/storage/revocation), which is a real schema change and stays
// out of scope here; this is the "cheap to do now" version: click, get a
// snapshot .ics, import it into whatever calendar app you use.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { getAgendaItems, type AgendaItem } from '@/lib/investor-agenda';

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// RFC 5545 line folding — content lines must not exceed 75 octets;
// continuation lines start with a single space.
function foldLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const out: string[] = [];
  let rest = line;
  let first = true;
  while (Buffer.byteLength(rest, 'utf8') > (first ? 75 : 74)) {
    const limit = first ? 75 : 74;
    let cut = limit;
    while (cut > 0 && Buffer.byteLength(rest.slice(0, cut), 'utf8') > limit) cut -= 1;
    out.push((first ? '' : ' ') + rest.slice(0, cut));
    rest = rest.slice(cut);
    first = false;
  }
  out.push(' ' + rest);
  return out.join('\r\n');
}

function toICSDateTime(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function toICSDateOnly(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function eventToLines(item: AgendaItem): string[] {
  const allDay = item.kind === 'round_close';
  const uid = `${item.kind}-${item.orgId}-${item.followupId ?? item.date}@sherlockdeal.com`;
  const lines = [
    'BEGIN:VEVENT',
    foldLine(`UID:${uid}`),
    foldLine(`DTSTAMP:${toICSDateTime(new Date().toISOString())}`),
    allDay ? foldLine(`DTSTART;VALUE=DATE:${toICSDateOnly(item.date)}`) : foldLine(`DTSTART:${toICSDateTime(item.date)}`),
    foldLine(`SUMMARY:${escapeText(item.title)}`),
    foldLine(`DESCRIPTION:${escapeText(item.orgName)}`),
    'END:VEVENT',
  ];
  return lines;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const items = await getAgendaItems(admin, sb, user.id, email);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sherlock Deal//Investor Agenda//EN',
    'CALSCALE:GREGORIAN',
    ...items.flatMap(eventToLines),
    'END:VCALENDAR',
  ];

  return new NextResponse(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sherlock-deal-agenda.ics"',
    },
  });
}
