# -*- coding: utf-8 -*-
"""Gera out/spec.json (modelo 3D) a partir de geom.py."""
import json, math, base64, struct
from shapely.geometry import Polygon, Point, LineString, box as sbox
from shapely.ops import unary_union
from shapely.prepared import prep
import geom as G
from geom import add_box, add_prism, boxes, prisms

EPS = 1e-6

# ============================================================================ paredes com vãos
def wall_pieces(level, w, zb, zt, ext_mat, int_mat, reveal='reveal'):
    u0, v0, u1, v1, out = w
    axis = 'u' if (u1 - u0) >= (v1 - v0) else 'v'
    ops = []
    for o in G.OPEN[level]:
        a0, b0, a1, b1 = o['r']
        if min(u1, a1) - max(u0, a0) > EPS and min(v1, b1) - max(v0, b0) > EPS:
            if axis == 'u':
                ops.append((max(u0, a0), min(u1, a1), o['z'][0], o['z'][1]))
            else:
                ops.append((max(v0, b0), min(v1, b1), o['z'][0], o['z'][1]))
    ops.sort()
    if out:
        opp = {'-u': '+u', '+u': '-u', '-v': '+v', '+v': '-v'}[out]
        ends = ['-u', '+u'] if axis == 'u' else ['-v', '+v']
        faces = {out: ext_mat, opp: int_mat, 'top': int_mat, 'bot': int_mat}
        for e in ends: faces[e] = reveal
    else:
        faces = None
    lo = u0 if axis == 'u' else v0
    hi = u1 if axis == 'u' else v1

    def put(a, b, z0, z1, f):
        if axis == 'u':
            add_box(a, v0, z0, b, v1, z1, int_mat if not out else ext_mat, faces=f)
        else:
            add_box(u0, a, z0, u1, b, z1, int_mat if not out else ext_mat, faces=f)
    cur = lo
    for a, b, z0, z1 in ops:
        if a > cur + EPS:
            put(cur, a, zb, zt, faces)
        if z0 > zb + EPS:
            f = dict(faces) if faces else None
            if f: f['top'] = reveal
            put(a, b, zb, z0, f)
        if z1 < zt - EPS:
            f = dict(faces) if faces else None
            if f: f['bot'] = reveal
            put(a, b, z1, zt, f)
        cur = max(cur, b)
    if hi > cur + EPS:
        put(cur, hi, zb, zt, faces)

for w in G.WALLS['rc']:
    if w[4]:
        wall_pieces('rc', w, G.Z_RC, G.Z_CEIL, 'timber', 'plaster')
    else:
        wall_pieces('rc', w, G.Z_RC, G.Z_CEIL, 'plaster', 'plaster')
for (u0, v0, u1, v1, h) in G.LOW_WALLS['rc']:
    add_box(u0, v0, G.Z_RC, u1, v1, G.Z_RC + h, 'plaster', faces={'top': 'oak'})
for w in G.WALLS['cave']:
    if w[4]:
        wall_pieces('cave', w, G.Z_FOOTING, G.Z_PLINTH_TOP, 'render', 'cave_wall')
    else:
        wall_pieces('cave', w, G.Z_CAVE, G.Z_CAVE_SOFF, 'cave_wall', 'cave_wall')

# junta de sombra entre embasamento e caixa de madeira (36,90 → 37,00), recuada 3 cm
u0, v0, u1, v1 = G.FOOT
add_prism(G.FOOT_POLY.buffer(-0.03, join_style=2).difference(G.FOOT_POLY.buffer(-0.29, join_style=2)), G.Z_PLINTH_TOP, G.Z_RC - 0.02, 'reveal', 'reveal', tag='reveal')

# ============================================================================ lajes
stair_void = G.sbox(G.STAIR['u0'], 1.27, G.STAIR['u1'], max(G.STAIR['v_top'], G.STAIR['v_bot']))   # v3: abre do fecho sul (1,27) ao topo (6,08)
add_prism(G.FOOT_POLY.difference(stair_void), 36.62, 36.985, 'concrete', 'reveal', bottom='plaster', tag='slab_rc')
add_prism(G.CAVE_POLY, 33.85, G.Z_CAVE - 0.005, 'cave_floor', 'render', tag='slab_cave')
for lvl, z in (('rc', 36.985), ('cave', G.Z_CAVE - 0.005)):
    for name, rect, mat in G.ROOMS[lvl]:
        if name == 'Escada':
            continue
        add_prism(G.room_poly(lvl, name, rect), z, z + 0.015, mat, mat, tag='floor')
# portas exteriores/limiar: pavimento contínuo no vão das portas de correr
roof_holes = unary_union([G.sbox(*s) for s in G.SKYLIGHTS])
add_prism(G.FOOT_POLY.difference(roof_holes), G.Z_CEIL, G.Z_ROOF_SLAB, 'concrete', 'timber', bottom='ceiling', tag='roof')
add_prism(G.FOOT_POLY.difference(roof_holes.buffer(0.12, join_style=2)), G.Z_ROOF_SLAB, G.Z_ROOF_TOP, 'gravel', 'timber', bottom='concrete', tag='roof')
for s in G.SKYLIGHTS:  # costeletas + vidro
    a, b, c, d = s
    ring = G.sbox(a - 0.12, b - 0.12, c + 0.12, d + 0.12).difference(G.sbox(a, b, c, d))
    add_prism(ring, G.Z_ROOF_SLAB, G.Z_ROOF_TOP + 0.10, 'metal', 'metal', tag='sky_frame')
    add_box(a, b, G.Z_ROOF_TOP + 0.10, c, d, G.Z_ROOF_TOP + 0.12, 'glass', tag='glass', cast=False)
    add_box(a, b, G.Z_CEIL, c, d, G.Z_ROOF_SLAB, 'plaster', faces={'top': 'plaster', 'bot': 'plaster'}, tag='skywell_dummy') if False else None
# pala em consola (betão à vista)
add_prism(G.PALA_POLY, G.Z_CEIL, G.Z_PALA_TOP, 'concrete', 'concrete', bottom='soffit', tag='pala')
# varanda poente em consola sobre o pátio da garagem
add_prism(G.sbox(*G.BALCONY), 36.72, G.Z_DECK, 'deck', 'concrete', bottom='soffit', tag='balcony')

# ============================================================================ caixilharia
FR = 0.05  # perfil

def glazing(level, o):
    a0, b0, a1, b1 = o['r']
    z0, z1 = o['z']
    k = o['k']
    if k in ('door', 'pass'):
        return
    along_u = (a1 - a0) > (b1 - b0)
    # plano do caixilho: a 2/3 da espessura para o interior (fachada ventilada)
    if along_u:
        vm = (b0 + b1) / 2
        p0, p1 = a0, a1
        def bx(s0, s1, zz0, zz1, m, t=0.06, off=0.0):
            add_box(s0, vm + off - t / 2, zz0, s1, vm + off + t / 2, zz1, m, cast=(m != 'glass'))
    else:
        um = (a0 + a1) / 2
        p0, p1 = b0, b1
        def bx(s0, s1, zz0, zz1, m, t=0.06, off=0.0):
            add_box(um + off - t / 2, s0, zz0, um + off + t / 2, s1, zz1, m, cast=(m != 'glass'))
    if k == 'garage':
        bx(p0, p1, z0, z1, 'garage_door', t=0.08, off=0.0)
        return
    if k == 'entry':
        bx(p0, p0 + 1.02, z0, z1, 'oak', t=0.07)                  # porta pivotante em carvalho, até ao teto
        bx(p0 + 1.02, p1, z0, z1, 'frame', t=0.06)
        return
    # aro
    bx(p0, p1, z1 - FR, z1, 'frame'); bx(p0, p1, z0, z0 + FR, 'frame')
    bx(p0, p0 + FR, z0, z1, 'frame'); bx(p1 - FR, p1, z0, z1, 'frame')
    n = {'slide2': 2, 'slide3': 3, 'win': 1, 'glassdoor': 1, 'fixed': 1}.get(k, 1)
    if k == 'win' and (p1 - p0) > 1.6:
        n = 2
    w = (p1 - p0 - 2 * FR) / n
    for i in range(n):
        s0 = p0 + FR + i * w
        off = 0.0 if (k.startswith('slide') and i % 2 == 0) else (0.035 if k.startswith('slide') else 0.0)
        bx(s0 + 0.0, s0 + w, z0 + FR, z1 - FR, 'glass', t=0.024, off=off)
        if i > 0:
            bx(s0 - 0.025, s0 + 0.025, z0 + FR, z1 - FR, 'frame', t=0.07)

for lvl in ('rc', 'cave'):
    for o in G.OPEN[lvl]:
        glazing(lvl, o)

# guarda de vidro (suite 1, sobre o pátio) e varanda poente
add_box(11.85, -1.36, G.Z_RC, 14.25, -1.34, 38.10, 'glass', tag='glass', cast=False)
add_box(-1.22, 1.68, G.Z_DECK, -1.20, 8.00, 38.05, 'glass', tag='glass', cast=False)
add_box(-1.25, 1.68, 38.03, -1.18, 8.00, 38.07, 'frame')

# portadas de correr em ripado carbonizado (V1 e V1b) — estacionadas à frente do pilar cego entre os dois vãos
for i, (va, vb) in enumerate([(2.45, 4.15), (2.95, 4.65), (3.20, 5.20)]):   # v3: estacionam à frente do pilar da lareira
    uu = -1.10 + i * 0.07
    add_box(uu - 0.03, va, G.Z_RC + 0.02, uu + 0.03, vb, G.Z_CEIL - 0.02, 'shutter', tag='shutter')
add_box(-1.20, -3.30, G.Z_CEIL - 0.06, -0.95, 8.0, G.Z_CEIL, 'metal')   # calha da portada sob a pala

# ============================================================================ escadas
def stair(u0, u1, v_top, v_bot, z_top, z_bot, n, mat='stair', side=None, base=None):
    dv = (v_bot - v_top) / (n - 1)
    rz = (z_top - z_bot) / n
    for i in range(n - 1):
        va, vb = v_top + i * dv, v_top + (i + 1) * dv
        zt = z_top - (i + 1) * rz
        add_box(u0, min(va, vb), (base if base is not None else zt - 0.18), u1, max(va, vb), zt, mat)
stair(G.STAIR['u0'], G.STAIR['u1'], G.STAIR['v_top'], G.STAIR['v_bot'], G.Z_RC, G.Z_CAVE, G.STAIR['n'], 'oak')
# escada do pátio (granito)
ps = G.PATIO_STAIR
stair(ps['u0'], ps['u1'], ps['v_top'], ps['v_bot'], ps['z_top'], G.Z_PATIO, ps['n'], 'granite')
add_box(ps['u0'], ps['v_top'] - 0.8, 33.9, ps['u1'], ps['v_top'], ps['z_top'], 'granite')
# entrada pedonal (PIP): portão no muro da estrada, patamar e 7 degraus que sobem para norte junto ao muro
es = G.ENTRY_STAIR
add_prism(G.ENTRY_LANDING, 34.9, es['z_bot'], 'granite', 'granite', tag='entry')
stair(es['u0'], es['u1'], es['v_top'], es['v_bot'], G.Z_DECK, es['z_bot'], es['n'], 'granite', base=34.9)
add_box(es['u0'], es['v_bot'] - 0.30, 34.9, es['u1'], es['v_bot'], es['z_bot'] + 0.0, 'granite')
add_box(0.10, es['v_bot'], G.Z_DECK, 0.12, es['v_top'], 37.95, 'glass', tag='glass', cast=False)   # guarda do deck sobre a escada
gu = G.B_N(sum(G.GATE_V) / 2) + 0.15
add_box(gu - 0.03, G.GATE_V[0] + 0.05, es['z_bot'], gu + 0.03, G.GATE_V[1] - 0.05, es['z_bot'] + 1.05, 'metal_black', tag='gate')   # portão pedonal em aço

# ============================================================================ deck, piscina, muros
deck = G.DECK_POLY.difference(G.DECK_NOTCH)
deck_nopool = deck.difference(G.sbox(*G.POOL))
add_prism(deck_nopool, 33.60, G.Z_DECK - 0.02, 'render', 'render', tag='deck_body')
add_prism(deck_nopool.difference(G.FOOT_POLY), G.Z_DECK - 0.02, G.Z_DECK, 'deck', 'deck', tag='deck_top')
pu0, pv0, pu1, pv1 = G.POOL
add_box(pu0, pv0, G.Z_POOL_FLOOR - 0.25, pu1, pv1, G.Z_POOL_FLOOR, 'liner')
for (a, b, c, d) in [(pu0, pv0, pu1, pv0 + 0.02), (pu0, pv1 - 0.02, pu1, pv1), (pu0, pv0, pu0 + 0.02, pv1), (pu1 - 0.02, pv0, pu1, pv1)]:
    add_box(a, b, G.Z_POOL_FLOOR, c, d, G.Z_DECK - 0.02, 'liner')
add_box(pu0 + 0.02, pv0 + 0.02, G.Z_POOL_WATER - 0.01, pu1 - 0.02, pv1 - 0.02, G.Z_POOL_WATER, 'water', tag='water', cast=False)
# capeamento em granito amaciado (n, s, e); a poente o muro da estrada
for (a, b, c, d) in [(pu0 - 0.30, pv1, pu1 + 0.30, pv1 + 0.30), (pu0 - 0.30, pv0 - 0.30, pu1 + 0.30, pv0), (pu1, pv0, pu1 + 0.30, pv1), (pu0 - 0.30, pv0, pu0, pv1)]:
    add_box(a, b, G.Z_DECK - 0.02, c, d, G.Z_DECK + 0.03, 'coping')

def parapet_along(points, h0, h1, mat, t=0.25, inward=+1):
    ls = LineString(points)
    poly = ls.buffer(t / 2, cap_style=2, join_style=2)
    add_prism(poly, h0, h1, mat, mat, tag='parapet')

# ---- muros junto à estrada em patamares (v3): muro 1 à face da estrada (≤ 1,10 acima dela), patamar plantado, muro 2 do deck
for (va, vb, top) in G.MURO1_SEGS:
    ls = LineString([(G.B_N(va) + 0.15, va), (G.B_N(vb) + 0.15, vb)])
    add_prism(ls.buffer(0.15, cap_style=2, join_style=2), min(G.road_z(0, va), G.road_z(0, vb)) - 0.45, top, 'stone', 'stone', tag='parapet')
    add_prism(ls.buffer(0.17, cap_style=2, join_style=2), top, top + 0.04, 'coping', 'coping', tag='parapet')
m2 = LineString(G.MURO2_LINE)
add_prism(m2.buffer(0.25, single_sided=True, join_style=2), 34.6, G.Z_DECK - 0.02, 'stone', 'stone', tag='parapet')
add_prism(m2.buffer(0.27, single_sided=True, join_style=2), G.Z_DECK - 0.02, G.Z_DECK + 0.03, 'coping', 'coping', tag='parapet')
add_prism(m2.buffer(0.13, single_sided=True, join_style=2).difference(m2.buffer(0.11, single_sided=True, join_style=2)), G.Z_DECK, 37.95, 'glass', 'glass', tag='glass')
for (u0, v0, u1, v1, top) in G.COURT_WALLS:
    add_box(u0, v0, 33.6, u1, v1, top, 'stone', faces={'top': 'coping'})
# muros do pátio afundado (betão ciclópico com granito da escavação)
add_box(9.10, -5.10, 33.6, 9.40, -1.33, 37.03, 'stone', faces={'-u': 'render', 'top': 'coping'})
add_box(9.24, -5.10, 37.03, 9.26, -1.33, 38.05, 'glass', tag='glass', cast=False)
add_box(9.10, -5.10, 33.6, 14.20, -4.80, 36.00, 'stone', faces={'top': 'coping'})
add_box(15.20, -5.10, 33.6, 15.50, -1.33, 36.00, 'stone', faces={'top': 'coping'})
add_box(9.10, -8.20, 33.6, 9.40, -5.10, 37.90, 'render', faces={'top': 'coping'})
add_prism(G.sbox(*G.PATIO), 33.70, G.Z_PATIO, 'patio_floor', 'stone', tag='patio')
# pátio da garagem
add_prism(G.GPATIO_POLY, 33.80, G.Z_GPATIO, 'gpatio', 'render', tag='gpatio')

# ============================================================================ mobiliário (interior e exterior)
F = []
def furn(u0, v0, z0, u1, v1, z1, m):
    add_box(u0, v0, z0, u1, v1, z1, m, tag='furn')
Z = G.Z_RC
# cozinha (v3): parede técnica a nascente (placa + colunas), ilha com lava-loiça virada ao jantar e ao mar, bancada norte
furn(5.94, 3.70, Z, 6.54, 4.90, Z + 0.90, 'furn_white'); furn(5.94, 3.70, Z + 0.90, 6.54, 4.90, Z + 0.93, 'stone_top')
furn(6.02, 3.95, Z + 1.60, 6.54, 4.65, Z + 1.95, 'metal')                      # exaustor
furn(5.94, 4.90, Z, 6.54, 6.50, Z + 2.40, 'furn_oak')                         # colunas: frigorífico, fornos, despensa
furn(3.90, 3.90, Z, 4.90, 6.10, Z + 0.90, 'furn_dark'); furn(3.86, 3.86, Z + 0.90, 4.94, 6.14, Z + 0.94, 'stone_top')
furn(3.10, 7.05, Z, 4.80, 7.70, Z + 0.90, 'furn_white'); furn(3.10, 7.05, Z + 0.90, 4.80, 7.70, Z + 0.93, 'stone_top')
# jantar junto à janela poente V1b
furn(1.30, 5.00, Z + 0.72, 2.25, 7.20, Z + 0.76, 'furn_oak')
for (uu, vv) in ((1.35, 5.05), (2.12, 5.05), (1.35, 7.07), (2.12, 7.07)):
    furn(uu, vv, Z, uu + 0.08, vv + 0.08, Z + 0.72, 'furn_oak')
furn(0.62, 5.25, Z, 1.02, 7.05, Z + 0.45, 'furn_oak')                         # banco a poente
for vv in (5.20, 5.85, 6.50):
    furn(2.55, vv, Z, 2.98, vv + 0.45, Z + 0.45, 'furn_oak'); furn(2.90, vv, Z + 0.45, 2.98, vv + 0.45, Z + 0.85, 'furn_oak')
furn(0.50, 7.30, Z, 2.80, 7.70, Z + 0.75, 'furn_oak')                         # aparador sob a V13
# banco-lareira ao longo do pilar poente (entre V1 e V1b): salamandra junto ao mar, TV ao lado
furn(0.30, 2.40, Z, 0.80, 5.20, Z + 0.40, 'concrete')
furn(0.35, 2.55, Z + 0.40, 0.85, 3.15, Z + 1.15, 'metal_black')               # salamandra
furn(0.53, 2.78, Z + 1.15, 0.67, 2.92, G.Z_ROOF_TOP + 0.9, 'metal_black')     # conduta
furn(0.30, 3.57, Z + 0.72, 0.36, 5.03, Z + 1.55, 'screen')                     # TV 65" em braço articulado
# sala: sofá virado a poente (mar), chaise a sul, mesa de centro, tapete
furn(3.45, 0.40, Z, 4.35, 3.20, Z + 0.42, 'fabric'); furn(4.15, 0.40, Z, 4.35, 3.20, Z + 0.80, 'fabric')
furn(2.60, 0.40, Z, 3.45, 1.25, Z + 0.42, 'fabric')
furn(1.80, 1.45, Z, 2.90, 2.75, Z + 0.32, 'furn_dark')
furn(1.20, 0.10, Z, 3.95, 3.40, Z + 0.003, 'rug')
furn(0.75, -0.80, Z, 1.55, 0.00, Z + 0.40, 'fabric')                           # poltrona no canto sudoeste
# entrada: armário no nicho a sul da escada; banco
furn(6.66, 0.67, Z, 7.66, 1.15, Z + 2.40, 'furn_oak')
# quartos
furn(11.52, 0.40, Z, 13.52, 2.00, Z + 0.50, 'linen'); furn(11.40, 0.30, Z, 11.52, 2.10, Z + 1.05, 'furn_oak')   # suite 1: cama a olhar a nascente/sul
furn(11.40, -0.05, Z, 11.85, 0.30, Z + 0.50, 'furn_oak'); furn(11.40, 2.10, Z, 11.85, 2.50, Z + 0.50, 'furn_oak')
furn(12.25, 2.84, Z, 14.70, 3.44, Z + 2.40, 'furn_oak')                        # roupeiro da suite 1
furn(12.50, 3.70, Z, 14.10, 5.70, Z + 0.50, 'linen'); furn(12.50, 3.56, Z, 14.10, 3.70, Z + 1.05, 'furn_oak')   # suite 2
furn(14.10, 3.62, Z, 14.55, 4.05, Z + 0.50, 'furn_oak')
# closet 2, lavandaria, despensa
furn(9.28, 4.12, Z, 9.88, 5.52, Z + 2.40, 'furn_oak')
furn(8.56, 5.65, Z, 9.16, 7.70, Z + 0.90, 'furn_white')
furn(8.70, 4.15, Z, 9.16, 5.45, Z + 2.20, 'furn_white')
# deck: mesa exterior sob a pala, espreguiçadeiras no deck poente (como na v2)
furn(2.20, -2.95, Z, 4.60, -2.05, Z + 0.75, 'furn_oak')
furn(2.20, -3.35, Z, 4.60, -3.05, Z + 0.45, 'furn_oak'); furn(2.20, -1.95, Z, 4.60, -1.65, Z + 0.45, 'furn_oak')
for uu in (-1.36, -0.16):
    furn(uu, -3.83, Z, uu + 0.70, -1.93, Z + 0.32, 'fabric_out')
# sala do jardim (cave)
furn(12.0, 1.9, G.Z_CAVE, 14.3, 2.75, G.Z_CAVE + 0.42, 'fabric'); furn(12.0, 2.60, G.Z_CAVE, 14.3, 2.80, G.Z_CAVE + 0.80, 'fabric')
# carros (garagem)
for (va, vb) in ((2.30, 4.15), (5.05, 6.90)):
    furn(1.00, va, G.Z_CAVE, 5.60, vb, G.Z_CAVE + 1.35, 'car')
# vasos/árvore no pátio afundado: tratado como árvore

# ============================================================================ terreno (campo de alturas)
PARC = prep(G.PARCEL_A); ROADP = prep(G.ROAD); ROAD = G.ROAD; PB = prep(G.PARCEL_B)
PATIOP = prep(G.sbox(*G.PATIO)); GPP = prep(G.GPATIO_POLY)
ENTRYP = prep(G.ENTRY_LANDING.union(G.sbox(G.ENTRY_STAIR['u0'], G.ENTRY_STAIR['v_bot'], G.ENTRY_STAIR['u1'], G.ENTRY_STAIR['v_top'])))
WEDGEP = prep(G.ENTRY_WEDGE); PATP = prep(G.PATAMAR)
GPPB = prep(G.GPATIO_POLY.buffer(0.36, join_style=2))
M1ZONE = prep(unary_union([G.sbox(-15, -9.9, 1, 1.45), G.sbox(-15, 8.2, 1, 16.9)]))
NPLANT = prep(G.PARCEL_A.buffer(-0.30, join_style=2).intersection(G.sbox(-12.0, 8.20, 0.0, 9.80)))
UNDER = prep(unary_union([G.DECK_POLY, G.FOOT_POLY, G.sbox(*G.BALCONY)]).buffer(0.05))
NT = G.NORTH_TERRACE
south_path = LineString([(-0.6, -9.45), (3.0, -9.0), (8.6, -8.75), (11.5, -7.2), (14.7, -5.6)])
SPATH = south_path.buffer(0.55)
north_pave = G.sbox(0.0, 8.0, 10.2, 9.3)
yard = G.sbox(6.6, 9.3, 9.6, 10.6)
east_path = LineString([(15.0, 9.0), (18.5, 7.0), (22.5, 4.5)]).buffer(0.45)
beds = unary_union([G.sbox(-0.6, -9.05, 9.1, -8.25),            # canteiro ao pé do muro da piscina
                    G.DECK_POLY.buffer(0.9).difference(G.DECK_POLY).intersection(G.sbox(-3, -6, 9.2, 1.4)),
                    G.sbox(15.5, -4.8, 17.5, 1.5)])
SSTRIP = prep(G.PARCEL_A.intersection(G.sbox(-3.0, -11.0, 9.1, -8.2)).buffer(0)); SP = prep(SPATH); NP = prep(north_pave); YD = prep(yard); EP = prep(east_path); BD = prep(beds)

def ground(u, v):
    p = Point(u, v)
    n = G.natural(u, v)
    if PATIOP.contains(p):
        return G.Z_PATIO - 0.08, 'patio'
    if GPP.contains(p) or (GPPB.contains(p) and v > 7.85):
        return G.Z_GPATIO - 0.012 * max(0.0, -u), 'gpatio'
    if PARC.contains(p) and M1ZONE.contains(p) and ROAD.distance(p) < 0.36:
        return G.road_z(u, v), 'road'         # pé do muro 1: a transição de cota fica escondida no muro
    if ROADP.contains(p):
        return G.road_z(u, v), 'road'
    if UNDER.contains(p):
        return min(n, 35.2), 'under'
    if ENTRYP.contains(p):
        return G.ENTRY_STAIR['z_bot'] - 0.01, 'path'
    if WEDGEP.contains(p):
        return 36.45, 'bed'
    if PATP.contains(p):
        return min(G.road_wall_top(v) - 0.10, 36.85), 'bed'
    if NPLANT.contains(p):
        return min(max(n, 35.6), 36.15), 'bed'
    if not PARC.contains(p):
        # Trav. de João Pires (existente) a sul-poente da ponta: faixa a ~35,9 descendo para SO
        if v < -9.5 and u < 2.0 and abs((v + 9.9) - 0.55 * (u + 0.9)) < 3.2:
            return 35.9 + 0.035 * min(0.0, u + 0.9), 'road'
        return n, ('fieldB' if PB.contains(p) else 'field')
    if ROAD.distance(p) < 0.7 and u < 0.5:
        return G.road_z(u, v) - 0.05, 'bed'
    z = n
    cls = 'meadow'
    # plataforma norte (36,95) e rampa 1:2,5 até ao natural
    d = NT.distance(p)
    z = max(z, 36.95 - d / 2.5)
    if d == 0: cls = 'lawn'
    # caminho sul em socalco (35,9 → 35,7 → 35,85) e rampa
    if SSTRIP.contains(p):
        return (35.9 if u < 0 else 35.68 + max(0.0, u - 9) * 0.03) - 0.02 * (0 if SP.contains(p) else 1), ('path' if SP.contains(p) else 'bed')
    ds = SPATH.distance(p)
    tz = 35.9 if u < 0 else (35.68 if u < 9 else 35.68 + (u - 9) * 0.03)
    z = max(z, tz - ds / 2.0) if ds < 3 else z
    # contorno do pátio afundado a sul/nascente e da casa a nascente
    dpat = G.sbox(9.1, -5.1, 15.5, -1.33).distance(p)
    if dpat < 3: z = max(z, 35.85 - dpat / 2.0)
    deast = G.sbox(15.0, -1.33, 15.0, 8.0).distance(p) if u >= 15.0 else 99
    if deast < 4: z = max(z, 36.85 - deast / 2.5)
    # junto ao deck (talude/canteiro)
    ddk = G.DECK_POLY.distance(p)
    if ddk < 1.2 and u > -0.5: z = max(z, 35.6 - ddk * 0.3)
    if SP.contains(p) or YD.contains(p) or EP.contains(p): cls = 'path'
    elif NP.contains(p): cls = 'paving'
    elif BD.contains(p): cls = 'bed'
    return z, cls

CLS = ['meadow', 'lawn', 'path', 'paving', 'bed', 'road', 'gpatio', 'patio', 'field', 'fieldB', 'under']
U_MIN, U_MAX, V_MIN, V_MAX, STEP = -46.0, 56.0, -36.0, 44.0, 0.5
nu = int(round((U_MAX - U_MIN) / STEP)) + 1
nv = int(round((V_MAX - V_MIN) / STEP)) + 1
H = []; C = []
for j in range(nv):
    v = V_MIN + j * STEP
    for i in range(nu):
        u = U_MIN + i * STEP
        z, c = ground(u, v)
        H.append(int(round((z - 30.0) * 100)))
        C.append(CLS.index(c))
terrain = dict(u0=U_MIN, v0=V_MIN, step=STEP, nu=nu, nv=nv,
               h=base64.b64encode(struct.pack('<%dh' % len(H), *H)).decode(),
               c=base64.b64encode(bytes(C)).decode(), classes=CLS)

# ============================================================================ vegetação
trees = [
    # tipo, u, v, altura, diâmetro copa
    ('pine', 24.0, 4.0, 11.0, 9.0),        # pinheiro-manso no alto nascente (miradouro)
    ('oak', 19.0, 11.8, 9.0, 7.5),         # carvalho-alvarinho
    ('oak', 3.0, 14.2, 8.0, 6.5),
    ('arbutus', 10.4, -3.9, 4.6, 3.0),     # medronheiro a crescer do pátio afundado
    ('olive', 8.0, 12.3, 3.8, 3.2), ('olive', 15.2, 13.2, 3.4, 2.8),
    ('fruit', 16.2, 9.4, 3.2, 2.8), ('fruit', 17.6, 7.6, 3.0, 2.6),
    ('arbutus', 26.5, 10.5, 4.0, 3.2), ('arbutus', 13.0, -7.6, 3.4, 2.6),
    ('cypress', -9.5, 16.0, 7.0, 1.8),
]
# pomar/prado na parcela B (a poente da estrada) — moldura verde da vista
for k, (uu, vv) in enumerate([(-18, 2), (-24, 8), (-30, -2), (-20, -10), (-27, -14), (-34, 6), (-15, 12), (-36, -8)]):
    trees.append(('fruit', uu, vv, 3.4 + (k % 3) * 0.4, 3.0 + (k % 2) * 0.6))
# sebes no limite (exceto a frente da estrada)
inner = G.PARCEL_A.buffer(-0.75, join_style=2)
pts = list(inner.exterior.coords)
hedges = []
for a, b in zip(pts, pts[1:]):
    mid = Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    if G.ROAD.buffer(2.2).contains(mid):
        continue
    if LineString([a, b]).length < 0.3:
        continue
    if G.sbox(-2.0, -10.5, 9.4, -8.15).contains(mid):   # sebe sul baixa ao longo do caminho
        hedges.append(dict(a=[round(a[0], 2), round(a[1], 2)], b=[round(b[0], 2), round(b[1], 2)], h=1.4, w=0.7))
    else:
        hedges.append(dict(a=[round(a[0], 2), round(a[1], 2)], b=[round(b[0], 2), round(b[1], 2)], h=1.8, w=0.85))
shrubs = []
import random
random.seed(7)
for _ in range(70):   # gramíneas/arbustos baixos em canteiros
    for _t in range(20):
        u = random.uniform(-3, 20); v = random.uniform(-10, 14)
        p = Point(u, v)
        if BD.contains(p) or (G.PARCEL_A.contains(p) and G.sbox(15.4, -4.5, 21, 2).contains(p)):
            shrubs.append([round(u, 2), round(v, 2), round(random.uniform(0.5, 1.0), 2)])
            break

# ============================================================================ luzes interiores e câmaras
lights = [
    dict(p=[2.0, 1.0, 39.5], i=7, d=9), dict(p=[3.6, 3.2, 39.5], i=6, d=8), dict(p=[3.2, 5.6, 39.5], i=6, d=8),
    dict(p=[8.4, 0.2, 39.5], i=3, d=5), dict(p=[13.0, 1.2, 39.5], i=4, d=6), dict(p=[13.0, 5.6, 39.5], i=3, d=6),
    dict(p=[12.8, 1.0, 36.4], i=4, d=7), dict(p=[3.0, -2.3, 39.7], i=3, d=6),
]

def sun(az, alt):
    """vetor para o sol em coordenadas locais (u,v,z). az a partir do norte geográfico, sentido horário."""
    north = (math.sin(G.ANG), math.cos(G.ANG)); east = (math.cos(G.ANG), -math.sin(G.ANG))
    a, h = math.radians(az), math.radians(alt)
    hu = math.sin(a) * east[0] + math.cos(a) * north[0]
    hv = math.sin(a) * east[1] + math.cos(a) * north[1]
    return [round(hu * math.cos(h), 4), round(hv * math.cos(h), 4), round(math.sin(h), 4)]

cams = {
    'hero':   dict(p=[9.0, -8.05, 38.6], t=[-6.0, 0.4, 37.9], fov=60, sun=sun(282, 9), exp=0.85, dusk=1),
    'aerial': dict(p=[-22.0, -34.0, 60.0], t=[6.5, 1.5, 35.5], fov=34, sun=sun(232, 38), exp=0.72, dusk=0),
    'road':   dict(p=[-15.5, -3.5, 35.6], t=[0.5, 3.0, 37.3], fov=52, sun=sun(250, 22), exp=0.72, dusk=0),
    'living': dict(p=[5.75, 6.9, 38.55], t=[-2.0, 0.6, 37.9], fov=68, sun=sun(250, 21), exp=0.8, dusk=1),
    'sala':   dict(p=[4.05, 1.85, 38.12], t=[0.0, 2.95, 38.05], fov=74, sun=sun(262, 14), exp=0.82, dusk=1),
    'entrada': dict(p=[-5.6, -13.2, 37.6], t=[0.6, -5.2, 36.9], fov=56, sun=sun(225, 35), exp=0.72, dusk=0),
    'patio':  dict(p=[14.05, -4.45, 35.62], t=[10.2, -0.4, 36.55], fov=72, sun=sun(195, 58), exp=0.72, dusk=0),
    'cutaway': dict(p=[-4.5, -17.5, 57.0], t=[7.4, 2.6, 36.0], fov=38, sun=sun(215, 50), exp=0.72, dusk=0, noroof=1),
    'north':  dict(p=[13.4, 17.6, 40.6], t=[4.2, 5.6, 37.4], fov=50, sun=sun(150, 48), exp=0.72, dusk=0),
}

spec = dict(boxes=boxes, prisms=prisms, terrain=terrain, trees=trees, hedges=hedges, shrubs=shrubs,
            lights=lights, cams=cams, zref=34.0, footprint=G.FOOT,
            sea=dict(u=-1250.0), north=[math.sin(G.ANG), math.cos(G.ANG)])
json.dump(spec, open('out/spec.json', 'w'), separators=(',', ':'))
print('boxes', len(boxes), 'prisms', len(prisms), 'terrain', nu, 'x', nv, 'trees', len(trees), 'hedges', len(hedges), 'shrubs', len(shrubs))
import os
print('spec KB', os.path.getsize('out/spec.json') // 1024)
