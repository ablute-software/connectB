# -*- coding: utf-8 -*-
"""Duas casas T3 para a área resultante B — geometria única (fonte de verdade).

Cada casa tem o seu referencial (X, Y) em metros: X ao longo da ala dos quartos (de poente para nascente),
Y perpendicular (para o lado fechado: norte em B-norte, a linha divisória em B-sul). Origem no canto
SO exterior da ala dos quartos. H2L converte para as coordenadas locais (u, v) do sítio (sitio.py).

As duas casas usam as MESMAS peças (kit):
  · ala dos quartos (baixa)      14,40 × 6,00 m  pé-direito 2,60
  · caixa da sala (alta)          7,20 × 11,60 m  cozinha/jantar ao nível F (pé-direito 3,60),
                                                   sala 3 degraus abaixo (F − 0,51, pé-direito 4,11)
  · alpendre da piscina           4,00 × 4,40 m  (Fase 2: fecha e passa a escritório/estúdio)
  · alpendre de estacionamento    6,00 × 5,60 m  + arrumos/técnica 1,20 m
  · piscina                       9,00 × 3,50 m  (8,00 × 3,50 em B-sul, pelo bico poente do lote)
"""
import json, math, os
import numpy as np
from shapely.geometry import Polygon, box as sbox, Point, LineString
from shapely.ops import unary_union
import sitio as S

HERE = os.path.dirname(os.path.abspath(__file__))
DIV = json.load(open(os.path.join(HERE, 'out', 'divisao.json')))
LOT = {'N': Polygon(DIV['Bn']).buffer(0), 'S': Polygon(DIV['Bs']).buffer(0)}
_O = np.array(DIV['linha'][1]); _ex = np.array(DIV['linha'][0]) - _O; _ex /= np.linalg.norm(_ex)
LINE_ANG = math.degrees(math.atan2(_ex[1], _ex[0]))           # ≈ 15,15° a partir do eixo u
DIVIDER = LineString(DIV['linha'])

def _line_frame(x, y):
    ey = np.array([-_ex[1], _ex[0]]); p = _O + x * _ex + y * ey; return (float(p[0]), float(p[1]))

# ----------------------------------------------------------------------------- espessuras e alturas do kit
E, I = 0.30, 0.12                  # parede exterior / interior
DS = 0.51                          # 3 degraus de 0,17 entre a cozinha e a sala
BAR = dict(L=14.40, W=6.00, ceil=2.60, slab=0.25, roof=0.20, parapet=0.10)      # topo = F + 3,15
BOX = dict(A=7.20, B=11.60, ceil=3.60, slab=0.25, roof=0.20, parapet=0.20)       # topo = F + 4,25
ALP = dict(clear=2.60, slab=0.25)  # alpendres: laje fina 0,25
BAR_TOP = BAR['ceil'] + BAR['slab'] + BAR['roof'] + BAR['parapet']
BOX_TOP = BOX['ceil'] + BOX['slab'] + BOX['roof'] + BOX['parapet']

class House:
    def __init__(self, key, name, origin, ang_deg, F, C, gate):
        self.key, self.name, self.origin, self.ang = key, name, origin, math.radians(ang_deg)
        self.ang_deg = ang_deg
        self.F = F                  # ala dos quartos, cozinha e jantar
        self.Sz = round(F - DS, 3)  # sala, alpendre e deck da piscina
        self.C = C                  # alpendre de estacionamento
        self.gate = gate            # cota do portão (estrada)
        self.rooms, self.walls, self.open, self.slabs, self.ext = [], [], [], [], []
        self.furn, self.labels = [], []
        self.lot = LOT[key]
    # ---- referencial
    def H2L(self, X, Y):
        c, s = math.cos(self.ang), math.sin(self.ang)
        return (self.origin[0] + X * c - Y * s, self.origin[1] + X * s + Y * c)
    def L2H(self, u, v):
        c, s = math.cos(self.ang), math.sin(self.ang); du, dv = u - self.origin[0], v - self.origin[1]
        return (du * c + dv * s, -du * s + dv * c)
    def polyL(self, poly):
        return Polygon([self.H2L(x, y) for x, y in poly.exterior.coords])
    def natural(self, X, Y):
        return S.natural(*self.H2L(X, Y))
    # ---- registo
    def room(self, name, geom, z, mat, area_tag='util'):
        g = geom if isinstance(geom, Polygon) else sbox(*geom)
        self.rooms.append(dict(n=name, g=g, r=tuple(round(c, 3) for c in g.bounds), z=z, m=mat, tag=area_tag))
    def wall(self, rect, ext, z0, z1, mat_out='render', mat_in='plaster', tag=None):
        self.walls.append(dict(r=tuple(round(c, 3) for c in rect), ext=ext, z=(round(z0, 3), round(z1, 3)), mo=mat_out, mi=mat_in, t=tag))
    def opening(self, n, rect, z0, z1, kind, desc='', **kw):
        d = dict(n=n, r=tuple(round(c, 3) for c in rect), z=(round(z0, 3), round(z1, 3)), k=kind, d=desc); d.update(kw)
        self.open.append(d)
    def slab(self, poly, z0, z1, top, side, bot=None, tag=None):
        self.slabs.append(dict(p=poly, z=(round(z0, 3), round(z1, 3)), top=top, side=side, bot=bot or top, t=tag))

def rect_map(f, a0, b0, a1, b1):
    (x0, y0), (x1, y1) = f(a0, b0), f(a1, b1)
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))

# ============================================================================ ala dos quartos (igual nas duas)
def build_bar(H, west_window, east_door):
    F = H.F; L, W = BAR['L'], BAR['W']; zc = F + BAR['ceil']
    # paredes exteriores
    H.wall((0, 0, L, E), '-y', F, zc); H.wall((0, W - E, L, W), '+y', F, zc)
    H.wall((0, E, E, W - E), '-x', F, zc); H.wall((L - E, E, L, W - E), '+x', F, zc)
    yr = W - E - 1.20 - I          # 4,38 — limite da banda dos quartos
    H.wall((E, yr, L - E, yr + I), None, F, zc)
    xs = [(4.50, 'Suite'), (6.22, 'WC suite'), (9.34, 'Quarto 2'), (11.26, 'WC'), (L - E, 'Quarto 3')]
    x0 = E
    for k, (x1, nm) in enumerate(xs):
        H.room(nm, (x0, E, x1, yr), F, 'tile' if nm.startswith('WC') else 'floor_wood')
        if k < len(xs) - 1:
            H.wall((x1, E, x1 + I, yr), None, F, zc); x0 = x1 + I
    H.room('Galeria', (E, yr + I, L - E, W - E), F, 'floor_wood')
    # vãos exteriores — fachada do pátio/jardim (Y = 0)
    H.opening('Q1', (0.90, 0, 3.90, E), F, F + 2.40, 'slide2', 'Suite → terraço (correr, 3,00 × 2,40) + portadas de madeira')
    H.opening('Q2', (4.95, 0, 5.85, E), F + 1.60, F + 2.30, 'win', 'WC da suite (alta, fosca)')
    H.opening('Q3', (6.75, 0, 9.05, E), F, F + 2.40, 'slide2', 'Quarto 2 → terraço (2,30 × 2,40) + portadas')
    H.opening('Q4', (9.80, 0, 10.80, E), F + 1.60, F + 2.30, 'win', 'WC (alta, fosca)')
    H.opening('Q5', (11.65, 0, 13.85, E), F, F + 2.40, 'slide2', 'Quarto 3 → terraço (2,20 × 2,40) + portadas')
    # galeria: faixa alta contínua no lado fechado (luz sem vistas)
    for i, (a, b) in enumerate([(0.70, 4.10), (4.50, 7.90), (8.30, 11.70)]):
        H.opening('G%d' % (i + 1), (a, W - E, b, W), F + 1.85, F + 2.40, 'fixed', 'Galeria — janela alta (peitoril 1,85)')
    if west_window:
        H.opening('Q6', (0, 1.00, E, 3.40), F + 0.60, F + 2.40, 'win', 'Suite → jardim poente (janela de sacada baixa)')
    if east_door:
        H.opening('P1', (L - E, yr + I + 0.05, L, W - E - 0.05), F, F + 2.40, 'entry', 'Porta de entrada (madeira, pivotante)')
    # portas interiores
    for (a, nm) in [(1.20, 'Suite'), (7.20, 'Q2'), (9.65, 'WC'), (12.10, 'Q3')]:
        H.opening('p', (a, yr, a + 0.80, yr + I), F, F + 2.10, 'door', sw='-y')
    H.opening('p', (4.50, 3.10, 4.62, 3.90), F, F + 2.10, 'door', sw='+x')
    # laje de cobertura + pala de 0,90 m sobre a fachada sul
    H.slab(sbox(0, -0.90, L, W), zc, zc + BAR['slab'], 'concrete', 'render', bot='ceiling', tag='roof_bar')
    H.slab(sbox(0, 0, L, W).buffer(-0.12, join_style=2), zc + BAR['slab'], zc + BAR['slab'] + BAR['roof'], 'gravel', 'render', tag='roof_bar')
    H.slab(sbox(0, -0.90, L, W).difference(sbox(0, 0, L, W).buffer(-0.12, join_style=2)).difference(sbox(0, -0.90, L, -0.0)),
           zc + BAR['slab'], F + BAR_TOP, 'render', 'render', tag='parapet')
    H.slab(sbox(0, -0.90, L, 0), zc + BAR['slab'], zc + BAR['slab'] + 0.06, 'metal', 'metal', tag='roof_bar')
    H.slab(sbox(0, 0, L, W), F - 0.30, F - 0.015, 'concrete', 'granite_base', bot='concrete', tag='slab_bar')
    for r in H.rooms:
        pass

# ============================================================================ caixa da sala (igual nas duas, espelhada em B-sul)
def build_box(H, f, gallery_b, pod, door_T=None, c_jantar=False, e_kind='fixed2'):
    """f(a, b) → (X, Y). a: 0 = lado do pátio/jardim (C), 7,2 = lado fechado (K). b: 0 = topo da sala (E), 11,6 = topo da cozinha (T)."""
    F, Sz = H.F, H.Sz; A, B = BOX['A'], BOX['B']; zc = F + BOX['ceil']
    R = lambda a0, b0, a1, b1: rect_map(f, a0, b0, a1, b1)
    def side(da, db):
        x0, y0 = f(0, 0); x1, y1 = f(da, db); dx, dy = x1 - x0, y1 - y0
        return ('+x' if dx > 0 else '-x') if abs(dx) > abs(dy) else ('+y' if dy > 0 else '-y')
    H.box_sides = dict(C=side(-1, 0), K=side(1, 0), E=side(0, -1), T=side(0, 1))
    H.box_f = f
    # paredes exteriores (a altura total, do nível da sala ao teto)
    sd = H.box_sides
    H.wall(R(0, 0, E, B), sd['C'], Sz, zc); H.wall(R(A - E, 0, A, B), sd['K'], Sz, zc)
    H.wall(R(E, 0, A - E, E), sd['E'], Sz, zc); H.wall(R(E, B - E, A - E, B), sd['T'], Sz, zc)
    bs = 4.40; bp = bs + 3 * 0.27      # degraus b 4,40 → 5,21
    H.room('Sala', R(E, E, A - E, bs), Sz, 'floor_int')
    H.room('Degraus', R(E, bs, A - E, bp), F, 'floor_int', area_tag='util')
    pa0, pb0, pa1, pb1 = pod
    kit = sbox(*R(E, bp, A - E, B - E)).difference(sbox(*R(pa0 - 0.10, pb0 - 0.10, pa1, min(pb1 + 0.10, B - E))))
    H.room('Cozinha · jantar', kit, F, 'floor_int')
    # cápsula de serviço (WC social + lavandaria/despensa), paredes de 0,10, altura 2,40
    t = 0.10; zp = F + 2.40
    H.wall(R(pa0 - t, pb0 - t, pa0, pb1), None, F, zp, mat_out='oak_panel', mat_in='plaster')
    H.wall(R(pa0 - t, pb0 - t, pa1, pb0), None, F, zp, mat_out='oak_panel', mat_in='plaster')
    if pb1 < B - E - 0.01:
        H.wall(R(pa0 - t, pb1, pa1, pb1 + t), None, F, zp, mat_out='oak_panel', mat_in='plaster')
    mid = (pb0 + pb1) / 2
    H.wall(R(pa0, mid - 0.05, pa1, mid + 0.05), None, F, zp)
    H.room('WC social', R(pa0, mid + 0.05, pa1, pb1), F, 'tile')
    H.room('Lavandaria · despensa', R(pa0, pb0, pa1, mid - 0.05), F, 'tile')
    H.slab(Polygon([f(pa0 - t, pb0 - t), f(pa1, pb0 - t), f(pa1, pb1 + (t if pb1 < B - E - 0.01 else 0)), f(pa0 - t, pb1 + (t if pb1 < B - E - 0.01 else 0))]), zp, zp + 0.08, 'oak_panel', 'oak_panel', tag='pod_top')
    # degraus (3 espelhos de 0,17)
    H.steps_in = []
    for k in range(3):
        H.steps_in.append(R(E, bs + k * 0.27, A - E, bs + (k + 1) * 0.27) + (round(F - DS + (k + 1) * 0.17, 3),))
    # vãos
    H.opening('S1', R(0, 0.60, E, 4.10), Sz, F + 2.60, 'slide3', 'Sala → alpendre e piscina (correr, 3,50 × 3,11)')
    if e_kind == 'slide3':
        H.opening('S2', R(0.60, 0, 6.60, E), Sz, F + 2.60, 'slide3', 'Topo da sala → alpendre e piscina (correr, 6,00 × 3,11)')
    else:
        H.opening('S2', R(0.90, 0, 6.30, E), Sz, F + 2.60, 'fixed2', 'Topo da sala → jardim (vidro fixo + 1 folha de correr, 5,40 × 3,11)')
    H.opening('S3', R(A - E, 0.60, A, 11.00), F + 2.90, F + 3.45, 'fixed', 'Clerestório contínuo no lado fechado (peitoril 2,90)')
    if c_jantar:
        H.opening('S4', R(0, 5.60, E, 8.00), F, F + 2.60, 'slide2', 'Jantar → jardim sul (correr, 2,40 × 2,60)')
    if door_T:
        H.opening('P1', R(door_T[0], B - E, door_T[1], B), F, F + 2.40, 'entry', 'Porta de entrada (madeira, pivotante)')
        H.opening('S5', R(2.60, B - E, 4.40, B), F + 1.05, F + 2.40, 'win', 'Cozinha — janela sobre a bancada')
    ga0, ga1 = gallery_b
    H.gallery_link = (ga0, ga1)
    H.opening('p', R(pa0 - t, pb0 + 0.30, pa0, pb0 + 1.00), F, F + 2.10, 'door', sw='C')
    H.opening('p', R(pa0 - t, pb1 - 1.00, pa0, pb1 - 0.30), F, F + 2.10, 'door', sw='C')
    # lajes: pavimento em dois níveis, cobertura, platibanda
    H.slab(Polygon([f(0, 0), f(A, 0), f(A, bs), f(0, bs)]), Sz - 0.30, Sz - 0.015, 'concrete', 'granite_base', bot='concrete', tag='slab_box')
    H.slab(Polygon([f(0, bs), f(A, bs), f(A, B), f(0, B)]), Sz - 0.30, F - 0.015, 'concrete', 'granite_base', bot='concrete', tag='slab_box')
    full = Polygon([f(0, 0), f(A, 0), f(A, B), f(0, B)])
    H.slab(full, zc, zc + BOX['slab'], 'concrete', 'render', bot='ceiling', tag='roof_box')
    inner = full.buffer(-0.15, join_style=2)
    H.slab(inner, zc + BOX['slab'], zc + BOX['slab'] + BOX['roof'], 'gravel', 'render', tag='roof_box')
    H.slab(full.difference(inner), zc + BOX['slab'], F + BOX_TOP, 'render', 'render', tag='parapet')
    H.box_poly = full

# ============================================================================ alpendres
def build_alpendre(H, rect, back_side, cols):
    """Alpendre da piscina, ao nível da sala. back_side: lado com muro de granito (privacidade)."""
    x0, y0, x1, y1 = rect; Sz = H.Sz; zs = Sz + ALP['clear']
    H.slab(sbox(x0, y0, x1, y1), zs, zs + ALP['slab'], 'concrete', 'concrete', bot='soffit', tag='alp')
    H.slab(sbox(x0, y0, x1, y1), Sz - 0.25, Sz - 0.01, 'deck', 'granite_base', tag='alp_floor')
    t = 0.40
    if back_side == '-y':
        H.wall((x0, y0, x1, y0 + t), 'stone', Sz, zs, mat_out='granite_wall', mat_in='granite_wall', tag='alp_wall')
    elif back_side == '+y':
        H.wall((x0, y1 - t, x1, y1), 'stone', Sz, zs, mat_out='granite_wall', mat_in='granite_wall', tag='alp_wall')
    for (cx, cy) in cols:
        H.wall((cx - 0.06, cy - 0.06, cx + 0.06, cy + 0.06), 'col', Sz, zs, mat_out='metal', mat_in='metal', tag='col')
    H.alp = sbox(x0, y0, x1, y1)

def build_carport(H, rect, store_rect, cols, porch=None):
    x0, y0, x1, y1 = rect; C = H.C; zs = C + 2.40
    full = sbox(x0, y0, x1, y1)
    if porch is not None: full = full.union(sbox(*porch))
    H.slab(full, zs, zs + ALP['slab'], 'concrete', 'concrete', bot='soffit', tag='car')
    H.slab(sbox(x0, y0, x1, y1), C - 0.25, C - 0.01, 'gpatio', 'granite_base', tag='car_floor')
    sx0, sy0, sx1, sy1 = store_rect; t = 0.15
    H.wall((sx0, sy0, sx1, sy0 + t), 'store', C, zs, mat_out='timber', mat_in='plaster', tag='store')
    H.wall((sx0, sy1 - t, sx1, sy1), 'store', C, zs, mat_out='timber', mat_in='plaster', tag='store')
    H.wall((sx0, sy0, sx0 + t, sy1), 'store', C, zs, mat_out='timber', mat_in='plaster', tag='store')
    H.wall((sx1 - t, sy0, sx1, sy1), 'store', C, zs, mat_out='timber', mat_in='plaster', tag='store')
    H.room('Arrumos · técnica', (sx0 + t, sy0 + t, sx1 - t, sy1 - t), C, 'cave_floor', area_tag='anexo')
    for (cx, cy) in cols:
        H.wall((cx - 0.06, cy - 0.06, cx + 0.06, cy + 0.06), 'col', C, zs, mat_out='metal', mat_in='metal', tag='col')
    H.car = sbox(x0, y0, x1, y1); H.store = sbox(*store_rect)

# ============================================================================ CASA NORTE (B-norte) — L à volta do pátio
N = House('N', 'Casa do Pátio', origin=(-47.80, 9.00), ang_deg=0.0, F=32.95, C=33.35, gate=33.67)
build_bar(N, west_window=True, east_door=False)
build_box(N, lambda a, b: (14.40 + a, -5.60 + b), gallery_b=(10.10, 11.30), pod=(4.70, 8.20, 6.90, 11.30), door_T=(0.60, 1.60), e_kind='fixed2')
N.opening('p', (14.10, 4.55, 14.70, 5.65), N.F, N.F + 2.40, 'pass', 'Galeria → cozinha')
build_alpendre(N, (10.40, -6.00, 14.40, -1.60), '-y', cols=[(10.52, -1.72)])
build_carport(N, (21.60, -3.60, 28.80, 2.00), store_rect=(21.60, -3.60, 22.80, 2.00), cols=[(28.68, -3.48), (28.68, 1.88)])
N.pool = (0.60, -6.80, 9.60, -3.30)
N.steps_out = dict(x0=0.0, x1=10.40, y_top=-1.00, n=3)          # terraço dos quartos (F) → deck (sala)
N.terrace = sbox(0.0, -1.00, 14.40, 0.0)
N.deck = Polygon([(-0.40, -8.30), (14.40, -8.30), (14.40, -1.81), (-0.40, -1.81)])
N.forecourt = Polygon([(21.60, 2.00), (30.60, 2.00), (31.40, 8.10), (22.00, 8.10)])
N.path = sbox(14.40, 6.00, 22.00, 7.60)                          # rampa 1:16 do pátio de entrada à porta

# ============================================================================ CASA SUL (B-sul) — casa comprida, sala no fim
_oS = _line_frame(23.60, -9.20)
SH = House('S', 'Casa Comprida', origin=_oS, ang_deg=LINE_ANG, F=33.45, C=33.75, gate=34.40)
build_bar(SH, west_window=False, east_door=True)
build_box(SH, lambda a, b: (-11.60 + b, -1.20 + a), gallery_b=(10.10, 11.30), pod=(4.60, 6.70, 6.90, 9.50), c_jantar=True, e_kind='slide3')
SH.opening('p', (-0.30, 4.55, 0.30, 5.65), SH.F, SH.F + 2.40, 'pass', 'Galeria → cozinha')
build_alpendre(SH, (-15.60, 1.60, -11.60, 6.00), '+y', cols=[(-15.48, 1.72)])
build_carport(SH, (15.40, 0.40, 21.40, 6.00), store_rect=(15.40, -0.80, 21.40, 0.40), cols=[(21.28, 5.88), (21.28, 0.52), (15.52, 5.88)], porch=(14.40, 0.40, 15.40, 6.00))
SH.pool = (-23.60, 2.30, -15.60, 5.80)
SH.steps_out = dict(x0=0.0, x1=14.40, y_top=-1.00, n=3)
SH.terrace = sbox(0.0, -1.00, 14.40, 0.0)
SH.deck = Polygon([(-24.60, 1.30), (-11.60, 1.30), (-11.60, 6.60), (-24.60, 6.60)])
SH.forecourt = Polygon([(21.40, 0.40), (25.20, 4.60), (25.20, 8.90), (21.40, 6.00)])
SH.path = sbox(14.40, 0.40, 15.40, 6.00)
HOUSES = [N, SH]

# ============================================================================ áreas e verificações
def footprint(H):
    return unary_union([sbox(0, 0, BAR['L'], BAR['W']), H.box_poly])

def areas(H):
    util = sum(r['g'].area for r in H.rooms if r['tag'] == 'util')
    fp = footprint(H)
    return dict(abc=round(fp.area, 1), util=round(util, 1), alpendre_piscina=round(H.alp.area, 1),
                alpendre_carros=round(H.car.difference(H.store).area, 1), arrumos=round(H.store.area, 1),
                implantacao=round(unary_union([fp, H.alp, H.car]).area, 1), lote=round(H.lot.area, 1),
                piscina=round((H.pool[2] - H.pool[0]) * (H.pool[3] - H.pool[1]), 1))

def checks(H):
    out = []
    lotb = H.lot.exterior
    for nm, g in [('ala+caixa', footprint(H)), ('alpendre piscina', H.alp), ('alpendre carros', H.car), ('piscina', sbox(*H.pool))]:
        gl = H.polyL(g)
        out.append((nm, gl.within(H.lot), round(lotb.distance(gl), 2), round(S.ROAD.distance(gl), 2)))
    return out

def tops(H):
    return dict(ala=round(H.F + BAR_TOP, 2), caixa=round(H.F + BOX_TOP, 2), sala=H.Sz, F=H.F, C=H.C)

if __name__ == '__main__':
    for H in HOUSES:
        print('=====', H.name, 'origem', [round(c, 3) for c in H.origin], 'ângulo', round(H.ang_deg, 3))
        print(' áreas', areas(H)); print(' cotas', tops(H))
        for c in checks(H): print('  dentro/dist limite/dist estrada', c)
        fpL = H.polyL(footprint(H))
        zs = [S.natural(x, y) for x, y in fpL.exterior.coords]
        print('  natural sob a casa: %.2f – %.2f' % (min(zs), max(zs)))
        for r in H.rooms: print('   %-24s %6.2f m²  z %.2f' % (r['n'], r['g'].area, r['z']))
