# -*- coding: utf-8 -*-
"""Exporta o terreno de poente (área resultante B, Carreço) para SketchUp, a partir de out/spec.json
(a mesma geometria dos renders, gerada por build3d.py). Escreve em ../sketchup/:

  construir_terreno_poente.rb  script Ruby que constrói o modelo nativo no SketchUp 2017+ (grupos por casa
                               e por categoria, etiquetas, materiais, terreno, vegetação, cenas, norte e local)
  terreno_poente.dae           o mesmo modelo em COLLADA, para Ficheiro > Importar (alternativa sem Ruby)
  LEIA-ME.txt                  instruções curtas

Coordenadas no SketchUp: x = u, y = v (eixos locais do sítio, os mesmos da casa de A), z = cota − 33,00. Metros.
O spec.json é lido sempre que se corre este script: se a geometria mudar, basta voltar a correr build3d.py e
depois este script. Não depende de casas.py nem de sitio.py.

Uso:  cd fonte && python3 skp.py
Teste fora do SketchUp:  ruby -r ./mock_su.rb ../sketchup/construir_terreno_poente.rb
"""
import json, math, base64, os
import numpy as np
import mapbox_earcut as earcut
from shapely.geometry import Polygon, box as sbox
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely.prepared import prep

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = os.path.join(HERE, 'out', 'spec.json')
OUT = os.path.normpath(os.path.join(HERE, '..', 'sketchup'))
RB_NAME, DAE_NAME, TXT_NAME = 'construir_terreno_poente.rb', 'terreno_poente.dae', 'LEIA-ME.txt'

ZREF = 33.0             # cota de referência: z = 0 no SketchUp
PASSO_TERRENO = 1.0     # malha do terreno no SketchUp (m); o spec.json traz 0,5 m — 1,0 m chega e o modelo fica leve
ANG_DEG = 19.951053938392224          # eixo u a norte do nascente (sitio.py)
M0, P0 = -60409.15, 229931.92         # origem das coordenadas locais em ETRS89 / PT-TM06
LAT, LON = 41.742, -8.874             # Carreço

spec = json.load(open(SPEC, encoding='utf-8'))

# ============================================================================ materiais (nome no SketchUp, RGB, opacidade)
MATS = {
    'render': ('Reboco de cal branco', (239, 235, 227), 1.0), 'plaster': ('Estuque branco', (243, 241, 236), 1.0),
    'ceiling': ('Teto branco', (246, 244, 240), 1.0), 'granite_wall': ('Alvenaria de granito', (146, 140, 130), 1.0),
    'granite_base': ('Granito (embasamento)', (181, 175, 164), 1.0), 'granite': ('Granito (degraus)', (195, 189, 178), 1.0),
    'coping': ('Granito amaciado (capeamentos)', (201, 195, 184), 1.0), 'deck': ('Lajeado de granito amaciado', (207, 200, 188), 1.0),
    'concrete': ('Betão à vista', (217, 213, 205), 1.0), 'soffit': ('Betão à vista (intradorso)', (228, 224, 217), 1.0),
    'reveal': ('Remate escuro', (45, 42, 38), 1.0), 'frame': ('Caixilho bronze escuro', (58, 52, 45), 1.0),
    'metal': ('Aço bronze escuro', (58, 52, 45), 1.0), 'metal_black': ('Aço preto', (24, 24, 24), 1.0),
    'glass': ('Vidro', (174, 194, 200), 0.30), 'glass_dark': ('Vidro escuro (casa de A)', (95, 113, 120), 1.0),
    'a_wall': ('Reboco (casa de A)', (232, 227, 218), 1.0), 'a_roof': ('Cobertura (casa de A)', (52, 56, 59), 1.0),
    'timber': ('Ripado de pinho tratado', (146, 104, 64), 1.0), 'shutter': ('Portadas de madeira', (146, 104, 64), 1.0),
    'oak': ('Carvalho (porta de entrada)', (168, 119, 76), 1.0), 'oak_panel': ('Painel de carvalho', (189, 145, 101), 1.0),
    'floor_int': ('Soalho de carvalho (sala e cozinha)', (200, 176, 145), 1.0), 'floor_wood': ('Soalho de madeira (quartos)', (196, 172, 140), 1.0),
    'tile': ('Mosaico cerâmico', (216, 212, 204), 1.0), 'cave_floor': ('Betonilha afagada', (169, 165, 157), 1.0),
    'gravel': ('Seixo (cobertura)', (154, 148, 139), 1.0), 'gpatio': ('Saibro estabilizado', (214, 204, 184), 1.0),
    'water': ('Água', (47, 138, 146), 0.65), 'liner': ('Liner da piscina', (143, 179, 176), 1.0),
    'furn_white': ('Móvel branco', (236, 235, 231), 1.0), 'furn_oak': ('Móvel de carvalho', (185, 140, 92), 1.0),
    'furn_dark': ('Móvel escuro', (58, 55, 51), 1.0), 'stone_top': ('Bancada de pedra', (216, 211, 201), 1.0),
    'fabric': ('Tecido', (183, 174, 159), 1.0), 'fabric_out': ('Tecido de exterior', (232, 226, 214), 1.0),
    'linen': ('Linho', (239, 233, 222), 1.0), 'rug': ('Tapete', (167, 152, 138), 1.0), 'car': ('Carro', (106, 112, 118), 1.0),
    # terreno (por classe do campo de alturas)
    't_meadow': ('Prado', (123, 138, 76), 1.0), 't_lawn': ('Relva', (103, 146, 74), 1.0), 't_path': ('Caminho de saibro', (205, 189, 156), 1.0),
    't_paving': ('Lajeado (terreno)', (186, 180, 169), 1.0), 't_bed': ('Canteiro', (93, 106, 58), 1.0),
    't_road': ('Calçada (estrada nova)', (185, 181, 173), 1.0), 't_gpatio': ('Saibro (pátios)', (210, 199, 178), 1.0),
    't_under': ('Terra (sob as casas)', (111, 106, 95), 1.0), 't_field': ('Campo', (138, 154, 85), 1.0),
    # vegetação e anotações
    'v_trunk': ('Tronco', (91, 75, 60), 1.0), 'v_oak': ('Copa de carvalho', (76, 106, 47), 1.0), 'v_pine': ('Copa de pinheiro', (58, 82, 41), 1.0),
    'v_euc': ('Copa de eucalipto', (95, 113, 84), 1.0), 'v_olive': ('Copa de oliveira', (127, 140, 102), 1.0),
    'v_arbutus': ('Copa de medronheiro', (59, 93, 46), 1.0), 'v_fruit': ('Copa de fruteira', (94, 127, 56), 1.0),
    'v_cypress': ('Copa de cipreste', (46, 74, 42), 1.0), 'v_hedge': ('Sebe', (79, 107, 58), 1.0), 'v_shrub': ('Arbustos e gramíneas', (141, 154, 90), 1.0),
    'north': ('Seta do norte', (176, 65, 62), 1.0),
}

# ============================================================================ etiquetas (tags) e categorias
TAG_TERRENO, TAG_MUROS, TAG_COB, TAG_MOB, TAG_VEG, TAG_TXT = '01 Terreno', '02 Muros e limites', '05 Coberturas', '06 Mobiliário', '07 Vegetação', '09 Textos e norte'
CASAS = {   # chave do spec → (nome do grupo, etiqueta)
    'N': ('Casa do Pátio (B-norte)', '03 Casa do Pátio (B-norte)'),
    'S': ('Casa Comprida (B-sul)', '04 Casa Comprida (B-sul)'),
    'A': ('Casa da parcela A (volumetria)', '08 Casa de A (volumetria)'),
}
TAGS = [TAG_TERRENO, TAG_MUROS, CASAS['N'][1], CASAS['S'][1], TAG_COB, TAG_MOB, TAG_VEG, CASAS['A'][1], TAG_TXT]
for g in spec['groups']:
    if g['n'] not in CASAS:          # grupo novo no spec: entra com etiqueta própria em vez de se perder
        CASAS[g['n']] = ('Grupo %s' % g['n'], '10 Outros')
        if '10 Outros' not in TAGS: TAGS.append('10 Outros')

# sub-grupos dentro de cada casa: (nome, etiqueta própria ou None = a da casa)
CATS = [('Paredes', None), ('Caixilharia e vidros', None), ('Portadas', None), ('Lajes e pavimentos', None),
        ('Coberturas (casa e alpendres)', TAG_COB), ('Alpendres e arrumos', None), ('Exteriores (deck, terraço e piscina)', None),
        ('Mobiliário', TAG_MOB), ('Volumetria', None), ('Cobertura de duas águas', None), ('Outros', None)]
C_PAR, C_CAIX, C_PORT, C_LAJ, C_COB, C_ALP, C_EXT, C_MOB, C_VOL, C_TEL, C_OUT = range(len(CATS))

PRISM_CAT = {'floor': C_LAJ, 'slab_bar': C_LAJ, 'slab_box': C_LAJ, 'pod_top': C_PAR,
             'roof_bar': C_COB, 'roof_box': C_COB, 'parapet': C_COB, 'alp': C_COB, 'car': C_COB,
             'alp_floor': C_ALP, 'car_floor': C_ALP,
             'deck': C_EXT, 'deck_body': C_EXT, 'terrace': C_EXT, 'terrace_body': C_EXT, 'coping': C_EXT, 'path': C_EXT}

def box_cat(gn, b):
    if gn == 'A': return C_VOL
    t, m = b.get('t'), b['m']
    if t == 'furn' or m.startswith('furn_'): return C_MOB
    if t == 'shutter' or m == 'shutter': return C_PORT
    if t in ('col', 'alp_wall', 'store') or m == 'timber': return C_ALP
    if t == 'water' or m in ('water', 'liner', 'granite', 'coping'): return C_EXT
    if m in ('frame', 'glass', 'oak'): return C_CAIX
    if m == 'metal': return C_PORT                  # calha das portadas, sob a pala
    if m in ('floor_int', 'floor_wood', 'tile'): return C_LAJ   # degraus interiores da sala
    if m in ('render', 'plaster', 'oak_panel', 'granite_wall', 'reveal'): return C_PAR
    return C_OUT

def prism_cat(gn, p):
    if gn == 'A': return C_VOL
    t = p.get('t') or ''
    if t in PRISM_CAT: return PRISM_CAT[t]
    if t.startswith('roof'): return C_COB
    return C_OUT

FACE_KEYS = ['+x', '-x', '+y', '-y', 'top', 'bot']
KEY_ALIAS = {'+u': '+x', '-u': '-x', '+v': '+y', '-v': '-y'}
def norm_faces(f):
    return {KEY_ALIAS.get(k, k): v for k, v in (f or {}).items()}

def r3(x): return round(float(x), 3)

def clean_ring(ring):
    """Arredonda ao mm e tira pontos repetidos (o SketchUp recusa faces com pontos duplicados)."""
    out = []
    for x, y in ring:
        q = (r3(x), r3(y))
        if not out or q != out[-1]: out.append(q)
    if len(out) > 1 and out[0] == out[-1]: out.pop()
    return out if len(out) >= 3 else None

def to_site(g, X, Y):
    c, s = math.cos(g['a']), math.sin(g['a'])
    return (g['o'][0] + X * c - Y * s, g['o'][1] + X * s + Y * c)

# ============================================================================ terreno: malha reduzida, recortada sob as casas e piscinas
t = spec['terrain']
NU, NV, ST = t['nu'], t['nv'], t['step']
ZG = np.frombuffer(base64.b64decode(t['h']), dtype='<i2').astype(np.float64).reshape(NV, NU) / 100.0 + t['z0']
CG = np.frombuffer(base64.b64decode(t['c']), dtype=np.uint8).reshape(NV, NU)
CLS = t['classes']
K = max(1, int(round(PASSO_TERRENO / ST)))
II = list(range(0, NU, K)); JJ = list(range(0, NV, K))
if II[-1] != NU - 1: II.append(NU - 1)
if JJ[-1] != NV - 1: JJ.append(NV - 1)
UG = np.array([t['u0'] + i * ST for i in II]); VG = np.array([t['v0'] + j * ST for j in JJ])
ZD = ZG[np.ix_(JJ, II)]
NI, NJ = len(II), len(JJ)

def z_mesh(u, v):
    """Cota na malha reduzida (mesma diagonal dos triângulos), para assentar árvores, sebes e textos."""
    i = int(np.clip(np.searchsorted(UG, u) - 1, 0, NI - 2)); j = int(np.clip(np.searchsorted(VG, v) - 1, 0, NJ - 2))
    fu = min(1.0, max(0.0, (u - UG[i]) / (UG[i + 1] - UG[i]))); fv = min(1.0, max(0.0, (v - VG[j]) / (VG[j + 1] - VG[j])))
    z00, z10, z01, z11 = ZD[j, i], ZD[j, i + 1], ZD[j + 1, i], ZD[j + 1, i + 1]
    if fu + fv <= 1.0: return float(z00 + fu * (z10 - z00) + fv * (z01 - z00))
    return float(z11 + (1 - fu) * (z01 - z11) + (1 - fv) * (z10 - z11))

def cls_at(u, v):
    i = int(np.clip(round((u - t['u0']) / ST), 0, NU - 1)); j = int(np.clip(round((v - t['v0']) / ST), 0, NV - 1))
    return CLS[CG[j, i]]

# buracos no terreno: implantação das casas (lajes de piso) e piscinas — o terreno não atravessa pavimentos nem água
holes = []
for g in spec['groups']:
    for p in g['prisms']:
        if p.get('t') in ('slab_bar', 'slab_box'):
            holes.append(Polygon([to_site(g, x, y) for x, y in p['p']]))
    for b in g['boxes']:
        if b['m'] == 'liner':
            (x0, y0, _), (x1, y1, _) = b['a'], b['b']
            holes.append(Polygon([to_site(g, x, y) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]))
HOLES = unary_union([h.buffer(0) for h in holes]) if holes else None
HOLES_P = prep(HOLES) if HOLES is not None else None
HB = HOLES.bounds if HOLES is not None else None

T_PTS, T_IDX = [], {}
def tpt(u, v, z):
    key = (r3(u), r3(v))
    if key not in T_IDX:
        T_IDX[key] = len(T_PTS); T_PTS.append((key[0], key[1], round(z - ZREF, 3)))
    return T_IDX[key]

T_TRIS = {}   # material → [(i, j, k)]
def add_ttri(mk, a, b, c):
    ia, ib, ic = tpt(*a), tpt(*b), tpt(*c)
    if len({ia, ib, ic}) < 3: return
    pa, pb, pc = T_PTS[ia], T_PTS[ib], T_PTS[ic]
    cr = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])
    if abs(cr) < 2e-4: return                       # lasca degenerada depois de arredondar
    if cr < 0: ib, ic = ic, ib
    T_TRIS.setdefault(mk, []).append((ia, ib, ic))

def plane(a, b, c):
    A = np.array([[a[0], a[1], 1.0], [b[0], b[1], 1.0], [c[0], c[1], 1.0]])
    return tuple(float(x) for x in np.linalg.solve(A, np.array([a[2], b[2], c[2]])))

def polys_of(geom):
    """Polígonos de uma geometria shapely qualquer (Polygon, MultiPolygon, GeometryCollection)."""
    if geom.is_empty: return []
    if geom.geom_type == 'Polygon': return [geom]
    return [p for part in getattr(geom, 'geoms', []) for p in polys_of(part)]

# limites entre classes (estrada, pátios, caminhos, relva, prado): polígonos tirados da grelha de 0,5 m e
# simplificados, para os limites ficarem direitos em vez de em escada de 1 m; os triângulos são cortados por eles.
# Máscaras encaixadas: o polígono k cobre as classes 1..k, por isso cada limite é desenhado por um só polígono
# (sem frestas entre polígonos vizinhos); o que fica fora de todos é campo ('field').
CLASS_ORDER = ['road', 'gpatio', 'path', 'paving', 'bed', 'under', 'lawn', 'meadow']
BACKGROUND = 'field'
SIMPLIFY = 0.6
def mask_poly(mask):
    rects = []
    for j in range(NV):
        row = mask[j]
        if not row.any(): continue
        d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
        for a, b in zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1) - 1):
            rects.append(sbox(t['u0'] + (a - 0.5) * ST, t['v0'] + (j - 0.5) * ST, t['u0'] + (b + 0.5) * ST, t['v0'] + (j + 0.5) * ST))
    if not rects: return None
    g = unary_union(rects).simplify(SIMPLIFY, preserve_topology=True).buffer(0)
    g = unary_union([p for p in polys_of(g) if p.area > 1.0])
    return None if g.is_empty else g
CPOLYS, _ids = [], []
for c in CLASS_ORDER:
    if c not in CLS: continue
    _ids.append(CLS.index(c))
    if not (CG == CLS.index(c)).any(): continue
    g = mask_poly(np.isin(CG, _ids))
    if g is not None: CPOLYS.append(('t_' + c, g, prep(g), g.bounds))
POLY_CLASSES = {mk for mk, _, _, _ in CPOLYS}
def fallback_class(u, v):
    mk = 't_' + cls_at(u, v)
    return ('t_' + BACKGROUND) if (mk in POLY_CLASSES and BACKGROUND in CLS) else mk

def add_piece(mk, geom, pl):
    a_, b_, c_ = pl
    for pg in polys_of(geom):
        if pg.area < 1e-4: continue
        pg = orient(pg, 1.0)
        rings = [list(pg.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in pg.interiors]
        verts = np.array([q for r in rings for q in r], dtype=np.float64)
        ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
        for x, y, z in earcut.triangulate_float64(verts, ends).reshape(-1, 3):
            add_ttri(mk, *[(verts[q][0], verts[q][1], a_ * verts[q][0] + b_ * verts[q][1] + c_) for q in (x, y, z)])

def bb_hit(bb, us, vs): return not (max(us) < bb[0] or min(us) > bb[2] or max(vs) < bb[1] or min(vs) > bb[3])

n_cut = 0
for j in range(NJ - 1):
    for i in range(NI - 1):
        P = lambda a, b: (float(UG[a]), float(VG[b]), float(ZD[b, a]))
        for tri in ((P(i, j), P(i + 1, j), P(i, j + 1)), (P(i + 1, j), P(i + 1, j + 1), P(i, j + 1))):
            us = [p[0] for p in tri]; vs = [p[1] for p in tri]
            tp = Polygon([(p[0], p[1]) for p in tri])
            rest = tp
            if HB is not None and bb_hit(HB, us, vs) and HOLES_P.intersects(tp):
                rest = tp.difference(HOLES); n_cut += 1
                if rest.is_empty: continue
            pl = None
            whole = rest is tp
            for mk, g, gp, bb in CPOLYS:
                if not bb_hit(bb, us, vs) or not gp.intersects(rest): continue
                if gp.contains(rest):
                    if whole: add_ttri(mk, *tri)
                    else: add_piece(mk, rest, pl or plane(*tri))
                    rest = None; break
                pl = pl or plane(*tri)
                add_piece(mk, rest.intersection(g), pl)
                rest = rest.difference(g); whole = False
                if rest.is_empty: rest = None; break
            if rest is None: continue
            c = rest.representative_point() if not whole else None
            mk = fallback_class(c.x, c.y) if c is not None else fallback_class(sum(us) / 3, sum(vs) / 3)
            if whole: add_ttri(mk, *tri)
            else: add_piece(mk, rest, pl or plane(*tri))

# ============================================================================ casas, muros e casa de A (dados para o Ruby e para o COLLADA)
def box_row(gn, b):
    (x0, y0, z0), (x1, y1, z1) = b['a'], b['b']
    f = norm_faces(b.get('f'))
    faces = [f.get(k, '') for k in FACE_KEYS]
    return [box_cat(gn, b), b['m'], r3(x0), r3(y0), r3(z0 - ZREF), r3(x1), r3(y1), r3(z1 - ZREF), faces if any(faces) else 0]

def prism_row(cat, p):
    outer = clean_ring(p['p'])
    if outer is None: return None
    hs = [h for h in (clean_ring(h) for h in p['h']) if h]
    return [cat, p['top'], p['side'], p.get('bot') or p['top'], r3(p['z'][0] - ZREF), r3(p['z'][1] - ZREF), outer, hs]

HOUSES = []
for g in spec['groups']:
    nome, tag = CASAS[g['n']]
    boxes = [box_row(g['n'], b) for b in g['boxes']]
    prisms = [r for r in (prism_row(prism_cat(g['n'], p), p) for p in g['prisms']) if r]
    roof = [[r3(v), r3(z - ZREF)] for v, z in g['roof_tri']] if g.get('roof_tri') else None
    HOUSES.append(dict(n=g['n'], nome=nome, tag=tag, o=[r3(g['o'][0]), r3(g['o'][1])], a=round(g['a'], 7),
                       boxes=boxes, prisms=prisms, roof=roof, roof_x=[-0.3, 15.3], g=g))
# muros do sítio: o grupo 'site' tem hoje o = [0, 0] e a = 0; se um dia mudar, passa-se já para coordenadas do sítio
site_g = spec['site']
def site_ring(ring): return [to_site(site_g, x, y) for x, y in ring]
WALLS = [r for r in (prism_row(0, dict(p, p=site_ring(p['p']), h=[site_ring(h) for h in p['h']])) for p in site_g['prisms']) if r]

def house_pts_site(H):
    """Pontos (u, v, z) de toda a geometria de uma casa, em coordenadas do sítio (para caixas envolventes)."""
    g = H['g']; pts = []
    for b in g['boxes']:
        for x in (b['a'][0], b['b'][0]):
            for y in (b['a'][1], b['b'][1]):
                u, v = to_site(g, x, y); pts += [(u, v, b['a'][2]), (u, v, b['b'][2])]
    for p in g['prisms']:
        for x, y in p['p']:
            u, v = to_site(g, x, y); pts += [(u, v, p['z'][0]), (u, v, p['z'][1])]
    if g.get('roof_tri'):
        for y, z in g['roof_tri']:
            for x in H['roof_x']:
                u, v = to_site(g, x, y); pts.append((u, v, z))
    return np.array(pts)

# ============================================================================ vegetação
TREE_FORM = {   # tipo → (nome, altura do tronco, centro da copa, semi-altura da copa) — frações da altura da árvore
    'pine': ('Pinheiro', 0.78, 0.84, 0.14), 'euc': ('Eucalipto', 0.62, 0.70, 0.27), 'oak': ('Carvalho', 0.42, 0.62, 0.36),
    'olive': ('Oliveira', 0.32, 0.60, 0.33), 'arbutus': ('Medronheiro', 0.38, 0.60, 0.38), 'fruit': ('Fruteira', 0.38, 0.60, 0.38),
    'cypress': ('Cipreste', 0.10, 0.52, 0.48),
}
TRUNK_R = 0.035          # raio do tronco, fração do diâmetro da copa
TREES = []
for kind, u, v, h, d in spec['trees']:
    k = kind if kind in TREE_FORM else 'oak'
    TREES.append([k, r3(u), r3(v), r3(z_mesh(u, v) - 0.15 - ZREF), r3(h), r3(d)])
# sebes: partidas em troços de ≤ 3 m que acompanham o terreno (base abaixo do chão, topo à altura da sebe)
HEDGES = []
for hd in spec['hedges']:
    (ua, va), (ub, vb), hh, w = hd['a'], hd['b'], hd['h'], hd['w']
    L = math.hypot(ub - ua, vb - va)
    if L < 0.05: continue
    n = max(1, int(math.ceil(L / 3.0))); nx, ny = -(vb - va) / L * w / 2, (ub - ua) / L * w / 2
    for s in range(n):
        t0, t1 = s / n, (s + 1) / n
        p0 = (ua + (ub - ua) * t0, va + (vb - va) * t0); p1 = (ua + (ub - ua) * t1, va + (vb - va) * t1)
        zs = [z_mesh(*p0), z_mesh(*p1), z_mesh((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)]
        z0 = min(zs) - 0.15; z1 = zs[2] + hh - 0.05
        ring = [(p0[0] + nx, p0[1] + ny), (p1[0] + nx, p1[1] + ny), (p1[0] - nx, p1[1] - ny), (p0[0] - nx, p0[1] - ny)]
        HEDGES.append([[[r3(a), r3(b)] for a, b in ring], r3(z0 - ZREF), r3(z1 - ZREF)])
SHRUBS = [[r3(u), r3(v), r3(z_mesh(u, v) - ZREF), r3(s)] for u, v, s in spec['shrubs']]

# ============================================================================ textos, seta do norte, cenas
NORTH = spec.get('north') or [math.sin(math.radians(ANG_DEG)), math.cos(math.radians(ANG_DEG))]
NORTH_ANGLE = math.degrees(math.atan2(NORTH[0], NORTH[1]))       # ângulo do norte a partir do eixo verde, no sentido dos ponteiros

TEXTS = []
for H in HOUSES:
    pts = house_pts_site(H)
    if H['n'] in ('N', 'S'):
        fp = [Polygon([to_site(H['g'], x, y) for x, y in p['p']]) for p in H['g']['prisms'] if p.get('t') in ('slab_bar', 'slab_box')]
        c = unary_union(fp).centroid if fp else None
        cu, cv = (c.x, c.y) if c else (pts[:, 0].mean(), pts[:, 1].mean())
    else:
        cu, cv = (pts[:, 0].min() + pts[:, 0].max()) / 2, (pts[:, 1].min() + pts[:, 1].max()) / 2
    TEXTS.append([H['nome'], r3(cu), r3(cv), r3(pts[:, 2].max() + 1.0 - ZREF)])
road = np.argwhere(CG == CLS.index('road')) if 'road' in CLS else np.zeros((0, 2))
if len(road):
    ru = t['u0'] + road[:, 1].mean() * ST; rv = t['v0'] + road[:, 0].mean() * ST
    TEXTS.append(['Estrada nova', r3(ru), r3(rv), r3(z_mesh(ru, rv) + 0.5 - ZREF)])

# seta do norte (5 m), no campo aberto a sul de B (sem árvores), e vista de planta que enquadra casas, muros e seta
frame_pts = [house_pts_site(H)[:, :2] for H in HOUSES if H['n'] in ('N', 'S')] or [house_pts_site(H)[:, :2] for H in HOUSES]
if WALLS: frame_pts.append(np.array([q for r in WALLS for q in r[6]], dtype=float))
pl = np.vstack(frame_pts)
PU0, PV0 = pl.min(axis=0); PU1, PV1 = pl.max(axis=0)
ax, ay = PU0 + 8.0, PV0 - 5.5
nx_, ny_ = NORTH; ex_, ey_ = ny_, -nx_
arrow2d = [(ax + nx_ * 4.0, ay + ny_ * 4.0), (ax - nx_ * 1.0 + ex_ * 1.4, ay - ny_ * 1.0 + ey_ * 1.4), (ax, ay), (ax - nx_ * 1.0 - ex_ * 1.4, ay - ny_ * 1.0 - ey_ * 1.4)]
az = max(z_mesh(*q) for q in arrow2d) + 0.15
ARROW = [[r3(a), r3(b), r3(az - ZREF)] for a, b in arrow2d]
TEXTS.append(['N', r3(ax + nx_ * 4.6), r3(ay + ny_ * 4.6), r3(az - ZREF)])
pl = np.vstack([pl, np.array(arrow2d)])
PU0, PV0 = pl.min(axis=0); PU1, PV1 = pl.max(axis=0)
PCU, PCV = (PU0 + PU1) / 2, (PV0 + PV1) / 2
PLAN_H = max(PV1 - PV0, (PU1 - PU0) / 1.6) * 1.08 + 3.0

CAM_NAMES = {'aerial': 'Aérea', 'aerial2': 'Aérea sudoeste', 'courtN': 'Pátio da Casa do Pátio', 'courtS': 'Piscina da Casa Comprida',
             'livingN': 'Sala', 'fromA': 'Vista da casa de A', 'road': 'Da estrada', 'cutaway': 'Maquete'}
SCENES = []   # [nome, olho, alvo, fov ou nil, altura ortogonal ou nil, cima, etiquetas escondidas]
for k, c in spec['cams'].items():
    hidden = [TAG_TXT] + ([TAG_COB] if c.get('noroof') else [])
    SCENES.append([CAM_NAMES.get(k, k), [r3(c['p'][0]), r3(c['p'][1]), r3(c['p'][2] - ZREF)],
                   [r3(c['t'][0]), r3(c['t'][1]), r3(c['t'][2] - ZREF)], float(c.get('fov', 45)), None, [0, 0, 1], hidden])
SCENES.append(['Planta (vista de topo)', [r3(PCU), r3(PCV), 120.0], [r3(PCU), r3(PCV), 0.0], None, r3(PLAN_H), [0, 1, 0], [TAG_COB, TAG_VEG]])

# ============================================================================ Ruby
def fnum(x, nd=3):
    v = round(float(x), nd)
    if v == 0: return '0'
    return ('%.*f' % (nd, v)).rstrip('0').rstrip('.')

def rb_str(s): return '"' + s.replace('\\', '\\\\').replace('"', '\\"').replace('#', '\\#') + '"'
def rb(x):
    if x is None: return 'nil'
    if isinstance(x, bool): return 'true' if x else 'false'
    if isinstance(x, str): return rb_str(x)
    if isinstance(x, (list, tuple)): return '[' + ','.join(rb(y) for y in x) + ']'
    if isinstance(x, (float, np.floating)): return fnum(x)
    return str(int(x))

ca, sa = math.cos(math.radians(ANG_DEG)), math.sin(math.radians(ANG_DEG))
HEADER = f'''# encoding: UTF-8
# =====================================================================================================================
# Terreno de poente (área resultante B), Trav. de João Pires, Carreço (Viana do Castelo)
# Duas casas T3 térreas — Casa do Pátio (lote B-norte) e Casa Comprida (lote B-sul) — com o terreno, os muros de
# granito, a vegetação e a casa da parcela A (só volumetria, para contexto).
# Gerado por fonte/skp.py a partir de fonte/out/spec.json (a mesma geometria dos renders). Não editar à mão:
# se o projeto mudar, volta-se a correr build3d.py e skp.py.
#
# COMO USAR (SketchUp 2017 ou mais recente):
#   1. Criar a pasta C:\\casa\\ e copiar para lá este ficheiro (construir_terreno_poente.rb).
#      Usar exatamente esta pasta: caminhos com espaços, ou sem o nome do ficheiro, falharam antes.
#   2. Abrir o SketchUp com um modelo novo, de preferência o modelo "Arquitetura — Metros".
#   3. Abrir a consola: Janela > Consola de Ruby (em inglês: Extensions > Developer > Ruby Console;
#      nas versões antigas, Window > Ruby Console).
#   4. Escrever exatamente (barras para a frente, plicas simples) e carregar em Enter:
#         load 'C:/casa/construir_terreno_poente.rb'
#   5. Esperar 20 s a 1 min. A consola diz o que construiu. Gravar como .skp.
#      Tudo fica numa só operação: Editar > Anular desfaz o modelo inteiro. Correr só uma vez por modelo.
#
# COORDENADAS (metros):
#   x (vermelho) = u — eixo local a {fnum(ANG_DEG, 3).replace('.', ',')}° a norte do nascente (ENE), o mesmo da casa de A
#   y (verde)    = v — perpendicular a u, para NNO
#   z (azul)     = cota − 33,00. A cota 33,00 fica em z = 0; cota absoluta = z + 33,00.
#   Origem (0, 0) = ETRS89 / PT-TM06 M = −60 409,15, P = 229 931,92 (canto SO da casa de A, estudo v4).
#   Para passar um ponto (x, y) do modelo a ETRS89 / PT-TM06:
#      M = −60 409,15 + {fnum(ca, 5).replace('.', ',')}·x − {fnum(sa, 5).replace('.', ',')}·y
#      P = 229 931,92 + {fnum(sa, 5).replace('.', ',')}·x + {fnum(ca, 5).replace('.', ',')}·y
#   O norte geográfico está {fnum(NORTH_ANGLE, 3).replace('.', ',')}° à direita do eixo verde (sentido dos ponteiros do relógio). O script
#   desenha uma seta vermelha no terreno (etiqueta "{TAG_TXT}") e acerta o norte solar e o local (Carreço,
#   {fnum(LAT, 3).replace('.', ',')} N, {fnum(-LON, 3).replace('.', ',')} W) para os estudos de sombras (Ver > Sombras).
#
# ORGANIZAÇÃO:
#   Etiquetas: {', '.join(TAGS)}.
#   Cada casa é um grupo com a sua origem e rotação, e lá dentro há sub-grupos por categoria: paredes,
#   caixilharia e vidros, portadas, lajes e pavimentos, coberturas, alpendres e arrumos, exteriores (deck,
#   terraço, piscina) e mobiliário. As coberturas e o mobiliário têm etiqueta própria, para se poderem esconder.
#   Cenas: as vistas dos renders e uma planta de topo (sem coberturas nem vegetação).
#
# APROXIMAÇÕES: terreno a partir das curvas de nível do levantamento (malha de {fnum(PASSO_TERRENO).replace('.', ',')} m; o levantamento
#   manda); vegetação ilustrativa; casa de A só em volumetria; mobiliário indicativo.
# =====================================================================================================================
'''

L = [HEADER, 'require "sketchup.rb"', '', 'module TerrenoPoente']
w = L.append
w('  MATS = {')
for k, (n, rgb, a) in MATS.items():
    w(f'    {rb_str(k)} => [{rb_str(n)}, {list(rgb)}, {fnum(a, 2) if a < 1 else "1.0"}],')
w('  }')
w('  TAGS = ' + rb(TAGS))
w(f'  TAG_TERRENO = {rb_str(TAG_TERRENO)}; TAG_MUROS = {rb_str(TAG_MUROS)}; TAG_VEG = {rb_str(TAG_VEG)}; TAG_TXT = {rb_str(TAG_TXT)}')
w('  # sub-grupos de cada casa: [nome, etiqueta própria ou nil (fica com a da casa)]')
w('  CATS = ' + rb([[n, tg] for n, tg in CATS]))
w('  FACE_KEYS = ' + rb(FACE_KEYS))
w('  # Casas: [nome, etiqueta, origem [u, v], rotação (rad, anti-horária a partir de x), caixas, prismas, telhado, x do telhado]')
w('  #   caixa:  [categoria, material, x0, y0, z0, x1, y1, z1, materiais por face (+x, -x, +y, -y, topo, base) ou 0]')
w('  #   prisma: [categoria, mat. topo, mat. lados, mat. base, z0, z1, contorno [[x, y]...], furos [[[x, y]...]...]]')
w('  #   telhado (casa de A): triângulo [[y, z]...] extrudido ao longo de x; coordenadas locais da casa')
w('  CASAS = [')
for H in HOUSES:
    w(f'    [{rb_str(H["nome"])}, {rb_str(H["tag"])}, {rb(H["o"])}, {fnum(H["a"], 7)},')
    w('     [')
    for b in H['boxes']: w('      ' + rb(b) + ',')
    w('     ], [')
    for p in H['prisms']: w('      ' + rb(p) + ',')
    w(f'     ], {rb(H["roof"])}, {rb(H["roof_x"])}],')
w('  ]')
w('  # muros de granito do sítio e capeamentos: prismas em coordenadas do sítio')
w('  MUROS = [')
for p in WALLS: w('    ' + rb(p) + ',')
w('  ]')
w('  # árvores: tipo => [nome, altura do tronco, centro da copa, semi-altura da copa] (frações da altura)')
w('  ARVORES = {' + ', '.join(f'{rb_str(k)} => {rb([n, a, b, c])}' for k, (n, a, b, c) in TREE_FORM.items()) + '}')
w(f'  RAIO_TRONCO = {fnum(TRUNK_R)}')
w('  # [tipo, u, v, z da base, altura, diâmetro da copa]')
w('  TREES = [')
for r_ in TREES: w('    ' + rb(r_) + ',')
w('  ]')
w('  # troços de sebe: [contorno [[u, v] x4], z0, z1]')
w('  HEDGES = [')
for r_ in HEDGES: w('    ' + rb(r_) + ',')
w('  ]')
w('  # arbustos: [u, v, z, tamanho]')
w('  SHRUBS = [')
for r_ in SHRUBS: w('    ' + rb(r_) + ',')
w('  ]')
w('  TEXTOS = ' + rb(TEXTS))
w('  SETA_NORTE = ' + rb(ARROW))
w(f'  NORTE_ANGULO = {fnum(NORTH_ANGLE, 3)}')
w(f'  LOCAL = {{ "Latitude" => {fnum(LAT, 4)}, "Longitude" => {fnum(LON, 4)}, "City" => "Carreço", "Country" => "Portugal", "TZOffset" => 0.0 }}')
w('  # cenas: [nome, olho, alvo, campo de visão vertical (ou nil = vista ortogonal), altura da vista ortogonal, vetor "cima", etiquetas escondidas]')
w('  CENAS = [')
for s in SCENES: w('    ' + rb(s) + ',')
w('  ]')
w(f'  # terreno: pontos [u, v, z] seguidos e triângulos por material (índices a partir de 0); malha de {fnum(PASSO_TERRENO)} m,')
w('  # recortada sob as casas e as piscinas')
pts_flat = [fnum(c) for p in T_PTS for c in p]
w('  TERRENO_PTS = [')
for k in range(0, len(pts_flat), 30): w('    ' + ','.join(pts_flat[k:k + 30]) + ',')
w('  ]')
w('  TERRENO_TRIS = {')
for mk, tl in T_TRIS.items():
    flat = [str(x) for tr in tl for x in tr]
    w(f'    {rb_str(mk)} => [')
    for k in range(0, len(flat), 45): w('      ' + ','.join(flat[k:k + 45]) + ',')
    w('    ],')
w('  }')
w(r'''
  class << self
    attr_reader :resumo
  end

  def self.p3(u, v, z)
    Geom::Point3d.new(u.to_f.m, v.to_f.m, z.to_f.m)
  end

  def self.material(key)
    return @mats[key] if @mats[key]
    nome, rgb, alfa = MATS[key] || ["Material #{key}", [200, 200, 200], 1.0]
    m = @model.materials[nome] || @model.materials.add(nome)
    m.color = Sketchup::Color.new(*rgb)
    m.alpha = alfa if alfa < 1.0
    @mats[key] = m
  end

  def self.layer(nome)
    @layers[nome] ||= (@model.layers[nome] || @model.layers.add(nome))
  end

  # corre o bloco; se uma peça falhar, conta-a e continua (o resto do modelo constrói-se na mesma)
  def self.safe(what)
    yield
  rescue StandardError => e
    @falhas += 1
    puts "  aviso: #{what} não foi construído (#{e.message})" if @falhas <= 12
    nil
  end

  def self.face_key(n)
    return "top" if n.z > 0.9
    return "bot" if n.z < -0.9
    return "+x" if n.x > 0.9
    return "-x" if n.x < -0.9
    return "+y" if n.y > 0.9
    "-y"
  end

  def self.paint(f, key)
    mat = material(key)
    f.material = mat
    f.back_material = mat
  end

  # base horizontal (contorno + furos) extrudida na vertical: um sólido fechado
  def self.extrude(ents, pts, holes, h)
    outer = ents.add_face(pts)
    raise "face não criada" unless outer
    holes.each do |hp|
      hf = ents.add_face(hp)
      hf.erase! if hf && hf.valid?
    end
    base = ents.grep(Sketchup::Face).max_by(&:area)
    base.reverse! if base.normal.z < 0
    base.pushpull(h.m)
  end

  def self.solid(parent)
    g = parent.add_group
    begin
      yield g.entities
    rescue StandardError
      g.erase! if g.valid?
      raise
    end
    g
  end

  def self.box(parent, row)
    _c, mk, x0, y0, z0, x1, y1, z1, faces = row
    solid(parent) do |ents|
      extrude(ents, [p3(x0, y0, z0), p3(x1, y0, z0), p3(x1, y1, z0), p3(x0, y1, z0)], [], z1 - z0)
      ents.grep(Sketchup::Face).each do |f|
        key = mk
        if faces != 0
          k = faces[FACE_KEYS.index(face_key(f.normal))]
          key = k unless k.nil? || k == ""
        end
        paint(f, key)
      end
    end
  end

  def self.prism(parent, row)
    _c, top, side, bot, z0, z1, outer, holes = row
    solid(parent) do |ents|
      extrude(ents, outer.map { |x, y| p3(x, y, z0) }, holes.map { |h| h.map { |x, y| p3(x, y, z0) } }, z1 - z0)
      ents.grep(Sketchup::Face).each do |f|
        n = f.normal
        paint(f, n.z > 0.9 ? top : (n.z < -0.9 ? bot : side))
      end
    end
  end

  # telhado de duas águas da casa de A: triângulo no plano x = x0, extrudido até x1
  # (empena poente pintada de vidro escuro, como a empena envidraçada da casa de A)
  def self.gable(parent, tri, x0, x1)
    solid(parent) do |ents|
      f = ents.add_face(tri.map { |y, z| p3(x0, y, z) })
      raise "face do telhado não criada" unless f
      f.reverse! if f.normal.x < 0
      f.pushpull((x1 - x0).m)
      ents.grep(Sketchup::Face).each do |fc|
        n = fc.normal
        paint(fc, n.x < -0.9 ? "glass_dark" : ((n.x > 0.9 || n.z < -0.9) ? "a_wall" : "a_roof"))
      end
    end
  end

  def self.build_terrain
    g = @model.entities.add_group
    g.name = "Terreno (curvas de nível do levantamento; aproximado)"
    g.layer = layer(TAG_TERRENO)
    flags = Geom::PolygonMesh::AUTO_SOFTEN | Geom::PolygonMesh::SMOOTH_SOFT_EDGES
    n = 0
    TERRENO_TRIS.each do |mk, idx|
      safe("terreno (#{mk})") do
        mesh = Geom::PolygonMesh.new(idx.size, idx.size / 3)
        local = {}
        ids = idx.map do |k|
          local[k] ||= mesh.add_point(p3(TERRENO_PTS[3 * k], TERRENO_PTS[3 * k + 1], TERRENO_PTS[3 * k + 2]))
        end
        (ids.size / 3).times { |i| mesh.add_polygon(ids[3 * i], ids[3 * i + 1], ids[3 * i + 2]) }
        mat = material(mk)
        g.entities.add_faces_from_mesh(mesh, flags, mat, mat)
        n += idx.size / 3
      end
    end
    n
  end

  def self.build_walls
    g = @model.entities.add_group
    g.name = "Muros de granito e capeamentos"
    g.layer = layer(TAG_MUROS)
    MUROS.each_with_index do |row, i|
      safe("muro #{i + 1}") { prism(g.entities, row).name = (row[2] == "coping" ? "Capeamento" : "Muro de granito") }
    end
  end

  def self.build_house(casa)
    nome, tag, o, ang, boxes, prisms, roof, roof_x = casa
    hg = @model.entities.add_group
    hg.name = nome
    hg.layer = layer(tag)
    hg.transformation = Geom::Transformation.new(p3(o[0], o[1], 0)) * Geom::Transformation.rotation(ORIGIN, Z_AXIS, ang)
    subs = {}
    sub = lambda do |ci|
      subs[ci] ||= begin
        cn, ctag = CATS[ci]
        sg = hg.entities.add_group
        sg.name = cn
        sg.layer = layer(ctag) if ctag
        sg
      end
    end
    boxes.each_with_index { |row, i| safe("#{nome}: caixa #{i + 1}") { box(sub.call(row[0]).entities, row) } }
    prisms.each_with_index { |row, i| safe("#{nome}: prisma #{i + 1}") { prism(sub.call(row[0]).entities, row) } }
    safe("#{nome}: telhado") { gable(sub.call(CATS.index { |c| c[0] == "Cobertura de duas águas" }).entities, roof, roof_x[0], roof_x[1]) } if roof
  end

  def self.sphere_mesh(rx, ry, rz, cz)
    t = (1.0 + Math.sqrt(5.0)) / 2.0
    v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    v = v.map { |p| l = Math.sqrt(p[0]**2 + p[1]**2 + p[2]**2); [p[0] / l, p[1] / l, p[2] / l] }
    f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
         [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
    cache = {}
    mid = lambda do |a, b|
      key = a < b ? [a, b] : [b, a]
      cache[key] ||= begin
        p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]
        l = Math.sqrt(p[0]**2 + p[1]**2 + p[2]**2)
        v << [p[0] / l, p[1] / l, p[2] / l]
        v.size - 1
      end
    end
    f2 = []
    f.each do |a, b, c|
      ab = mid.call(a, b); bc = mid.call(b, c); ca = mid.call(c, a)
      f2 << [a, ab, ca] << [b, bc, ab] << [c, ca, bc] << [ab, bc, ca]
    end
    mesh = Geom::PolygonMesh.new(v.size, f2.size)
    idx = v.map { |p| mesh.add_point(Geom::Point3d.new((p[0] * rx).m, (p[1] * ry).m, (cz + p[2] * rz).m)) }
    f2.each { |a, b, c| mesh.add_polygon(idx[a], idx[b], idx[c]) }
    mesh
  end

  # árvore unitária (1 m de altura, copa com 1 m de diâmetro): cada instância escala para o porte real
  def self.tree_def(kind)
    return @defs[kind] if @defs[kind]
    nome, tronco, centro, semi = ARVORES[kind] || ARVORES["oak"]
    d = @model.definitions.add("Árvore — #{nome}")
    ents = d.entities
    c = ents.add_circle(ORIGIN, Z_AXIS, RAIO_TRONCO.m, 8)
    tf = ents.add_face(c)
    tf.reverse! if tf.normal.z < 0
    tf.pushpull(tronco.m)
    ents.grep(Sketchup::Face).each { |f| paint(f, "v_trunk") }
    cm = material(MATS["v_#{kind}"] ? "v_#{kind}" : "v_oak")
    ents.add_faces_from_mesh(sphere_mesh(0.5, 0.5, semi, centro), Geom::PolygonMesh::AUTO_SOFTEN | Geom::PolygonMesh::SMOOTH_SOFT_EDGES, cm, cm)
    @defs[kind] = d
  end

  def self.shrub_def
    return @defs[:arbusto] if @defs[:arbusto]
    d = @model.definitions.add("Arbusto")
    cm = material("v_shrub")
    d.entities.add_faces_from_mesh(sphere_mesh(0.6, 0.6, 0.45, 0.25), Geom::PolygonMesh::AUTO_SOFTEN | Geom::PolygonMesh::SMOOTH_SOFT_EDGES, cm, cm)
    @defs[:arbusto] = d
  end

  def self.build_vegetation
    g = @model.entities.add_group
    g.name = "Vegetação (ilustrativa)"
    g.layer = layer(TAG_VEG)
    ga = g.entities.add_group
    ga.name = "Árvores"
    TREES.each_with_index do |(kind, u, v, z, h, d), i|
      safe("árvore #{i + 1}") do
        tr = Geom::Transformation.translation(p3(u, v, z)) * Geom::Transformation.scaling(d, d, h)
        ga.entities.add_instance(tree_def(kind), tr)
      end
    end
    gs = g.entities.add_group
    gs.name = "Sebes"
    HEDGES.each_with_index do |(ring, z0, z1), i|
      safe("sebe #{i + 1}") { prism(gs.entities, [0, "v_hedge", "v_hedge", "v_hedge", z0, z1, ring, []]) }
    end
    gb = g.entities.add_group
    gb.name = "Arbustos e gramíneas"
    SHRUBS.each_with_index do |(u, v, z, s), i|
      safe("arbusto #{i + 1}") do
        gb.entities.add_instance(shrub_def, Geom::Transformation.translation(p3(u, v, z)) * Geom::Transformation.scaling(s, s, s))
      end
    end
  end

  def self.build_texts
    g = @model.entities.add_group
    g.name = "Textos e norte"
    g.layer = layer(TAG_TXT)
    TEXTOS.each_with_index do |(s, u, v, z), i|
      safe("texto #{i + 1}") { g.entities.add_text(s, p3(u, v, z), Geom::Vector3d.new(0, 0, (s == "N" ? 0.6 : 2.0).m)) }
    end
    safe("seta do norte") do
      sg = g.entities.add_group
      sg.name = "Norte geográfico"
      f = sg.entities.add_face(SETA_NORTE.map { |u, v, z| p3(u, v, z) })
      f.reverse! if f.normal.z < 0
      paint(f, "north")
    end
  end

  def self.set_location
    si = @model.shadow_info
    LOCAL.merge("NorthAngle" => NORTE_ANGULO).each do |k, val|
      begin
        si[k] = val
      rescue StandardError => e
        puts "  aviso: sombras — #{k} não acertado (#{e.message})"
      end
    end
  end

  def self.build_scenes
    view = @model.active_view
    CENAS.each do |nome, eye, tgt, fov, altura, up, ocultas|
      safe("cena #{nome}") do
        cam = Sketchup::Camera.new(p3(*eye), p3(*tgt), Geom::Vector3d.new(*up))
        if fov
          cam.perspective = true
          cam.fov = fov
        else
          cam.perspective = false
          cam.height = altura.m
        end
        view.camera = cam
        TAGS.each { |t| layer(t).visible = !ocultas.include?(t) }
        @model.pages.add(nome)
      end
    end
    TAGS.each { |t| layer(t).visible = true }
    @model.pages.selected_page = @model.pages[0] if @model.pages.size > 0
  end

  def self.build
    @model = Sketchup.active_model
    @mats = {}
    @layers = {}
    @defs = {}
    @falhas = 0
    t0 = Time.now
    @model.start_operation("Terreno de poente (B), Carreço", true)
    puts "Terreno de poente: a construir o modelo..."
    TAGS.each { |t| layer(t) }
    ntri = build_terrain
    build_walls
    CASAS.each { |c| build_house(c) }
    build_vegetation
    build_texts
    set_location
    build_scenes
    @model.commit_operation
    nb = CASAS.inject(0) { |s, c| s + c[4].size }
    np = CASAS.inject(0) { |s, c| s + c[5].size }
    @resumo = { :caixas => nb, :prismas => np, :muros => MUROS.size, :triangulos_terreno => ntri, :arvores => TREES.size,
                :sebes => HEDGES.size, :arbustos => SHRUBS.size, :cenas => @model.pages.size, :falhas => @falhas }
    puts format("Terreno de poente: %d caixas e %d prismas nas casas, %d peças de muro, %d triângulos de terreno, %d árvores, %d troços de sebe, %d arbustos, %d cenas — %.1f s.",
                nb, np, MUROS.size, ntri, TREES.size, HEDGES.size, SHRUBS.size, @model.pages.size, Time.now - t0)
    puts(@falhas == 0 ? "Tudo construído sem falhas. Gravar como .skp." : "Atenção: #{@falhas} peça(s) não foram construídas (ver avisos acima); o resto está bem.")
  rescue StandardError => err
    @model.abort_operation if @model
    puts "Erro a construir o terreno de poente: #{err.message}"
    puts err.backtrace.first(6).join("\n")
    raise
  end
end

TerrenoPoente.build
''')
os.makedirs(OUT, exist_ok=True)
RB_PATH = os.path.join(OUT, RB_NAME)
with open(RB_PATH, 'w', encoding='utf-8', newline='\n') as fh:
    fh.write('\n'.join(L))

# ============================================================================ COLLADA
def box_tris(b):
    (x0, y0, z0), (x1, y1, z1) = b['a'], b['b']
    z0 -= ZREF; z1 -= ZREF
    f = norm_faces(b.get('f'))
    q = {'+x': [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], '-x': [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
         '+y': [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], '-y': [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
         'top': [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], 'bot': [(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)]}
    out = []
    for k, (a, bb, c, d) in q.items():
        mk = f.get(k) or b['m']
        out += [(mk, (a, bb, c)), (mk, (a, c, d))]
    return out

def prism_tris(ring, hs, z0, z1, top, side, bot):
    poly = Polygon(ring, hs).buffer(0)
    out = []
    for pg in polys_of(poly):
        pg = orient(pg, 1.0)
        rings = [list(pg.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in pg.interiors]
        verts = np.array([q for r in rings for q in r], dtype=np.float64)
        ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
        for a, b, c in earcut.triangulate_float64(verts, ends).reshape(-1, 3):
            A, B, C = verts[a], verts[b], verts[c]
            if (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) < 0: B, C = C, B
            out.append((top, ((A[0], A[1], z1), (B[0], B[1], z1), (C[0], C[1], z1))))
            out.append((bot, ((A[0], A[1], z0), (C[0], C[1], z0), (B[0], B[1], z0))))
        for r in rings:
            for i in range(len(r)):
                a, b = r[i], r[(i + 1) % len(r)]
                q0, q1, q2, q3 = (a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)
                out += [(side, (q0, q1, q2)), (side, (q0, q2, q3))]
    return out

def prism_row_tris(r):
    _c, top, side, bot, z0, z1, ring, hs = r
    return prism_tris(ring, hs, z0, z1, top, side, bot)

def gable_tris(tri, x0, x1):
    (y0, za), (y1, zb), (y2, zc) = tri
    A0, B0, C0 = (x0, y0, za), (x0, y1, zb), (x0, y2, zc)
    A1, B1, C1 = (x1, y0, za), (x1, y1, zb), (x1, y2, zc)
    # o triângulo virado para −x é a empena poente (vidro escuro); +x empena nascente
    nx = (y1 - y0) * (zc - za) - (zb - za) * (y2 - y0)      # componente x da normal de (A0, B0, C0)
    west, east = ((A0, C0, B0), (A1, B1, C1)) if nx > 0 else ((A0, B0, C0), (A1, C1, B1))
    out = [('glass_dark', west), ('a_wall', east)]
    for (P, Q), (P1, Q1) in (((A0, B0), (A1, B1)), ((B0, C0), (B1, C1)), ((C0, A0), (C1, A1))):
        quad = (P, Q, Q1, P1)
        n = np.cross(np.subtract(Q, P), np.subtract(Q1, P))
        cen = np.mean([A0, B0, C0], axis=0); mid = np.mean([P, Q], axis=0)
        if np.dot(n, mid - cen) < 0: quad = (P, P1, Q1, Q)
        mk = 'a_wall' if abs(P[2] - Q[2]) < 1e-6 and P[2] <= min(za, zb, zc) + 1e-6 else 'a_roof'
        out += [(mk, (quad[0], quad[1], quad[2])), (mk, (quad[0], quad[2], quad[3]))]
    return out

def icosphere(sub=1):
    tt = (1 + 5 ** 0.5) / 2
    V = [(-1, tt, 0), (1, tt, 0), (-1, -tt, 0), (1, -tt, 0), (0, -1, tt), (0, 1, tt), (0, -1, -tt), (0, 1, -tt), (tt, 0, -1), (tt, 0, 1), (-tt, 0, -1), (-tt, 0, 1)]
    V = [tuple(np.array(p) / np.linalg.norm(p)) for p in V]
    F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
         (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    for _ in range(sub):
        cache = {}
        def mid(a, b):
            key = (min(a, b), max(a, b))
            if key not in cache:
                p = (np.array(V[a]) + np.array(V[b])) / 2; V.append(tuple(p / np.linalg.norm(p))); cache[key] = len(V) - 1
            return cache[key]
        F2 = []
        for a, b, c in F:
            ab, bc, ca_ = mid(a, b), mid(b, c), mid(c, a)
            F2 += [(a, ab, ca_), (b, bc, ab), (c, ca_, bc), (ab, bc, ca_)]
        F = F2
    return V, F
ICO1 = icosphere(1); ICO0 = icosphere(0)
def ellipsoid(cx, cy, cz, rx, ry, rz, ico):
    V, F = ico
    P = [(cx + a * rx, cy + b * ry, cz + c * rz) for a, b, c in V]
    return [(P[a], P[b], P[c]) for a, b, c in F]

class Dae:
    def __init__(self):
        self.geoms = []
    def geom(self, name, tris):
        mats = {}
        for mk, tr in tris: mats.setdefault(mk, []).append(tr)
        if not mats: return None
        gid = 'geo%d' % len(self.geoms); self.geoms.append((gid, name, mats)); return gid

def esc(s): return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
D = Dae()
NODES = []   # (nome, matriz 4×4 ou None, [ids de geometria], [nós filhos])
NODES.append(('Terreno', None, [D.geom('Terreno', [(mk, tuple(T_PTS[q] for q in tr)) for mk, tl in T_TRIS.items() for tr in tl])], []))
NODES.append(('Muros de granito e capeamentos', None, [D.geom('Muros', [x for r in WALLS for x in prism_row_tris(r)])], []))
for H in HOUSES:
    bycat = {}
    for b, row in zip(H['g']['boxes'], H['boxes']):
        bycat.setdefault(row[0], []).extend(box_tris(b))
    for r in H['prisms']:
        bycat.setdefault(r[0], []).extend(prism_row_tris(r))
    if H['roof']:
        bycat.setdefault(C_TEL, []).extend(gable_tris(H['roof'], *H['roof_x']))
    kids = []
    for ci in sorted(bycat):
        gid = D.geom(f'{H["nome"]} — {CATS[ci][0]}', bycat[ci])
        if gid: kids.append((CATS[ci][0], None, [gid], []))
    c, s = math.cos(H['a']), math.sin(H['a'])
    NODES.append((H['nome'], [c, -s, 0, H['o'][0], s, c, 0, H['o'][1], 0, 0, 1, 0, 0, 0, 0, 1], [], kids))
veg_trees = []
for kind, u, v, z, h, d in TREES:
    _, tronco, centro, semi = TREE_FORM[kind]
    r = TRUNK_R * d; th = tronco * h
    for k in range(8):
        a0, a1 = 2 * math.pi * k / 8, 2 * math.pi * (k + 1) / 8
        p0 = (u + r * math.cos(a0), v + r * math.sin(a0)); p1 = (u + r * math.cos(a1), v + r * math.sin(a1))
        veg_trees += [('v_trunk', ((p0[0], p0[1], z), (p1[0], p1[1], z), (p1[0], p1[1], z + th))), ('v_trunk', ((p0[0], p0[1], z), (p1[0], p1[1], z + th), (p0[0], p0[1], z + th)))]
    veg_trees += [('v_' + kind, tr) for tr in ellipsoid(u, v, z + centro * h, 0.5 * d, 0.5 * d, semi * h, ICO1)]
veg_hedges = [x for ring, z0, z1 in HEDGES for x in prism_tris(ring, [], z0, z1, 'v_hedge', 'v_hedge', 'v_hedge')]
veg_shrubs = [('v_shrub', tr) for u, v, z, s in SHRUBS for tr in ellipsoid(u, v, z + 0.25 * s, 0.6 * s, 0.6 * s, 0.45 * s, ICO0)]
NODES.append(('Vegetação (ilustrativa)', None, [], [('Árvores', None, [D.geom('Árvores', veg_trees)], []), ('Sebes', None, [D.geom('Sebes', veg_hedges)], []),
                                                  ('Arbustos e gramíneas', None, [D.geom('Arbustos', veg_shrubs)], [])]))
ar = [tuple(p) for p in ARROW]
NODES.append(('Norte geográfico', None, [D.geom('Norte', [('north', (ar[0], ar[1], ar[2])), ('north', (ar[0], ar[2], ar[3]))])], []))

used = sorted({mk for _, _, mats in D.geoms for mk in mats})
X = ['<?xml version="1.0" encoding="utf-8"?>', '<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">',
     '<asset><contributor><author>skp.py — terreno de poente, Carreço</author><authoring_tool>skp.py</authoring_tool>'
     '<comments>x = u, y = v (eixos locais do sítio), z = cota - 33,00. Origem ETRS89/PT-TM06 M=-60409,15 P=229931,92; eixo x a 19,951 graus a norte do nascente.</comments>'
     '</contributor><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>', '<library_effects>']
for mk in used:
    n, rgb, a = MATS.get(mk, ('Material ' + mk, (200, 200, 200), 1.0))
    col = ' '.join('%.4f' % (x / 255) for x in rgb)
    tr = (f'<transparent opaque="A_ONE"><color>1 1 1 {a:.2f}</color></transparent><transparency><float>1</float></transparency>' if a < 1 else '')
    X.append(f'<effect id="fx-{mk}"><profile_COMMON><technique sid="common"><lambert><diffuse><color>{col} 1</color></diffuse>{tr}</lambert></technique></profile_COMMON></effect>')
X.append('</library_effects><library_materials>')
for mk in used:
    X.append(f'<material id="mat-{mk}" name="{esc(MATS.get(mk, ("Material " + mk,))[0])}"><instance_effect url="#fx-{mk}"/></material>')
X.append('</library_materials><library_geometries>')
GEO_MATS = {}
for gid, name, mats in D.geoms:
    pts, pidx, parts = [], {}, []
    for mk, tl in mats.items():
        ids = []
        for tr in tl:
            for p in tr:
                key = (round(float(p[0]), 3), round(float(p[1]), 3), round(float(p[2]), 3))
                if key not in pidx: pidx[key] = len(pts); pts.append(key)
                ids.append(pidx[key])
        parts.append((mk, ids))
    GEO_MATS[gid] = [mk for mk, _ in parts]
    X.append(f'<geometry id="{gid}" name="{esc(name)}"><mesh><source id="{gid}-pos"><float_array id="{gid}-pos-a" count="{len(pts) * 3}">'
             + ' '.join(f'{fnum(a)} {fnum(b)} {fnum(c)}' for a, b, c in pts)
             + f'</float_array><technique_common><accessor source="#{gid}-pos-a" count="{len(pts)}" stride="3">'
             '<param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>'
             f'<vertices id="{gid}-vtx"><input semantic="POSITION" source="#{gid}-pos"/></vertices>')
    for mk, ids in parts:
        X.append(f'<triangles material="m-{mk}" count="{len(ids) // 3}"><input semantic="VERTEX" source="#{gid}-vtx" offset="0"/><p>' + ' '.join(map(str, ids)) + '</p></triangles>')
    X.append('</mesh></geometry>')
X.append('</library_geometries><library_visual_scenes><visual_scene id="cena" name="Terreno de poente (B), Carreço">')
nid = [0]
def write_node(name, mtx, gids, kids):
    nid[0] += 1
    X.append(f'<node id="n{nid[0]}" name="{esc(name)}">' + (f'<matrix sid="transform">{" ".join(fnum(x, 7) for x in mtx)}</matrix>' if mtx else ''))
    for gid in gids:
        if not gid: continue
        X.append(f'<instance_geometry url="#{gid}"><bind_material><technique_common>'
                 + ''.join(f'<instance_material symbol="m-{mk}" target="#mat-{mk}"/>' for mk in GEO_MATS[gid]) + '</technique_common></bind_material></instance_geometry>')
    for k in kids: write_node(*k)
    X.append('</node>')
for nd in NODES: write_node(*nd)
X.append('</visual_scene></library_visual_scenes><scene><instance_visual_scene url="#cena"/></scene></COLLADA>')
DAE_PATH = os.path.join(OUT, DAE_NAME)
with open(DAE_PATH, 'w', encoding='utf-8', newline='\n') as fh:
    fh.write('\n'.join(X))

# ============================================================================ LEIA-ME
cenas_txt = '\n'.join('   - ' + s[0] for s in SCENES)
tags_txt = '\n'.join('   ' + tg for tg in TAGS)
LEIA = f'''TERRENO DE POENTE (ÁREA B), CARREÇO — MODELO SKETCHUP
==================================================

Duas casas T3 térreas — Casa do Pátio (lote B-norte) e Casa Comprida (lote B-sul) — com o terreno,
os muros de granito, a vegetação e a casa da parcela A (só volumetria, para contexto).
Gerado por fonte/skp.py a partir de fonte/out/spec.json: é a mesma geometria dos renders.

FICHEIROS
  {RB_NAME.ljust(30)}script Ruby que constrói o modelo nativo no SketchUp (recomendado)
  {DAE_NAME.ljust(30)}o mesmo modelo em COLLADA (alternativa sem Ruby)
  {TXT_NAME.ljust(30)}este ficheiro

ABRIR COM O SCRIPT RUBY (SketchUp 2017 ou mais recente)
  1. Criar a pasta C:\\casa\\ e copiar para lá o ficheiro {RB_NAME}.
     Usar exatamente esta pasta: caminhos com espaços, ou sem o nome do ficheiro, falharam antes.
  2. Abrir o SketchUp com um modelo novo ("Arquitetura — Metros").
  3. Janela > Consola de Ruby (em inglês: Extensions > Developer > Ruby Console).
  4. Escrever, tal e qual, e carregar em Enter:
        load 'C:/casa/{RB_NAME}'
  5. Esperar 20 s a 1 min. A consola diz o que foi construído. Gravar como .skp.
  Correr só uma vez por modelo. Editar > Anular desfaz tudo de uma vez.

ABRIR O COLLADA
  Ficheiro > Importar…, tipo "COLLADA (*.dae)", escolher {DAE_NAME}.
  Vem com os grupos e as cores, mas sem etiquetas, cenas, textos nem norte (isso só o script faz).

COORDENADAS (metros)
  x (eixo vermelho) = u, eixo local a {fnum(ANG_DEG, 3).replace('.', ',')}° a norte do nascente (ENE) — o mesmo da casa de A
  y (eixo verde)    = v, perpendicular, para NNO
  z (eixo azul)     = cota − 33,00. A cota 33,00 fica em z = 0; cota absoluta = z + 33,00.
  Origem (0, 0) = ETRS89 / PT-TM06 M = −60 409,15, P = 229 931,92 (canto SO da casa de A, estudo v4).
     M = −60 409,15 + {fnum(ca, 5).replace('.', ',')}·x − {fnum(sa, 5).replace('.', ',')}·y
     P = 229 931,92 + {fnum(sa, 5).replace('.', ',')}·x + {fnum(ca, 5).replace('.', ',')}·y
  Norte geográfico: {fnum(NORTH_ANGLE, 3).replace('.', ',')}° à direita do eixo verde (sentido dos ponteiros). Há uma seta vermelha
  no terreno, no campo a sul do lote B-sul. O script acerta o norte solar e o local (Carreço, {fnum(LAT, 3).replace('.', ',')} N,
  {fnum(-LON, 3).replace('.', ',')} W) para os estudos de sombras: Ver > Sombras. Para confirmar o norte, ligar
  Ver > Barras de ferramentas > Norte solar > Mostrar norte: a linha do SketchUp deve ir na direção da seta vermelha.

ETIQUETAS (para ligar e desligar)
{tags_txt}
  Cada casa é um grupo com a sua origem e rotação. Lá dentro há sub-grupos: Paredes, Caixilharia e vidros,
  Portadas, Lajes e pavimentos, Coberturas (casa e alpendres), Alpendres e arrumos, Exteriores (deck,
  terraço e piscina) e Mobiliário. As coberturas e o mobiliário têm etiqueta própria.

CENAS
{cenas_txt}

O QUE É APROXIMADO
  - Terreno: cotas tiradas das curvas de nível do levantamento (equidistância 0,20 m, cotas atribuídas a
    partir das curvas mestras lidas na imagem), modeladas à volta das casas; malha de {fnum(PASSO_TERRENO).replace('.', ',')} m.
    Não substitui o levantamento: o levantamento manda.
  - Vegetação ilustrativa: posição e porte indicativos; a mata a norte e a poente segue a ortofoto.
  - Casa da parcela A: só volumetria (embasamento, paredes, telhado de duas águas e empena envidraçada).
  - Mobiliário e carros: indicativos, para dar escala.
  - Fora do modelo: o mar e a paisagem distante que aparecem nos renders.
'''
TXT_PATH = os.path.join(OUT, TXT_NAME)
with open(TXT_PATH, 'w', encoding='utf-8-sig', newline='\r\n') as fh:
    fh.write(LEIA)

ntt = sum(len(v) for v in T_TRIS.values())
print('rb %d KB | dae %d KB | txt %d B' % (os.path.getsize(RB_PATH) // 1024, os.path.getsize(DAE_PATH) // 1024, os.path.getsize(TXT_PATH)))
print('casas', [(H['n'], len(H['boxes']), len(H['prisms'])) for H in HOUSES], '| muros', len(WALLS),
      '| terreno: malha %g m, %d pontos, %d triângulos (%d junto a casas e piscinas)' % (PASSO_TERRENO, len(T_PTS), ntt, n_cut),
      '| árvores', len(TREES), 'sebes', len(HEDGES), 'arbustos', len(SHRUBS), '| cenas', len(SCENES), '| norte %.3f°' % NORTH_ANGLE)
