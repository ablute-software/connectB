'use client';
// P134-C — founder side of one Sherlock messaging thread.
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { DealThreadView } from '@/components/deal-messages/DealThreadView';

export default function FounderThreadPage() {
  const params = useParams<{ threadId: string }>();
  const threadId = params.threadId;

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-8">
      <Link href="/messages" className="text-xs text-gray-400 hover:underline">← Back to Messages</Link>
      <h1 className="mt-1 text-lg font-bold text-gray-900">Conversation</h1>
      <div className="mt-3">
        <DealThreadView viewerSide="founder" fetchUrl={`/api/founder/messages/${threadId}`} postUrl={`/api/founder/messages/${threadId}`} />
      </div>
    </div>
  );
}
