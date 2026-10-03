# -*- coding: utf-8 -*-
"""Gera out/spec.json (modelo 3D das duas casas, terreno, muros, vegetação, casa de A e câmaras)."""
import json, math, base64, struct, random, os
from shapely.geometry import Polygon, Point, LineString, box as sbox, MultiPolygon
from shapely.ops import unary_union
from shapely.prepared import prep
import sitio as S
import casas as C

EPS = 1e-6
def r3(x): return round(float(x), 3)
def ring(poly): return [[r3(x), r3(y)] for x, y in list(poly.exterior.coords)[:-1]]

class Group:
    def __init__(self, name, origin=(0.0, 0.0), ang=0.0):
        self.name, self.origin, self.ang = name, origin, ang
        self.boxes, self.prisms = [], []
    def box(self, x0, y0, z0, x1, y1, z1, m, faces=None, tag=None, cast=True):
        if x1 - x0 < 1e-4 or y1 - y0 < 1e-4 or z1 - z0 < 1e-4: return
        b = dict(a=[r3(x0), r3(y0), r3(z0)], b=[r3(x1), r3(y1), r3(z1)], m=m)
        if faces: b['f'] = faces
        if tag: b['t'] = tag
        if not cast: b['nc'] = 1
        self.boxes.append(b)
    def prism(self, poly, z0, z1, top, side, bot=None, tag=None):
        if poly is None or poly.is_empty: return
        gs = poly.geoms if hasattr(poly, 'geoms') else [poly]
        for g in gs:
            if not isinstance(g, Polygon) or g.area < 1e-3: continue
            g = g.buffer(0)
            if g.is_empty or not isinstance(g, Polygon): continue
            self.prisms.append(dict(p=ring(g), h=[[[r3(x), r3(y)] for x, y in list(i.coords)[:-1]] for i in g.interiors],
                                    z=[r3(z0), r3(z1)], top=top, side=side, bot=bot or top, t=tag))
    def out(self):
        return dict(n=self.name, o=[r3(self.origin[0]), r3(self.origin[1])], a=round(self.ang, 6), boxes=self.boxes, prisms=self.prisms)

OPP = {'-x': '+x', '+x': '-x', '-y': '+y', '+y': '-y'}

# ============================================================================ casas
def wall_pieces(G, H, w):
    x0, y0, x1, y1 = w['r']; zb, zt = w['z']; ext = w['ext']
    axis = 'x' if (x1 - x0) >= (y1 - y0) else 'y'
    if ext in ('stone', 'col'):
        G.box(x0, y0, zb, x1, y1, zt, w['mo'], tag=w.get('t')); return
    ops = []
    for o in H.open:
        a0, b0, a1, b1 = o['r']
        if min(x1, a1) - max(x0, a0) > EPS and min(y1, b1) - max(y0, b0) > EPS:
            if o['z'][1] <= zb + EPS or o['z'][0] >= zt - EPS: continue
            if axis == 'x': ops.append((max(x0, a0), min(x1, a1), max(zb, o['z'][0]), min(zt, o['z'][1])))
            else: ops.append((max(y0, b0), min(y1, b1), max(zb, o['z'][0]), min(zt, o['z'][1])))
    ops.sort()
    if ext in ('-x', '+x', '-y', '+y'):
        ends = ['-x', '+x'] if axis == 'x' else ['-y', '+y']
        faces = {ext: w['mo'], OPP[ext]: w['mi'], 'top': w['mi'], 'bot': w['mi']}
        for e in ends: faces[e] = 'reveal'
        mat = w['mo']
    elif ext == 'store':
        faces = None; mat = w['mo']
    else:
        faces = None; mat = w['mi'] if w['mo'] == 'render' else w['mo']
        if w['mo'] == 'oak_panel':
            faces = None; mat = 'oak_panel'
    lo, hi = (x0, x1) if axis == 'x' else (y0, y1)
    def put(a, b, z0, z1, f):
        if axis == 'x': G.box(a, y0, z0, b, y1, z1, mat, faces=f)
        else: G.box(x0, a, z0, x1, b, z1, mat, faces=f)
    cur = lo
    for a, b, z0, z1 in ops:
        if a > cur + EPS: put(cur, a, zb, zt, faces)
        if z0 > zb + EPS:
            f = dict(faces) if faces else None
            if f: f['top'] = 'reveal'
            put(a, b, zb, z0, f)
        if z1 < zt - EPS:
            f = dict(faces) if faces else None
            if f: f['bot'] = 'reveal'
            put(a, b, z1, zt, f)
        cur = max(cur, b)
    if hi > cur + EPS: put(cur, hi, zb, zt, faces)

FR = 0.05
def glazing(G, o):
    a0, b0, a1, b1 = o['r']; z0, z1 = o['z']; k = o['k']
    if k in ('door', 'pass'): return
    along_x = (a1 - a0) > (b1 - b0)
    if along_x:
        ym = (b0 + b1) / 2; p0, p1 = a0, a1
        def bx(s0, s1, zz0, zz1, m, t=0.06, off=0.0):
            G.box(s0, ym + off - t / 2, zz0, s1, ym + off + t / 2, zz1, m, cast=(m != 'glass'))
    else:
        xm = (a0 + a1) / 2; p0, p1 = b0, b1
        def bx(s0, s1, zz0, zz1, m, t=0.06, off=0.0):
            G.box(xm + off - t / 2, s0, zz0, xm + off + t / 2, s1, zz1, m, cast=(m != 'glass'))
    if k == 'entry':
        bx(p0, p1, z0, z1, 'oak', t=0.07); return
    bx(p0, p1, z1 - FR, z1, 'frame'); bx(p0, p1, z0, z0 + FR, 'frame')
    bx(p0, p0 + FR, z0, z1, 'frame'); bx(p1 - FR, p1, z0, z1, 'frame')
    n = {'slide2': 2, 'slide3': 3, 'win': 1, 'fixed': 1, 'fixed2': 2}.get(k, 1)
    if k in ('win', 'fixed') and (p1 - p0) > 2.0: n = int((p1 - p0) / 1.4) + 1
    w = (p1 - p0 - 2 * FR) / n
    for i in range(n):
        s0 = p0 + FR + i * w
        off = 0.0 if (not k.startswith('slide') or i % 2 == 0) else 0.035
        bx(s0, s0 + w, z0 + FR, z1 - FR, 'glass', t=0.024, off=off)
        if i > 0: bx(s0 - 0.025, s0 + 0.025, z0 + FR, z1 - FR, 'frame', t=0.07)

def stair(G, x0, x1, y_top, y_bot, z_top, z_bot, n, mat='granite', along='y'):
    """n degraus de y_top (cota z_top) para y_bot (cota z_bot)."""
    rz = (z_top - z_bot) / n
    for i in range(n):
        if along == 'y':
            ya = y_top + (y_bot - y_top) * i / n; yb = y_top + (y_bot - y_top) * (i + 1) / n
            G.box(x0, min(ya, yb), z_bot - 0.3, x1, max(ya, yb), z_top - (i + 1) * rz, mat)
        else:
            xa = y_top + (y_bot - y_top) * i / n; xb = y_top + (y_bot - y_top) * (i + 1) / n
            G.box(min(xa, xb), x0, z_bot - 0.3, max(xa, xb), x1, z_top - (i + 1) * rz, mat)

def house_group(H):
    G = Group(H.key, H.origin, H.ang)
    for w in H.walls: wall_pieces(G, H, w)
    for o in H.open: glazing(G, o)
    for s in H.slabs: G.prism(s['p'], s['z'][0], s['z'][1], s['top'], s['side'], s['bot'], tag=s['t'])
    for r in H.rooms:
        if r['n'] == 'Degraus': continue
        G.prism(r['g'], r['z'] - 0.015, r['z'], r['m'], r['m'], tag='floor')
    for (x0, y0, x1, y1, zt) in H.steps_in:
        G.box(x0, y0, H.Sz - 0.2, x1, y1, zt, 'floor_int')
    F, Sz = H.F, H.Sz
    # terraço dos quartos (F) e degraus para o deck/jardim (sala)
    t = H.terrace; tx0, ty0, tx1, ty1 = t.bounds
    G.prism(t, Sz - 0.6, F - 0.02, 'render', 'granite_base', tag='terrace_body')
    G.prism(t, F - 0.02, F, 'deck', 'deck', tag='terrace')
    st = H.steps_out
    stair(G, st['x0'], st['x1'], ty0, ty0 - 0.81, F, Sz, 3, 'granite')
    # deck da piscina
    pool = sbox(*H.pool)
    deck = H.deck.difference(pool).difference(sbox(*H.box_poly.bounds)).difference(H.alp)
    if H.key == 'N': deck = deck.difference(sbox(tx0, ty0 - 0.81, st['x1'], ty1))
    G.prism(deck, Sz - 0.8, Sz - 0.02, 'render', 'granite_base', tag='deck_body')
    G.prism(deck, Sz - 0.02, Sz, 'deck', 'deck', tag='deck')
    px0, py0, px1, py1 = H.pool; zf = Sz - 1.45
    G.box(px0, py0, zf - 0.25, px1, py1, zf, 'liner')
    for (a, b, c, d) in [(px0, py0, px1, py0 + 0.02), (px0, py1 - 0.02, px1, py1), (px0, py0, px0 + 0.02, py1), (px1 - 0.02, py0, px1, py1)]:
        G.box(a, b, zf, c, d, Sz - 0.02, 'liner')
    G.box(px0 + 0.02, py0 + 0.02, Sz - 0.07, px1 - 0.02, py1 - 0.02, Sz - 0.06, 'water', tag='water', cast=False)
    G.prism(pool.buffer(0.30, join_style=2).difference(pool), Sz - 0.03, Sz + 0.02, 'coping', 'coping', tag='coping')
    # pátio de entrada / alpendre de carros (piso já nas lajes do alpendre) e caminho
    if H.key == 'N':
        G.prism(H.path, F - 0.4, F + 0.0, 'gpatio', 'granite_base', tag='path')
    # portadas de correr em madeira (estacionadas ao lado dos vãos dos quartos)
    for o in H.open:
        if o['n'] in ('Q1', 'Q3', 'Q5'):
            a0, b0, a1, b1 = o['r']; wdt = (a1 - a0) / 2
            for i, xs in enumerate([a1 + 0.05, a1 + 0.05 + wdt * 0.0]):
                pass
            G.box(a1 + 0.04, -0.14, F + 0.02, a1 + 0.04 + wdt, -0.08, F + 2.38, 'shutter', tag='shutter')
            G.box(a1 + 0.10, -0.21, F + 0.02, a1 + 0.10 + wdt, -0.15, F + 2.38, 'shutter', tag='shutter')
    # pala-guarda: calha das portadas sob a pala
    G.box(0.0, -0.22, F + 2.42, C.BAR['L'], -0.06, F + 2.50, 'metal')
    furniture(G, H)
    return G

def furniture(G, H):
    F, Sz = H.F, H.Sz; f = H.box_f
    def fb(a0, b0, a1, b1, z0, z1, m):
        x0, y0, x1, y1 = C.rect_map(f, a0, b0, a1, b1); G.box(x0, y0, z0, x1, y1, z1, m, tag='furn')
    # sala (caixa): sofá em L virado ao vão, mesa baixa, tapete, salamandra
    fb(3.6, 0.9, 4.5, 3.9, Sz, Sz + 0.42, 'fabric'); fb(4.3, 0.9, 4.5, 3.9, Sz, Sz + 0.80, 'fabric')
    fb(1.8, 0.8, 4.5, 1.6, Sz, Sz + 0.42, 'fabric')
    fb(1.6, 1.9, 3.1, 3.3, Sz, Sz + 0.32, 'furn_dark'); fb(1.2, 1.4, 4.2, 3.8, Sz, Sz + 0.004, 'rug')
    fb(6.1, 0.8, 6.6, 1.3, Sz, Sz + 1.0, 'metal_black'); fb(6.28, 0.98, 6.42, 1.12, Sz + 1.0, H.F + 4.4, 'metal_black')
    # jantar
    fb(1.2, 5.7, 3.8, 6.7, F + 0.72, F + 0.76, 'furn_oak')
    for bb in (5.8, 6.55): fb(1.3, bb, 3.7, bb + 0.05, F, F + 0.72, 'furn_oak')
    # cozinha: bancada no topo T e ilha
    fb(0.6, 10.70, 4.5 if H.key == 'S' else 4.6, 11.30, F, F + 0.90, 'furn_white'); fb(0.6, 10.70, 4.5 if H.key == 'S' else 4.6, 11.30, F + 0.90, F + 0.93, 'stone_top')
    fb(1.4, 8.3, 3.8, 9.2, F, F + 0.90, 'furn_dark'); fb(1.35, 8.25, 3.85, 9.25, F + 0.90, F + 0.94, 'stone_top')
    # quartos
    for (x0, x1) in ((1.2, 3.0), (7.0, 8.6), (12.0, 13.6)):
        G.box(x0, 2.3, F, x1, 4.38, F + 0.50, 'linen', tag='furn')
        G.box(x0, 4.2, F, x1, 4.38, F + 1.05, 'furn_oak', tag='furn')
    # alpendre da piscina: mesa e bancos
    ax0, ay0, ax1, ay1 = H.alp.bounds
    cx, cy = (ax0 + ax1) / 2, (ay0 + ay1) / 2
    G.box(cx - 0.5, cy - 1.1, Sz + 0.72, cx + 0.5, cy + 1.1, Sz + 0.76, 'furn_oak', tag='furn')
    G.box(cx - 0.5, cy - 1.1, Sz, cx - 0.4, cy + 1.1, Sz + 0.72, 'furn_oak', tag='furn')
    # espreguiçadeiras junto à piscina
    px0, py0, px1, py1 = H.pool
    if H.key == 'N':
        for xx in (2.0, 3.2, 4.4): G.box(xx, py0 - 1.35, Sz, xx + 0.7, py0 - 0.45, Sz + 0.30, 'fabric_out', tag='furn')
    else:
        for xx in (-22.6, -21.4): G.box(xx, py0 - 1.2, Sz, xx + 0.7, py0 - 0.4, Sz + 0.30, 'fabric_out', tag='furn')
    # carros
    cx0, cy0, cx1, cy1 = H.car.bounds
    if H.key == 'N':
        for xa in (23.4, 26.2): G.box(xa, cy0 + 0.4, H.C, xa + 1.85, cy0 + 4.9, H.C + 1.40, 'car', tag='furn')
    else:
        for ya in (0.8, 3.6): G.box(cx0 + 0.6, ya, H.C, cx0 + 5.1, ya + 1.85, H.C + 1.40, 'car', tag='furn')

# ============================================================================ sítio: muros, estrada, casa de A
site = Group('site')
def wall_along(points, h, t, mat, step=2.5, top_mat='coping', gaps=()):
    ls = LineString(points); n = max(1, int(ls.length / step))
    for i in range(n):
        a, b = ls.interpolate(i / n, normalized=True), ls.interpolate((i + 1) / n, normalized=True)
        mid = Point((a.x + b.x) / 2, (a.y + b.y) / 2)
        if any(g.distance(mid) < 0.01 for g in gaps): continue
        seg = LineString([a, b]).buffer(t / 2, cap_style=2, join_style=2)
        zg = max(ground_z(a.x, a.y), ground_z(b.x, b.y), ground_z(mid.x, mid.y))
        zl = min(ground_z(a.x, a.y), ground_z(b.x, b.y)) - 0.4
        site.prism(seg, zl, zg + h, mat, mat, tag='wall')
        site.prism(seg.buffer(0.03, join_style=2), zg + h, zg + h + 0.06, top_mat, top_mat, tag='wall')

# ============================================================================ terreno (campo de alturas) — cota final
HP = {H.key: H for H in C.HOUSES}
PREP = {}
for H in C.HOUSES:
    fp = C.footprint(H)
    PREP[H.key] = dict(
        lot=prep(H.lot), fp=prep(fp.buffer(0.05)), pool=prep(sbox(*H.pool).buffer(0.05)), deck=prep(H.deck.union(H.alp).buffer(0.02)), terr=prep(H.terrace.buffer(0.0)),
        steps=prep(sbox(H.steps_out['x0'], -1.81, H.steps_out['x1'], -1.0)),
        car=prep(H.car.union(H.store).buffer(0.05)), fc=prep(H.forecourt), path=prep(H.path),
        deckg=H.deck.union(H.alp).union(H.terrace).union(fp).union(H.car), fcg=H.forecourt, pathg=H.path, fpg=fp)
ROADP = prep(S.ROAD); AP = prep(S.A); BP = prep(S.B)
A_PLAT = sbox(-1.5, -2.34, 17.0, 10.0)

def ground_z(u, v):
    return ground(u, v)[0]

def ground(u, v):
    p = Point(u, v)
    n = S.natural(u, v)
    if ROADP.contains(p):
        return S.road_z(u, v), 'road'
    if AP.contains(p):
        d = A_PLAT.distance(p)
        z = 37.0 if d == 0 else max(n, 37.0 - d / 2.0)
        if u < 0 and A_PLAT.distance(p) > 0: z = max(n, min(z, S.road_z(u, v) + 0.2 + (0 - u) * 0))
        return z, ('lawn' if d < 0.01 else 'meadow')
    for H in C.HOUSES:
        P = PREP[H.key]
        if not P['lot'].contains(p): continue
        X, Y = H.L2H(u, v); q = Point(X, Y)
        if P['fp'].contains(q): return min(n, H.Sz - 0.3), 'under'
        if P['pool'].contains(q): return H.Sz - 1.9, 'under'
        if P['car'].contains(q): return H.C - 0.02, 'gpatio'
        if P['deck'].contains(q): return H.Sz - 0.05, 'under'
        if P['fc'].contains(q):
            # rampa do portão até ao alpendre
            if H.key == 'N':
                t = max(0.0, min(1.0, (Y - 2.0) / 6.1)); return H.C + t * (H.gate - H.C) - 0.01, 'gpatio'
            t = max(0.0, min(1.0, (X - 21.4) / 3.8)); return H.C + t * (H.gate - H.C) - 0.01, 'gpatio'
        if P['path'].contains(q):
            return H.F - 0.02 + max(0.0, (X - 14.4) / 7.6) * (H.C - H.F), 'path'
        # jardim: plataforma do jardim à cota da sala, a ligar ao natural em talude suave 1:4
        d = P['deckg'].distance(q)
        zt = H.Sz - 0.05
        z = zt + (n - zt) * min(1.0, d / max(0.5, abs(n - zt) * 4.0)) if d < 8 else n
        if H.key == 'S' and -7.0 < Y < -1.0 and 0.0 <= X <= 14.4:
            z = H.Sz - 0.05; return z, 'lawn'
        if H.key == 'N' and -9.0 < Y < -1.8 and -1.0 <= X <= 14.4:
            return H.Sz - 0.05, 'lawn'
        return z, ('lawn' if d < 5 else 'meadow')
    if BP.contains(p):
        return n, 'meadow'
    # fora do terreno: Trav. de João Pires e campos
    return n, 'field'

CLS = ['meadow', 'lawn', 'path', 'paving', 'bed', 'road', 'gpatio', 'under', 'field']
U_MIN, U_MAX, V_MIN, V_MAX, STEP = -86.0, 30.0, -44.0, 40.0, 0.5
nu = int(round((U_MAX - U_MIN) / STEP)) + 1; nv = int(round((V_MAX - V_MIN) / STEP)) + 1
Hh, Cc = [], []
for j in range(nv):
    v = V_MIN + j * STEP
    for i in range(nu):
        u = U_MIN + i * STEP
        z, c = ground(u, v)
        Hh.append(int(round((z - 28.0) * 100))); Cc.append(CLS.index(c))
terrain = dict(u0=U_MIN, v0=V_MIN, step=STEP, nu=nu, nv=nv, z0=28.0,
               h=base64.b64encode(struct.pack('<%dh' % len(Hh), *Hh)).decode(), c=base64.b64encode(bytes(Cc)).decode(), classes=CLS)

# ---- muros do sítio
div = list(C.DIVIDER.coords)
wall_along(div, 1.80, 0.40, 'granite_wall')                                         # muro de meação
# limite sul de B-sul (muro de granito ao longo do jardim e da piscina)
bs = list(C.LOT['S'].exterior.coords)
south = [p for p in S.B.exterior.coords]
def boundary_part(poly, pred):
    pts = list(poly.exterior.coords); segs = []
    for a, b in zip(pts, pts[1:]):
        m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if pred(Point(m)): segs.append((a, b))
    return segs
for a, b in boundary_part(C.LOT['S'], lambda m: m.distance(C.DIVIDER) > 0.5 and S.ROAD.distance(m) > 0.5 and m.y < -9 and m.x < -30.0):
    wall_along([a, b], 1.80, 0.40, 'granite_wall')
# frentes de estrada: muro de granito baixo com portões
gN = Polygon([C.N.H2L(x, y) for x, y in [(28.8, 4.6), (34.0, 4.6), (34.0, 8.2), (28.8, 8.2)]]).buffer(0)
gS = Polygon([C.SH.H2L(x, y) for x, y in [(22.0, 5.2), (27.0, 5.2), (27.0, 9.4), (22.0, 9.4)]]).buffer(0)
for a, b in boundary_part(S.B, lambda m: S.ROAD.distance(m) < 0.3):
    wall_along([a, b], 1.20, 0.35, 'granite_wall', step=1.0, gaps=(gN, gS))

# ---- casa de A (NordicSea v4.3, volumetria simplificada para contexto)
A = Group('A')
A.box(0.0, -1.34, 34.10, 15.0, 8.0, 37.0, 'render', tag='A')                       # cave/embasamento
A.box(0.0, -1.34, 37.0, 15.0, 8.0, 41.20, 'a_wall', faces={'-u': 'glass_dark'}, tag='A')
roof = []
for k in range(0, 31):
    pass
# telhado de 2 águas a 37°, cumeeira a v = 3,33 (prisma triangular ao longo de u)
tri = Polygon([(-1.34 - 0.4, 41.20 - 0.3), (8.0 + 0.4, 41.20 - 0.3), (3.33, 41.20 + (3.33 + 1.34) * math.tan(math.radians(37)))])
A.roof_tri = [[r3(a), r3(b)] for a, b in list(tri.exterior.coords)[:-1]]
A.box(-1.0, -1.34, 36.72, 0.0, 8.0, 37.0, 'concrete', tag='A')                      # varanda poente
A.box(-0.02, -1.0, 37.05, 0.02, 7.7, 44.0, 'glass_dark', tag='A_glass')

# ============================================================================ vegetação
rnd = random.Random(11)
trees = []
def add_tree(kind, u, v, h, d): trees.append([kind, r3(u), r3(v), r3(h), r3(d)])
# mata a norte de B e a poente (pinheiro-bravo e eucalipto) — ver ortofoto
TP = prep(S.TOTAL.buffer(1.5))
for _ in range(900):
    u = rnd.uniform(-86, 25); v = rnd.uniform(-44, 40)
    p = Point(u, v)
    if TP.contains(p) or ROADP.contains(p): continue
    north_belt = v > 19.0 + 0.0 * u and u < -14
    west_belt = u < -64.0 and (u < -72 or rnd.random() < 0.45)
    south_field = v < -20 and u > -58 and u < -5
    if south_field: continue
    if not (north_belt or west_belt or (u > 18 and v > 10)): continue
    kind = 'pine' if rnd.random() < 0.55 else ('euc' if rnd.random() < 0.6 else 'oak')
    hmax = 11.0 if west_belt and u > -78 else 16.0
    add_tree(kind, u, v, rnd.uniform(7.5, hmax) if kind != 'oak' else rnd.uniform(6, 9), rnd.uniform(4, 7))
# jardins
for (k, x, y, h, d) in [('oak', 4.0, -10.6, 7.5, 6.5), ('olive', -2.5, -6.5, 4.0, 3.4), ('arbutus', 9.0, 8.6, 3.6, 2.8), ('fruit', 3.0, 9.0, 3.2, 2.8),
                        ('olive', 17.0, -8.6, 3.8, 3.0), ('arbutus', 31.0, -1.6, 3.4, 2.6)]:
    add_tree(k, *C.N.H2L(x, y), h, d)
for (k, x, y, h, d) in [('oak', -27.6, -1.4, 7.0, 6.0), ('olive', 4.0, -4.3, 3.8, 3.0), ('olive', 10.5, -4.6, 3.6, 2.8), ('arbutus', -8.0, -3.4, 3.4, 2.6),
                        ('fruit', -4.0, 8.4, 3.0, 2.6), ('arbutus', 25.0, -2.6, 3.2, 2.4)]:
    add_tree(k, *C.SH.H2L(x, y), h, d)
# casa de A: pinheiro-manso e oliveiras
for (k, u, v, h, d) in [('pine', 24.0, 4.0, 11.0, 9.0), ('oak', 19.0, 11.8, 9.0, 7.5), ('olive', 8.0, 12.3, 3.8, 3.2)]:
    add_tree(k, u, v, h, d)
# sebes: limites norte/poente de B-norte, poente de B-sul, e ao longo do muro de meação
hedges = []
def hedge_line(pts, h, w, off=0.0):
    ls = LineString(pts)
    if off: ls = ls.parallel_offset(off, 'left') if off > 0 else ls.parallel_offset(-off, 'right')
    cs = list(ls.coords)
    for a, b in zip(cs, cs[1:]):
        if LineString([a, b]).length < 0.3: continue
        hedges.append(dict(a=[r3(a[0]), r3(a[1])], b=[r3(b[0]), r3(b[1])], h=h, w=w))
inner = S.B.buffer(-0.9, join_style=2)
cs = list(inner.exterior.coords)
for a, b in zip(cs, cs[1:]):
    m = Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    if S.ROAD.distance(m) < 2.5: continue
    if m.y < -12 and -56 < m.x < -30.0: continue   # troço do limite sul de B-sul com muro de granito
    hedges.append(dict(a=[r3(a[0]), r3(a[1])], b=[r3(b[0]), r3(b[1])], h=2.2, w=1.0))
# sebe dupla ao longo do muro de meação (dos dois lados), menos junto à estrada
d0 = C.DIVIDER
for off in (0.9,):
    seg = d0.parallel_offset(abs(off), 'left' if off > 0 else 'right')
    c2 = list(seg.coords)
    for a, b in zip(c2, c2[1:]):
        m = Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if S.ROAD.distance(m) < 3.0: continue
        hedges.append(dict(a=[r3(a[0]), r3(a[1])], b=[r3(b[0]), r3(b[1])], h=2.3, w=0.9))
shrubs = []
for H in C.HOUSES:
    # canteiros de gramíneas e aromáticas ao longo dos muros e da casa
    for _ in range(36):
        for _t in range(30):
            X = rnd.uniform(-26, 30); Y = rnd.uniform(-12, 10)
            u, v = H.H2L(X, Y); p = Point(u, v)
            if not H.lot.buffer(-1.6).contains(p): continue
            q = Point(X, Y)
            if H.deck.buffer(0.5).contains(q) or C.footprint(H).buffer(0.8).contains(q) or H.car.buffer(1.0).contains(q) or H.forecourt.buffer(0.5).contains(q): continue
            if H.lot.exterior.distance(p) < 3.2 or C.DIVIDER.distance(p) < 3.0:
                shrubs.append([r3(u), r3(v), round(rnd.uniform(0.5, 1.0), 2)]); break

# ============================================================================ câmaras e sol
ANG = S.ANG
def sun(az, alt):
    north = (math.sin(ANG), math.cos(ANG)); east = (math.cos(ANG), -math.sin(ANG))
    a, h = math.radians(az), math.radians(alt)
    hu = math.sin(a) * east[0] + math.cos(a) * north[0]; hv = math.sin(a) * east[1] + math.cos(a) * north[1]
    return [round(hu * math.cos(h), 4), round(hv * math.cos(h), 4), round(math.sin(h), 4)]
def HP_(H, X, Y, z): u, v = H.H2L(X, Y); return [r3(u), r3(v), r3(z)]
N, SH = C.N, C.SH
cams = {
    'aerial':  dict(p=[-97.0, -17.0, 91.0], t=[-30.0, -1.0, 31.0], fov=31, sun=sun(248, 26), exp=0.78, dusk=0),
    'aerial2': dict(p=[-70.0, -62.0, 52.0], t=[-30.0, 0.0, 33.0], fov=40, sun=sun(215, 42), exp=0.75, dusk=0),
    'courtN':  dict(p=HP_(N, 1.2, -7.6, N.Sz + 1.55), t=HP_(N, 13.0, -1.0, N.Sz + 1.7), fov=66, sun=sun(255, 14), exp=0.82, dusk=1),
    'courtS':  dict(p=HP_(SH, -23.0, 0.4, SH.Sz + 1.55), t=HP_(SH, -10.0, 4.4, SH.Sz + 1.8), fov=64, sun=sun(250, 18), exp=0.80, dusk=1),
    'livingN': dict(p=HP_(N, 19.0, 1.6, N.F + 1.55), t=HP_(N, 14.4, -4.2, N.Sz + 1.15), fov=74, sun=sun(250, 18), exp=0.85, dusk=0),
    'fromA':   dict(p=[-0.8, 3.2, 38.62], t=[-60.0, -3.0, 34.2], fov=56, sun=sun(255, 12), exp=0.85, dusk=1),
    'road':    dict(p=[-3.5, -11.5, 37.9], t=[-30.0, 4.0, 34.2], fov=52, sun=sun(230, 30), exp=0.75, dusk=0),
    'cutaway': dict(p=[-60.0, -46.0, 78.0], t=[-31.0, 0.0, 33.0], fov=36, sun=sun(215, 50), exp=0.72, dusk=0, noroof=1),
}
groups = [house_group(N).out(), house_group(SH).out(), A.out()]
groups[2]['roof_tri'] = A.roof_tri
spec = dict(groups=groups, site=site.out(), terrain=terrain, trees=trees, hedges=hedges, shrubs=shrubs, cams=cams,
            zref=33.0, sea=dict(u=-1250.0), north=[math.sin(ANG), math.cos(ANG)], center=[-30.0, 0.0, 33.0])
os.makedirs('out', exist_ok=True)
json.dump(spec, open('out/spec.json', 'w'), separators=(',', ':'))
print('grupos', [(g['n'], len(g['boxes']), len(g['prisms'])) for g in groups], 'site', len(site.boxes), len(site.prisms))
print('terreno', nu, 'x', nv, 'árvores', len(trees), 'sebes', len(hedges), 'arbustos', len(shrubs), 'KB', os.path.getsize('out/spec.json') // 1024)
