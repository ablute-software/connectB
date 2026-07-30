// Investor Workspace Interoperability (prompt 62.4) — minimal CSV writer.
// Pure, no dependency: quotes a field only when it contains a comma, quote,
// or newline, doubling internal quotes per RFC 4180.
function csvField(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(csvField).join(',');
  const body = rows.map((row) => columns.map((c) => csvField(row[c])).join(','));
  return [header, ...body].join('\r\n');
}
