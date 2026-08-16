// Data Room V2 — pure helpers for Storage keys and document link
// validation. No I/O, no server-only: shared by the client-side upload flow
// and both store providers' addDocument, and unit-testable with fixtures.

// B1: Supabase Storage object keys must be ASCII-safe — a raw filename like
// "Consulta de Certidão Permanente 07-2026 (1).pdf" breaks the upload with
// "Invalid key". Fold diacritics (same NFD technique as catalog-dedupe.ts's
// normalizeName, for consistency) and replace anything illegal; the
// ORIGINAL filename is kept separately as the document's display name
// (documents.name), never lost — this only ever touches the Storage key.
export function sanitizeStorageKey(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  const asciiBase = base.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const safeBase = asciiBase.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  const safeExt = ext.replace(/[^A-Za-z0-9.]+/g, '');
  return `${safeBase || 'file'}${safeExt}`;
}

// B2: Google Docs/Sheets/Slides/Drive share links always contain /edit in
// their canonical URL (docs.google.com/document/d/ID/edit?usp=sharing) —
// permissions live server-side, not in the URL — so the blanket "/edit =
// editable" heuristic false-positives on every single Google link.
// Normalize these specific, well-known formats to their view-only
// equivalent before the no-edit-link check ever runs. Every other /edit
// link (Notion, anything else) still gets rejected — this is narrowly
// scoped to formats we can rewrite with confidence, not a general bypass.
const GOOGLE_DOC_EDIT_RE = /^(https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[^/?#]+)\/edit(?:[/?#].*)?$/i;
const GOOGLE_DRIVE_EDIT_RE = /^(https?:\/\/drive\.google\.com\/file\/d\/[^/?#]+)\/edit(?:[/?#].*)?$/i;

export function normalizeDocumentUrl(url: string): string {
  const doc = url.match(GOOGLE_DOC_EDIT_RE);
  if (doc) return `${doc[1]}/preview`;
  const drive = url.match(GOOGLE_DRIVE_EDIT_RE);
  if (drive) return `${drive[1]}/view`;
  return url;
}

export function isEditableLink(url: string): boolean {
  return normalizeDocumentUrl(url).includes('/edit');
}

// F5 — the portal's per-item NDA gate. A grant whose nda_required is true
// and not yet accepted must never surface its folder/document — this is
// the one function both the real /api/portal/access route and the demo-mode
// portal page call, so "hidden pre-upload, visible post-upload" is the same
// rule everywhere, not reimplemented per caller.
export interface GrantLike {
  folder_id?: string;
  document_id?: string;
  nda_required: boolean;
  nda_accepted_at?: string;
}

export function unlockedGrants<T extends GrantLike>(grants: T[]): T[] {
  return grants.filter((g) => !g.nda_required || !!g.nda_accepted_at);
}

// Prompt 204(a) — `visibility` entra aqui porque passou a decidir acesso.
// Opcional para nao partir chamadores que ainda nao a passem, mas ver o
// comentario do gate: ausente significa "sem restricao", que e o
// comportamento anterior.
export interface DocMeta { id: string; folder_id?: string; visibility?: string }
export interface ResolvedDocumentAccess { visibleIds: string[]; pendingCount: number }

// F4's per-doc override only means anything if it actually takes priority
// over the folder the document lives in — access_grants can't express "grant
// this folder EXCEPT one document," so a document living in a granted
// folder AND carrying its own more specific grant must resolve to the
// document-level grant, never "whichever grant happens to be unlocked."
// Caught live: overriding one document in an already-shared folder to
// require an NDA did nothing, because the folder's own (unlocked) grant
// still covered it — the naive "any applicable grant unlocks it" check a
// portal route would otherwise write.
// Prompt 204 §A, segunda metade — a que não estava no relatório e sem a qual
// o fix não produz nada.
//
// Os chamadores constroem a lista de documentos candidatos com
// `documents.folder_id IN (pastas concedidas)`. Mesmo depois de
// resolveDocumentAccess passar a descer a árvore, um documento numa subpasta
// nunca chegava a ser candidato — a query nem o trazia. Portanto o conjunto
// de pastas usado na query tem de ser o FECHO descendente das concedidas,
// não as concedidas em si.
//
// Devolve as raízes mais todos os descendentes. Tolerante a ciclos pela
// mesma razão defensiva de nearestFolderGrant.
export function descendantFolderIds(folders: TreeFolder[], rootIds: string[]): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const f of folders) {
    if (!f.parent_id) continue;
    const list = childrenOf.get(f.parent_id) ?? [];
    list.push(f.id);
    childrenOf.set(f.parent_id, list);
  }
  const out = new Set<string>();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop() as string;
    if (out.has(id)) continue;
    out.add(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  return [...out];
}

// Prompt 204 §A — um grant de PASTA cobre a subárvore inteira, não só os
// documentos directamente lá dentro.
//
// Bug confirmado em produção: os dois grants activos da ablute_ estavam na
// pasta raiz "Vault Data Room", que tem zero documentos directos — os 40+
// vivem nas subpastas (00 Index, 01 Summary, 02 Corporate…). O match directo
// `byFolder.get(doc.folder_id)` nunca subia a árvore, portanto o investidor
// via um data room vazio e o founder não percebia porquê.
//
// A precedência é por ESPECIFICIDADE, que é a extensão natural da regra F4
// que já existia (grant por documento ganha ao da pasta):
//   documento > subpasta > ... > raiz
// O ancestral MAIS PRÓXIMO ganha — um grant numa subpasta com NDA continua a
// impor NDA mesmo que a raiz esteja partilhada sem ele, que é o que torna
// "partilhar tudo excepto esta pasta com NDA" exprimível.
//
// `folders` é obrigatório de propósito, não opcional com default []: esta
// função decide AUTORIZAÇÃO, e um chamador novo que se esquecesse do
// argumento reintroduzia o bug em silêncio. Obrigatório = o compilador
// obriga a pensar. (São seis chamadores hoje, não dois.)
export function resolveDocumentAccess<T extends GrantLike>(
  grants: T[], documents: DocMeta[], folders: TreeFolder[],
): ResolvedDocumentAccess {
  const byDoc = new Map<string, T>();
  const byFolder = new Map<string, T>();
  for (const g of grants) {
    if (g.document_id) byDoc.set(g.document_id, g);
    else if (g.folder_id) byFolder.set(g.folder_id, g);
  }
  const parentOf = new Map(folders.map((f) => [f.id, f.parent_id]));

  // Sobe até encontrar o primeiro ancestral com grant. O `seen` é defensivo:
  // uma cadeia de parent_id corrompida (ciclo) não pode pendurar o portal.
  function nearestFolderGrant(folderId?: string): T | undefined {
    const seen = new Set<string>();
    let cur = folderId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const g = byFolder.get(cur);
      if (g) return g;
      cur = parentOf.get(cur);
    }
    return undefined;
  }

  const visibleIds: string[] = [];
  let pendingCount = 0;
  for (const doc of documents) {
    // Prompt 204(a) — 'due_diligence' so abre com grant ao PROPRIO documento.
    //
    // Ate aqui o campo era so um rotulo: a migracao 0100 di-lo por escrito
    // ("today this is a label only"). Mas nao era inerte — o
    // computeCellEffect da matriz People & Access do founder ja tratava
    // due_diligence como "nenhum grant pode ter efeito aqui". Ou seja, a
    // matriz prometia uma proteccao que o portal nao cumpria: um cadeado
    // decorativo, no ecra onde a decisao de partilhar se toma.
    //
    // Um grant de pasta (incluindo o da raiz, desde o 204 §A) deixa de
    // chegar. O grant por documento continua a chegar, porque e a forma
    // explicita de dizer "este, sim, e para esta pessoa" — e mantem a
    // coerencia com a regra de especificidade do F4.
    const docGrant = byDoc.get(doc.id);
    const effective = doc.visibility === 'due_diligence'
      ? docGrant
      : docGrant ?? nearestFolderGrant(doc.folder_id);
    if (!effective) continue;
    if (!effective.nda_required || effective.nda_accepted_at) visibleIds.push(doc.id);
    else pendingCount++;
  }
  return { visibleIds, pendingCount };
}

// E5 — drag-to-reorder within a folder. Given the folder's current document
// order and a drag from `dragId` onto `targetId`, returns the new id order
// (dragId removed, then re-inserted at the target's slot). Pure so the
// reorder math is unit-tested independently of the DnD event plumbing; the
// store then writes position = array index for each id, keeping them dense.
// A drop on itself, or on an id not in the list, is a no-op (returns the
// input order unchanged) so the caller never persists a spurious reshuffle.
export function reorderByDrag(ids: string[], dragId: string, targetId: string): string[] {
  if (dragId === targetId) return ids;
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, dragId);
  return next;
}

// F4 — tri-state grant-by-selection tree. Three clicks cycle through: not
// shared -> shared -> shared + NDA required -> not shared.
export type GrantState = 'none' | 'shared' | 'shared_nda';

export function cycleGrantState(s: GrantState): GrantState {
  return s === 'none' ? 'shared' : s === 'shared' ? 'shared_nda' : 'none';
}

export interface TreeFolder { id: string; parent_id?: string }
export interface TreeDocument { id: string; folder_id?: string }

// Clicking a folder cascades its new state to every document and
// subfolder inside it (recursively) — the keys this returns are exactly
// what a folder-level state change should apply to. Clicking an individual
// document afterward still only ever touches that document's own key, so
// it reads as an override rather than being overwritten back.
export function collectFolderSelectionKeys(folderId: string, folders: TreeFolder[], documents: TreeDocument[]): string[] {
  const keys = [`folder:${folderId}`];
  for (const doc of documents.filter((d) => d.folder_id === folderId)) keys.push(`doc:${doc.id}`);
  for (const sub of folders.filter((f) => f.parent_id === folderId)) {
    keys.push(...collectFolderSelectionKeys(sub.id, folders, documents));
  }
  return keys;
}

export interface GrantDiffItem {
  key: string;
  action: 'add' | 'revoke' | 'none';
  existingId?: string;
  ndaRequired: boolean;
}

// Turns "here's the tree's current tri-state selection" + "here's what this
// grantee already has" into a minimal add/revoke plan — re-submitting the
// same selection twice is a no-op, and only what actually changed produces
// a write. A state change (shared -> shared_nda or back) is a revoke of the
// old grant plus an add of the new one, not an in-place update — access_grants
// rows are otherwise immutable once granted, matching how revoke/re-grant
// already works everywhere else in this app.
export function diffGrantSelection(
  selection: Record<string, GrantState>,
  existingByKey: Record<string, { id: string; nda_required: boolean }>,
): GrantDiffItem[] {
  const allKeys = new Set([...Object.keys(selection), ...Object.keys(existingByKey)]);
  const out: GrantDiffItem[] = [];
  for (const key of allKeys) {
    const newState = selection[key] ?? 'none';
    const existing = existingByKey[key];
    const existingState: GrantState = existing ? (existing.nda_required ? 'shared_nda' : 'shared') : 'none';
    if (newState === existingState) continue;
    if (existing) out.push({ key, action: 'revoke', existingId: existing.id, ndaRequired: existing.nda_required });
    if (newState !== 'none') out.push({ key, action: 'add', ndaRequired: newState === 'shared_nda' });
  }
  return out;
}
