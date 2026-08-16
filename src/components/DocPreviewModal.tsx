'use client';
// Prompt 206-C — pré-visualização de um documento partilhado.
//
// REGRA DO CLAUDE.md, e a razão de este ficheiro existir separado: qualquer
// overlay `fixed inset-0` TEM de ir por createPortal para document.body. Um
// antecessor com transform/filter/backdrop-blur torna-se o containing block
// de descendentes fixed, e o overlay colapsa à caixa desse antecessor sem
// erro, sem aviso e sem teste a falhar. Já aconteceu aqui: o backdrop-blur
// do WorkspaceHeader reduziu o overlay do MatchDeal de 800px para 53px.
// Esta página tem o mesmo header por cima.
//
// Não é um viewer: é um iframe para links e um link para o resto. Construir
// um visualizador próprio seria trabalho a mais para o que a pergunta é
// ("que documento é que eles viram?").
import { createPortal } from 'react-dom';
import type { DocumentItem } from '@/lib/types';

export function DocPreviewModal({ doc, sharedAt, onClose }: {
  doc: DocumentItem; sharedAt?: string; onClose: () => void;
}) {
  // Guarda de SSR: sem isto o build de uma página server-rendered rebenta
  // ao tocar em document.
  if (typeof document === 'undefined') return null;

  const url = doc.external_url;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">{doc.name}</p>
            {sharedAt && <p className="text-[11px] text-gray-400">Shared {sharedAt.slice(0, 10)}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs hover:bg-gray-50">
            Close
          </button>
        </div>

        <div className="min-h-[50vh] flex-1 overflow-auto bg-gray-50">
          {url ? (
            <iframe src={url} title={doc.name} className="h-[60vh] w-full border-0" />
          ) : (
            // Ficheiro na Vault (storage_path): a URL assinada não se pode
            // gerar no browser sem expor credenciais, portanto o caminho
            // honesto é mandar para a Vault em vez de fingir um preview.
            <div className="flex h-[50vh] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-gray-500">
              <p>This one lives in the Vault — no inline preview.</p>
              <a href={`/documents?doc=${doc.id}`} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">
                Open in the Vault
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
