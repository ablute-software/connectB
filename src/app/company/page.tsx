// /company merged into /dashboard (separador "Review & Optimization").
// Server component (not 'use client') so the companyCanon capability check
// runs before the redirect target is chosen — per spec: if the capability is
// off, land on plain /dashboard (no ?tab for a separador that isn't there),
// not on a tab that doesn't render.
//
// Uses redirect() (307), NOT permanentRedirect() (308), on purpose: the
// target depends on companyCanon, a capability that can flip on later (once
// migration 0020 is applied) — a 308 is cacheable by the browser and could
// keep sending a visitor to plain /dashboard even after the capability turns
// on. The other redirects in this batch have a fixed target and use 308.
import { redirect } from 'next/navigation';
import { companyCanonAvailable } from '@/lib/company-canon';

// Without this, Next prerenders the page at build time (no cookies/headers/
// searchParams read here to trigger dynamic rendering on its own) and bakes
// in whichever answer companyCanonAvailable() gave during that one build —
// exactly the staleness this redirect exists to avoid.
export const dynamic = 'force-dynamic';

export default async function CompanyRedirect() {
  const available = await companyCanonAvailable();
  redirect(available ? '/dashboard?tab=review-optimization' : '/dashboard');
}
