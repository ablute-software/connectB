# -*- coding: utf-8 -*-
"""Casa Plinto — geometria única (fonte de verdade) da Proposta B para a parcela A de Carreço.

Coordenadas locais (m): u ao longo do lado comprido (ENE, 20° a norte do nascente),
v perpendicular (NNW). Origem no canto SW exterior da cave/casa do estudo v4.
Cotas absolutas (z) como no levantamento: R/C 37,00; cave 34,10.
"""
import json, math
from shapely.geometry import Polygon, box as sbox, Point, LineString, MultiPolygon
from shapely.ops import unary_union

# ----------------------------------------------------------------------------- níveis
FOOT = (0.0, -1.33, 15.0, 8.0)          # implantação 15,00 x 9,33 = 139,95 m2
E, I = 0.30, 0.12                        # parede exterior / interior
Z_CAVE, Z_CAVE_SOFF = 34.10, 36.65
Z_RC, Z_CEIL = 37.00, 39.85
Z_ROOF_SLAB, Z_ROOF_TOP = 40.10, 40.45   # laje de cobertura / topo da platibanda
Z_PALA_TOP = 40.15                       # pala (laje em consola) 0,30 m
Z_PLINTH_TOP = 36.90                     # topo do embasamento (junta escura até 37,00)
Z_PATIO, Z_GPATIO = 34.00, 34.20
Z_DECK = 37.00
Z_POOL_WATER, Z_POOL_FLOOR = 36.95, 35.55
Z_FOOTING = 33.40

# ----------------------------------------------------------------------------- terreno (lido do DXF v4)
SITE = json.load(open('site_local.json'))
PARCEL_A = Polygon(SITE['parcelA']).buffer(0)
ROAD = Polygon(SITE['road']).buffer(0)
PARCEL_B = Polygon(SITE['parcelB']).buffer(0)
ANG = math.radians(SITE['angle'])        # eixo u a 19,95° do nascente

def natural(u, v):
    """Terreno natural aproximado: bilinear nos 4 cantos da implantação (34,81 SO; 35,82 SE;
    36,60 NE; 34,87 NO), extrapolação moderada para fora. O levantamento manda."""
    vv = v + 1.33
    if vv >= 0:
        uu = max(-15.0, min(30.0, u)); vc = min(vv, 20.0)
        return 34.81 + 0.06733 * u + 0.00643 * vv + 0.005145 * uu * vc
    return 34.81 + 0.06733 * u + 0.012 * vv          # a sul da casa só o declive nascente-poente

def road_z(u, v):
    # estrada nova: 35,9 no fim da Trav. de João Pires (ponta sul) → 34,2 frente à garagem → desce para norte
    xs, zs = [-10.0, 4.5, 17.0], [35.90, 34.20, 33.60]
    if v <= xs[0]: return zs[0]
    if v >= xs[-1]: return zs[-1]
    for i in range(len(xs) - 1):
        if xs[i] <= v <= xs[i + 1]:
            t = (v - xs[i]) / (xs[i + 1] - xs[i]); return zs[i] + t * (zs[i + 1] - zs[i])

def boundary_u_at(v):
    """u do limite poente da parcela (berma da estrada nova) à cota v."""
    pts = SITE['parcelA']
    west = [p for p in pts if p[0] < 0.5 and -10.5 < p[1] < 17.5]
    west = sorted(west, key=lambda p: p[1])
    for a, b in zip(west, west[1:]):
        if a[1] <= v <= b[1] and b[1] > a[1]:
            t = (v - a[1]) / (b[1] - a[1]); return a[0] + t * (b[0] - a[0])
    return west[0][0] if v < west[0][1] else west[-1][0]

# ----------------------------------------------------------------------------- estruturas de saída
boxes, prisms = [], []

def add_box(u0, v0, z0, u1, v1, z1, mat, faces=None, tag=None, cast=True, recv=True):
    if u1 - u0 < 1e-4 or v1 - v0 < 1e-4 or z1 - z0 < 1e-4:
        return
    b = dict(a=[round(u0, 3), round(v0, 3), round(z0, 3)], b=[round(u1, 3), round(v1, 3), round(z1, 3)], m=mat)
    if faces: b['f'] = faces
    if tag: b['t'] = tag
    if not cast: b['nc'] = 1
    if not recv: b['nr'] = 1
    boxes.append(b)

def ring(poly):
    return [[round(x, 3), round(y, 3)] for x, y in list(poly.exterior.coords)[:-1]]

def add_prism(poly, z0, z1, top, side, tag=None, bottom=None):
    if poly.is_empty: return
    geoms = poly.geoms if isinstance(poly, MultiPolygon) else [poly]
    for g in geoms:
        if g.area < 1e-3: continue
        g = g.buffer(0)
        prisms.append(dict(p=ring(g), h=[[[round(x, 3), round(y, 3)] for x, y in list(i.coords)[:-1]] for i in g.interiors],
                           z=[round(z0, 3), round(z1, 3)], top=top, side=side, bot=bottom or top, t=tag))

# ----------------------------------------------------------------------------- compartimentos
ROOMS = {
    'rc': [
        # nome, rect (u0,v0,u1,v1), pavimento
        ('Sala · jantar · cozinha', (0.30, -1.03, 6.54, 7.70), 'floor_int'),
        ('Entrada', (6.66, -1.03, 8.06, 1.15), 'floor_int'),
        ('WC serviço', (8.18, -1.03, 9.16, 1.40), 'tile'),
        ('Escada', (6.66, 1.27, 7.66, 5.47), 'floor_int'),
        ('Corredor', (7.72, 1.52, 9.16, 5.47), 'floor_int'),
        ('Lavandaria', (6.66, 5.59, 9.16, 7.70), 'tile'),
        ('WC 1', (9.28, -1.03, 11.28, 1.03), 'tile'),
        ('Closet 1', (9.28, 1.15, 11.28, 2.88), 'floor_wood'),
        ('Passagem', (9.28, 3.00, 11.28, 4.00), 'floor_wood'),
        ('Closet 2', (9.28, 4.12, 11.28, 5.52), 'floor_wood'),
        ('WC 2', (9.28, 5.64, 11.28, 7.70), 'tile'),
        ('Suite 1', (11.40, -1.03, 14.70, 3.44), 'floor_wood'),
        ('Suite 2', (11.40, 3.56, 14.70, 7.70), 'floor_wood'),
    ],
    'cave': [
        ('Garagem (2 carros)', (0.30, 1.82, 6.54, 7.70), 'cave_floor'),
        ('Arrumos · oficina · piscina', (0.30, -1.03, 6.54, 1.70), 'cave_floor'),
        ('Técnica', (6.66, -1.03, 9.28, 1.15), 'cave_floor'),
        ('Escada', (6.66, 1.27, 7.66, 5.47), 'cave_floor'),
        ('Átrio', (7.78, 1.27, 9.28, 7.70), 'cave_floor'),   # corredor + átrio (polígono abaixo)
        ('Sala do Jardim', (11.04, -1.03, 14.70, 3.50), 'floor_wood'),
        ('WC 3', (9.40, -1.03, 10.92, 1.17), 'tile'),
        ('Closet 3', (9.40, 1.29, 10.92, 3.50), 'floor_wood'),
    ],
}
ATRIO_POLY = unary_union([sbox(7.78, 1.27, 9.28, 5.47), sbox(6.66, 5.47, 9.28, 7.70)])

def room_poly(level, name, rect):
    if level == 'cave' and name == 'Átrio':
        return ATRIO_POLY
    if level == 'rc' and name == 'Corredor':
        return unary_union([sbox(7.72, 1.52, 9.16, 5.47), sbox(7.72, 1.15, 8.06, 1.52)])
    return sbox(*rect)

# ----------------------------------------------------------------------------- paredes
# (u0,v0,u1,v1, lado exterior)  — lado exterior: '-u','+u','-v','+v' ou None (interior)
WALLS = {
    'rc': [
        (0.00, -1.33, 15.00, -1.03, '-v'),   # sul
        (0.00, 7.70, 15.00, 8.00, '+v'),     # norte
        (0.00, -1.03, 0.30, 7.70, '-u'),     # poente
        (14.70, -1.03, 15.00, 7.70, '+u'),   # nascente
        # interiores
        (6.54, 1.15, 6.66, 7.70, None),      # sala | escada / lavandaria (parede-estante)
        (8.06, -1.03, 8.18, 1.52, None),     # entrada | WC serviço
        (8.06, 1.40, 9.16, 1.52, None),      # WC serviço norte
        (6.66, 5.47, 9.16, 5.59, None),      # escada/corredor | lavandaria
        (9.16, -1.03, 9.28, 7.70, None),     # núcleo | banda húmida
        (9.28, 1.03, 11.28, 1.15, None),     # WC1 | closet1
        (9.28, 2.88, 11.28, 3.00, None),     # closet1 | passagem
        (9.28, 4.00, 11.28, 4.12, None),     # passagem | closet2
        (9.28, 5.52, 11.28, 5.64, None),     # closet2 | WC2
        (11.28, -1.03, 11.40, 7.70, None),   # banda húmida | quartos
        (11.40, 3.44, 14.70, 3.56, None),    # suite1 | suite2
    ],
    'cave': [
        (0.00, -1.33, 15.00, -1.03, '-v'),
        (14.70, -1.03, 15.00, 3.80, '+u'),
        (9.58, 3.50, 14.70, 3.80, '+v'),
        (9.28, 3.50, 9.58, 8.00, '+u'),
        (0.00, 7.70, 9.28, 8.00, '+v'),
        (0.00, -1.03, 0.30, 7.70, '-u'),
        # interiores
        (0.30, 1.70, 6.54, 1.82, None),      # garagem | arrumos
        (6.54, -1.03, 6.66, 7.70, None),     # garagem/arrumos | núcleo
        (7.66, 1.27, 7.78, 5.47, None),      # escada | corredor
        (6.66, 1.15, 9.28, 1.27, None),      # técnica | corredor
        (9.28, -1.03, 9.40, 3.50, None),     # corredor | suite
        (9.40, 1.17, 10.92, 1.29, None),     # WC3 | closet3
        (10.92, -1.03, 11.04, 3.50, None),   # closet/WC3 | sala do jardim
    ],
}
CAVE_POLY = Polygon([(0, -1.33), (15, -1.33), (15, 3.80), (9.58, 3.80), (9.58, 8.0), (0, 8.0)])
FOOT_POLY = sbox(*FOOT)

# ----------------------------------------------------------------------------- vãos
# tipo: slide2/slide3 (correr), win (janela), fixed, door (porta interior), entry, garage, glassdoor
OPEN = {
    'rc': [
        dict(n='V1', r=(0.00, -0.83, 0.30, 4.67), z=(Z_RC, Z_CEIL), k='slide3', d='Sala → varanda poente (vista mar)'),
        dict(n='V2', r=(0.50, -1.33, 6.20, -1.03), z=(Z_RC, Z_CEIL), k='slide3', d='Sala/jantar → deck e piscina'),
        dict(n='V3', r=(6.80, -1.33, 7.96, -1.03), z=(Z_RC, Z_CEIL), k='entry', d='Porta de entrada (até ao teto)'),
        dict(n='V4', r=(8.40, -1.33, 8.95, -1.03), z=(38.55, 39.25), k='win', d='WC serviço (alta, fosca)'),
        dict(n='V5', r=(9.60, -1.33, 11.00, -1.03), z=(38.65, 39.40), k='win', d='WC 1 (alta, fosca)'),
        dict(n='V6', r=(11.85, -1.33, 14.25, -1.03), z=(Z_RC, Z_CEIL), k='slide2', d='Suite 1 → vista sul (guarda de vidro)'),
        dict(n='V7', r=(14.70, 0.40, 15.00, 1.80), z=(37.90, 39.40), k='win', d='Suite 1 (nascente)'),
        dict(n='V8', r=(14.70, 4.50, 15.00, 6.90), z=(37.45, Z_CEIL), k='win', d='Suite 2 (nascente)'),
        dict(n='V9', r=(13.00, 7.70, 14.20, 8.00), z=(38.20, 39.40), k='win', d='Suite 2 (norte)'),
        dict(n='V10', r=(9.70, 7.70, 10.90, 8.00), z=(38.65, 39.40), k='win', d='WC 2 (alta, fosca)'),
        dict(n='V11', r=(6.80, 7.70, 7.70, 8.00), z=(Z_RC, 39.20), k='glassdoor', d='Lavandaria → estendal'),
        dict(n='V12', r=(4.90, 7.70, 5.85, 8.00), z=(Z_RC, Z_CEIL), k='glassdoor', d='Cozinha → horta e jardim norte'),
        dict(n='V13', r=(1.30, 7.70, 4.30, 8.00), z=(38.05, 39.25), k='win', d='Cozinha (sobre a bancada)'),
        # portas interiores
        dict(n='p', r=(8.35, 1.40, 9.05, 1.52), z=(Z_RC, 39.85), k='door', sw='+v'),
        dict(n='p', r=(7.76, 5.47, 8.46, 5.59), z=(Z_RC, 39.85), k='door', sw='+v'),
        dict(n='p', r=(9.16, 3.00, 9.28, 4.00), z=(Z_RC, 39.85), k='pass'),
        dict(n='p', r=(9.55, 2.88, 10.35, 3.00), z=(Z_RC, 39.85), k='door', sw='-v'),
        dict(n='p', r=(9.55, 4.00, 10.35, 4.12), z=(Z_RC, 39.85), k='door', sw='+v'),
        dict(n='p', r=(10.30, 1.03, 11.10, 1.15), z=(Z_RC, 39.85), k='door', sw='-v'),
        dict(n='p', r=(10.30, 5.52, 11.10, 5.64), z=(Z_RC, 39.85), k='door', sw='+v'),
        dict(n='p', r=(11.28, 1.95, 11.40, 2.75), z=(Z_RC, 39.85), k='door', sw='+u'),
        dict(n='p', r=(11.28, 4.35, 11.40, 5.15), z=(Z_RC, 39.85), k='door', sw='+u'),
    ],
    'cave': [
        dict(n='V14', r=(0.00, 2.32, 0.30, 7.32), z=(Z_CAVE, 36.40), k='garage', d='Portão seccionado da garagem (revestido, à face)'),
        dict(n='V15', r=(11.20, -1.33, 14.00, -1.03), z=(Z_CAVE, 36.55), k='slide2', d='Sala do Jardim → pátio afundado'),
        dict(n='V16', r=(9.70, -1.33, 10.60, -1.03), z=(35.70, 36.40), k='win', d='WC 3 (alta)'),
        dict(n='p', r=(4.60, 1.70, 5.50, 1.82), z=(Z_CAVE, 36.20), k='door', sw='-v'),
        dict(n='p', r=(6.54, 6.30, 6.66, 7.20), z=(Z_CAVE, 36.20), k='door', sw='-u', d='EI30'),
        dict(n='p', r=(7.90, 1.15, 8.70, 1.27), z=(Z_CAVE, 36.20), k='door', sw='-v'),
        dict(n='p', r=(9.28, 2.50, 9.40, 3.30), z=(Z_CAVE, 36.20), k='door', sw='+u'),
        dict(n='p', r=(9.70, 1.17, 10.50, 1.29), z=(Z_CAVE, 36.20), k='door', sw='-v'),
        dict(n='p', r=(10.92, 2.30, 11.04, 3.10), z=(Z_CAVE, 36.20), k='door', sw='+u'),
    ],
}
SKYLIGHTS = [  # (u0,v0,u1,v1)
    (2.00, 5.20, 4.40, 5.90),    # sobre a ilha
    (6.76, 1.70, 7.56, 4.70),    # sobre a escada (luz até à cave)
    (9.95, -0.60, 10.55, 0.00),  # WC 1
    (10.45, 3.20, 11.05, 3.80),  # fundo da passagem dos quartos
]
STAIR = dict(u0=6.66, u1=7.66, v_top=1.27, v_bot=5.47, n=16)

# ----------------------------------------------------------------------------- exteriores
POOL = (-1.00, -7.90, 8.00, -4.90)          # 9,0 x 3,0 m
PATIO = (9.40, -4.80, 15.20, -1.33)         # pátio afundado (cota 34,00)
PATIO_STAIR = dict(u0=14.20, u1=15.20, v_top=-4.80, v_bot=-1.80, n=10, z_top=35.80)
DECK_STEPS = dict(u0=8.15, u1=9.05, v_top=-6.30, v_bot=-8.20, n=7, z_bot=35.70)
B_N = boundary_u_at
DECK_POLY = Polygon([(-1.30, -8.20), (9.10, -8.20), (9.10, -1.33), (0.0, -1.33), (0.0, 1.40),
                     (B_N(1.40) + 0.25, 1.40), (B_N(-0.737) + 0.25, -0.737), (B_N(-1.887) + 0.25, -1.887),
                     (B_N(-5.348) + 0.25, -5.348), (B_N(-7.671) + 0.25, -7.671)]).buffer(0)
DECK_NOTCH = sbox(DECK_STEPS['u0'], -8.25, DECK_STEPS['u1'], DECK_STEPS['v_top'])
BALCONY = (-1.20, 1.70, 0.00, 8.00)
PALA_POLY = unary_union([sbox(-1.20, -3.33, 9.40, -1.33), sbox(-1.20, -1.33, 0.0, 8.00)])
GPATIO_POLY = Polygon([(0.0, 1.70), (0.0, 7.90), (B_N(7.90), 7.90), (B_N(6.709), 6.709), (B_N(4.937), 4.937),
                       (B_N(3.166), 3.166), (B_N(1.70), 1.70)]).buffer(0)
NORTH_TERRACE = sbox(-0.6, 8.0, 15.0, 10.6)      # plataforma do jardim norte à cota 36,95

def opening_list(level):
    return OPEN[level]

# ----------------------------------------------------------------------------- áreas
def areas():
    out = {}
    for lvl in ('rc', 'cave'):
        rows = []
        for name, rect, _ in ROOMS[lvl]:
            a = room_poly(lvl, name, rect).area
            if lvl == 'rc' and name == 'Corredor':
                a = a
            rows.append((name, round(a, 2)))
        out[lvl] = rows
    out['implantacao'] = round(FOOT_POLY.area, 2)
    out['bruta_rc'] = round(FOOT_POLY.area, 2)
    out['bruta_cave'] = round(CAVE_POLY.area, 2)
    out['util_rc'] = round(sum(a for _, a in out['rc']), 2)
    out['util_cave'] = round(sum(a for _, a in out['cave']), 2)
    out['pala'] = round(PALA_POLY.area, 2)
    out['deck'] = round(DECK_POLY.difference(sbox(*POOL)).area, 2)
    out['pool'] = round(sbox(*POOL).area, 2)
    out['patio'] = round(sbox(*PATIO).area, 2)
    out['parcela'] = round(PARCEL_A.area, 2)
    return out

if __name__ == '__main__':
    a = areas()
    for k, v in a.items():
        print(k, v)
    print('deck poly ok', DECK_POLY.is_valid, round(DECK_POLY.area, 1), 'inside parcel:', DECK_POLY.within(PARCEL_A.buffer(0.05)))
    print('foot inside', FOOT_POLY.within(PARCEL_A), 'min dist foot→limit', round(PARCEL_A.exterior.distance(FOOT_POLY), 2))
    print('pool inside', sbox(*POOL).within(PARCEL_A), 'dist', round(PARCEL_A.exterior.distance(sbox(*POOL)), 2))
    print('patio inside', sbox(*PATIO).buffer(0.3).within(PARCEL_A), round(PARCEL_A.exterior.distance(sbox(*PATIO).buffer(0.3)), 2))
    print('gpatio', round(GPATIO_POLY.area, 1))
    for v in (-8, -5, -1.33, 0, 1.4, 4, 8):
        print('boundary u at v', v, round(boundary_u_at(v), 2))
    for p in [(0, -1.33), (15, -1.33), (15, 8), (0, 8), (-0.9, -9.9), (12, -6), (15, -5), (5, -8.8)]:
        print('natural', p, round(natural(*p), 2))
