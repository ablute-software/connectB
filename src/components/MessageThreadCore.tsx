'use client';
// Prompt 397 §B.4.1 — the thread+composer core, extracted out of
// MessageInvestorDrawer so it can be mounted two ways: inside the drawer's
// own chrome (unchanged, other pages) and inline in the entity page's
// conversation panel (Message mode, Prompt 397 §B.4 — no drawer chrome).
import Link from 'next/link';
import { DealThreadView } from '@/components/deal-messages/DealThreadView';
import { useStore } from '@/lib/store';

export function MessageThreadCore({
  entityId, investorCatalogEntityId, initialBody,
}: {
  entityId: string;
  investorCatalogEntityId: string;
  // Block F — an NDA-request draft, review-before-send (see DealThreadView).
  initialBody?: string;
}) {
  // Prompt 210 §A.1 — the Vault, ordered by folder so it's fast to find.
  const { db } = useStore();
  const attachable = db.documents
    .map((d) => ({
      id: d.id, name: d.name,
      folder: db.folders.find((f) => f.id === d.folder_id)?.name ?? '',
    }))
    .sort((a, b) => (a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name)))
    .map((d) => ({ id: d.id, name: d.folder ? `${d.folder} · ${d.name}` : d.name }));

  return (
    <>
      <DealThreadView
        viewerSide="founder"
        fetchUrl={`/api/founder/messages?entityId=${entityId}`}
        postUrl="/api/founder/messages"
        extraPostBody={{ investorCatalogEntityId }}
        attachableDocuments={attachable}
        initialBody={initialBody}
      />
      {/* Prompt 210 §A.3 — no direct-from-computer attach, on purpose:
          everything that circulates has to be in the Vault (view-only,
          versioned, tracked). */}
      <p className="mt-2 text-[11px] text-gray-400">
        Only Vault documents can be attached — that&apos;s what keeps them view-only, versioned and tracked.{' '}
        <Link href="/documents" className="font-medium text-[#0E7490] hover:underline">Upload to the Vault first</Link>.
      </p>
    </>
  );
}
