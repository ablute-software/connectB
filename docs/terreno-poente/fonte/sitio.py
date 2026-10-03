# -*- coding: utf-8 -*-
"""Terreno de poente (área resultante B), Carreço — sítio, cotas e divisão.

Coordenadas locais (m) iguais às da casa de A (Casa Plinto / v4): origem em ETRS89 M = −60 409,15,
P = 229 931,92; eixo u a 19,951° a norte do nascente (ENE), eixo v perpendicular (NNO). Cotas absolutas.

Cotas do terreno natural: curvas de nível do levantamento (site_lines_local.json, 67 polilinhas sem z)
com cota atribuída a partir das curvas mestras etiquetadas na imagem do levantamento (32, 33, 34, 35;
equidistância 0,20 m). A atribuição foi verificada pela continuidade das curvas dos dois lados do muro sul de B.
"""
import json, math, os
import numpy as np
from shapely.geometry import Polygon, LineString, Point, MultiPoint
from shapely.ops import split, unary_union
HERE = os.path.dirname(os.path.abspath(__file__))
ANG_DEG = 19.951053938392224
ANG = math.radians(ANG_DEG)
M0, P0 = -60409.15, 229931.92
CA, SA = math.cos(ANG), math.sin(ANG)

def w2l(M, P):
    dm, dp = M - M0, P - P0
    return (dm * CA + dp * SA, -dm * SA + dp * CA)

def l2w(u, v):
    return (M0 + u * CA - v * SA, P0 + u * SA + v * CA)

_par = json.load(open(os.path.join(HERE, '..', 'parcelas_etrs89.json')))
def _poly(key):
    return Polygon([w2l(*p[:2]) for p in _par[key]]).buffer(0)
B = _poly('B_etrs89'); A = _poly('A_etrs89'); ROAD = _poly('road_etrs89'); TOTAL = _poly('total_etrs89')

# ----------------------------------------------------------------------------- curvas de nível com cota
Z_CURVA = {0: 31.4, 1: 31.6, 2: 31.8, 3: 32.0, 4: 32.2, 60: 32.4, 9: 32.6, 10: 32.8, 57: 33.0, 12: 33.2,
           55: 33.4, 54: 33.6, 53: 33.8, 52: 34.0,
           66: 31.2, 65: 31.4, 64: 31.6, 63: 31.8, 62: 32.0, 61: 32.2, 6: 32.4, 59: 32.6, 58: 32.8, 11: 33.0,
           56: 33.2, 13: 33.4, 14: 33.6, 15: 33.8, 16: 34.0, 18: 34.2, 20: 34.4, 22: 34.6, 24: 34.8, 26: 35.0, 28: 35.2,
           19: 34.2, 21: 34.4, 23: 34.6, 25: 34.8, 27: 35.0, 29: 35.2, 30: 35.4}
_lines = json.load(open(os.path.join(HERE, 'site_lines_local.json')))
CONTOURS = [(Z_CURVA[i], pl) for i, pl in enumerate(_lines['terreno']) if i in Z_CURVA]
LIMITES = _lines['limites']

_pts, _zs = [], []
for z, pl in CONTOURS:
    ls = LineString([(p[0], p[1]) for p in pl])
    n = max(2, int(ls.length / 0.75))
    for k in range(n + 1):
        q = ls.interpolate(k / n, normalized=True); _pts.append((q.x, q.y)); _zs.append(z)
# cotas da casa de A (cantos da implantação, como na Plinto) para fechar o modelo a nascente da estrada
for (u, v, z) in [(0.0, -1.33, 34.81), (15.0, -1.33, 35.82), (15.0, 8.0, 36.60), (0.0, 8.0, 34.87)]:
    _pts.append((u, v)); _zs.append(z)
_pts = np.array(_pts); _zs = np.array(_zs)
from scipy.interpolate import LinearNDInterpolator, NearestNDInterpolator
_lin = LinearNDInterpolator(_pts, _zs); _near = NearestNDInterpolator(_pts, _zs)

def natural(u, v):
    z = _lin(u, v)
    if np.isnan(z):
        z = _near(u, v)
    return float(z)

def natural_arr(U, V):
    Z = _lin(U, V); m = np.isnan(Z)
    if m.any(): Z[m] = _near(U[m], V[m])
    return Z

def road_z(u, v):
    """Estrada nova (perfil do PIP): 35,90 na ponta sul (fim da Trav. de João Pires) → 34,20 frente à garagem de A → 33,60 a norte."""
    xs, zs = [-10.0, 4.5, 17.0], [35.90, 34.20, 33.60]
    if v <= xs[0]: return zs[0] + (xs[0] - v) * 0.0
    if v >= xs[-1]: return zs[-1]
    for i in range(len(xs) - 1):
        if xs[i] <= v <= xs[i + 1]:
            t = (v - xs[i]) / (xs[i + 1] - xs[i]); return zs[i] + t * (zs[i + 1] - zs[i])

# ----------------------------------------------------------------------------- frente de B para a estrada
def road_front():
    """Linha comum B | estrada, ordenada de sul para norte."""
    inter = B.boundary.intersection(ROAD.buffer(0.15))
    segs = inter.geoms if hasattr(inter, 'geoms') else [inter]
    pts = []
    for s in segs:
        pts += list(s.coords)
    # projectar num eixo ao longo da estrada (de sul para norte = v crescente)
    pts = sorted(set((round(x, 3), round(y, 3)) for x, y in pts), key=lambda p: p[1])
    return LineString(pts)

def west_side():
    """Limite poente de B (a linha quebrada entre o canto SO e o canto NO), de sul para norte."""
    c = list(B.exterior.coords)[:-1]
    # canto NO = vértice com menor u + maior v; canto SO = vértice com menor v
    nw = max(c, key=lambda p: -p[0] * 0.3 + p[1]); sw = min(c, key=lambda p: p[1])
    # percorrer o anel de sw até nw pelo lado de menor u
    n = len(c); i0 = c.index(sw); i1 = c.index(nw)
    fwd = [c[(i0 + k) % n] for k in range((i1 - i0) % n + 1)]
    bwd = [c[(i0 - k) % n] for k in range((i0 - i1) % n + 1)]
    path = fwd if np.mean([p[0] for p in fwd]) < np.mean([p[0] for p in bwd]) else bwd
    return LineString(path)

if __name__ == '__main__':
    print('B', round(B.area, 1), 'A', round(A.area, 1), 'estrada', round(ROAD.area, 1), 'total', round(TOTAL.area, 1))
    rf = road_front(); ws = west_side()
    print('frente estrada', round(rf.length, 2), list(rf.coords)[0], list(rf.coords)[-1])
    print('lado poente', round(ws.length, 2), list(ws.coords)[0], list(ws.coords)[-1])
    for (u, v) in [list(rf.coords)[0], list(rf.coords)[-1]]:
        print('estrada em', (round(u, 1), round(v, 1)), 'z estrada', round(road_z(u, v), 2), 'z natural', round(natural(u, v), 2))
    minx, miny, maxx, maxy = B.bounds
    print('bounds B (u,v)', [round(x, 1) for x in B.bounds])
    zs = [natural(x, y) for x in np.arange(minx, maxx, 1.0) for y in np.arange(miny, maxy, 1.0) if B.contains(Point(x, y))]
    print('cota natural em B: min %.2f  max %.2f  média %.2f' % (min(zs), max(zs), np.mean(zs)))
