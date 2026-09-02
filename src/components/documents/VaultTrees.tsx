'use client';
// Prompt 546 — the three tree components from the Vault page, moved OUT of
// DocumentsPageInner's body.
//
// The bug they caused: declaring a component inside another component's
// body gives it a NEW function identity on every render of the parent.
// React compares element types by identity, so a new identity is a
// different component type — it unmounts the old subtree and mounts a fresh
// one instead of re-rendering it. In "What do they see?" that meant every
// click on a tri-state box threw the whole tree away and built it again;
// the scroll container (max-h-64 overflow-y-auto) was momentarily empty, so
// its scrollTop clamped to 0 and the list snapped back to the top. Setting
// one deep file to "shared + NDA" took two clicks and two scrolls.
//
// Nothing about the click cycle changed. What changed is that the DOM node
// survives the click, so the scroll position — and the focus ring, for
// anyone using the keyboard — stays where the founder left it.
//
// They live in their own file rather than at the top of page.tsx because
// that file is already 1900 lines; the closure they used to read is now an
// explicit `ctx` prop, which also makes what each tree actually depends on
// visible instead of implied.
import type { Dispatch, SetStateAction } from 'react';
import type { DocumentItem, Folder } from '@/lib/types';
import type { GrantState } from '@/lib/data-room';

export function TriStateBox({ state, onClick }: { state: GrantState; onClick: () => void }) {
  const style = state === 'none'
    ? 'border border-gray-300 bg-white'
    : state === 'shared'
    ? 'border border-cyan-600 bg-cyan-600 text-white'
    : 'border border-amber-600 bg-amber-500 text-white';
  const title = state === 'none' ? 'Not shared — click to share' : state === 'shared' ? 'Shared — click to also require an NDA' : 'Shared + NDA required — click to unshare';
  return (
    <button type="button" onClick={onClick} title={title}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold leading-none ${style}`}>
      {state === 'shared' ? '✓' : state === 'shared_nda' ? '🔒' : ''}
    </button>
  );
}

// What the sharing tree reads. A fresh object per render is fine and
// deliberate — re-rendering was never the problem; remounting was.
export interface GrantTreeCtx {
  selection: Record<string, GrantState>;
  toggleFolderSelection: (folderId: string) => void;
  toggleDocSelection: (docId: string) => void;
  childrenOf: (id: string) => Folder[];
  docsIn: (id: string) => DocumentItem[];
}

export function GrantTreeNode({ f, depth, ctx }: { f: Folder; depth: number; ctx: GrantTreeCtx }) {
  const kids = ctx.childrenOf(f.id);
  const docs = ctx.docsIn(f.id);
  return (
    <div>
      <div className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: `${depth * 14}px` }}>
        <TriStateBox state={ctx.selection[`folder:${f.id}`] ?? 'none'} onClick={() => ctx.toggleFolderSelection(f.id)} />
        <span className="text-sm text-gray-700">{f.kind === 'data_room' ? '▣' : '▤'} {f.name}</span>
      </div>
      {docs.map((d) => (
        <div key={d.id} className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: `${(depth + 1) * 14}px` }}>
          <TriStateBox state={ctx.selection[`doc:${d.id}`] ?? 'none'} onClick={() => ctx.toggleDocSelection(d.id)} />
          <span className="text-xs text-gray-600">{d.name}</span>
        </div>
      ))}
      {kids.map((k) => <GrantTreeNode key={k.id} f={k} depth={depth + 1} ctx={ctx} />)}
    </div>
  );
}

// The left-hand folder tree reads considerably more of the page's state
// than the sharing tree does; grouping it into one ctx keeps the call sites
// readable and makes the dependency list explicit.
export interface FolderTreeCtx {
  childrenOf: (id: string) => Folder[];
  docsIn: (id: string) => DocumentItem[];
  collapsed: Set<string>;
  toggleCollapse: (id: string) => void;
  renamingFolderId: string | null;
  folderRenameText: string;
  setFolderRenameText: (v: string) => void;
  saveRenameFolder: () => void;
  startRenameFolder: (f: Folder) => void;
  confirmDeleteFolder: (f: Folder) => void;
  selFolder: string | null;
  setSelFolder: (id: string) => void;
  dragDocId: string | null;
  dragOverFolderId: string | null;
  // The raw React setter, so both the direct and updater forms the page
  // already used keep working unchanged.
  setDragOverFolderId: Dispatch<SetStateAction<string | null>>;
  handleDropOnFolder: (folderId: string) => void;
}

export function FolderNode({ f, depth, ctx }: { f: Folder; depth: number; ctx: FolderTreeCtx }) {
  const kids = ctx.childrenOf(f.id);
  const isCollapsed = ctx.collapsed.has(f.id);
  return (
    <div>
      <div className="group flex items-center gap-1" style={{ paddingLeft: `${8 + depth * 14}px` }}>
        {ctx.renamingFolderId === f.id ? (
          <>
            <input value={ctx.folderRenameText} onChange={(e) => ctx.setFolderRenameText(e.target.value)} autoFocus
              className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-sm" />
            <button onClick={ctx.saveRenameFolder} className="text-xs text-cyan-700 hover:underline">save</button>
          </>
        ) : (
          <>
            {kids.length > 0 ? (
              <button onClick={() => ctx.toggleCollapse(f.id)} title={isCollapsed ? 'Expand' : 'Collapse'}
                className="w-3 shrink-0 text-[10px] text-gray-400 hover:text-gray-700">{isCollapsed ? '▸' : '▾'}</button>
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <button onClick={() => ctx.setSelFolder(f.id)}
              onDragOver={ctx.dragDocId ? (e) => { e.preventDefault(); ctx.setDragOverFolderId(f.id); } : undefined}
              onDragLeave={ctx.dragDocId ? () => ctx.setDragOverFolderId((cur) => cur === f.id ? null : cur) : undefined}
              onDrop={ctx.dragDocId ? (e) => { e.preventDefault(); ctx.handleDropOnFolder(f.id); } : undefined}
              className={`flex flex-1 items-center gap-1.5 rounded px-2 py-1 text-left text-sm ${
                ctx.dragOverFolderId === f.id ? 'bg-cyan-100 ring-1 ring-cyan-400'
                  : ctx.selFolder === f.id ? 'bg-[#E8F4F8] font-medium text-[#0E7490]' : 'text-gray-700 hover:bg-gray-50'}`}>
              <span>{f.kind === 'data_room' ? '▣' : '▤'}</span> {f.name}
              <span className="ml-auto text-[10px] text-gray-400">{ctx.docsIn(f.id).length || ''}</span>
            </button>
            <button onClick={() => ctx.startRenameFolder(f)} title="Rename folder"
              className="hidden text-xs text-gray-400 hover:text-cyan-700 group-hover:inline">✎</button>
            <button onClick={() => ctx.confirmDeleteFolder(f)} title="Delete folder"
              className="hidden text-xs text-gray-400 hover:text-[#B00000] group-hover:inline">🗑</button>
          </>
        )}
      </div>
      {!isCollapsed && kids.map((k) => <FolderNode key={k.id} f={k} depth={depth + 1} ctx={ctx} />)}
    </div>
  );
}
