// Prompt 914 — the rehearsal script is only worth running if it rehearses THE migration and THE cases the TypeScript test runs.
// It embeds the migration text (it has to: the migration is applied inside the same transaction, so the old/new comparison runs
// against production data without committing anything) and it is GENERATED from effective-plan-cases.json, the file
// effective-plan.test.ts reads. An embedded or generated copy drifts the moment someone edits one side; this pins them together,
// and pins the property that makes the rehearsal safe to run against production: one statement, no way to commit.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import cases from './effective-plan-cases.json';

const root = path.resolve(__dirname, '../..');
const norm = (t: string) => t.replace(/\r\n/g, '\n');
const migration = norm(readFileSync(path.join(root, 'supabase/migrations/20261013170000_effective_plan.sql'), 'utf8')).trim();
const script = norm(readFileSync(path.join(root, 'scripts/verify-effective-plan-914.sql'), 'utf8'));
const START = '-- >>> MIGRATION (verbatim) >>>';
const END = '-- <<< MIGRATION <<<';
const executable = script.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('scripts/verify-effective-plan-914.sql', () => {
  it('embeds the migration exactly, between its two markers', () => {
    const start = script.indexOf(START);
    const end = script.indexOf(END);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(script.slice(start + START.length, end).trim()).toBe(migration);
  });

  it('is exactly what the composer produces from the templates, the migration and the shared cases (no hand edits, no stale cases)', async () => {
    const composer = await import(/* @vite-ignore */ pathToFileURL(path.join(root, 'scripts/compose-effective-plan-rehearsal.mjs')).href);
    expect(composer.compose()).toBe(script);
  });

  it('is a single DO statement that ends by raising, so nothing it does (the migration included) can commit', () => {
    expect(executable.match(/\$rehearsal\$/g)).toHaveLength(2);
    expect(executable.trimStart().startsWith('do $rehearsal$')).toBe(true);
    expect(executable.trimEnd().endsWith('$rehearsal$;')).toBe(true);
    // the last statement before the closing tag is the exception that carries the result and rolls everything back
    expect(executable).toMatch(/raise exception E'REHEARSAL_RESULT[^;]*;\s*end\s*\$rehearsal\$;\s*$/);
    // no transaction control anywhere in the executable text
    expect(executable).not.toMatch(/\b(commit|rollback|savepoint)\b/i);
  });

  it('runs every case of the shared list that the database can hold, and says which it skips', () => {
    const runnable = [...cases.fixtures, ...cases.matrix];
    for (const c of runnable) expect(script, c.id).toContain(`pg_temp.zz_check('${c.id} ${c.label.replace(/'/g, "''")}'`);
    for (const c of cases.real) {
      expect(script, c.id).toContain(`${c.id} LIVE`);
      expect(script, c.id).toContain(`public.effective_plan('${c.orgId}'::uuid)`);
    }
    for (const c of cases.typescriptOnly) expect(script, c.id).toContain(`${c.id} — ${c.label}: not run here`);
    // each expected value in the script is the one in the JSON (the generator, not a copy, wrote it)
    const checks = executable.match(/perform pg_temp\.zz_check\('(?:zz\d|m\d\d|r\d)[^\n]*\n?/g) ?? [];
    expect(checks).toHaveLength(runnable.length + cases.real.length);
  });

  it('carries the proofs that make the old-versus-new comparison mean something', () => {
    // B0: the real production functions, called as a member — the bug this migration also repairs is shown, not assumed
    expect(script).toContain("'B0 production today: ai_wallet_status() called by a member raises 42702");
    expect(script).toContain("'B0 production today: charge_ai_action() called by the same member works");
    // A1: new minus the Prompt 914 block (and, for the status function, minus the qualification) is byte-for-byte the old text
    expect(script).toContain("'A1 ai_wallet_status: new definition minus the Prompt 914 block and minus the column qualification is byte-for-byte the old one'");
    expect(script).toContain("'A1 charge_ai_action: new definition minus the Prompt 914 block is byte-for-byte the old one'");
    // A3 / A0: the controls that stop the equalities from being vacuous
    expect(script).toContain("'A0 control:");
    expect(script).toContain("'A3 control:");
    // the app path: role authenticated, with a control that the function itself is refused to that role
    expect(script).toContain("execute 'set local role authenticated'");
    expect(script).toContain("'P1 control: as authenticated effective_plan() itself is refused");
  });
});

describe('the migration itself', () => {
  it('marks the Prompt 914 block in both wallet functions, so the rehearsal can remove it and compare', () => {
    expect(migration.match(/-- >>> Prompt 914/g)).toHaveLength(2);
    expect(migration.match(/-- <<< Prompt 914/g)).toHaveLength(2);
    expect(migration.match(/v_plan := public\.effective_plan\(p_org_id\);/g)).toHaveLength(2);
  });

  it('keeps effective_plan() internal: revoked from the client roles, granted to the service role', () => {
    expect(migration).toContain('revoke execute on function public.effective_plan(uuid) from public, anon, authenticated;');
    expect(migration).toContain('grant execute on function public.effective_plan(uuid) to service_role;');
    expect(migration).toMatch(/create or replace function public\.effective_plan\(p_org_id uuid\)[\s\S]*?security definer\s+set search_path to ''/);
  });

  it('qualifies the exemption columns in ai_wallet_status (the 42702 repair) and only there', () => {
    const wallet = migration.slice(migration.indexOf('create or replace function public.ai_wallet_status'), migration.indexOf('create or replace function public.charge_ai_action'));
    expect(wallet).toContain('(orgs.is_test or orgs.is_internal)');
    expect(wallet).not.toMatch(/\(is_test or is_internal\)/);
    // charge_ai_action has no OUT column called is_test: it is left exactly as production has it
    const charge = migration.slice(migration.indexOf('create or replace function public.charge_ai_action'));
    expect(charge).toContain('(is_test or is_internal)');
  });

  it('does not write orgs.plan and does not touch the plan numbers (the prompt\'s own prohibitions)', () => {
    const code = migration.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/update\s+public\.orgs\s+set\s+plan\b/i);
    expect(code).not.toMatch(/\bupdate\s+public\.plans\b/i);
    expect(code).not.toMatch(/\binsert\s+into\s+public\.plans\b/i);
  });
});
