'use client';
// Prompt 930 (B) — documents of an application open INSIDE the platform, in the same viewer as the data room (DocumentViewerModal: a full-screen overlay through a portal, a PDF or an image in the browser's own viewer with
// its zoom and pages, Esc to close, previous / next between the documents of the application; a format it cannot show says so and offers "Download"). The screens do not each build their own: they wrap what they show in
// <DocViewerProvider docs=…> and every file in an answer (`AnswerView`) and every "Open document" calls `useDocViewer()`. The address of a document is always the platform's own route (it streams the bytes): never a Storage address.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DocumentViewerModal } from '@/components/portal/DocumentViewerModal';

export interface ViewerDoc { fileId: string; fileName: string; url: string }

const DocViewerContext = createContext<((fileId: string) => void) | null>(null);

/** `null` outside a provider: the caller then falls back to a plain link (nothing breaks where no viewer is mounted). */
export const useDocViewer = (): ((fileId: string) => void) | null => useContext(DocViewerContext);

export function DocViewerProvider({ docs, children }: { docs: ViewerDoc[]; children: ReactNode }) {
  const [index, setIndex] = useState<number | null>(null);
  const open = useCallback((fileId: string) => { const i = docs.findIndex((d) => d.fileId === fileId); if (i >= 0) setIndex(i); }, [docs]);
  const items = useMemo(() => docs.map((d) => ({ id: d.fileId, name: d.fileName })), [docs]);
  const close = useCallback(() => setIndex(null), []);
  return (
    <DocViewerContext.Provider value={open}>
      {children}
      {index !== null && docs[index] && (
        <DocumentViewerModal items={items} index={index} onIndexChange={(i) => setIndex(Math.max(0, Math.min(docs.length - 1, i)))} onClose={close} openUrl={(id) => docs.find((d) => d.fileId === id)?.url ?? ''} />
      )}
    </DocViewerContext.Provider>
  );
}
