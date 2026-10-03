# -*- coding: utf-8 -*-
"""Peças desenhadas (SVG): divisão, implantação, plantas, cortes e alçados das duas casas."""
import math, json, base64, struct
from shapely.geometry import Polygon, LineString, Point, box as sbox, MultiPolygon
from shapely.ops import unary_union
import sitio as S
import casas as C

INK = '#1d1d1b'; POCHE = '#2a2927'; MID = '#8a867e'; LIGHT = '#c9c4ba'; PAPER = '#fbfaf7'
WATER = '#b9dde0'; DECKC = '#ebe6dc'; GREEN = '#dfe8cf'; GREEN2 = '#cddcb4'; PATH = '#e8dcc4'; ROADC = '#d4d1cb'
NC = '#3f6e8c'; SC = '#a4632a'                           # cor de B-norte / B-sul
GRAN = '#8d877c'; ROOF_BOX = '#4a4844'; ROOF_BAR = '#77746d'; ROOF_ALP = '#bdb8ae'
FONT = "font-family='Inter, Helvetica, Arial, sans-serif'"
spec = json.load(open('out/spec.json'))

class SVG:
    def __init__(self, w, h):
        self.w, self.h, self.items = int(w), int(h), [f"<rect x='0' y='0' width='{int(w)}' height='{int(h)}' fill='{PAPER}'/>"]
    def add(self, s): self.items.append(s)
    def save(self, path):
        open(path, 'w').write(f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {self.w} {self.h}' width='{self.w}' height='{self.h}' {FONT}>" + ''.join(self.items) + '</svg>')

def fmt(x): return f'{x:.1f}'
def num(x, d=2): return f'{x:.{d}f}'.replace('.', ',')
def poly_path(geom, T):
    gs = geom.geoms if hasattr(geom, 'geoms') else [geom]; d = ''
    for g in gs:
        if g.is_empty or not hasattr(g, 'exterior'): continue
        for ringc in [g.exterior] + list(g.interiors):
            pts = [T(x, y) for x, y in ringc.coords]; d += 'M' + ' L'.join(f'{fmt(a)},{fmt(b)}' for a, b in pts) + ' Z '
    return d
def line_path(pts, T): return 'M' + ' L'.join(f'{fmt(T(*p)[0])},{fmt(T(*p)[1])}' for p in pts)
def text(s, x, y, size=11, color=INK, anchor='middle', weight=400, rot=None, italic=False, halo=False):
    tr = f" transform='rotate({rot:.2f} {fmt(x)} {fmt(y)})'" if rot is not None else ''
    st = " font-style='italic'" if italic else ''
    hl = f" stroke='{PAPER}' stroke-width='3' paint-order='stroke'" if halo else ''
    return f"<text x='{fmt(x)}' y='{fmt(y)}' font-size='{size}' fill='{color}' text-anchor='{anchor}' font-weight='{weight}'{tr}{st}{hl}>{s}</text>"
def north_arrow(svg, x, y, ang_deg, r=22):
    a = math.radians(ang_deg)
    tip = (x + r * math.sin(a), y - r * math.cos(a)); tail = (x - r * 0.6 * math.sin(a), y + r * 0.6 * math.cos(a))
    left = (x + 7 * math.cos(a), y + 7 * math.sin(a)); right = (x - 7 * math.cos(a), y - 7 * math.sin(a))
    svg.add(f"<circle cx='{fmt(x)}' cy='{fmt(y)}' r='{r + 4}' fill='none' stroke='{MID}' stroke-width='0.8'/>")
    svg.add(f"<path d='M{fmt(tip[0])},{fmt(tip[1])} L{fmt(left[0])},{fmt(left[1])} L{fmt(tail[0])},{fmt(tail[1])} Z' fill='{INK}'/>")
    svg.add(f"<path d='M{fmt(tip[0])},{fmt(tip[1])} L{fmt(right[0])},{fmt(right[1])} L{fmt(tail[0])},{fmt(tail[1])} Z' fill='none' stroke='{INK}' stroke-width='1'/>")
    svg.add(text('N', x + (r + 13) * math.sin(a), y - (r + 13) * math.cos(a) + 4, 11, INK, weight=700))
def scale_bar(svg, x, y, Sc, meters=5, step=1):
    n = int(meters / step)
    for i in range(n):
        svg.add(f"<rect x='{fmt(x + i * step * Sc)}' y='{fmt(y)}' width='{fmt(step * Sc)}' height='5' fill='{INK if i % 2 == 0 else PAPER}' stroke='{INK}' stroke-width='0.8'/>")
    svg.add(text('0', x, y + 17, 9, MID)); svg.add(text(f'{meters} m', x + meters * Sc, y + 17, 9, MID))
def m2(a): return num(a, 1) + ' m²'
def dim(svg, p0, p1, off, label, size=9.5, col=INK):
    """cota alinhada entre dois pontos (já em píxeis), desviada 'off' píxeis para a esquerda do sentido p0→p1."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]; L = math.hypot(dx, dy); nx, ny = -dy / L, dx / L
    a = (p0[0] + nx * off, p0[1] + ny * off); b = (p1[0] + nx * off, p1[1] + ny * off)
    svg.add(f"<line x1='{fmt(a[0])}' y1='{fmt(a[1])}' x2='{fmt(b[0])}' y2='{fmt(b[1])}' stroke='{MID}' stroke-width='0.8'/>")
    for (q, pp) in ((a, p0), (b, p1)):
        svg.add(f"<line x1='{fmt(pp[0])}' y1='{fmt(pp[1])}' x2='{fmt(q[0] + nx * 3)}' y2='{fmt(q[1] + ny * 3)}' stroke='{LIGHT}' stroke-width='0.6'/>")
        svg.add(f"<line x1='{fmt(q[0] - 3 * (dx / L) + 3 * nx)}' y1='{fmt(q[1] - 3 * (dy / L) + 3 * ny)}' x2='{fmt(q[0] + 3 * (dx / L) - 3 * nx)}' y2='{fmt(q[1] + 3 * (dy / L) - 3 * ny)}' stroke='{INK}' stroke-width='1'/>")
    ang = math.degrees(math.atan2(dy, dx))
    if ang > 90: ang -= 180
    if ang < -90: ang += 180
    mx, my = (a[0] + b[0]) / 2 + nx * 6 * (1 if off >= 0 else -1), (a[1] + b[1]) / 2 + ny * 6 * (1 if off >= 0 else -1)
    svg.add(text(label, mx, my + 3, size, col, rot=ang, halo=True))

# ----------------------------------------------------------------------------- terreno final (do spec) e natural
_t = spec['terrain']; _H = struct.unpack('<%dh' % (_t['nu'] * _t['nv']), base64.b64decode(_t['h']))
def ground_final(u, v):
    i = round((u - _t['u0']) / _t['step']); j = round((v - _t['v0']) / _t['step'])
    i = max(0, min(_t['nu'] - 1, i)); j = max(0, min(_t['nv'] - 1, j))
    return _H[j * _t['nu'] + i] / 100 + _t['z0']

# ============================================================================ referencial "norte para cima" (ETRS89)
def site_T(S_, x0, y1, ox=20, oy=60):
    return lambda u, v: (ox + (S.l2w(u, v)[0] - x0) * S_, oy + (y1 - S.l2w(u, v)[1]) * S_)

def contours(svg, T, clip=None, labels=True):
    for z, pl in S.CONTOURS:
        ls = LineString([(p[0], p[1]) for p in pl])
        if clip is not None:
            ls = ls.intersection(clip)
            if ls.is_empty: continue
        gs = ls.geoms if hasattr(ls, 'geoms') else [ls]
        major = abs(z - round(z)) < 0.01
        for g in gs:
            if g.length < 0.5: continue
            svg.add(f"<path d='{line_path(list(g.coords), T)}' fill='none' stroke='{'#8f9c78' if major else '#bcc4aa'}' stroke-width='{0.9 if major else 0.5}'/>")
            if labels and major and g.length > 8:
                q = g.interpolate(0.5, normalized=True); q2 = g.interpolate(min(g.length, g.project(q) + 0.5))
                a, b = T(q.x, q.y), T(q2.x, q2.y); ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
                if ang > 90: ang -= 180
                if ang < -90: ang += 180
                svg.add(text(num(z, 0), a[0], a[1] + 3, 8.5, '#6f7d58', rot=ang, halo=True, weight=600))

# ============================================================================ 1. PLANTA DA DIVISÃO
def divisao(path):
    D = json.load(open('out/divisao.json'))
    allp = [S.l2w(*p) for p in list(S.TOTAL.exterior.coords)]
    xs = [p[0] for p in allp]; ys = [p[1] for p in allp]
    Sc = 12.0; x0, x1, y0, y1 = min(xs) - 6, max(xs) + 4, min(ys) - 8, max(ys) + 6
    W = (x1 - x0) * Sc + 40 + 330; Hh = (y1 - y0) * Sc + 110
    T = site_T(Sc, x0, y1, 20, 70)
    svg = SVG(W, Hh)
    Bn, Bs = C.LOT['N'], C.LOT['S']
    svg.add(f"<path d='{poly_path(S.A, T)}' fill='#f2e9cf' stroke='{MID}' stroke-width='0.8'/>")
    svg.add(f"<path d='{poly_path(S.ROAD, T)}' fill='{ROADC}' stroke='{MID}' stroke-width='0.8'/>")
    svg.add(f"<path d='{poly_path(Bn, T)}' fill='#e3ecef' stroke='none'/>")
    svg.add(f"<path d='{poly_path(Bs, T)}' fill='#f3e7da' stroke='none'/>")
    contours(svg, T, clip=S.TOTAL.buffer(6))
    for pl in S.LIMITES:
        svg.add(f"<path d='{line_path([(p[0], p[1]) for p in pl], T)}' fill='none' stroke='#c8b48f' stroke-width='0.6'/>")
    svg.add(f"<path d='{poly_path(Bn, T)}' fill='none' stroke='{NC}' stroke-width='2'/>")
    svg.add(f"<path d='{poly_path(Bs, T)}' fill='none' stroke='{SC}' stroke-width='2'/>")
    a, b = D['linha'][0], D['linha'][1]
    svg.add(f"<path d='{line_path([a, b], T)}' stroke='#b0413e' stroke-width='2.4' stroke-dasharray='12 4 3 4'/>")
    for p, lab in ((a, 'E'), (b, 'W')):
        q = T(*p); svg.add(f"<circle cx='{fmt(q[0])}' cy='{fmt(q[1])}' r='4.5' fill='#b0413e'/>")
    pa, pb = T(*a), T(*b)
    svg.add(text('E', pa[0] + 10, pa[1] - 8, 11, '#b0413e', weight=700)); svg.add(text('W', pb[0] - 12, pb[1] + 4, 11, '#b0413e', weight=700))
    dim(svg, pb, pa, 14, f"linha de divisão {num(LineString([a, b]).length)} m", col='#b0413e')
    # frentes de estrada e lados poentes
    rf = S.road_front(); ws = S.west_side()
    for P, col in ((Bn, NC), (Bs, SC)):
        f = P.boundary.intersection(S.ROAD.buffer(0.15))
        f = f if not hasattr(f, 'geoms') else max(f.geoms, key=lambda g: g.length)
        cs = list(f.coords); q0, q1 = T(*cs[0]), T(*cs[-1])
        dim(svg, q0, q1, -16 if q0[1] < q1[1] else 16, f'frente {num(P.boundary.intersection(S.ROAD.buffer(0.15)).length)} m', col=col)
        wpart = P.boundary.intersection(ws.buffer(0.15))
        wpart = wpart if not hasattr(wpart, 'geoms') else max(wpart.geoms, key=lambda g: g.length)
        cs = list(wpart.coords); q0, q1 = T(*cs[0]), T(*cs[-1])
        dim(svg, q0, q1, 16 if q0[1] < q1[1] else -16, f'poente {num(P.boundary.intersection(ws.buffer(0.15)).length)} m', col=col)
    for P, nm, col, m in ((Bn, 'B-NORTE', NC, D['norte']), (Bs, 'B-SUL', SC, D['sul'])):
        c = P.representative_point() if nm == 'B-SUL' else P.centroid
        q = T(c.x, c.y)
        if nm == 'B-SUL': q = T(-36.0, -11.0)
        svg.add(text(nm, q[0], q[1] - 8, 15, col, weight=800, halo=True))
        svg.add(text(m2(m['area']), q[0], q[1] + 10, 12.5, col, weight=600, halo=True))
        svg.add(text(f"cotas {num(m['cota_min'], 1)} – {num(m['cota_max'], 1)}", q[0], q[1] + 25, 9.5, MID, halo=True))
    q = T(*S.A.centroid.coords[0]); svg.add(text('PARCELA A · 685,20 m²', q[0], q[1], 10.5, '#8a6d2b', weight=700, halo=True))
    rq = S.ROAD.centroid; q = T(rq.x, rq.y); svg.add(text('estrada nova · 172,50 m²', q[0] + 2, q[1], 9, MID, rot=-52, halo=True))
    q = T(-8.0, -16.0); svg.add(text('Trav. de João Pires', q[0], q[1], 9.5, MID, italic=True, halo=True))
    # quadro
    qx = (x1 - x0) * Sc + 52; qy = 90
    rows = [('', 'B-norte', 'B-sul'), ('Área', m2(D['norte']['area']), m2(D['sul']['area'])),
            ('Frente para a estrada', num(D['norte']['frente_estrada']) + ' m', num(D['sul']['frente_estrada']) + ' m'),
            ('Lado poente', num(D['norte']['lado_poente']) + ' m', num(D['sul']['lado_poente']) + ' m'),
            ('Cota mín. – máx.', f"{num(D['norte']['cota_min'], 1)} – {num(D['norte']['cota_max'], 1)}", f"{num(D['sul']['cota_min'], 1)} – {num(D['sul']['cota_max'], 1)}"),
            ('Cota média', num(D['norte']['cota_media']), num(D['sul']['cota_media'])),
            ('Declive médio', num(D['norte']['declive_medio_pct'], 1) + ' %', num(D['sul']['declive_medio_pct'], 1) + ' %'),
            ('Estrada à frente', '33,6 – 34,3', '34,3 – 35,9'),
            ('Forma', 'larga', 'comprida')]
    for i, (k, n_, s_) in enumerate(rows):
        y = qy + i * 21
        if i == 0:
            svg.add(text('B-norte', qx + 205, y, 10.5, NC, weight=700)); svg.add(text('B-sul', qx + 282, y, 10.5, SC, weight=700)); continue
        svg.add(f"<line x1='{fmt(qx)}' y1='{fmt(y - 14)}' x2='{fmt(qx + 312)}' y2='{fmt(y - 14)}' stroke='{LIGHT}' stroke-width='0.6'/>")
        svg.add(text(k, qx, y, 10, INK, anchor='start')); svg.add(text(n_, qx + 205, y, 10, INK)); svg.add(text(s_, qx + 282, y, 10, INK))
    y = qy + len(rows) * 21 + 10
    LE, LW = D['linha_etrs'][0], D['linha_etrs'][1]
    for i, s in enumerate(['Pontos da linha (ETRS89 / PT-TM06):', f'E (estrada) M {num(LE[0])}  P {num(LE[1])}', f'W (poente)  M {num(LW[0])}  P {num(LW[1])}',
                           'Regra: áreas iguais e frentes iguais.', 'Cotas: curvas do levantamento (0,20 m).']):
        svg.add(text(s, qx, y + i * 16, 9.5, INK if i in (0, 3) else MID, anchor='start', weight=600 if i in (0, 3) else 400))
    svg.add(text('DIVISÃO DA ÁREA RESULTANTE B EM DOIS LOTES', 18, 26, 14, INK, anchor='start', weight=700))
    svg.add(text('1 635,5 m² → 817,8 + 817,8 m² · uma linha reta da estrada nova ao limite poente', 18, 44, 10.5, MID, anchor='start'))
    north_arrow(svg, (x1 - x0) * Sc - 10, 60, 0)
    scale_bar(svg, 30, Hh - 26, Sc, 10, 2)
    svg.save(path)

# ============================================================================ 2. IMPLANTAÇÃO
def house_poly_world(H, g): return H.polyL(g)
def implantacao(path):
    allp = [S.l2w(*p) for p in list(S.TOTAL.exterior.coords)]
    xs = [p[0] for p in allp]; ys = [p[1] for p in allp]
    Sc = 13.0; x0, x1, y0, y1 = min(xs) - 5, max(xs) - 18, min(ys) - 6, max(ys) + 4
    W = (x1 - x0) * Sc + 40; Hh = (y1 - y0) * Sc + 100
    T = site_T(Sc, x0, y1, 20, 64)
    svg = SVG(W, Hh)
    svg.add(f"<path d='{poly_path(S.A, T)}' fill='#f2e9cf' stroke='{MID}' stroke-width='0.8'/>")
    svg.add(f"<path d='{poly_path(S.ROAD, T)}' fill='{ROADC}' stroke='{MID}' stroke-width='0.8'/>")
    for H, col in ((C.N, NC), (C.SH, SC)):
        svg.add(f"<path d='{poly_path(H.lot, T)}' fill='{GREEN}' stroke='none'/>")
    contours(svg, T, clip=S.B, labels=False)
    for H, col in ((C.N, NC), (C.SH, SC)):
        L = lambda g: poly_path(H.polyL(g), T)
        svg.add(f"<path d='{L(H.forecourt.intersection(Polygon([H.L2H(*p) for p in H.lot.exterior.coords])))}' fill='#e8e0cf' stroke='{MID}' stroke-width='0.5'/>")
        svg.add(f"<path d='{L(H.deck)}' fill='{DECKC}' stroke='{MID}' stroke-width='0.6'/>")
        svg.add(f"<path d='{L(H.terrace)}' fill='#e2dccf' stroke='{MID}' stroke-width='0.5'/>")
        svg.add(f"<path d='{L(sbox(*H.pool))}' fill='{WATER}' stroke='{INK}' stroke-width='0.8'/>")
        svg.add(f"<path d='{L(sbox(0, -0.9, C.BAR['L'], C.BAR['W']))}' fill='{ROOF_BAR}' stroke='{INK}' stroke-width='0.9'/>")
        svg.add(f"<path d='{L(H.box_poly)}' fill='{ROOF_BOX}' stroke='{INK}' stroke-width='1'/>")
        svg.add(f"<path d='{L(H.alp)}' fill='{ROOF_ALP}' stroke='{INK}' stroke-width='0.8'/>")
        svg.add(f"<path d='{L(unary_union([H.car, H.store]))}' fill='{ROOF_ALP}' stroke='{INK}' stroke-width='0.8'/>")
        # afastamentos de 3 m
        svg.add(f"<path d='{poly_path(H.lot.buffer(-3.0, join_style=2), T)}' fill='none' stroke='{col}' stroke-width='0.8' stroke-dasharray='4 3'/>")
        svg.add(f"<path d='{poly_path(H.lot, T)}' fill='none' stroke='{col}' stroke-width='1.8'/>")
        # etiquetas de cotas
        c = H.polyL(H.box_poly).centroid; q = T(c.x, c.y)
        svg.add(text('caixa alta', q[0], q[1] - 6, 8.5, '#f1efea', weight=600)); svg.add(text('topo ' + num(H.F + C.BOX_TOP), q[0], q[1] + 6, 8.5, '#f1efea'))
        c = H.polyL(sbox(0, 0, C.BAR['L'], C.BAR['W'])).centroid; q = T(c.x, c.y)
        svg.add(text('ala dos quartos · R/C ' + num(H.F), q[0], q[1] - 2, 8.5, '#ffffff', weight=600, rot=-(H.ang_deg + S.ANG_DEG)))
        svg.add(text('topo ' + num(H.F + C.BAR_TOP), q[0], q[1] + 9, 8, '#f1efea', rot=-(H.ang_deg + S.ANG_DEG)))
        c = H.polyL(sbox(*H.pool)).centroid; q = T(c.x, c.y)
        svg.add(text('piscina', q[0], q[1] + 3, 8, '#2f6f74', weight=600, rot=-(H.ang_deg + S.ANG_DEG)))
        c = H.polyL(H.alp).centroid; q = T(c.x, c.y); svg.add(text('alpendre', q[0], q[1] + 3, 7.5, INK, rot=-(H.ang_deg + S.ANG_DEG)))
        c = H.polyL(H.car).centroid; q = T(c.x, c.y); svg.add(text('alpendre', q[0], q[1] - 3, 7.5, INK, rot=-(H.ang_deg + S.ANG_DEG))); svg.add(text('2 carros · ' + num(H.C), q[0], q[1] + 7, 7.5, INK, rot=-(H.ang_deg + S.ANG_DEG)))
    # muros e sebes (do spec)
    for p in spec['site']['prisms']:
        if p['t'] != 'wall': continue
        svg.add(f"<path d='{poly_path(Polygon(p['p']), T)}' fill='{GRAN}' stroke='none'/>")
    for hd in spec['hedges']:
        a, b = T(*hd['a']), T(*hd['b'])
        svg.add(f"<line x1='{fmt(a[0])}' y1='{fmt(a[1])}' x2='{fmt(b[0])}' y2='{fmt(b[1])}' stroke='#7f9a63' stroke-opacity='0.75' stroke-width='{fmt(hd['w'] * Sc * 0.8)}' stroke-linecap='round'/>")
    cols = {'pine': '#6c8a4f', 'euc': '#8a9a78', 'oak': '#7d9a5c', 'olive': '#a7b08f', 'arbutus': '#5f844a', 'fruit': '#8eaa63', 'cypress': '#4e6b45'}
    for kind, u, v, h, d in spec['trees']:
        q = T(u, v)
        if not (0 < q[0] < W and 50 < q[1] < Hh - 30): continue
        if not S.TOTAL.buffer(6).contains(Point(u, v)): continue
        svg.add(f"<circle cx='{fmt(q[0])}' cy='{fmt(q[1])}' r='{fmt(d / 2 * Sc)}' fill='{cols[kind]}' fill-opacity='0.45' stroke='{cols[kind]}' stroke-width='0.8'/>")
    D = json.load(open('out/divisao.json'))
    svg.add(f"<path d='{line_path(D['linha'], T)}' stroke='#b0413e' stroke-width='1.4' stroke-dasharray='10 4 2 4'/>")
    for H, nm, col, q in ((C.N, 'CASA DO PÁTIO · B-norte', NC, (-40.0, 19.5)), (C.SH, 'CASA COMPRIDA · B-sul', SC, (-40.0, -19.5))):
        p = T(*q); svg.add(text(nm, p[0], p[1], 11, col, weight=800, halo=True))
    for H, (dx, dy) in ((C.N, (0, -16)), (C.SH, (0, 18))):
        gx, gy = H.gate_pt if hasattr(H, 'gate_pt') else (None, None)
    q = T(-14.0, 12.0); svg.add(text('portão ' + num(C.N.gate), q[0] + 8, q[1], 8.5, NC, anchor='start', weight=600, halo=True))
    q = T(*C.SH.H2L(24.0, 8.0)); svg.add(text('portão ' + num(C.SH.gate), q[0] + 10, q[1] + 4, 8.5, SC, anchor='start', weight=600, halo=True))
    q = T(4.5, 3.0); svg.add(text('casa de A', q[0], q[1], 10, '#8a6d2b', weight=700, halo=True)); svg.add(text('R/C 37,00', q[0], q[1] + 12, 9, '#8a6d2b', halo=True))
    svg.add(f"<path d='{poly_path(Polygon([(0, -1.34), (15, -1.34), (15, 8), (0, 8)]), T)}' fill='none' stroke='#8a6d2b' stroke-width='1' stroke-dasharray='3 2'/>")
    svg.add(text('IMPLANTAÇÃO DAS DUAS CASAS', 18, 24, 14, INK, anchor='start', weight=700))
    svg.add(text('tracejado fino: afastamento de 3 m aos limites · muros de granito a cinzento · sebes a verde', 18, 41, 10.5, MID, anchor='start'))
    north_arrow(svg, W - 46, 52, 0)
    scale_bar(svg, 30, Hh - 24, Sc, 10, 2)
    svg.save(path)



# ============================================================================ 3. PLANTAS DAS CASAS
DASH = " stroke-dasharray='3 2'"
def furn_boxes(H):
    g = [g for g in spec['groups'] if g['n'] == H.key][0]
    return [b for b in g['boxes'] if b.get('t') == 'furn']

LABEL_POS = {
    'N': {'Cozinha · jantar': (17.6, 2.6), 'Galeria': (7.4, 5.1), 'Degraus': None, 'WC social': (19.75, 10.05 - 5.6 + 0.65), 'Lavandaria · despensa': (19.75, 8.95 - 5.6 - 0.3)},
    'S': {'Cozinha · jantar': (-3.6, 1.6), 'Galeria': (7.4, 5.1), 'Degraus': None, 'WC social': (-2.75, 4.0), 'Lavandaria · despensa': (-4.25, 4.0)},
}
SHORT = {'Lavandaria · despensa': 'Lavand. · desp.', 'Arrumos · técnica': 'Arrumos · técnica'}

def plan(H, path, phase2=False):
    if H.key == 'N':
        xmin, xmax, ymin, ymax, Sc = -2.0, 32.4, -10.4, 10.2, 38.0
    else:
        xmin, xmax, ymin, ymax, Sc = -27.4, 27.6, -8.0, 10.6, 30.0
    W = (xmax - xmin) * Sc + 40; Hh = (ymax - ymin) * Sc + 110
    T = lambda x, y: (20 + (x - xmin) * Sc, 70 + (ymax - y) * Sc)
    svg = SVG(W, Hh)
    view = sbox(xmin, ymin, xmax, ymax)
    lotH = Polygon([H.L2H(*p) for p in H.lot.exterior.coords]).buffer(0)
    svg.add(f"<path d='{poly_path(lotH.intersection(view), T)}' fill='{GREEN}' stroke='none'/>")
    roadH = Polygon([H.L2H(*p) for p in S.ROAD.exterior.coords]).buffer(0)
    svg.add(f"<path d='{poly_path(roadH.intersection(view), T)}' fill='{ROADC}' stroke='{MID}' stroke-width='0.6'/>")
    rq = roadH.intersection(view)
    if not rq.is_empty:
        c = rq.representative_point(); q = T(c.x, c.y); svg.add(text('estrada nova', q[0], q[1], 9, MID, rot=-70 if H.key == 'N' else -84, italic=True))
    lb = lotH.exterior.intersection(view)
    for g in (lb.geoms if hasattr(lb, 'geoms') else [lb]):
        if g.length > 0.1: svg.add(f"<path d='{line_path(list(g.coords), T)}' fill='none' stroke='{NC if H.key == 'N' else SC}' stroke-width='1.6' stroke-dasharray='12 4 2 4'/>")
    # muros do sítio e sebes
    for p in spec['site']['prisms']:
        if p['t'] != 'wall': continue
        g = Polygon([H.L2H(*q) for q in p['p']]).buffer(0)
        if g.intersects(view): svg.add(f"<path d='{poly_path(g.intersection(view), T)}' fill='{GRAN}' stroke='none'/>")
    for hd in spec['hedges']:
        a, b = H.L2H(*hd['a']), H.L2H(*hd['b']); ls = LineString([a, b]).intersection(view)
        if ls.is_empty: continue
        for g in (ls.geoms if hasattr(ls, 'geoms') else [ls]):
            cs = list(g.coords); qa, qb = T(*cs[0]), T(*cs[-1])
            svg.add(f"<line x1='{fmt(qa[0])}' y1='{fmt(qa[1])}' x2='{fmt(qb[0])}' y2='{fmt(qb[1])}' stroke='#9db586' stroke-opacity='0.8' stroke-width='{fmt(hd['w'] * Sc)}' stroke-linecap='round'/>")
    # exteriores
    fc = H.forecourt.intersection(lotH)
    svg.add(f"<path d='{poly_path(fc, T)}' fill='#ece4d3' stroke='{MID}' stroke-width='0.6'/>")
    if H.key == 'N': svg.add(f"<path d='{poly_path(H.path, T)}' fill='#ece4d3' stroke='{MID}' stroke-width='0.6'/>")
    svg.add(f"<path d='{poly_path(H.deck, T)}' fill='{DECKC}' stroke='{MID}' stroke-width='0.7'/>")
    svg.add(f"<path d='{poly_path(H.alp, T)}' fill='#e4ded2' stroke='{MID}' stroke-width='0.7'/>")
    svg.add(f"<path d='{poly_path(H.terrace, T)}' fill='#e6e0d4' stroke='{MID}' stroke-width='0.6'/>")
    pool = sbox(*H.pool)
    svg.add(f"<path d='{poly_path(pool.buffer(0.30, join_style=2).difference(pool), T)}' fill='#ded8cc' stroke='{MID}' stroke-width='0.6'/>")
    svg.add(f"<path d='{poly_path(pool, T)}' fill='{WATER}' stroke='{INK}' stroke-width='1.1'/>")
    c = pool.centroid; q = T(c.x, c.y)
    svg.add(text(f"PISCINA {num(H.pool[2] - H.pool[0])} × {num(H.pool[3] - H.pool[1])}", q[0], q[1] - 2, 10.5, '#2f6f74', weight=600))
    svg.add(text(f"água a {num(H.Sz - 0.06)} · prof. 1,40", q[0], q[1] + 11, 8.5, '#2f6f74'))
    st = H.steps_out
    for k in range(4):
        y = -1.0 - k * 0.27; a, b = T(st['x0'], y), T(st['x1'], y)
        svg.add(f"<line x1='{fmt(a[0])}' y1='{fmt(a[1])}' x2='{fmt(b[0])}' y2='{fmt(b[1])}' stroke='{MID}' stroke-width='0.7'/>")
    # alpendre de estacionamento + arrumos
    svg.add(f"<path d='{poly_path(H.car, T)}' fill='#ebe7df' stroke='{MID}' stroke-width='0.7'/>")
    # paredes cortadas (poché) com vãos
    walls = unary_union([sbox(*w['r']) for w in H.walls if w['ext'] not in ('col',)])
    ops = unary_union([sbox(*o['r']) for o in H.open])
    stone = unary_union([sbox(*w['r']) for w in H.walls if w['ext'] == 'stone'])
    svg.add(f"<path d='{poly_path(walls.difference(ops).difference(stone), T)}' fill='{POCHE}' stroke='none'/>")
    svg.add(f"<path d='{poly_path(stone, T)}' fill='{GRAN}' stroke='{INK}' stroke-width='0.6'/>")
    for w in H.walls:
        if w['ext'] == 'col': svg.add(f"<path d='{poly_path(sbox(*w['r']), T)}' fill='{INK}'/>")
    # projeções: lajes dos alpendres e pala
    for g in (H.alp, H.car.union(H.store), sbox(0, -0.9, C.BAR['L'], 0)):
        svg.add(f"<path d='{poly_path(g, T)}' fill='none' stroke='{INK}' stroke-width='0.8' stroke-dasharray='9 4 2 4'/>")
    # vãos
    for o in H.open:
        a0, b0, a1, b1 = o['r']; k = o['k']; along_x = (a1 - a0) >= (b1 - b0)
        if k == 'pass': continue
        if k == 'door':
            sw = o.get('sw', '-y')
            if along_x:
                ym = (b0 + b1) / 2; w = a1 - a0; d = -1 if sw in ('-y', 'C') else 1
                p0, p1, p2 = T(a0, ym), T(a0, ym + d * w), T(a1, ym)
            else:
                xm = (a0 + a1) / 2; w = b1 - b0; d = 1 if sw in ('+x',) else -1
                p0, p1, p2 = T(xm, b0), T(xm + d * w, b0), T(xm, b1)
            svg.add(f"<line x1='{fmt(p0[0])}' y1='{fmt(p0[1])}' x2='{fmt(p1[0])}' y2='{fmt(p1[1])}' stroke='{INK}' stroke-width='1.1'/>")
            r = w * Sc; sweep = 1 if (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]) > 0 else 0
            svg.add(f"<path d='M{fmt(p1[0])},{fmt(p1[1])} A{fmt(r)},{fmt(r)} 0 0 {sweep} {fmt(p2[0])},{fmt(p2[1])}' fill='none' stroke='{MID}' stroke-width='0.6'/>")
            continue
        x0, y0 = T(a0, b1); x1, y1 = T(a1, b0)
        svg.add(f"<rect x='{fmt(x0)}' y='{fmt(y0)}' width='{fmt(x1 - x0)}' height='{fmt(y1 - y0)}' fill='{PAPER}' stroke='{INK}' stroke-width='0.6'/>")
        high = o['z'][0] > H.F + 1.0
        if along_x:
            ym = (y0 + y1) / 2
            if k.startswith('slide'):
                svg.add(f"<line x1='{fmt(x0)}' y1='{fmt(ym - 2)}' x2='{fmt((x0 + x1) / 2 + 6)}' y2='{fmt(ym - 2)}' stroke='{INK}' stroke-width='1.3'/>")
                svg.add(f"<line x1='{fmt((x0 + x1) / 2 - 6)}' y1='{fmt(ym + 2)}' x2='{fmt(x1)}' y2='{fmt(ym + 2)}' stroke='{INK}' stroke-width='1.3'/>")
            elif k == 'entry':
                svg.add(f"<line x1='{fmt(x0 + 3)}' y1='{fmt(ym)}' x2='{fmt(x1 - 3)}' y2='{fmt(ym)}' stroke='#8a5a2b' stroke-width='3.5'/>")
            else:
                svg.add(f"<line x1='{fmt(x0)}' y1='{fmt(ym)}' x2='{fmt(x1)}' y2='{fmt(ym)}' stroke='{INK}' stroke-width='1'{DASH if high else ''}/>")
        else:
            xm = (x0 + x1) / 2
            if k.startswith('slide'):
                svg.add(f"<line x1='{fmt(xm - 2)}' y1='{fmt(y0)}' x2='{fmt(xm - 2)}' y2='{fmt((y0 + y1) / 2 + 6)}' stroke='{INK}' stroke-width='1.3'/>")
                svg.add(f"<line x1='{fmt(xm + 2)}' y1='{fmt((y0 + y1) / 2 - 6)}' x2='{fmt(xm + 2)}' y2='{fmt(y1)}' stroke='{INK}' stroke-width='1.3'/>")
            elif k == 'entry':
                svg.add(f"<line x1='{fmt(xm)}' y1='{fmt(y0 + 3)}' x2='{fmt(xm)}' y2='{fmt(y1 - 3)}' stroke='#8a5a2b' stroke-width='3.5'/>")
            else:
                svg.add(f"<line x1='{fmt(xm)}' y1='{fmt(y0)}' x2='{fmt(xm)}' y2='{fmt(y1)}' stroke='{INK}' stroke-width='1'{DASH if high else ''}/>")
        if o['n'] not in ('p',):
            cx = (x0 + x1) / 2; cy = (y0 + y1) / 2
            ox = 0 if along_x else (14 if (a0 + a1) / 2 > 0 else -14); oy = (14 if (b0 + b1) / 2 < 2 else -10) if along_x else 3
            svg.add(text(o['n'], cx + ox, cy + oy, 7.5, '#7a6a55', weight=600))
    # degraus interiores
    for (x0, y0, x1, y1, zt) in H.steps_in:
        svg.add(f"<path d='{poly_path(sbox(x0, y0, x1, y1), T)}' fill='none' stroke='{MID}' stroke-width='0.7'/>")
    # mobiliário (do modelo)
    for b in furn_boxes(H):
        x0, y0, z0 = b['a']; x1, y1, z1 = b['b']
        if z1 - z0 < 0.05 and b['m'] != 'rug': continue
        if b['m'] == 'car':
            svg.add(f"<path d='{poly_path(sbox(x0, y0, x1, y1), T)}' fill='none' stroke='{LIGHT}' stroke-width='0.9'/>"); continue
        svg.add(f"<path d='{poly_path(sbox(x0, y0, x1, y1), T)}' fill='none' stroke='{MID}' stroke-width='0.6'/>")
    # loiças (esquemático)
    for (x, y) in [(5.4, 3.6), (10.5, 3.6), (5.4, 0.9), (10.5, 0.9)]:
        q = T(x, y); svg.add(f"<ellipse cx='{fmt(q[0])}' cy='{fmt(q[1])}' rx='{fmt(0.22 * Sc)}' ry='{fmt(0.28 * Sc)}' fill='none' stroke='{MID}' stroke-width='0.7'/>")
    # etiquetas dos compartimentos
    lp = LABEL_POS[H.key]
    for r in H.rooms:
        if r['n'] in lp and lp[r['n']] is None: continue
        pos = lp.get(r['n'])
        if pos is None:
            c = r['g'].representative_point() if r['n'] not in ('Sala',) else r['g'].centroid; pos = (c.x, c.y)
            if r['n'].startswith('Quarto') or r['n'] == 'Suite': pos = (c.x, 1.2)
            if r['n'].startswith('WC') and r['n'] != 'WC social': pos = (c.x, 2.5)
        q = T(*pos); a = r['g'].area; nm = SHORT.get(r['n'], r['n'])
        small = a < 8 or r['n'].startswith('WC')
        rot = -90 if ((r['n'].startswith('WC') and r['n'] != 'WC social') or (H.key == 'S' and r['n'] in ('WC social', 'Lavandaria · despensa'))) else None
        svg.add(text(nm, q[0], q[1], 8.5 if small else 11, INK, weight=600, rot=rot, halo=True))
        if rot is None: svg.add(text(m2(a), q[0], q[1] + (10 if small else 13), 8 if small else 9.5, MID, halo=True))
        else: svg.add(text(m2(a), q[0] + 11, q[1], 8, MID, rot=-90, halo=True))
    # níveis
    def lvl(x, y, z, lab=None):
        q = T(x, y)
        svg.add(f"<path d='M{fmt(q[0])},{fmt(q[1])} l-5,-7 l10,0 Z' fill='{INK}'/>")
        svg.add(text(('+' + num(z)) if lab is None else lab, q[0] + 8, q[1] - 1, 8.5, INK, anchor='start', weight=600, halo=True))
    f = H.box_f
    lvl(*f(3.2, 3.2), H.Sz); lvl(*(f(5.6, 6.4) if H.key == 'N' else f(1.6, 6.2)), H.F); lvl(7.0, -0.5, H.F)
    ax0, ay0, ax1, ay1 = H.alp.bounds; lvl((ax0 + ax1) / 2, ay0 + 0.6, H.Sz)
    cx0, cy0, cx1, cy1 = H.car.bounds; lvl(cx1 - 1.0, cy0 + 0.8, H.C)
    # legendas exteriores
    q = T((ax0 + ax1) / 2, (ay0 + ay1) / 2 + 0.6); svg.add(text('ALPENDRE', q[0], q[1], 9.5, INK, weight=600)); svg.add(text(m2(H.alp.area), q[0], q[1] + 11, 8.5, MID))
    if phase2:
        svg.add(f"<path d='{poly_path(H.alp.buffer(-0.06, join_style=2), T)}' fill='none' stroke='#b0413e' stroke-width='2' stroke-dasharray='6 3'/>")
        svg.add(text('Fase 2: fecha → escritório / estúdio', q[0], q[1] + 24, 8.5, '#b0413e', weight=600, halo=True))
    q = T((cx0 + cx1) / 2 + 0.6, (cy0 + cy1) / 2 + 0.4); svg.add(text('ALPENDRE · 2 CARROS', q[0], q[1], 9.5, INK, weight=600, halo=True)); svg.add(text(m2(H.car.difference(H.store).area), q[0], q[1] + 11, 8.5, MID, halo=True))
    dk = H.deck.difference(pool).difference(H.alp).centroid
    q = T(H.pool[0] + 1.2, H.pool[1] - 0.8) if H.key == 'N' else T(H.pool[0] + 2.0, H.pool[1] - 0.7)
    svg.add(text('DECK +' + num(H.Sz), q[0], q[1], 8.5, MID, anchor='start', weight=600))
    q = T(2.0, -0.55); svg.add(text('terraço dos quartos', q[0], q[1] + 3, 8, MID, anchor='start', italic=True))
    if H.key == 'N':
        q = T(5.0, -9.3); svg.add(text('PÁTIO · relvado e oliveiras', q[0], q[1], 9.5, '#56663e', weight=600, halo=True))
        q = T(18.0, 7.1); svg.add(text('rampa 1:16 → porta', q[0], q[1] + 3, 8, MID, italic=True, halo=True))
        q = T(27.6, 6.2); svg.add(text('pátio de entrada', q[0], q[1], 8.5, MID, italic=True, halo=True))
        q = T(-1.2, 8.6); svg.add(text('mata a norte', q[0], q[1], 8.5, '#56663e', anchor='start', italic=True))
        q = T(8.0, -10.0); svg.add(text('muro de meação 1,80 + sebe · Casa Comprida', q[0] + 140, q[1] + 6, 8.5, MID, italic=True, halo=True))
    else:
        q = T(5.5, -5.0); svg.add(text('JARDIM SUL DOS QUARTOS · relvado, oliveiras', q[0], q[1], 9.5, '#56663e', weight=600, halo=True))
        q = T(-21.0, -2.4); svg.add(text('jardim poente', q[0], q[1], 9.5, '#56663e', weight=600, halo=True))
        q = T(23.6, 7.6); svg.add(text('rampa do portão', q[0], q[1], 8.5, MID, italic=True, halo=True))
        q = T(14.9, 3.2); svg.add(text('entrada · 2 degraus', q[0], q[1], 8, MID, rot=-90, italic=True, halo=True))
        q = T(4.0, 9.6); svg.add(text('muro de meação 1,80 + sebe · Casa do Pátio', q[0], q[1], 8.5, MID, italic=True, halo=True))
    # cotas
    def dh(x0, x1, y, off, lab=None):
        a, b = T(x0, y), T(x1, y); dim(svg, a, b, off, lab or num(x1 - x0))
    def dv(y0, y1, x, off, lab=None):
        a, b = T(x, y0), T(x, y1); dim(svg, a, b, off, lab or num(y1 - y0))
    dh(0, C.BAR['L'], C.BAR['W'], -26 if H.key == 'N' else -18)
    bx0, by0, bx1, by1 = H.box_poly.bounds
    if H.key == 'N':
        dh(bx0, bx1, by1, -26); dv(by0, by1, bx1, -34); dv(0, C.BAR['W'], 0, 24)
    else:
        dh(bx0, bx1, by1, -18); dv(by0, by1, bx0, 24); dv(0, C.BAR['W'], C.BAR['L'], -40)
    # título
    nm = 'CASA DO PÁTIO · lote B-norte' if H.key == 'N' else 'CASA COMPRIDA · lote B-sul'
    svg.add(text(f'PLANTA DO R/C — {nm}', 18, 26, 14, INK, anchor='start', weight=700))
    A_ = C.areas(H)
    svg.add(text(f"T3 · área bruta {m2(A_['abc'])} · útil {m2(A_['util'])} · quartos e cozinha a +{num(H.F)}, sala e deck a +{num(H.Sz)} (3 degraus)", 18, 44, 10.5, MID, anchor='start'))
    north_arrow(svg, W - 52, 54, S.ANG_DEG + H.ang_deg)
    scale_bar(svg, 30, Hh - 26, Sc, 5)
    svg.save(path)

if __name__ == '__main__':
    divisao('out/divisao.svg'); implantacao('out/implantacao.svg')
    plan(C.N, 'out/planta_patio.svg', phase2=True); plan(C.SH, 'out/planta_comprida.svg', phase2=True)
    print('ok')
