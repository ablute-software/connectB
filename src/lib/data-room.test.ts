import { describe, expect, it } from 'vitest';
import {
  collectFolderSelectionKeys, cycleGrantState, diffGrantSelection, isEditableLink,
  descendantFolderIds, dueDiligenceUnderFolders, normalizeDocumentUrl, reorderByDrag, resolveDocumentAccess, sanitizeStorageKey, unlockedGrants,
} from './data-room';

describe('sanitizeStorageKey', () => {
  it('folds diacritics, replaces spaces/parentheses, and keeps the extension', () => {
    expect(sanitizeStorageKey('Consulta de Certidão Permanente 07-2026 (1).pdf'))
      .toBe('Consulta-de-Certidao-Permanente-07-2026-1.pdf');
  });

  it('leaves an already-safe filename untouched', () => {
    expect(sanitizeStorageKey('deck-v3.pdf')).toBe('deck-v3.pdf');
  });

  it('handles a file with no extension', () => {
    expect(sanitizeStorageKey('README')).toBe('README');
  });

  it('never produces an empty base name', () => {
    expect(sanitizeStorageKey('日本語.pdf')).toBe('file.pdf');
  });

  it('strips illegal characters from the extension too', () => {
    expect(sanitizeStorageKey('weird.p?d#f')).toBe('weird.pdf');
  });
});

describe('normalizeDocumentUrl', () => {
  it('normalizes a Google Docs edit link to /preview', () => {
    expect(normalizeDocumentUrl('https://docs.google.com/document/d/1AbC23/edit?usp=sharing'))
      .toBe('https://docs.google.com/document/d/1AbC23/preview');
  });

  it('normalizes a Google Sheets edit link to /preview', () => {
    expect(normalizeDocumentUrl('https://docs.google.com/spreadsheets/d/1AbC23/edit#gid=0'))
      .toBe('https://docs.google.com/spreadsheets/d/1AbC23/preview');
  });

  it('normalizes a Google Slides edit link to /preview', () => {
    expect(normalizeDocumentUrl('https://docs.google.com/presentation/d/1AbC23/edit'))
      .toBe('https://docs.google.com/presentation/d/1AbC23/preview');
  });

  it('normalizes a Google Drive file edit link to /view', () => {
    expect(normalizeDocumentUrl('https://drive.google.com/file/d/1AbC23/edit?usp=sharing'))
      .toBe('https://drive.google.com/file/d/1AbC23/view');
  });

  it('leaves a non-Google /edit link untouched', () => {
    const url = 'https://www.notion.so/workspace/Some-Page-abc123/edit';
    expect(normalizeDocumentUrl(url)).toBe(url);
  });

  it('leaves an already view-only Google link untouched', () => {
    const url = 'https://docs.google.com/document/d/1AbC23/preview';
    expect(normalizeDocumentUrl(url)).toBe(url);
  });
});

describe('isEditableLink', () => {
  it('accepts a Google Docs edit link once normalized', () => {
    expect(isEditableLink('https://docs.google.com/document/d/1AbC23/edit?usp=sharing')).toBe(false);
  });

  it('still rejects a literal non-Google /edit link', () => {
    expect(isEditableLink('https://www.notion.so/workspace/Some-Page-abc123/edit')).toBe(true);
  });

  it('accepts an ordinary view-only link', () => {
    expect(isEditableLink('https://example.com/deck.pdf')).toBe(false);
  });
});

describe('unlockedGrants (F5 portal NDA gate)', () => {
  it('includes a grant that never required an NDA', () => {
    const grants = [{ document_id: 'd1', nda_required: false }];
    expect(unlockedGrants(grants)).toEqual(grants);
  });

  it('excludes an nda_required grant before the NDA is on file', () => {
    const grants = [{ document_id: 'd1', nda_required: true }];
    expect(unlockedGrants(grants)).toEqual([]);
  });

  it('includes an nda_required grant once accepted', () => {
    const grants = [{ document_id: 'd1', nda_required: true, nda_accepted_at: '2026-01-01T00:00:00Z' }];
    expect(unlockedGrants(grants)).toEqual(grants);
  });

  it('filters a mixed set to only the unlocked ones', () => {
    const grants = [
      { document_id: 'd1', nda_required: false },
      { document_id: 'd2', nda_required: true },
      { document_id: 'd3', nda_required: true, nda_accepted_at: '2026-01-01T00:00:00Z' },
    ];
    expect(unlockedGrants(grants).map((g) => g.document_id)).toEqual(['d1', 'd3']);
  });
});

describe('resolveDocumentAccess (F4 per-doc override vs its folder grant)', () => {
  it('a document with only a folder-level grant is visible when that grant is unlocked', () => {
    const grants = [{ folder_id: 'f1', nda_required: false }];
    const docs = [{ id: 'd1', folder_id: 'f1' }];
    expect(resolveDocumentAccess(grants, docs, [{ id: 'f1' }])).toEqual({ visibleIds: ['d1'], pendingCount: 0 });
  });

  it('a document-level override to require an NDA wins even though its folder is shared without one', () => {
    const grants = [
      { folder_id: 'f1', nda_required: false },
      { document_id: 'd1', nda_required: true },
    ];
    const docs = [{ id: 'd1', folder_id: 'f1' }, { id: 'd2', folder_id: 'f1' }];
    const result = resolveDocumentAccess(grants, docs, [{ id: 'f1' }]);
    expect(result.visibleIds).toEqual(['d2']);
    expect(result.pendingCount).toBe(1);
  });

  it('a document-level override to NOT require an NDA wins even though its folder requires one', () => {
    const grants = [
      { folder_id: 'f1', nda_required: true },
      { document_id: 'd1', nda_required: false },
    ];
    const docs = [{ id: 'd1', folder_id: 'f1' }, { id: 'd2', folder_id: 'f1' }];
    const result = resolveDocumentAccess(grants, docs, [{ id: 'f1' }]);
    expect(result.visibleIds).toEqual(['d1']);
    expect(result.pendingCount).toBe(1);
  });

  it('a document with no applicable grant at all is neither visible nor pending', () => {
    const grants: { folder_id?: string; document_id?: string; nda_required: boolean }[] = [];
    const docs = [{ id: 'd1', folder_id: 'f1' }];
    expect(resolveDocumentAccess(grants, docs, [{ id: 'f1' }])).toEqual({ visibleIds: [], pendingCount: 0 });
  });

  it('an accepted document-level NDA makes it visible', () => {
    const grants = [{ document_id: 'd1', nda_required: true, nda_accepted_at: '2026-01-01T00:00:00Z' }];
    const docs = [{ id: 'd1', folder_id: 'f1' }];
    expect(resolveDocumentAccess(grants, docs, [{ id: 'f1' }])).toEqual({ visibleIds: ['d1'], pendingCount: 0 });
  });
});

// Prompt 204 §A — o bug real da ablute_: os dois grants activos estavam na
// pasta RAIZ "Vault Data Room" (0 documentos directos) e os 40+ documentos
// vivem nas subpastas. Antes disto, um grant na raiz nao mostrava nada.
describe('resolveDocumentAccess (204 §A: grant de pasta cobre a subarvore)', () => {
  // raiz -> 01 Summary -> doc
  const ARVORE = [{ id: 'raiz' }, { id: 'sum', parent_id: 'raiz' }, { id: 'corp', parent_id: 'raiz' }];

  it('grant na raiz torna visiveis os documentos das subpastas (o caso ablute_)', () => {
    const grants = [{ folder_id: 'raiz', nda_required: false }];
    const docs = [{ id: 'd-sum', folder_id: 'sum' }, { id: 'd-corp', folder_id: 'corp' }];

    expect(resolveDocumentAccess(grants, docs, ARVORE))
      .toEqual({ visibleIds: ['d-sum', 'd-corp'], pendingCount: 0 });
  });

  it('desce mais do que um nivel', () => {
    const fundo = [...ARVORE, { id: 'anexos', parent_id: 'sum' }, { id: 'velhos', parent_id: 'anexos' }];
    const grants = [{ folder_id: 'raiz', nda_required: false }];

    expect(resolveDocumentAccess(grants, [{ id: 'd', folder_id: 'velhos' }], fundo).visibleIds).toEqual(['d']);
  });

  it('grant na subpasta GANHA ao da raiz -- ancestral mais proximo, nao qualquer um', () => {
    const grants = [
      { folder_id: 'raiz', nda_required: false },
      { folder_id: 'corp', nda_required: true },   // pasta sensivel, com NDA
    ];
    const docs = [{ id: 'd-sum', folder_id: 'sum' }, { id: 'd-corp', folder_id: 'corp' }];

    const r = resolveDocumentAccess(grants, docs, ARVORE);
    expect(r.visibleIds).toEqual(['d-sum']);
    expect(r.pendingCount).toBe(1);
  });

  it('e ao contrario: subpasta partilhada sem NDA dentro de uma raiz com NDA', () => {
    const grants = [
      { folder_id: 'raiz', nda_required: true },
      { folder_id: 'sum', nda_required: false },
    ];
    const docs = [{ id: 'd-sum', folder_id: 'sum' }, { id: 'd-corp', folder_id: 'corp' }];

    const r = resolveDocumentAccess(grants, docs, ARVORE);
    expect(r.visibleIds).toEqual(['d-sum']);
    expect(r.pendingCount).toBe(1);
  });

  it('o override por documento continua a ganhar a tudo, incluindo a ancestrais', () => {
    const grants = [
      { folder_id: 'raiz', nda_required: false },
      { document_id: 'd-corp', nda_required: true },
    ];
    const docs = [{ id: 'd-sum', folder_id: 'sum' }, { id: 'd-corp', folder_id: 'corp' }];

    const r = resolveDocumentAccess(grants, docs, ARVORE);
    expect(r.visibleIds).toEqual(['d-sum']);
    expect(r.pendingCount).toBe(1);
  });

  it('NDA pendente na pasta ancestral conta como pendente, nao como visivel', () => {
    const grants = [{ folder_id: 'raiz', nda_required: true }];
    const docs = [{ id: 'd-sum', folder_id: 'sum' }];

    expect(resolveDocumentAccess(grants, docs, ARVORE)).toEqual({ visibleIds: [], pendingCount: 1 });
  });

  it('NDA aceite na pasta ancestral torna a subarvore visivel', () => {
    const grants = [{ folder_id: 'raiz', nda_required: true, nda_accepted_at: '2026-01-01T00:00:00Z' }];
    const docs = [{ id: 'd-sum', folder_id: 'sum' }];

    expect(resolveDocumentAccess(grants, docs, ARVORE).visibleIds).toEqual(['d-sum']);
  });

  it('uma arvore vazia nao inventa acessos -- so o match directo', () => {
    const grants = [{ folder_id: 'raiz', nda_required: false }];
    expect(resolveDocumentAccess(grants, [{ id: 'd', folder_id: 'sum' }], []).visibleIds).toEqual([]);
  });

  it('um ciclo em parent_id nao pendura nem concede', () => {
    const ciclo = [{ id: 'a', parent_id: 'b' }, { id: 'b', parent_id: 'a' }];
    const grants = [{ folder_id: 'outra', nda_required: false }];
    expect(resolveDocumentAccess(grants, [{ id: 'd', folder_id: 'a' }], ciclo).visibleIds).toEqual([]);
  });

  it('documento sem pasta nenhuma so e visivel por grant directo', () => {
    const grants = [{ folder_id: 'raiz', nda_required: false }];
    expect(resolveDocumentAccess(grants, [{ id: 'd' }], ARVORE).visibleIds).toEqual([]);
  });
});

describe('descendantFolderIds (204 §A: fecho descendente para a query)', () => {
  const ARVORE = [
    { id: 'raiz' }, { id: 'sum', parent_id: 'raiz' }, { id: 'corp', parent_id: 'raiz' },
    { id: 'anexos', parent_id: 'sum' }, { id: 'outra-raiz' },
  ];

  it('inclui a propria raiz e todos os descendentes', () => {
    expect(descendantFolderIds(ARVORE, ['raiz']).sort()).toEqual(['anexos', 'corp', 'raiz', 'sum']);
  });

  it('nao sai da subarvore pedida', () => {
    expect(descendantFolderIds(ARVORE, ['sum']).sort()).toEqual(['anexos', 'sum']);
  });

  it('aceita varias raizes sem repetir', () => {
    expect(descendantFolderIds(ARVORE, ['sum', 'anexos']).sort()).toEqual(['anexos', 'sum']);
  });

  it('uma folha devolve-se a si propria', () => {
    expect(descendantFolderIds(ARVORE, ['corp'])).toEqual(['corp']);
  });

  it('sem raizes devolve vazio', () => {
    expect(descendantFolderIds(ARVORE, [])).toEqual([]);
  });

  it('um ciclo nao pendura', () => {
    expect(descendantFolderIds([{ id: 'a', parent_id: 'b' }, { id: 'b', parent_id: 'a' }], ['a']).sort()).toEqual(['a', 'b']);
  });
});

describe('reorderByDrag (E5 within-folder reorder persistence)', () => {
  it('moves a document earlier in the order', () => {
    expect(reorderByDrag(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves a document later in the order', () => {
    expect(reorderByDrag(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('dropping onto itself is a no-op', () => {
    const ids = ['a', 'b', 'c'];
    expect(reorderByDrag(ids, 'b', 'b')).toEqual(['a', 'b', 'c']);
  });

  it('returns the order unchanged when the dragged id is not present', () => {
    const ids = ['a', 'b', 'c'];
    expect(reorderByDrag(ids, 'zzz', 'b')).toEqual(['a', 'b', 'c']);
  });

  it('returns the order unchanged when the target id is not present', () => {
    const ids = ['a', 'b', 'c'];
    expect(reorderByDrag(ids, 'a', 'zzz')).toEqual(['a', 'b', 'c']);
  });

  it('reordering to the first slot puts the dragged item at the front', () => {
    expect(reorderByDrag(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
  });
});

describe('cycleGrantState (F4 tri-state)', () => {
  it('cycles none -> shared -> shared_nda -> none', () => {
    expect(cycleGrantState('none')).toBe('shared');
    expect(cycleGrantState('shared')).toBe('shared_nda');
    expect(cycleGrantState('shared_nda')).toBe('none');
  });
});

describe('collectFolderSelectionKeys (F4 cascade)', () => {
  const folders = [
    { id: 'root', parent_id: undefined },
    { id: 'child', parent_id: 'root' },
    { id: 'grandchild', parent_id: 'child' },
    { id: 'unrelated', parent_id: undefined },
  ];
  const documents = [
    { id: 'doc-root', folder_id: 'root' },
    { id: 'doc-child', folder_id: 'child' },
    { id: 'doc-unrelated', folder_id: 'unrelated' },
  ];

  it('cascades to every descendant folder and document, never siblings', () => {
    const keys = collectFolderSelectionKeys('root', folders, documents);
    const expected = ['folder:root', 'doc:doc-root', 'folder:child', 'doc:doc-child', 'folder:grandchild'];
    expect([...keys].sort()).toEqual([...expected].sort());
    expect(keys).not.toContain('folder:unrelated');
    expect(keys).not.toContain('doc:doc-unrelated');
  });

  it('a leaf folder with no children returns only itself', () => {
    expect(collectFolderSelectionKeys('grandchild', folders, documents)).toEqual(['folder:grandchild']);
  });
});

describe('diffGrantSelection (F4 tri-state scoping)', () => {
  it('produces an add for a newly selected item with no existing grant', () => {
    const diff = diffGrantSelection({ 'doc:d1': 'shared' }, {});
    expect(diff).toEqual([{ key: 'doc:d1', action: 'add', ndaRequired: false }]);
  });

  it('produces an add with ndaRequired true for shared_nda', () => {
    const diff = diffGrantSelection({ 'doc:d1': 'shared_nda' }, {});
    expect(diff).toEqual([{ key: 'doc:d1', action: 'add', ndaRequired: true }]);
  });

  it('is a no-op when the selection already matches the existing grant', () => {
    const diff = diffGrantSelection({ 'doc:d1': 'shared' }, { 'doc:d1': { id: 'g1', nda_required: false } });
    expect(diff).toEqual([]);
  });

  it('revokes and re-adds when the NDA requirement changes', () => {
    const diff = diffGrantSelection({ 'doc:d1': 'shared_nda' }, { 'doc:d1': { id: 'g1', nda_required: false } });
    expect(diff).toEqual([
      { key: 'doc:d1', action: 'revoke', existingId: 'g1', ndaRequired: false },
      { key: 'doc:d1', action: 'add', ndaRequired: true },
    ]);
  });

  it('revokes an item that was un-selected back to none', () => {
    const diff = diffGrantSelection({ 'doc:d1': 'none' }, { 'doc:d1': { id: 'g1', nda_required: false } });
    expect(diff).toEqual([{ key: 'doc:d1', action: 'revoke', existingId: 'g1', ndaRequired: false }]);
  });

  it('re-submitting the exact same selection twice is a total no-op', () => {
    const existing = { 'doc:d1': { id: 'g1', nda_required: true } };
    const diff = diffGrantSelection({ 'doc:d1': 'shared_nda' }, existing);
    expect(diff).toEqual([]);
  });
});

// Prompt 204(a) — o cadeado deixa de ser decorativo. Ate aqui um documento
// marcado 'due_diligence' era servido na mesma por um grant de pasta,
// enquanto a matriz People & Access do founder dizia "nenhum grant pode ter
// efeito aqui" (computeCellEffect). Os dois PDFs em "Grant Agreements" da
// ablute_ sao o caso real.
describe('resolveDocumentAccess (204a: due_diligence so com grant ao proprio documento)', () => {
  const ARVORE = [{ id: 'raiz' }, { id: 'grants', parent_id: 'raiz' }];

  it('grant de pasta NAO chega a um documento due_diligence', () => {
    const grants = [{ folder_id: 'raiz', nda_required: false }];
    const docs = [
      { id: 'normal', folder_id: 'grants' },
      { id: 'prr', folder_id: 'grants', visibility: 'due_diligence' },
    ];
    expect(resolveDocumentAccess(grants, docs, ARVORE).visibleIds).toEqual(['normal']);
  });

  it('nem o grant da propria pasta onde ele esta', () => {
    const grants = [{ folder_id: 'grants', nda_required: false }];
    const docs = [{ id: 'prr', folder_id: 'grants', visibility: 'due_diligence' }];
    expect(resolveDocumentAccess(grants, docs, ARVORE).visibleIds).toEqual([]);
  });

  it('grant ao PROPRIO documento chega -- e a forma explicita de o partilhar', () => {
    const grants = [{ document_id: 'prr', nda_required: false }];
    const docs = [{ id: 'prr', folder_id: 'grants', visibility: 'due_diligence' }];
    expect(resolveDocumentAccess(grants, docs, ARVORE).visibleIds).toEqual(['prr']);
  });

  it('e o NDA continua a valer por cima disso', () => {
    const grants = [{ document_id: 'prr', nda_required: true }];
    const docs = [{ id: 'prr', folder_id: 'grants', visibility: 'due_diligence' }];
    const r = resolveDocumentAccess(grants, docs, ARVORE);
    expect(r.visibleIds).toEqual([]);
    expect(r.pendingCount).toBe(1);
  });

  it('bloqueado NAO conta como pendente de NDA -- sao coisas diferentes', () => {
    const grants = [{ folder_id: 'raiz', nda_required: false }];
    const docs = [{ id: 'prr', folder_id: 'grants', visibility: 'due_diligence' }];
    expect(resolveDocumentAccess(grants, docs, ARVORE)).toEqual({ visibleIds: [], pendingCount: 0 });
  });

  it('as outras visibilidades nao mudam nada', () => {
    const grants = [{ folder_id: 'raiz', nda_required: false }];
    const docs = [
      { id: 'a', folder_id: 'grants', visibility: 'on_grant' },
      { id: 'b', folder_id: 'grants', visibility: 'open' },
      { id: 'c', folder_id: 'grants' },
    ];
    expect(resolveDocumentAccess(grants, docs, ARVORE).visibleIds).toEqual(['a', 'b', 'c']);
  });
});

describe('dueDiligenceUnderFolders (204b: o aviso na criacao do grant)', () => {
  const ARVORE = [{ id: 'raiz' }, { id: 'grants', parent_id: 'raiz' }, { id: 'fora' }];
  const DOCS = [
    { id: 'prr', name: 'PRR.pdf', folder_id: 'grants', visibility: 'due_diligence' },
    { id: 'norte', name: 'NORTE2030.pdf', folder_id: 'grants', visibility: 'due_diligence' },
    { id: 'normal', name: 'Deck.pdf', folder_id: 'grants', visibility: 'on_grant' },
    { id: 'outro', name: 'Fora.pdf', folder_id: 'fora', visibility: 'due_diligence' },
  ];

  it('encontra os due_diligence na subarvore, incluindo os netos', () => {
    expect(dueDiligenceUnderFolders(ARVORE, DOCS, ['raiz']).map((d) => d.name))
      .toEqual(['PRR.pdf', 'NORTE2030.pdf']);
  });

  it('nao inclui os que nao sao due_diligence', () => {
    expect(dueDiligenceUnderFolders(ARVORE, DOCS, ['raiz']).some((d) => d.id === 'normal')).toBe(false);
  });

  it('nao sai da subarvore seleccionada', () => {
    expect(dueDiligenceUnderFolders(ARVORE, DOCS, ['grants']).map((d) => d.id)).toEqual(['prr', 'norte']);
    expect(dueDiligenceUnderFolders(ARVORE, DOCS, ['fora']).map((d) => d.id)).toEqual(['outro']);
  });

  it('sem pastas seleccionadas nao ha aviso nenhum', () => {
    expect(dueDiligenceUnderFolders(ARVORE, DOCS, [])).toEqual([]);
  });
});
