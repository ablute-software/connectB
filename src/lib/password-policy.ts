// Prompt 126 B / Prompt 119 §4.3 D3 — ONE password policy for the whole
// platform (founder signup, forgot/reset-password, and the new investor
// password screen), exported from one place so it's impossible for two
// surfaces to silently drift into two different rules. Minimum 10
// characters, at least one uppercase, one lowercase, one digit, one
// special character.
//
// §4.4 — this file is a CLIENT-SIDE CONVENIENCE (the live indicator that
// shows what's still missing as the person types), not the real
// enforcement. The only place this is actually imposed is the Supabase
// Auth project's own password policy (minimum length + required character
// classes), which is server-side project configuration, not a migration —
// deliberately NOT touched here. Every password-setting call site in this
// app must still show whatever error the server itself returns, verbatim,
// for the day the two policies diverge (they should be kept in sync, but
// this file is not the source of truth for what the server accepts).
export const PASSWORD_MIN_LENGTH = 10;

export interface PasswordRequirementCheck {
  minLength: boolean;
  hasUpper: boolean;
  hasLower: boolean;
  hasDigit: boolean;
  hasSpecial: boolean;
  valid: boolean;
}

export function checkPassword(password: string): PasswordRequirementCheck {
  const minLength = password.length >= PASSWORD_MIN_LENGTH;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  return { minLength, hasUpper, hasLower, hasDigit, hasSpecial, valid: minLength && hasUpper && hasLower && hasDigit && hasSpecial };
}
