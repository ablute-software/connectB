# -*- coding: utf-8 -*-
"""Divisão justa de B em B-norte e B-sul: uma linha reta da frente da estrada nova ao limite poente,
com áreas iguais e frentes de estrada iguais. Escreve out/divisao.json."""
import json, math, os
import numpy as np
from shapely.geometry import Polygon, LineString, Point, box
from shapely.ops import split
from scipy.optimize import brentq
import sitio as S

rf, ws = S.road_front(), S.west_side()

def cut(t, s):
    a = rf.interpolate(t, normalized=True); b = ws.interpolate(s, normalized=True)
    d = np.array([b.x - a.x, b.y - a.y]); d /= np.linalg.norm(d)
    L = LineString([(a.x - d[0] * 5, a.y - d[1] * 5), (b.x + d[0] * 5, b.y + d[1] * 5)])
    parts = sorted(split(S.B, L).geoms, key=lambda g: g.centroid.y)
    return parts[0], parts[-1], LineString([(a.x, a.y), (b.x, b.y)])

def solve(t=0.5):
    f = lambda s: cut(t, s)[0].area - S.B.area / 2
    s = brentq(f, 0.2, 0.8, xtol=1e-6)
    return s

def lot_metrics(P, name):
    front = P.boundary.intersection(S.ROAD.buffer(0.15)).length
    west = P.boundary.intersection(ws.buffer(0.15)).length
    # cotas
    minx, miny, maxx, maxy = P.bounds
    g = [(x, y) for x in np.arange(minx + 0.25, maxx, 0.5) for y in np.arange(miny + 0.25, maxy, 0.5) if P.contains(Point(x, y))]
    Z = np.array([S.natural(x, y) for x, y in g])
    # declive médio (gradiente por diferenças finitas)
    grads = []
    for x, y in g[::7]:
        gx = (S.natural(x + 0.5, y) - S.natural(x - 0.5, y)); gy = (S.natural(x, y + 0.5) - S.natural(x, y - 0.5))
        grads.append(math.hypot(gx, gy))
    # área "boa" para construir: afastada 3 m dos limites e 5 m da estrada, com declive < 8 %
    inner = P.buffer(-3.0, join_style=2).difference(S.ROAD.buffer(5.0))
    # maior retângulo alinhado com u/v dentro de inner (pesquisa em grelha)
    best = (0, None)
    xs = np.arange(minx, maxx, 0.5); ys = np.arange(miny, maxy, 0.5)
    from shapely.prepared import prep
    pin = prep(inner)
    for w in np.arange(10, 30.5, 1.0):
        for h in np.arange(8, 22.5, 1.0):
            if w * h <= best[0]: continue
            ok = False
            for x in xs:
                for y in ys:
                    if pin.contains(box(x, y, x + w, y + h)):
                        best = (w * h, (round(x, 1), round(y, 1), round(x + w, 1), round(y + h, 1))); ok = True; break
                if ok: break
    dA = Point(7.5, 3.3).distance(P.centroid)
    return dict(nome=name, area=round(P.area, 1), frente_estrada=round(front, 2), lado_poente=round(west, 2),
                cota_min=round(Z.min(), 2), cota_max=round(Z.max(), 2), cota_media=round(Z.mean(), 2),
                declive_medio_pct=round(100 * np.mean(grads), 1), area_edificavel=round(inner.area, 1),
                maior_retangulo=best[1], maior_retangulo_m2=best[0], dist_casa_A=round(dA, 1),
                estrada_z=[round(S.road_z(*c), 2) for c in [list(P.boundary.intersection(S.ROAD.buffer(0.15)).coords)[0]]] if front else None)

if __name__ == '__main__':
    os.makedirs('out', exist_ok=True)
    t = 0.5; s = solve(t)
    Bs, Bn, L = cut(t, s)
    a, b = L.coords[0], L.coords[1]
    print('linha: estrada', [round(x, 2) for x in a], '→ poente', [round(x, 2) for x in b], 'comprimento', round(L.length, 2),
          'rumo local', round(math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])), 1))
    print('fração no lado poente (de sul)', round(s, 3))
    mN, mS = lot_metrics(Bn, 'B-norte'), lot_metrics(Bs, 'B-sul')
    for m in (mN, mS): print(m)
    out = dict(t=t, s=s, linha=[list(map(lambda x: round(x, 3), a)), list(map(lambda x: round(x, 3), b))],
               linha_etrs=[list(map(lambda x: round(x, 3), S.l2w(*a))), list(map(lambda x: round(x, 3), S.l2w(*b)))],
               norte=mN, sul=mS,
               Bn=[[round(x, 3), round(y, 3)] for x, y in Bn.exterior.coords],
               Bs=[[round(x, 3), round(y, 3)] for x, y in Bs.exterior.coords])
    json.dump(out, open('out/divisao.json', 'w'), indent=1, ensure_ascii=False)
