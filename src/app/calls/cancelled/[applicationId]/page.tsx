'use client';
// Prompt 918 (Adenda 2, C) — an application of a call the entity DELETED: for the 30 days before everything is removed, the applicant can still read what they submitted and download their files
// (and, with the browser's own "Print → Save as PDF", keep a copy of the whole page). Nothing can be changed here: the call is gone, so the form is the read-only copy of what was submitted.
import { useParams } from 'next/navigation';
import { CancelledApplication } from '@/components/calls/applicant/CancelledApplication';

export default function CancelledApplicationPage() {
  const { applicationId } = useParams<{ applicationId: string }>();
  return <div className="mx-auto max-w-3xl p-4 sm:p-6"><CancelledApplication applicationId={applicationId} /></div>;
}
