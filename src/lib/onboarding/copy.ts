// Prompt 552 — onboarding copy carries one token, and something actually
// interpolates it.
//
// THE BUG. Prompt 333 pasted the four Welcome steps "exact copy as given",
// and the copy as given used `[Company]` as a stand-in for the company
// name. Nothing anywhere replaced it: WelcomeModal renders the step body
// verbatim and nothing under src/lib/onboarding/ or
// src/components/onboarding/ ever read the org name. So the placeholder
// shipped as literal text and a founder's first screen said "About
// [Company] is where you build your company's profile" — with the sidebar
// right beside it correctly reading "about ablute_", because shell.tsx
// builds that label from db.org.name at render time and the modal never
// did the same.
//
// A bare `[Company]` is indistinguishable from prose a writer meant to
// keep, which is exactly why it survived review. `{company}` is not: it
// reads as a slot, and the test below asserts that the content file
// contains no `[Company]` and no token other than this one.
export const COMPANY_TOKEN = '{company}';

// The same fallback shell.tsx:157 uses for its sidebar label ("about your
// company"), so the modal and the sidebar can never disagree about what an
// unnamed org is called.
export const COMPANY_FALLBACK = 'your company';

export interface OnboardingCopyContext {
  company: string | null | undefined;
}

export function renderOnboardingCopy(text: string, ctx: OnboardingCopyContext): string {
  const company = ctx.company?.trim() ? ctx.company.trim() : COMPANY_FALLBACK;
  // split/join, never `String.replace(token, company)`. In a string
  // replacement `$&`, `$1`, `` $` `` and `$'` are substitution patterns, so
  // a company legitimately named "M&A $1 Ventures" would come out mangled
  // or duplicated. split/join treats the value as literal text, always, and
  // replaces every occurrence rather than only the first — which a bare
  // string `replace` would also have got wrong.
  return text.split(COMPANY_TOKEN).join(company);
}
