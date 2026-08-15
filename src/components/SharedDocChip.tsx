'use client';
// Prompt 202 §F — "que deck é que eles viram?" respondido no próprio
// histórico. Um único componente para os dois sítios que o mostram (as
// linhas inline da entity page e o ThreadDrawer), para a resposta não
// divergir entre eles.
//
// Limite honesto, herdado do modelo de dados e não escondido aqui: isto só
// cobre o que foi partilhado VIA plataforma, ou seja o que o founder
// escolheu no "Material shared" do log. Um anexo enviado por fora não existe
// para a app — é mais uma razão para o aviso do §D.
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { resolveSharedVersion } from '@/lib/interaction-history';

export function SharedDocChip({ documentId, occurredAt }: { documentId?: string; occurredAt: string }) {
  const { db } = useStore();
  if (!documentId) return null;
  const doc = db.documents.find((d) => d.id === documentId);
  if (!doc) return null;

  const res = resolveSharedVersion(db.documentVersions ?? [], documentId, occurredAt);
  const versionLabel =
    res.kind === 'at_time' ? `v${res.version}`
    : res.kind === 'current_only' ? `v${res.version} — current version; the one they saw wasn't recorded`
    : null;

  return (
    <Link href={`/documents?doc=${doc.id}`}
      title={versionLabel ? `Shared: ${doc.name} (${versionLabel})` : `Shared: ${doc.name}`}
      className="inline-flex max-w-full items-baseline gap-1 rounded bg-white px-1.5 py-0.5 text-[11px] text-gray-600 ring-1 ring-gray-200 hover:text-[#0E7490] hover:ring-[#0E7490]">
      <span aria-hidden>📎</span>
      <span className="truncate">{doc.name}</span>
      {res.kind === 'at_time' && <span className="whitespace-nowrap text-gray-400">v{res.version}</span>}
      {res.kind === 'current_only' && (
        // Nunca fingir precisão: se a versão da altura não é determinável,
        // o ecrã diz isso em vez de mostrar a actual como se fosse aquela.
        <span className="whitespace-nowrap text-amber-700">v{res.version} (current)</span>
      )}
    </Link>
  );
}
