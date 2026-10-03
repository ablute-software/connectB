import numpy as np, math
from shapely.geometry import box, Point
from shapely.prepared import prep
import sitio as S
from divisao import cut, rf, ws
from scipy.optimize import brentq
def bigrect(P, setback=3.0, front=4.0):
    inner = P.buffer(-setback, join_style=2).difference(S.ROAD.buffer(front))
    pin = prep(inner); minx, miny, maxx, maxy = inner.bounds; best = (0, None)
    for w in np.arange(10, 34, 1.0):
        for h in np.arange(8, 26, 1.0):
            if w * h <= best[0]: continue
            done = False
            for x in np.arange(minx, maxx - w + 0.01, 0.5):
                for y in np.arange(miny, maxy - h + 0.01, 0.5):
                    if pin.contains(box(x, y, x + w, y + h)): best = (w * h, (w, h)); done = True; break
                if done: break
    return best
for t in np.arange(0.30, 0.76, 0.05):
    try:
        s = brentq(lambda s: cut(t, s)[0].area - S.B.area / 2, 0.05, 0.95, xtol=1e-5)
    except Exception as e:
        print(t, 'no'); continue
    Bs, Bn, L = cut(t, s)
    fN = Bn.boundary.intersection(S.ROAD.buffer(0.15)).length; fS = Bs.boundary.intersection(S.ROAD.buffer(0.15)).length
    wN = Bn.boundary.intersection(ws.buffer(0.15)).length; wS = Bs.boundary.intersection(ws.buffer(0.15)).length
    rN, rS = bigrect(Bn), bigrect(Bs)
    print(f't={t:.2f} s={s:.3f} frente N/S {fN:5.1f}/{fS:5.1f}  poente N/S {wN:5.1f}/{wS:5.1f}  ret N {rN}  ret S {rS}')
