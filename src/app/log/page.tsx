'use client';
// Prompt 400 §B.2 — /log is now a legacy redirect. Its whole feature
// surface was absorbed into the entity dossier's own conversation panel
// (Prompt 397 §B/§C, Prompt 400 §B.1: Draft with AI, material shared via
// Vault attachments, amount asked, next-action suggestion, Gmail send) —
// this file used to BE that form; every internal link that pointed here
// now points straight at ?rail=log on the entity page instead (grep
// confirms zero remaining internal /log?... links outside this file).
// This redirect exists only for old bookmarks and any link that still
// exists outside this codebase. Read in full before this rewrite; the one
// piece deliberately NOT carried forward into the panel is the web-form
// assist flow (channel === 'web_form', WebFormAssistPanel.tsx) — Prompt
// 400 §B.1.1's own text pre-approved leaving that where it was ("fica onde
// está por agora"), which is now unreachable now that this page no longer
// renders a form of its own. WebFormAssistPanel.tsx itself is left in
// place, not deleted, since this is a deferred feature, not a cancelled
// one — flagged in the Prompt 400 report, not silently dropped.
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { conversationDeepLink } from '@/lib/conversation-deep-link';

function LogRedirect() {
  const router = useRouter();
  const sp = useSearchParams();

  useEffect(() => {
    const entity = sp.get('entity');
    if (!entity) { router.replace('/tasks'); return; }
    // Prompt 893 §A — redirects straight to the new deep-link form now
    // (?tab=conversation&mode=log), one layer of legacy redirect fewer for
    // anyone still holding an old /log?... bookmark. The ?rail=log form
    // this used to target still works too (30-day alias on the entity
    // page itself), so this change is not load-bearing for anyone.
    router.replace(conversationDeepLink(entity, 'log', {
      person: sp.get('person') ?? undefined,
      // Prompt 372 Block D's own shape (documents/requests/[id]/page.tsx
      // links straight at the new form directly now, but this keeps any
      // OLDER bookmark of the pre-893 /log?... link working too).
      direction: sp.get('direction') ?? undefined,
      date: sp.get('date') ?? undefined,
      content: sp.get('content') ?? undefined,
    }));
  }, [router, sp]);

  return <div className="text-sm text-gray-400">Redirecting…</div>;
}

export default function LogPage() {
  return <Suspense fallback={null}><LogRedirect /></Suspense>;
}
