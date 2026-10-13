// Prompt 900 — the rehearsal script is only worth running if it rehearses THE migration. It embeds the migration text (it has to:
// the migration is applied inside the same transaction, so the old/new comparison runs against production data without
// committing anything), and an embedded copy drifts the moment someone edits one side. This pins the two together, and pins the
// property that makes the rehearsal safe to run against production: one statement, no way to commit.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const norm = (t: string) => t.replace(/\r\n/g, '\n');
const migration = norm(readFileSync(path.join(root, 'supabase/migrations/20261013160000_closed_deleted_accounts.sql'), 'utf8')).trim();
const script = norm(readFileSync(path.join(root, 'scripts/verify-closed-deleted-900.sql'), 'utf8'));
const START = '-- >>> MIGRATION (verbatim) >>>';
const END = '-- <<< MIGRATION <<<';

describe('scripts/verify-closed-deleted-900.sql', () => {
  it('embeds the migration exactly, between its two markers', () => {
    const start = script.indexOf(START);
    const end = script.indexOf(END);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(script.slice(start + START.length, end).trim()).toBe(migration);
  });

  it('is a single DO statement that ends by raising, so nothing it does (the migration included) can commit', () => {
    const code = script.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code.match(/\$rehearsal\$/g)).toHaveLength(2);
    expect(code.trimStart().startsWith('do $rehearsal$')).toBe(true);
    expect(code.trimEnd().endsWith('$rehearsal$;')).toBe(true);
    // the last statement before the closing tag is the exception that carries the result and rolls everything back
    expect(code).toMatch(/raise exception E'REHEARSAL_RESULT[^;]*;\s*end\s*\$rehearsal\$;\s*$/);
    // no transaction control anywhere in the executable text
    expect(code).not.toMatch(/\b(commit|rollback|savepoint)\b/i);
  });
});
