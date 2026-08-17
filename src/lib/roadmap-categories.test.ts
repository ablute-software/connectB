import { describe, expect, it } from 'vitest';
import {
  readItems, itemCategoryLabel, filterItemsByCategories, legendLabels,
  CATEGORY_COLORS, CATEGORY_SHAPES, COLOR_STYLES, SHAPE_STYLES, GENERAL_LABEL,
} from './roadmap-categories';

// Prompt 213 §D — o contrato entre o editor do founder e o filtro do
// investidor, preso antes de qualquer UI existir.

const CATS = [
  { id: 'c-rounds', label: 'Investment rounds' },
  { id: 'c-proto', label: 'Prototype' },
];

describe('readItems — retrocompatibilidade lazy da 0177', () => {
  it('items antigos leem-se como General', () => {
    const items = readItems({ items: ['WomenTechEU prize', 'First prototype'] });
    expect(items).toEqual([
      { text: 'WomenTechEU prize', category_id: null },
      { text: 'First prototype', category_id: null },
    ]);
  });

  it('items_v2 quando existe ganha ao antigo', () => {
    const items = readItems({
      items: ['old text'],
      items_v2: [{ text: 'new text', category_id: 'c-proto' }],
    });
    expect(items).toEqual([{ text: 'new text', category_id: 'c-proto' }]);
  });

  it('items_v2 vazio NAO ganha — cai no antigo', () => {
    expect(readItems({ items: ['a'], items_v2: [] })).toEqual([{ text: 'a', category_id: null }]);
  });
});

describe('itemCategoryLabel — lookup-miss = General', () => {
  it('resolve por id', () => {
    expect(itemCategoryLabel({ text: 'x', category_id: 'c-proto' }, CATS)).toBe('Prototype');
  });

  it('sem categoria e General', () => {
    expect(itemCategoryLabel({ text: 'x', category_id: null }, CATS)).toBe(GENERAL_LABEL);
  });

  // O contrato que torna apagar categorias seguro sem triggers.
  it('categoria APAGADA le-se como General, nunca rebenta', () => {
    expect(itemCategoryLabel({ text: 'x', category_id: 'c-apagada' }, CATS)).toBe(GENERAL_LABEL);
  });
});

describe('filterItemsByCategories — o filtro do investidor', () => {
  const ITEMS = [
    { text: 'Raised pre-seed', category_id: 'c-rounds' },
    { text: 'Prototype v2', category_id: 'c-proto' },
    { text: 'Team offsite', category_id: null },
  ];

  it('todas ligadas mostra tudo', () => {
    const all = new Set(['Investment rounds', 'Prototype', GENERAL_LABEL]);
    expect(filterItemsByCategories(ITEMS, CATS, all)).toHaveLength(3);
  });

  it('desligar uma esconde so os itens dela', () => {
    const semProto = new Set(['Investment rounds', GENERAL_LABEL]);
    const out = filterItemsByCategories(ITEMS, CATS, semProto);
    expect(out.map((i) => i.text)).toEqual(['Raised pre-seed', 'Team offsite']);
  });

  it('General e filtravel como as outras — mesmo sem ter id', () => {
    const soGeneral = new Set([GENERAL_LABEL]);
    expect(filterItemsByCategories(ITEMS, CATS, soGeneral).map((i) => i.text)).toEqual(['Team offsite']);
  });
});

describe('legendLabels — a legenda e a lista de checkboxes', () => {
  it('so categorias COM itens, pela ordem do founder, General no fim', () => {
    const ms = [
      { items: [], items_v2: [{ text: 'a', category_id: 'c-proto' }, { text: 'b', category_id: null }] },
    ];
    expect(legendLabels(ms, CATS)).toEqual(['Prototype', GENERAL_LABEL]);
  });

  it('categoria vazia nao gera checkbox — um checkbox que nao muda nada e ruido', () => {
    const ms = [{ items: [], items_v2: [{ text: 'a', category_id: 'c-rounds' }] }];
    expect(legendLabels(ms, CATS)).toEqual(['Investment rounds']);
  });

  it('roadmap todo legacy da so General', () => {
    expect(legendLabels([{ items: ['a', 'b'] }], CATS)).toEqual([GENERAL_LABEL]);
  });
});

describe('paleta e formas — conjuntos fechados, espelho da 0177', () => {
  it('todas as cores tem estilo, todas as formas tem classe', () => {
    for (const c of CATEGORY_COLORS) expect(COLOR_STYLES[c]).toBeDefined();
    for (const s of CATEGORY_SHAPES) expect(SHAPE_STYLES[s]).toBeDefined();
  });

  it('8 cores e 4 formas — os mesmos numeros do check constraint', () => {
    expect(CATEGORY_COLORS).toHaveLength(8);
    expect(CATEGORY_SHAPES).toHaveLength(4);
  });
});
