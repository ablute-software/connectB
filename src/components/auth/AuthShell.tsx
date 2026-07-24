// Standalone layout for the auth pages (login/signup/forgot-password/
// reset-password): a full-viewport decorative backdrop (dark teal gradient +
// blurred shapes + frosted glass) with the page's own card floating on top.
// No app chrome — Shell early-returns bare children on these routes so this
// is the only thing that renders. Purely presentational; each page keeps its
// own card markup/logic and just wraps it in this instead of a plain flex-
// center div.
import Link from 'next/link';
import s from './auth-shell.module.css';

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className={s.backdrop} aria-hidden="true">
        <span className={`${s.shape} ${s.shape1}`} />
        <span className={`${s.shape} ${s.shape2}`} />
        <span className={`${s.shape} ${s.shape3}`} />
        <div className={s.glass} />
      </div>
      <div className="relative z-10 flex w-full flex-col items-center gap-4">
        <Link href="/" className="text-sm font-medium text-white/70 transition hover:text-white">
          ← Back to sherlockdeal.com
        </Link>
        {children}
      </div>
    </div>
  );
}
