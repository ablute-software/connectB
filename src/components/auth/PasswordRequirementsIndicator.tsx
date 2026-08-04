'use client';
// Prompt 126 B / 119 §4.3 D3 — the 4-requirement indicator, shared by
// founder signup, reset-password, and the new investor set-password
// screen. Showing what's still missing (not just an error at the end) is
// what actually gets people to comply, per the prompt's own instruction.
import { checkPassword, PASSWORD_MIN_LENGTH } from '@/lib/password-policy';

function Requirement({ met, label }: { met: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-1.5 text-xs ${met ? 'text-emerald-700' : 'text-gray-400'}`}>
      <span aria-hidden="true">{met ? '✓' : '·'}</span>
      <span>{label}</span>
    </li>
  );
}

export function PasswordRequirementsIndicator({ password }: { password: string }) {
  const r = checkPassword(password);
  return (
    <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
      <Requirement met={r.minLength} label={`At least ${PASSWORD_MIN_LENGTH} characters`} />
      <Requirement met={r.hasUpper} label="One uppercase letter" />
      <Requirement met={r.hasLower} label="One lowercase letter" />
      <Requirement met={r.hasDigit} label="One number" />
      <Requirement met={r.hasSpecial} label="One special character" />
    </ul>
  );
}
