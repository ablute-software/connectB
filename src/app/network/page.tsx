'use client';
// My Network — Prompt 316 §C / Prompt 317 §D. Real page, replacing the
// Prompt 314 placeholder.
//
// Prompt 406 §A — the actual implementation moved to
// src/components/network/NetworkPageContent.tsx (see that file's own
// header comment). This stays a thin wrapper: Next's App Router page
// typegen rejects any named export or custom prop on a page.tsx file
// (confirmed empirically against `.next/types/app/network/page.ts` — a
// `viewerKind` prop here, however typed/defaulted, fails the build), and
// this is the standalone /network route, founder-only by construction —
// investors reach My Network through InvestorWorkspaceShell, which
// imports NetworkPageContent directly and never hits this route.
import { NetworkPageContent } from '@/components/network/NetworkPageContent';

export default function NetworkPage() {
  return <NetworkPageContent viewerKind="founder" />;
}
