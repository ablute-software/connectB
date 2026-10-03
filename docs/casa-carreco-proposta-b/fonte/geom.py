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
# v3 (03/10/2026): parte da v2 do Nuno no SketchUp — escada virada (chega ao R/C a norte, junto à
# lavandaria e à cozinha), sem WC na entrada, sem closet na suite sul — e acrescenta o WC de serviço
# (entra pela passagem dos quartos, não pela entrada), o WC da suite sul, a nova cozinha e a sala.
ROOMS = {
    'rc': [
        # nome, rect (u0,v0,u1,v1), pavimento
        ('Sala · jantar · cozinha', (0.30, -1.03, 6.54, 7.70), 'floor_int'),
        ('Entrada', (6.66, -1.03, 9.16, 1.15), 'floor_int'),          # + corredor até à passagem (polígono)
        ('Escada', (6.66, 1.27, 7.66, 6.08), 'floor_int'),
        ('Despensa', (7.78, 4.12, 9.16, 5.48), 'floor_int'),
        ('Lavandaria', (7.78, 5.60, 9.16, 7.70), 'tile'),             # + chegada da escada (polígono)
        ('WC 1', (9.28, -1.03, 11.28, 1.27), 'tile'),
        ('WC serviço', (9.28, 1.39, 11.28, 2.88), 'tile'),
        ('Passagem', (9.28, 3.00, 11.28, 4.00), 'floor_wood'),
        ('Closet 2', (9.28, 4.12, 11.28, 5.52), 'floor_wood'),
        ('WC 2', (9.28, 5.64, 11.28, 7.70), 'tile'),
        ('Suite 1', (11.40, -1.03, 14.70, 3.44), 'floor_wood'),       # + átrio de entrada (polígono)
        ('Suite 2', (11.40, 3.56, 14.70, 7.70), 'floor_wood'),        # − canto do átrio da suite 1
    ],
    'cave': [
        ('Garagem (2 carros)', (0.30, 1.82, 6.54, 7.70), 'cave_floor'),   # + passagem para a técnica
        ('Arrumos · oficina · piscina', (0.30, -1.03, 6.54, 1.70), 'cave_floor'),
        ('Átrio', (6.66, -1.03, 9.28, 1.27), 'cave_floor'),               # + chegada da escada e corredor
        ('Escada', (6.66, 1.88, 7.66, 6.18), 'cave_floor'),
        ('Técnica', (7.78, 3.62, 9.28, 7.70), 'cave_floor'),
        ('Sala do Jardim', (11.04, -1.03, 14.70, 3.50), 'floor_wood'),
        ('WC 3', (9.40, -1.03, 10.92, 1.17), 'tile'),
        ('Closet 3', (9.40, 1.29, 10.92, 3.50), 'floor_wood'),
    ],
}
ROOM_POLYS = {
    ('rc', 'Entrada'): unary_union([sbox(6.66, -1.03, 9.16, 1.15), sbox(7.78, 1.15, 9.16, 4.00)]),
    ('rc', 'Lavandaria'): unary_union([sbox(7.78, 5.60, 9.16, 7.70), sbox(6.66, 6.08, 7.78, 7.70)]),
    ('rc', 'Suite 1'): unary_union([sbox(11.40, -1.03, 14.70, 3.44), sbox(11.40, 3.44, 12.20, 4.00)]),
    ('rc', 'Suite 2'): sbox(11.40, 3.56, 14.70, 7.70).difference(sbox(11.40, 3.56, 12.32, 4.12)),
    ('cave', 'Garagem (2 carros)'): unary_union([sbox(0.30, 1.82, 6.54, 7.70), sbox(6.54, 6.30, 7.66, 7.70)]),
    ('cave', 'Átrio'): unary_union([sbox(6.66, -1.03, 9.28, 1.27), sbox(6.66, 1.27, 7.66, 1.88), sbox(7.78, 1.27, 9.28, 3.50)]),
}

def room_poly(level, name, rect):
    return ROOM_POLYS.get((level, name)) or sbox(*rect)

# ----------------------------------------------------------------------------- paredes
# (u0,v0,u1,v1, lado exterior)  — lado exterior: '-u','+u','-v','+v' ou None (interior)
WALLS = {
    'rc': [
        (0.00, -1.33, 15.00, -1.03, '-v'),   # sul
        (0.00, 7.70, 15.00, 8.00, '+v'),     # norte
        (0.00, -1.03, 0.30, 7.70, '-u'),     # poente
        (14.70, -1.03, 15.00, 7.70, '+u'),   # nascente
        # interiores
        (6.54, 0.67, 6.66, 6.644, None),     # sala | entrada e escada (v2); passa à cozinha a norte
        (7.66, 0.67, 7.78, 5.60, None),      # escada | entrada e despensa
        (6.66, 1.15, 7.66, 1.27, None),      # fecho sul da escada (armário de entrada à frente)
        (7.66, 4.00, 9.16, 4.12, None),      # entrada | despensa
        (7.78, 5.48, 9.16, 5.60, None),      # despensa | lavandaria
        (9.16, -1.03, 9.28, 7.70, None),     # núcleo | banda húmida
        (9.28, 1.27, 11.28, 1.39, None),     # WC 1 | WC serviço
        (9.28, 2.88, 11.28, 3.00, None),     # WC serviço | passagem
        (9.28, 4.00, 11.28, 4.12, None),     # passagem | closet 2
        (9.28, 5.52, 11.28, 5.64, None),     # closet 2 | WC 2
        (11.28, -1.03, 11.40, 7.70, None),   # banda húmida | quartos
        (12.20, 3.44, 14.70, 3.56, None),    # suite 1 | suite 2
        (11.40, 4.00, 12.32, 4.12, None),    # átrio da suite 1 (norte)
        (12.20, 3.56, 12.32, 4.00, None),    # átrio da suite 1 (nascente)
    ],
    'cave': [
        (0.00, -1.33, 15.00, -1.03, '-v'),
        (14.70, -1.03, 15.00, 3.80, '+u'),
        (9.58, 3.50, 14.70, 3.80, '+v'),
        (9.28, 3.50, 9.58, 8.00, '+u'),
        (0.00, 7.70, 9.28, 8.00, '+v'),
        (0.00, -1.03, 0.30, 7.70, '-u'),
        # interiores
        (0.30, 1.70, 4.60, 1.82, None),      # garagem | arrumos (aberto a nascente, v2)
        (6.54, -1.03, 6.66, 6.30, None),     # arrumos/garagem | átrio e escada (porta EI30)
        (7.66, 1.27, 7.78, 7.70, None),      # escada | corredor e técnica
        (6.66, 6.18, 7.66, 6.30, None),      # fecho norte da escada
        (7.78, 3.50, 9.28, 3.62, None),      # corredor | técnica (v2)
        (9.28, -1.03, 9.40, 3.50, None),     # corredor | suite
        (9.40, 1.17, 10.92, 1.29, None),     # WC3 | closet3
        (10.92, -1.03, 11.04, 3.50, None),   # closet/WC3 | sala do jardim
    ],
}
LOW_WALLS = {'rc': [(7.66, 5.60, 7.78, 6.08, 1.10)]}   # guarda da escada junto à lavandaria (u0,v0,u1,v1,altura)
CAVE_POLY = Polygon([(0, -1.33), (15, -1.33), (15, 3.80), (9.58, 3.80), (9.58, 8.0), (0, 8.0)])
FOOT_POLY = sbox(*FOOT)

# ----------------------------------------------------------------------------- vãos
# tipo: slide2/slide3 (correr), win (janela), fixed, door (porta interior), entry, garage, glassdoor
OPEN = {
    'rc': [
        dict(n='V1', r=(0.00, -0.83, 0.30, 2.40), z=(Z_RC, Z_CEIL), k='slide3', d='Sala → deck e varanda poente (vista mar)'),
        dict(n='V1b', r=(0.00, 5.20, 0.30, 7.20), z=(Z_RC, Z_CEIL), k='slide2', d='Jantar → varanda poente (pôr do sol)'),
        dict(n='V2', r=(0.50, -1.33, 6.20, -1.03), z=(Z_RC, Z_CEIL), k='slide3', d='Sala/jantar → deck e piscina'),
        dict(n='V3', r=(6.80, -1.33, 7.96, -1.03), z=(Z_RC, Z_CEIL), k='entry', d='Porta de entrada (até ao teto)'),
        dict(n='V5', r=(9.60, -1.33, 11.00, -1.03), z=(38.65, 39.40), k='win', d='WC 1 (alta, fosca)'),
        dict(n='V6', r=(11.85, -1.33, 14.25, -1.03), z=(Z_RC, Z_CEIL), k='slide2', d='Suite 1 → vista sul (guarda de vidro)'),
        dict(n='V7', r=(14.70, 0.40, 15.00, 1.80), z=(37.90, 39.40), k='win', d='Suite 1 (nascente)'),
        dict(n='V8', r=(14.70, 4.50, 15.00, 6.90), z=(37.45, Z_CEIL), k='win', d='Suite 2 (nascente)'),
        dict(n='V9', r=(13.00, 7.70, 14.20, 8.00), z=(38.20, 39.40), k='win', d='Suite 2 (norte)'),
        dict(n='V10', r=(9.70, 7.70, 10.90, 8.00), z=(38.65, 39.40), k='win', d='WC 2 (alta, fosca)'),
        dict(n='V11', r=(6.80, 7.70, 7.70, 8.00), z=(Z_RC, 39.20), k='glassdoor', d='Lavandaria → estendal'),
        dict(n='V12', r=(4.90, 7.70, 5.85, 8.00), z=(Z_RC, Z_CEIL), k='glassdoor', d='Cozinha → horta e jardim norte'),
        dict(n='V13', r=(1.30, 7.70, 4.30, 8.00), z=(38.05, 39.25), k='win', d='Jantar e bancada (alta)'),
        # portas interiores
        dict(n='p', r=(9.16, 3.00, 9.28, 4.00), z=(Z_RC, 39.85), k='pass'),
        dict(n='p', r=(10.45, 2.88, 11.20, 3.00), z=(Z_RC, 39.85), k='door', sw='-v', d='WC de serviço (pela passagem)'),
        dict(n='p', r=(9.55, 4.00, 10.35, 4.12), z=(Z_RC, 39.85), k='door', sw='+v'),
        dict(n='p', r=(10.30, 5.52, 11.10, 5.64), z=(Z_RC, 39.85), k='door', sw='+v'),
        dict(n='p', r=(11.28, -0.85, 11.40, -0.10), z=(Z_RC, 39.85), k='door', sw='-u', d='WC da suite 1'),
        dict(n='p', r=(11.28, 3.10, 11.40, 3.90), z=(Z_RC, 39.85), k='door', sw='+u', d='Suite 1'),
        dict(n='p', r=(11.28, 4.35, 11.40, 5.15), z=(Z_RC, 39.85), k='door', sw='+u', d='Suite 2 (pelo closet)'),
        dict(n='p', r=(8.10, 5.48, 8.80, 5.60), z=(Z_RC, 39.85), k='door', sw='-v', d='Despensa'),
    ],
    'cave': [
        dict(n='V14', r=(0.00, 2.32, 0.30, 7.32), z=(Z_CAVE, 36.40), k='garage', d='Portão seccionado da garagem (revestido, à face)'),
        dict(n='V15', r=(11.20, -1.33, 14.00, -1.03), z=(Z_CAVE, 36.55), k='slide2', d='Sala do Jardim → pátio afundado'),
        dict(n='V16', r=(9.70, -1.33, 10.60, -1.03), z=(35.70, 36.40), k='win', d='WC 3 (alta)'),
        dict(n='p', r=(6.54, 0.10, 6.66, 1.00), z=(Z_CAVE, 36.20), k='door', sw='-u', d='EI30 (arrumos/garagem → átrio)'),
        dict(n='p', r=(7.66, 6.55, 7.78, 7.35), z=(Z_CAVE, 36.20), k='door', sw='+u', d='Técnica'),
        dict(n='p', r=(9.28, 2.50, 9.40, 3.30), z=(Z_CAVE, 36.20), k='door', sw='+u'),
        dict(n='p', r=(9.70, 1.17, 10.50, 1.29), z=(Z_CAVE, 36.20), k='door', sw='-v'),
        dict(n='p', r=(10.92, 2.30, 11.04, 3.10), z=(Z_CAVE, 36.20), k='door', sw='+u'),
    ],
}
SKYLIGHTS = [  # (u0,v0,u1,v1)
    (4.00, 4.20, 4.80, 5.80),    # sobre a ilha
    (6.76, 2.20, 7.56, 5.60),    # sobre a escada (luz até à cave)
    (9.95, -0.60, 10.55, 0.00),  # WC 1 (tubo de luz)
    (9.95, 1.85, 10.55, 2.45),   # WC de serviço (tubo de luz)
    (10.45, 3.20, 11.05, 3.80),  # fundo da passagem dos quartos
]
# v2 do Nuno: a escada desce de norte (R/C, junto à lavandaria e à cozinha) para sul (cave, no átrio)
STAIR = dict(u0=6.66, u1=7.66, v_top=6.084, v_bot=1.884, n=16)

# ----------------------------------------------------------------------------- exteriores
POOL = (1.10, -7.90, 8.80, -4.90)           # 7,70 x 3,00 m — 2,1 m para nascente; a faixa junto à estrada fica para a entrada
PATIO = (9.40, -4.80, 15.20, -1.33)         # pátio afundado (cota 34,00)
PATIO_STAIR = dict(u0=14.20, u1=15.20, v_top=-4.80, v_bot=-1.80, n=10, z_top=35.80)
DECK_STEPS = None                           # v3: o deck liga ao caminho sul pela escada da entrada
B_N = boundary_u_at
def W2(v):
    """face interior do 2.º muro (o do deck): 1,25 m para dentro do limite — patamar plantado de 0,70 m entre os dois."""
    return B_N(v) + 1.25

# ---- entrada pedonal, como no PIP: portão e degraus na estrada (ponta sul); aqui entram e sobem logo para norte
GATE_V = (-9.45, -8.45)                     # vão do portão no muro da estrada
ENTRY_LANDING = Polygon([(B_N(-9.85) + 0.30, -9.85), (0.10, -9.85), (0.10, -8.20), (B_N(-8.20) + 0.30, -8.20)]).buffer(0)
ENTRY_STAIR = dict(u0=-1.10, u1=0.10, v_top=-6.40, v_bot=-8.20, n=7, z_bot=35.85)    # 7 espelhos de 0,164 → 37,00

DECK_POLY = Polygon([(0.10, -8.20), (9.10, -8.20), (9.10, -1.33), (0.0, -1.33), (0.0, 1.70), (-1.20, 1.70), (-1.20, 0.75),
                     (W2(0.75), 0.75), (W2(-0.737), -0.737), (W2(-1.887), -1.887), (W2(-5.348), -5.348),
                     (-1.10, -6.40), (0.10, -6.40)]).buffer(0)
DECK_NOTCH = Polygon()
BALCONY = (-1.20, 1.70, 0.00, 8.00)
PALA_POLY = unary_union([sbox(-1.20, -3.33, 9.40, -1.33), sbox(-1.20, -1.33, 0.0, 8.00)])
GPATIO_POLY = Polygon([(0.0, 1.70), (0.0, 7.90), (B_N(7.90), 7.90), (B_N(6.709), 6.709), (B_N(4.937), 4.937),
                       (B_N(3.166), 3.166), (B_N(1.70), 1.70)]).buffer(0)
NORTH_TERRACE = sbox(0.0, 8.0, 15.0, 10.6)      # plataforma do jardim norte à cota 36,95

# ---- muros junto à estrada em patamares (o PIP desce-os em degraus: a Câmara não aceita muros altos à face da estrada)
def road_wall_top(v):
    """muro 1 (à face da estrada): 36,95 junto à escada da entrada; no resto, 1,10 acima da estrada."""
    return 36.95 if v <= -6.40 else round(road_z(0, v) + 1.10, 2)

def _steps(v0, v1, n):
    return [(v0 + (v1 - v0) * i / n, v0 + (v1 - v0) * (i + 1) / n) for i in range(n)]
MURO1_SEGS = ([(-9.90, GATE_V[0], 36.95), (GATE_V[1], -6.40, 36.95)] +
              [(a, b, road_wall_top((a + b) / 2)) for a, b in _steps(-6.40, 1.45, 6)] +
              [(a, b, road_wall_top((a + b) / 2)) for a, b in _steps(8.20, 16.90, 7)])
MURO2_LINE = [(-1.10, -6.40), (W2(-5.348), -5.348), (W2(-1.887), -1.887), (W2(-0.737), -0.737), (W2(0.75), 0.75),
              (-1.20, 0.75), (-1.20, 1.70)]          # bordo do deck; o muro fica do lado de fora (0,25)
PATAMAR = (PARCEL_A.buffer(-0.30, join_style=2).intersection(sbox(-12.0, -6.40, 0.0, 1.45))
           .difference(DECK_POLY.buffer(0.25, join_style=2)).difference(FOOT_POLY)).buffer(0)
ENTRY_WEDGE = PARCEL_A.buffer(-0.30, join_style=2).intersection(sbox(-12.0, -8.20, -1.10, -6.40)).buffer(0)
COURT_WALLS = [  # (u0, v0, u1, v1, topo)
    (B_N(1.575) + 0.30, 1.45, -1.45, 1.70, 35.60),     # sul, junto à estrada: 1,40 acima do pátio
    (-1.45, 1.45, 0.00, 1.70, 37.00),                  # sul, junto à casa (suporta o deck)
    (B_N(8.05) + 0.20, 7.90, 0.00, 8.20, 36.20),       # norte: 2,00 (era 3,75)
]

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
    out['patamar'] = round(PATAMAR.area, 2)
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
