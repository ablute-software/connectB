import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Prompt 903 §A.2 — "zero type="password" outside PasswordInput.tsx and
// PinInput.tsx". The prompt asks for that as a one-off grep; a grep is read once
// and forgotten, and the bare field it removed had been copy-pasted into nine
// screens precisely because nothing stopped the next copy. This keeps it true:
// a new password field has to be a PasswordInput (and so has the eye, and a
// required autoComplete) or this fails the build.
//
// Two instruments, because a scan that quietly walks the wrong directory finds
// nothing and "found nothing" looks exactly like success: the first test proves
// the scan can see a password field at all by requiring it to find the two
// sanctioned files; only then does "no one else has one" mean anything.

// A password type written as an attribute (type="password", type='password',
// type={'password'}), a ternary (type={show ? 'text' : 'password'}) or an object
// key (type: 'password').
const PASSWORD_FIELD = /type\s*[=:]\s*(?:\{[^}]*)?['"`]password['"`]/;

// Adding to this list is a decision someone has to justify in a diff.
const SANCTIONED = ['components/PinInput.tsx', 'components/auth/PasswordInput.tsx'];

const SRC = fileURLToPath(new URL('../..', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(?:ts|tsx|js|jsx)$/.test(e.name) && !/\.test\.(?:ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

function filesDeclaringAPasswordField(): { file: string; line: number }[] {
  return sourceFiles(SRC).flatMap((full) =>
    readFileSync(full, 'utf8').split('\n').flatMap((text, i) =>
      PASSWORD_FIELD.test(text) ? [{ file: relative(SRC, full).split(sep).join('/'), line: i + 1 }] : []));
}

describe('every password field is a PasswordInput (Prompt 903 §A.2)', () => {
  it('the pattern catches every way of writing a password field, and nothing else', () => {
    for (const bad of [
      '<input type="password" />',
      "<input type='password' />",
      "<input type={'password'} />",
      "<input type={show ? 'text' : 'password'} />",
      "createElement('input', { type: 'password' })",
    ]) expect({ bad, caught: PASSWORD_FIELD.test(bad) }).toEqual({ bad, caught: true });
    for (const fine of [
      '<input autoComplete="new-password" />',
      '<input type="text" placeholder="Password *" />',
      '<input type="email" />',
      '<input type="passwordless" />',
    ]) expect({ fine, caught: PASSWORD_FIELD.test(fine) }).toEqual({ fine, caught: false });
  });

  it('the scan can see a password field: it finds exactly the two sanctioned files', () => {
    const found = [...new Set(filesDeclaringAPasswordField().map((m) => m.file))].sort();
    expect(found).toEqual([...SANCTIONED].sort());
  });

  it('no other file declares one', () => {
    const offenders = filesDeclaringAPasswordField().filter((m) => !SANCTIONED.includes(m.file));
    expect(offenders.map((m) => `${m.file}:${m.line}`)).toEqual([]);
  });
});
