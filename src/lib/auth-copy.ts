// Prompt 906 §C — words on the sign-in screens that a test has to be able to hold on to.
//
// "Forgot your password?" answers the same thing for every address, because the server must not say whether an
// account exists (Supabase's resetPasswordForEmail answers ok either way, on purpose). The screen used to read "If
// <address> has an account, we've sent a reset link" — true to the letter, and still a promise of an email that,
// for a founder who typed another address than the one they signed up with (João Loureiro, 12/10), could never
// arrive. This sentence promises nothing it cannot keep, and tells the reader the two things that are in their hands:
// look in spam, and check it is the address they registered with. It must never name or hint whether the account
// exists.
export const FORGOT_PASSWORD_SENT_COPY =
  "If an account exists for this address, you'll receive an email in a minute. Check spam, and make sure it's the address you signed up with.";
