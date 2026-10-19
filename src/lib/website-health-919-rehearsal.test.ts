// Prompt 919 — the rehearsal script is only worth running if it rehearses THE migration. It embeds the migration text (it has to: the
// migration is applied inside the same statement, so the checks run against production data without committing anything), and an
// embedded copy drifts the moment someone edits one side. This pins the two together, pins the property that makes the rehearsal safe to
// run against production (one statement, no way to commit), and pins the rollback to the migration: whatever the migration adds, the
// rollback must remove.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const norm = (t: string) => t.replace(/\r\n/g, '\n');
const read = (p: string) => norm(readFileSync(path.join(root, p), 'utf8'));
const code = (t: string) => t.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const migration = read('supabase/migrations/20261016140000_website_health.sql').trim();
const script = read('scripts/verify-website-health-919.sql');
const rollback = read('scripts/rollback-website-health-919.sql');
const START = '-- >>> MIGRATION (verbatim) >>>';
const END = '-- <<< MIGRATION <<<';

describe('scripts/verify-website-health-919.sql', () => {
  it('is exactly what the composer produces (head + migration + tail), so editing one side without the other fails here', async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(root, 'scripts/compose-website-health-919-rehearsal.mjs')).href)) as { compose: () => string };
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
    expect(body).toMatch(/raise exception E'REHEARSAL_RESULT[^;]*;\s*end\s*\$rehearsal\$;\s*$/);
    expect(body).not.toMatch(/\b(commit|rollback|savepoint)\b/i);
  });
});

describe('scripts/rollback-website-health-919.sql', () => {
  const added = code(migration);
  const undone = code(rollback);

  it('drops the table and its policy, and the column the migration adds', () => {
    const tables = [...added.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
    expect(tables).toEqual(['org_website_audits']);
    for (const t of tables) expect(undone).toContain(`drop table if exists public.${t}`);
    const policies = [...added.matchAll(/create policy (\w+)/g)].map((m) => m[1]);
    expect(policies).toEqual(['org_website_audits_member_read']);
    for (const p of policies) expect(undone).toContain(`drop policy if exists ${p}`);
    const columns = [...added.matchAll(/add column if not exists (\w+)/g)].map((m) => m[1]);
    expect(columns).toEqual(['website_score_visible']);
    for (const c of columns) expect(undone).toMatch(new RegExp(`drop column if exists ${c}\\b`));
  });

  it('removes the metered action when nothing was charged, and only switches it off when something was (ai_credit_charges has no cascade)', () => {
    expect(added).toContain("'website_summary'");
    expect(undone).toMatch(/delete from public\.ai_actions[\s\S]*key = 'website_summary'[\s\S]*not exists \(select 1 from public\.ai_credit_charges/);
    expect(undone).toMatch(/update public\.ai_actions set enabled = false where key = 'website_summary'/);
  });

  it('drops the policy before the table and the table before anything else it might depend on', () => {
    expect(undone.indexOf('drop policy')).toBeLessThan(undone.indexOf('drop table'));
  });
});
