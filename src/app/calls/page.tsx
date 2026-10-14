'use client';
// Prompt 907 (I4) — "Calls" in a startup's workspace: open calls, my applications and past applications (spec §20). Behind the Calls switch:
// with CALLS_MODE=off the menu entry is absent and the routes answer 404.
import { ApplicantCalls } from '@/components/calls/applicant/ApplicantCalls';

export default function CallsPage() {
  return <div className="mx-auto max-w-5xl p-4 sm:p-6"><ApplicantCalls /></div>;
}
