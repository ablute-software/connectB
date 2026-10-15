// Prompt 918 — the rehearsal script is only worth running if it rehearses THE migration. It embeds the migration text (it has to: the
// migration is applied inside the same statement, so the old/new comparison runs against production data without committing anything),
// and an embedded copy drifts the moment someone edits one side. This pins the two together, pins the property that makes the rehearsal
// safe to run against production (one statement, no way to commit), and pins the rollback to the migration: whatever the migration adds,
// the rollback must remove.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const norm = (t: string) => t.replace(/\r\n/g, '\n');
const read = (p: string) => norm(readFileSync(path.join(root, p), 'utf8'));
const code = (t: string) => t.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const migration = read('supabase/migrations/20261015130000_company_badges_public_source.sql').trim();
const script = read('scripts/verify-company-badges-918.sql');
const rollback = read('scripts/rollback-company-badges-918.sql');
const START = '-- >>> MIGRATION (verbatim) >>>';
const END = '-- <<< MIGRATION <<<';

describe('scripts/verify-company-badges-918.sql', () => {
  it('is exactly what the composer produces (head + migration + tail), so editing one side without the other fails here', async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(root, 'scripts/compose-company-badges-918-rehearsal.mjs')).href)) as { compose: () => string };
    expect(script).toBe(mod.compose());
  });

  it('embeds the migration exactly, between its two markers', () => {
    const start = script.indexOf(START);
    const end = script.indexOf(END);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(script.slice(start + START.length, end).trim()).toBe(migration);
  });

  it('is a single DO statement that ends by raising, so nothing it does (the migration included) can commit', () => {
    const body = code(script);
    expect(body.match(/\$rehearsal\$/g)).toHaveLength(2);
    expect(body.trimStart().startsWith('do $rehearsal$')).toBe(true);
    expect(body.trimEnd().endsWith('$rehearsal$;')).toBe(true);
    // the last statement before the closing tag is the exception that carries the result and rolls everything back
    expect(body).toMatch(/raise exception E'REHEARSAL_RESULT[^;]*;\s*end\s*\$rehearsal\$;\s*$/);
    // no transaction control anywhere in the executable text
    expect(body).not.toMatch(/\b(commit|rollback|savepoint)\b/i);
  });
});

describe('scripts/rollback-company-badges-918.sql', () => {
  const added = code(migration);
  const undone = code(rollback);

  it('drops every column the migration adds', () => {
    const columns = [...added.matchAll(/add column if not exists (\w+)/g)].map((m) => m[1]);
    expect(columns.sort()).toEqual(['kind', 'logo_url', 'source_found_by', 'source_title', 'source_url', 'updated_at']);
    for (const c of columns) expect(undone).toMatch(new RegExp(`drop column if exists ${c}\\b`));
  });

  it('drops every constraint, trigger and function the migration creates', () => {
    const constraints = [...added.matchAll(/add constraint (\w+)/g)].map((m) => m[1]);
    expect(constraints).toHaveLength(4);
    for (const c of constraints) expect(undone).toContain(`drop constraint if exists ${c}`);

    const triggers = [...added.matchAll(/create trigger (\w+)/g)].map((m) => m[1]);
    expect(triggers.sort()).toEqual(['company_badges_protect_verification', 'company_badges_touch']);
    for (const t of triggers) expect(undone).toContain(`drop trigger if exists ${t} on public.company_badges`);

    const functions = [...added.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]);
    expect(functions).toEqual(['company_badges_protect_verification']);
    for (const f of functions) expect(undone).toContain(`drop function if exists public.${f}()`);
  });

  it('removes the metered action when nothing was charged, and only switches it off when something was (ai_credit_charges has no cascade)', () => {
    expect(added).toContain("'badge_verification'");
    expect(undone).toMatch(/delete from public\.ai_actions[\s\S]*key = 'badge_verification'[\s\S]*not exists \(select 1 from public\.ai_credit_charges/);
    expect(undone).toMatch(/update public\.ai_actions set enabled = false where key = 'badge_verification'/);
  });

  it('puts the one demoted row back only while it is exactly as the backfill left it', () => {
    expect(undone).toContain("where id = '2cf54c37-8e9b-4aeb-b817-ab77288dccc2'");
    expect(undone).toContain("and verification_status = 'unverified'");
    expect(undone).toContain("and verification_note = 'Re-verify to attach a public source'");
  });

  it('runs the restore BEFORE the columns go and never drops a table', () => {
    expect(undone.indexOf('update public.company_badges')).toBeGreaterThan(-1);
    expect(undone.indexOf('update public.company_badges')).toBeLessThan(undone.indexOf('drop column if exists source_url'));
    expect(undone).not.toMatch(/drop table/i);
  });
});
