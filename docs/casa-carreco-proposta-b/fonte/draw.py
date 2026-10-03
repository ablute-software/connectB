# -*- coding: utf-8 -*-
"""Peças desenhadas (SVG) da Casa Plinto a partir de geom.py: plantas, implantação, cortes e alçados."""
import math
from shapely.geometry import Polygon, LineString, Point, box as sbox, MultiPolygon
from shapely.ops import unary_union
import geom as G
from geom import E, I

INK = '#1d1d1b'; POCHE = '#2a2927'; MID = '#8a867e'; LIGHT = '#c9c4ba'; PAPER = '#fbfaf7'
WATER = '#b9dde0'; DECKC = '#ebe6dc'; GREEN = '#d7e2c4'; GREEN2 = '#c3d3a8'; PATH = '#e8dcc4'; ROADC = '#d4d1cb'
FONT = "font-family='Inter, Helvetica, Arial, sans-serif'"

class SVG:
    def __init__(self, w, h, title=''):
        self.w, self.h, self.items = w, h, []
        self.items.append(f"<rect x='0' y='0' width='{w}' height='{h}' fill='{PAPER}'/>")
    def add(self, s): self.items.append(s)
    def save(self, path):
        open(path, 'w').write(f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {self.w} {self.h}' width='{self.w}' height='{self.h}' {FONT}>" + ''.join(self.items) + '</svg>')

def fmt(x): return f'{x:.1f}'

def poly_path(geom, T):
    gs = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    d = ''
    for g in gs:
        if g.is_empty: continue
        for ringc in [g.exterior] + list(g.interiors):
            pts = [T(x, y) for x, y in ringc.coords]
            d += 'M' + ' L'.join(f'{fmt(a)},{fmt(b)}' for a, b in pts) + ' Z '
    return d

def text(s, x, y, size=11, color=INK, anchor='middle', weight=400, rot=None, italic=False):
    tr = f" transform='rotate({rot} {fmt(x)} {fmt(y)})'" if rot is not None else ''
    st = " font-style='italic'" if italic else ''
    return f"<text x='{fmt(x)}' y='{fmt(y)}' font-size='{size}' fill='{color}' text-anchor='{anchor}' font-weight='{weight}'{tr}{st}>{s}</text>"

def north_arrow(svg, x, y, ang_deg, r=22):
    # ang_deg: rotação do norte verdadeiro em relação ao "cima" do desenho (sentido horário +)
    a = math.radians(ang_deg)
    tip = (x + r * math.sin(a), y - r * math.cos(a)); tail = (x - r * 0.6 * math.sin(a), y + r * 0.6 * math.cos(a))
    left = (x + 7 * math.cos(a), y + 7 * math.sin(a)); right = (x - 7 * math.cos(a), y - 7 * math.sin(a))
    svg.add(f"<circle cx='{fmt(x)}' cy='{fmt(y)}' r='{r + 4}' fill='none' stroke='{MID}' stroke-width='0.8'/>")
    svg.add(f"<path d='M{fmt(tip[0])},{fmt(tip[1])} L{fmt(left[0])},{fmt(left[1])} L{fmt(tail[0])},{fmt(tail[1])} Z' fill='{INK}'/>")
    svg.add(f"<path d='M{fmt(tip[0])},{fmt(tip[1])} L{fmt(right[0])},{fmt(right[1])} L{fmt(tail[0])},{fmt(tail[1])} Z' fill='none' stroke='{INK}' stroke-width='1'/>")
    tx, ty = x + (r + 13) * math.sin(a), y - (r + 13) * math.cos(a)
    svg.add(text('N', tx, ty + 4, 11, INK, weight=700))

def scale_bar(svg, x, y, S, meters=5):
    for i in range(meters):
        svg.add(f"<rect x='{fmt(x + i * S)}' y='{fmt(y)}' width='{fmt(S)}' height='5' fill='{INK if i % 2 == 0 else PAPER}' stroke='{INK}' stroke-width='0.8'/>")
    svg.add(text('0', x, y + 17, 9, MID)); svg.add(text(f'{meters} m', x + meters * S, y + 17, 9, MID))

def dim_h(svg, T, u0, u1, v, off, label=None, size=9.5):
    (x0, y), (x1, _) = T(u0, v), T(u1, v); yy = y + off
    svg.add(f"<line x1='{fmt(x0)}' y1='{fmt(yy)}' x2='{fmt(x1)}' y2='{fmt(yy)}' stroke='{MID}' stroke-width='0.8'/>")
    for xx in (x0, x1):
        svg.add(f"<line x1='{fmt(xx - 3)}' y1='{fmt(yy + 3)}' x2='{fmt(xx + 3)}' y2='{fmt(yy - 3)}' stroke='{INK}' stroke-width='1'/>")
        svg.add(f"<line x1='{fmt(xx)}' y1='{fmt(yy - 5)}' x2='{fmt(xx)}' y2='{fmt(yy + 5)}' stroke='{MID}' stroke-width='0.6'/>")
    svg.add(text(label or f'{u1 - u0:.2f}'.replace('.', ','), (x0 + x1) / 2, yy - 4, size, INK))

def dim_v(svg, T, v0, v1, u, off, label=None, size=9.5):
    (x, y0), (_, y1) = T(u, v0), T(u, v1); xx = x + off
    svg.add(f"<line x1='{fmt(xx)}' y1='{fmt(y0)}' x2='{fmt(xx)}' y2='{fmt(y1)}' stroke='{MID}' stroke-width='0.8'/>")
    for yy in (y0, y1):
        svg.add(f"<line x1='{fmt(xx - 3)}' y1='{fmt(yy + 3)}' x2='{fmt(xx + 3)}' y2='{fmt(yy - 3)}' stroke='{INK}' stroke-width='1'/>")
        svg.add(f"<line x1='{fmt(xx - 5)}' y1='{fmt(yy)}' x2='{fmt(xx + 5)}' y2='{fmt(yy)}' stroke='{MID}' stroke-width='0.6'/>")
    svg.add(text(label or f'{v1 - v0:.2f}'.replace('.', ','), xx - 5, (y0 + y1) / 2, size, INK, rot=-90))

def m2(a): return f"{a:.1f}".replace('.', ',') + ' m²'

# ============================================================================ PLANTAS
def plan(level, path, variant='f1'):
    S = 46.0; mx, my = 120, 120
    umin, umax, vmin, vmax = -4.8, 16.6, -9.6, 10.4
    W = int((umax - umin) * S + 2 * mx * 0.5); H = int((vmax - vmin) * S + my * 0.9)
    T = lambda u, v: (mx * 0.5 + (u - umin) * S, my * 0.45 + (vmax - v) * S)
    svg = SVG(W, H)
    # ---- contexto exterior
    if level == 'rc':
        svg.add(f"<path d='{poly_path(G.DECK_POLY.difference(G.DECK_NOTCH), T)}' fill='{DECKC}' stroke='{MID}' stroke-width='0.8'/>")
        svg.add(f"<path d='{poly_path(sbox(*G.BALCONY), T)}' fill='{DECKC}' stroke='{MID}' stroke-width='0.8'/>")
        pool = sbox(*G.POOL)
        svg.add(f"<path d='{poly_path(pool, T)}' fill='{WATER}' stroke='{INK}' stroke-width='1.1'/>")
        svg.add(f"<path d='{poly_path(pool.buffer(0.30, join_style=2).difference(pool), T)}' fill='#e2ddd2' stroke='{MID}' stroke-width='0.6'/>")
        px, py = T((G.POOL[0] + G.POOL[2]) / 2, (G.POOL[1] + G.POOL[3]) / 2)
        svg.add(text('PISCINA 9,00 × 3,00', px, py - 2, 11, '#2f6f74', weight=600)); svg.add(text('água a 36,95 · prof. 1,40', px, py + 12, 9, '#2f6f74'))
        svg.add(f"<path d='{poly_path(sbox(*G.PATIO), T)}' fill='#e6e2da' stroke='{MID}' stroke-width='0.8' stroke-dasharray='5 3'/>")
        cx, cy = T(12.3, -3.2); svg.add(text('pátio afundado', cx, cy, 9.5, MID, italic=True)); svg.add(text('(cota 34,00)', cx, cy + 12, 9, MID, italic=True))
        svg.add(f"<path d='{poly_path(G.GPATIO_POLY, T)}' fill='#ecebe7' stroke='{MID}' stroke-width='0.8' stroke-dasharray='5 3'/>")
        gx, gy = T(-2.6, 4.6); svg.add(text('pátio da garagem', gx, gy, 9, MID, italic=True)); svg.add(text('(34,20)', gx, gy + 11, 9, MID, italic=True))
        svg.add(f"<path d='{poly_path(G.NORTH_TERRACE.intersection(G.PARCEL_A), T)}' fill='{GREEN}' stroke='none'/>")
        svg.add(f"<path d='{poly_path(sbox(0.0, 8.0, 10.2, 9.3), T)}' fill='#e6e1d6' stroke='{MID}' stroke-width='0.5'/>")
        tx, ty = T(4.0, 9.85); svg.add(text('terraço norte · horta e aromáticas (36,95)', tx, ty, 9.5, '#56663e', italic=True))
        # pala (projeção)
        svg.add(f"<path d='{poly_path(G.PALA_POLY, T)}' fill='none' stroke='{INK}' stroke-width='0.9' stroke-dasharray='9 4 2 4'/>")
        lx, ly = T(4.2, -3.05); svg.add(text('projeção da pala em consola (2,00 m)', lx, ly, 9, INK, italic=True))
        # degraus
        ds = G.DECK_STEPS
        for i in range(ds['n']):
            v = ds['v_top'] - i * (ds['v_top'] - ds['v_bot']) / (ds['n'] - 1)
            a, b = T(ds['u0'], v), T(ds['u1'], v)
            svg.add(f"<line x1='{fmt(a[0])}' y1='{fmt(a[1])}' x2='{fmt(b[0])}' y2='{fmt(b[1])}' stroke='{MID}' stroke-width='0.7'/>")
        sx, sy = T(8.6, -8.75); svg.add(text('↓ caminho do portão', sx + 4, sy + 10, 9, MID))
        # guardas de vidro (deck poente)
        wp = [(G.B_N(v) + 0.37, v) for v in (-4.75, -3.0, -1.887, -0.737, 0.5, 1.40)]
        svg.add("<polyline points='" + ' '.join(f'{fmt(T(*p)[0])},{fmt(T(*p)[1])}' for p in wp) + f"' fill='none' stroke='#6a9aa3' stroke-width='2'/>")
        a, b = T(-1.2, 1.70), T(-1.2, 8.0)
        svg.add(f"<line x1='{fmt(a[0])}' y1='{fmt(a[1])}' x2='{fmt(b[0])}' y2='{fmt(b[1])}' stroke='#6a9aa3' stroke-width='2'/>")
        bx, by = T(-0.62, 4.9); svg.add(text('varanda poente', bx, by, 9, MID, rot=-90, italic=True))
        dx, dy = T(3.6, -4.25); svg.add(text('DECK 37,00', dx, dy, 10, MID, weight=600))
        # portadas (estacionadas)
        for i, (va, vb) in enumerate([(4.78, 6.68), (5.40, 7.30), (6.02, 7.92)]):
            uu = -1.10 + i * 0.07; a, b = T(uu, va), T(uu, vb)
            svg.add(f"<line x1='{fmt(a[0])}' y1='{fmt(a[1])}' x2='{fmt(b[0])}' y2='{fmt(b[1])}' stroke='#5b4a3a' stroke-width='3'/>")
    else:
        # cave: pátio afundado ao mesmo nível + escada + pátio da garagem
        svg.add(f"<path d='{poly_path(sbox(*G.PATIO), T)}' fill='#e9e5dd' stroke='{MID}' stroke-width='0.8'/>")
        ps = G.PATIO_STAIR
        for i in range(ps['n']):
            v = ps['v_top'] + i * (ps['v_bot'] - ps['v_top']) / (ps['n'] - 1)
            a, b = T(ps['u0'], v), T(ps['u1'], v)
            svg.add(f"<line x1='{fmt(a[0])}' y1='{fmt(a[1])}' x2='{fmt(b[0])}' y2='{fmt(b[1])}' stroke='{MID}' stroke-width='0.7'/>")
        sx, sy = T(14.7, -4.2); svg.add(text('sobe ao jardim', sx, sy, 8.5, MID, rot=-90))
        cx, cy = T(11.9, -3.0); svg.add(text('PÁTIO AFUNDADO', cx, cy, 10.5, INK, weight=600)); svg.add(text('34,00 · medronheiro · duche exterior', cx, cy + 13, 9, MID))
        tr = T(10.4, -3.9); svg.add(f"<circle cx='{fmt(tr[0])}' cy='{fmt(tr[1])}' r='{fmt(1.5 * S)}' fill='none' stroke='#7c9a5a' stroke-width='1' stroke-dasharray='3 2'/>")
        for w in [(9.10, -5.10, 9.40, -1.33), (9.10, -5.10, 14.20, -4.80), (15.20, -5.10, 15.50, -1.33)]:
            svg.add(f"<path d='{poly_path(sbox(*w), T)}' fill='#6d6a64' stroke='none'/>")
        svg.add(f"<path d='{poly_path(G.GPATIO_POLY, T)}' fill='#ecebe7' stroke='{MID}' stroke-width='0.8'/>")
        gx, gy = T(-2.6, 4.8); svg.add(text('PÁTIO DA', gx, gy - 6, 9.5, INK, weight=600)); svg.add(text('GARAGEM', gx, gy + 6, 9.5, INK, weight=600)); svg.add(text('34,20 → estrada', gx, gy + 19, 8.5, MID))
        for w in [(-4.6, 1.40, 0.0, 1.70), (G.B_N(8.05) + 0.05, 7.90, 0.0, 8.20)]:
            svg.add(f"<path d='{poly_path(sbox(*w), T)}' fill='#6d6a64' stroke='none'/>")
        # não escavado
        ne = sbox(9.58, 3.80, 15.0, 8.0)
        svg.add(f"<defs><pattern id='hatch' width='8' height='8' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><line x1='0' y1='0' x2='0' y2='8' stroke='{LIGHT}' stroke-width='1.2'/></pattern></defs>")
        svg.add(f"<path d='{poly_path(ne, T)}' fill='url(#hatch)' stroke='{LIGHT}' stroke-width='0.8'/>")
        nx, ny = T(12.3, 6.0); svg.add(text('terreno não escavado', nx, ny, 9.5, MID, italic=True))
        # piscina enterrada (projeção)
        svg.add(f"<path d='{poly_path(sbox(*G.POOL), T)}' fill='none' stroke='{LIGHT}' stroke-width='0.9' stroke-dasharray='6 4'/>")
        px, py = T(3.5, -6.4); svg.add(text('piscina (por cima, no deck)', px, py, 9, LIGHT, italic=True))
    # ---- paredes cortadas (poché) com vãos
    walls = unary_union([sbox(*w[:4]) for w in G.WALLS[level]])
    ops = unary_union([sbox(*o['r']) for o in G.OPEN[level]])
    cut = walls.difference(ops)
    svg.add(f"<path d='{poly_path(cut, T)}' fill='{POCHE}' stroke='none'/>")
    # ---- vãos
    for o in G.OPEN[level]:
        a0, b0, a1, b1 = o['r']; k = o['k']
        along_u = (a1 - a0) >= (b1 - b0)
        if k in ('door', 'pass'):
            if k == 'pass': continue
            # folha + arco
            sw = o.get('sw', '+v')
            if along_u:
                hinge = (a0, (b0 + b1) / 2); w = a1 - a0
                d = 1 if sw == '+v' else -1
                leaf_end = (a0, (b0 + b1) / 2 + d * w)
                p0, p1, p2 = T(*hinge), T(*leaf_end), T(a1, (b0 + b1) / 2)
            else:
                hinge = ((a0 + a1) / 2, b0); w = b1 - b0
                d = 1 if sw == '+u' else -1
                leaf_end = ((a0 + a1) / 2 + d * w, b0)
                p0, p1, p2 = T(*hinge), T(*leaf_end), T((a0 + a1) / 2, b1)
            svg.add(f"<line x1='{fmt(p0[0])}' y1='{fmt(p0[1])}' x2='{fmt(p1[0])}' y2='{fmt(p1[1])}' stroke='{INK}' stroke-width='1.2'/>")
            r = w * S
            svg.add(f"<path d='M{fmt(p1[0])},{fmt(p1[1])} A{fmt(r)},{fmt(r)} 0 0 {1 if (d > 0) ^ along_u else 0} {fmt(p2[0])},{fmt(p2[1])}' fill='none' stroke='{MID}' stroke-width='0.6'/>")
            continue
        x0, y0 = T(a0, b1); x1, y1 = T(a1, b0)
        svg.add(f"<rect x='{fmt(x0)}' y='{fmt(y0)}' width='{fmt(x1 - x0)}' height='{fmt(y1 - y0)}' fill='{PAPER}' stroke='{INK}' stroke-width='0.7'/>")
        if along_u:
            ym = (y0 + y1) / 2
            if k.startswith('slide'):
                svg.add(f"<line x1='{fmt(x0)}' y1='{fmt(ym - 2)}' x2='{fmt((x0 + x1) / 2 + 6)}' y2='{fmt(ym - 2)}' stroke='{INK}' stroke-width='1.3'/>")
                svg.add(f"<line x1='{fmt((x0 + x1) / 2 - 6)}' y1='{fmt(ym + 2)}' x2='{fmt(x1)}' y2='{fmt(ym + 2)}' stroke='{INK}' stroke-width='1.3'/>")
            elif k == 'garage':
                svg.add(f"<line x1='{fmt(x0)}' y1='{fmt(ym)}' x2='{fmt(x1)}' y2='{fmt(ym)}' stroke='{INK}' stroke-width='2' stroke-dasharray='4 2'/>")
            elif k == 'entry':
                svg.add(f"<line x1='{fmt(x0 + 1.02 * S * 0.5)}' y1='{fmt(ym - 0.5 * S)}' x2='{fmt(x0 + 1.02 * S * 0.5)}' y2='{fmt(ym + 0.5 * S)}' stroke='#8a5a2b' stroke-width='3'/>")
            else:
                svg.add(f"<line x1='{fmt(x0)}' y1='{fmt(ym)}' x2='{fmt(x1)}' y2='{fmt(ym)}' stroke='{INK}' stroke-width='1'/>")
        else:
            xm = (x0 + x1) / 2
            if k.startswith('slide'):
                svg.add(f"<line x1='{fmt(xm - 2)}' y1='{fmt(y0)}' x2='{fmt(xm - 2)}' y2='{fmt((y0 + y1) / 2 + 6)}' stroke='{INK}' stroke-width='1.3'/>")
                svg.add(f"<line x1='{fmt(xm + 2)}' y1='{fmt((y0 + y1) / 2 - 6)}' x2='{fmt(xm + 2)}' y2='{fmt(y1)}' stroke='{INK}' stroke-width='1.3'/>")
            elif k == 'garage':
                svg.add(f"<line x1='{fmt(xm)}' y1='{fmt(y0)}' x2='{fmt(xm)}' y2='{fmt(y1)}' stroke='{INK}' stroke-width='2' stroke-dasharray='4 2'/>")
            else:
                svg.add(f"<line x1='{fmt(xm)}' y1='{fmt(y0)}' x2='{fmt(xm)}' y2='{fmt(y1)}' stroke='{INK}' stroke-width='1'/>")
        if o['n'] != 'p':
            cx = (x0 + x1) / 2; cy = (y0 + y1) / 2
            off = (-14 if b0 < 0 and along_u else 14) if along_u else 0
            offx = 0 if along_u else (-16 if a0 < 1 else 16)
            svg.add(text(o['n'], cx + offx, cy + off + 3, 8, '#7a6a55', weight=600))
    # ---- escada
    st = G.STAIR
    for i in range(st['n'] - 1):
        v = st['v_top'] + i * (st['v_bot'] - st['v_top']) / (st['n'] - 1)
        a, b = T(st['u0'], v), T(st['u1'], v)
        svg.add(f"<line x1='{fmt(a[0])}' y1='{fmt(a[1])}' x2='{fmt(b[0])}' y2='{fmt(b[1])}' stroke='{MID}' stroke-width='0.7'/>")
    a, b = (T(7.16, st['v_top'] + 0.2), T(7.16, st['v_bot'] - 0.25)) if level == 'rc' else (T(7.16, st['v_bot'] - 0.2), T(7.16, st['v_top'] + 0.25))
    svg.add(f"<line x1='{fmt(a[0])}' y1='{fmt(a[1])}' x2='{fmt(b[0])}' y2='{fmt(b[1])}' stroke='{INK}' stroke-width='1' marker-end='url(#arr)'/>")
    svg.add(f"<defs><marker id='arr' markerWidth='8' markerHeight='8' refX='6' refY='4' orient='auto'><path d='M0,0 L8,4 L0,8 Z' fill='{INK}'/></marker></defs>")
    lbl = 'desce à cave' if level == 'rc' else 'sobe ao R/C'
    sx, sy = T(7.16, 3.4); svg.add(text(lbl, sx, sy, 8.5, MID, rot=-90))
    if level == 'rc':
        a, b = T(7.69, st['v_top']), T(7.69, st['v_bot'])
        svg.add(f"<line x1='{fmt(a[0])}' y1='{fmt(a[1])}' x2='{fmt(b[0])}' y2='{fmt(b[1])}' stroke='#6a9aa3' stroke-width='1.6'/>")
    # ---- mobiliário
    furn = []
    if level == 'rc':
        furn += [((0.60, 7.05, 4.70, 7.70), 'bancada'), ((5.94, 4.40, 6.54, 7.10), 'colunas'), ((1.80, 5.05, 4.60, 6.05), 'ilha'),
                 ((2.40, 2.70, 4.80, 3.70), 'mesa'), ((2.20, -0.55, 3.05, 2.05), 'sofá'), ((1.05, 0.10, 1.85, 1.30), None),
                 ((12.25, 1.44, 13.85, 3.44), 'cama'), ((12.25, 3.56, 13.85, 5.56), 'cama'),
                 ((9.28, 1.15, 9.88, 2.88), None), ((9.28, 4.12, 9.88, 5.52), None), ((8.76, 1.52, 9.16, 2.88), None),
                 ((8.56, 5.65, 9.16, 7.70), 'máquinas · tanque'), ((2.20, -2.95, 4.60, -2.05), 'mesa exterior'),
                 ((3.0, -4.75, 3.7, -2.85), None), ((4.2, -4.75, 4.9, -2.85), None)]
        # loiças (esquemático)
        for (u, v, r) in [(10.95, 0.35, 0.22), (8.85, 0.2, 0.2), (10.95, 6.3, 0.22)]:
            c = T(u, v); svg.add(f"<ellipse cx='{fmt(c[0])}' cy='{fmt(c[1])}' rx='{fmt(r * S)}' ry='{fmt(r * S * 1.3)}' fill='none' stroke='{MID}' stroke-width='0.7'/>")
        for rect in [(9.35, -0.98, 10.25, 0.62), (9.35, 6.0, 10.25, 7.65)]:
            furn.append((rect, None))
        c = T(1.15, 4.15); svg.add(f"<circle cx='{fmt(c[0])}' cy='{fmt(c[1])}' r='{fmt(0.3 * S)}' fill='{INK}'/>")
        svg.add(text('salamandra', c[0] + 2, c[1] + 22, 8, MID))
        for (u, v) in [(2.0, 5.6), (3.2, 5.6), (4.4, 5.6)]:
            pass
        # claraboias (projeção)
        for s in G.SKYLIGHTS:
            svg.add(f"<path d='{poly_path(sbox(*s), T)}' fill='none' stroke='#6a9aa3' stroke-width='0.8' stroke-dasharray='3 2'/>")
    else:
        furn += [((1.00, 2.30, 5.60, 4.15), 'carro'), ((1.00, 5.05, 5.60, 6.90), 'carro'),
                 ((0.40, -0.95, 3.0, -0.35), 'prateleiras · pranchas · bicicletas'), ((4.6, -0.95, 6.45, 0.2), 'filtro · bomba'),
                 ((6.80, -0.95, 7.60, -0.15), 'AQS'), ((8.30, -0.95, 9.20, -0.55), 'quadro'),
                 ((9.40, 1.29, 9.95, 3.50), None)]
        if variant == 'f1':
            furn += [((12.0, 1.9, 14.3, 2.80), 'sofá'), ((11.3, -0.6, 12.4, 0.6), 'bicicleta est.')]
        else:
            furn += [((12.10, 0.45, 13.70, 2.45), 'cama'), ((11.10, 3.0, 12.6, 3.45), None)]
        for (u, v, r) in [(10.6, 0.5, 0.2)]:
            c = T(u, v); svg.add(f"<ellipse cx='{fmt(c[0])}' cy='{fmt(c[1])}' rx='{fmt(r * S)}' ry='{fmt(r * S * 1.3)}' fill='none' stroke='{MID}' stroke-width='0.7'/>")
        furn.append(((9.45, -0.98, 10.30, 0.0), None))
    for rect, lab in furn:
        svg.add(f"<path d='{poly_path(sbox(*rect), T)}' fill='none' stroke='{MID}' stroke-width='0.7'/>")
        if lab:
            c = T((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2)
            rot = -90 if (rect[3] - rect[1]) > (rect[2] - rect[0]) * 1.6 else None
            svg.add(text(lab, c[0], c[1] + 3, 7.5, MID, rot=rot))
    # ---- etiquetas de compartimentos
    labelpos = {
        ('rc', 'Sala · jantar · cozinha'): (4.75, 1.05), ('rc', 'Entrada'): (7.36, 0.2), ('rc', 'WC serviço'): (8.67, -0.55),
        ('rc', 'Corredor'): (8.45, 4.5), ('rc', 'Escada'): None, ('rc', 'Lavandaria'): (7.55, 6.55), ('rc', 'WC 1'): (10.3, -0.4),
        ('rc', 'Closet 1'): (10.6, 2.0), ('rc', 'Passagem'): (10.3, 3.5), ('rc', 'Closet 2'): (10.6, 4.8), ('rc', 'WC 2'): (10.3, 6.8),
        ('rc', 'Suite 1'): (13.05, 0.25), ('rc', 'Suite 2'): (13.05, 6.6),
        ('cave', 'Garagem (2 carros)'): (3.3, 4.6), ('cave', 'Arrumos · oficina · piscina'): (3.3, 0.55), ('cave', 'Técnica'): (7.95, 0.25),
        ('cave', 'Escada'): None, ('cave', 'Átrio'): (8.5, 6.5), ('cave', 'Sala do Jardim'): (12.85, 0.9), ('cave', 'WC 3'): (10.16, -0.55),
        ('cave', 'Closet 3'): (10.4, 2.4),
    }
    for name, rect, _ in G.ROOMS[level]:
        pos = labelpos.get((level, name))
        if not pos: continue
        a = G.room_poly(level, name, rect).area
        nm = name
        if level == 'cave' and name == 'Sala do Jardim':
            nm = 'Sala do Jardim' if variant == 'f1' else 'Quarto 3 (suite)'
        if level == 'cave' and name == 'WC 3':
            nm = 'WC de apoio' if variant == 'f1' else 'WC 3'
        x, y = T(*pos)
        small = a < 4.5
        svg.add(text(nm, x, y, 8.5 if small else 11, INK, weight=600))
        svg.add(text(m2(a), x, y + (10 if small else 13), 8 if small else 9.5, MID))
    if level == 'rc':
        for (lab, u, v) in [('estar · vista mar', 1.6, -0.2), ('jantar', 3.6, 4.35), ('cozinha', 3.2, 6.55)]:
            x, y = T(u, v); svg.add(text(lab, x, y, 8.5, MID, italic=True))
    # ---- cotas
    dim_h(svg, T, 0.0, 15.0, G.FOOT[3], -42 if level == 'rc' else -40)
    for (a, b) in [(0.0, 6.54), (6.54, 9.16), (9.16, 11.28), (11.28, 15.0)]:
        dim_h(svg, T, a, b, G.FOOT[3], -24)
    dim_v(svg, T, G.FOOT[1], G.FOOT[3], 15.0, 46 if level == 'rc' else 60)
    # ---- título, norte, escala
    title = 'PLANTA DO R/C · cota 37,00' if level == 'rc' else ('PLANTA DO PISO DO JARDIM (CAVE) · cota 34,10' + (' — Fase 2 (T3)' if variant == 'f2' else ''))
    svg.add(text(title, 18, 26, 14, INK, anchor='start', weight=700))
    sub = 'T2 com duas suites · 139,95 m² de implantação · 120,1 m² úteis' if level == 'rc' else ('garagem 2 carros · arrumos · técnica · Sala do Jardim com WC (→ quarto 3)' if variant == 'f1' else 'a Sala do Jardim passa a quarto com closet e WC — T3')
    svg.add(text(sub, 18, 44, 10.5, MID, anchor='start'))
    north_arrow(svg, W - 52, 54, G.SITE['angle'])
    scale_bar(svg, W - 300, H - 30, S)
    svg.save(path)

# ============================================================================ IMPLANTAÇÃO (norte para cima)
def site(path):
    ang = math.radians(G.SITE['angle'])
    def W_(u, v):  # local → mundo relativo (norte para cima)
        return (u * math.cos(ang) - v * math.sin(ang), u * math.sin(ang) + v * math.cos(ang))
    S = 13.5
    allp = [W_(*p) for p in G.SITE['parcelA']] + [W_(*p) for p in G.SITE['road']]
    xs = [p[0] for p in allp]; ys = [p[1] for p in allp]
    x0, x1, y0, y1 = min(xs) - 10, max(xs) + 6, min(ys) - 6, max(ys) + 6
    Wd = int((x1 - x0) * S) + 40; Hd = int((y1 - y0) * S) + 70
    T = lambda u, v: (20 + (W_(u, v)[0] - x0) * S, 56 + (y1 - W_(u, v)[1]) * S)
    svg = SVG(Wd, Hd)
    # parcela B (parte) e estrada
    svg.add(f"<path d='{poly_path(G.PARCEL_B.intersection(G.PARCEL_A.buffer(30)), T)}' fill='#eef1e4' stroke='#b9bfa6' stroke-width='0.8'/>")
    svg.add(f"<path d='{poly_path(G.ROAD, T)}' fill='{ROADC}' stroke='{MID}' stroke-width='0.8'/>")
    svg.add(f"<path d='{poly_path(G.PARCEL_A, T)}' fill='{GREEN}' stroke='none'/>")
    svg.add(f"<path d='{poly_path(G.NORTH_TERRACE.intersection(G.PARCEL_A), T)}' fill='{GREEN2}' stroke='none'/>")
    svg.add(f"<path d='{poly_path(sbox(*G.PATIO).buffer(0.3, join_style=2), T)}' fill='#bdb7ab' stroke='{INK}' stroke-width='0.6'/>")
    svg.add(f"<path d='{poly_path(G.DECK_POLY, T)}' fill='{DECKC}' stroke='{INK}' stroke-width='0.7'/>")
    svg.add(f"<path d='{poly_path(sbox(*G.POOL), T)}' fill='{WATER}' stroke='{INK}' stroke-width='0.8'/>")
    svg.add(f"<path d='{poly_path(G.GPATIO_POLY, T)}' fill='#e4e2dd' stroke='{INK}' stroke-width='0.6'/>")
    # caminhos
    sp = LineString([(-0.6, -9.45), (3.0, -9.0), (8.6, -8.75), (11.5, -7.2), (14.7, -5.6)]).buffer(0.55)
    ep = LineString([(15.0, 9.0), (18.5, 7.0), (22.5, 4.5)]).buffer(0.45)
    svg.add(f"<path d='{poly_path(sp, T)}' fill='{PATH}' stroke='none'/><path d='{poly_path(ep, T)}' fill='{PATH}' stroke='none'/>")
    # casa: cobertura + pala
    svg.add(f"<path d='{poly_path(G.FOOT_POLY, T)}' fill='#3a3936' stroke='{INK}' stroke-width='1'/>")
    svg.add(f"<path d='{poly_path(G.PALA_POLY, T)}' fill='#a9a49b' stroke='{INK}' stroke-width='0.8'/>")
    for s in G.SKYLIGHTS:
        svg.add(f"<path d='{poly_path(sbox(*s), T)}' fill='#9fc3c9' stroke='none'/>")
    # árvores e sebes
    import json
    spec = json.load(open('out/spec.json'))
    for hd in spec['hedges']:
        a, b = T(*hd['a']), T(*hd['b'])
        svg.add(f"<line x1='{fmt(a[0])}' y1='{fmt(a[1])}' x2='{fmt(b[0])}' y2='{fmt(b[1])}' stroke='#7f9a63' stroke-opacity='0.75' stroke-width='{fmt(hd['w'] * S * 0.6)}' stroke-linecap='round'/>")
    for kind, u, v, h, d in spec['trees']:
        if not G.PARCEL_A.buffer(4).contains(Point(u, v)): continue
        c = T(u, v); col = {'pine': '#6c8a4f', 'oak': '#7d9a5c', 'olive': '#a7b08f', 'arbutus': '#5f844a', 'fruit': '#8eaa63', 'cypress': '#4e6b45'}[kind]
        svg.add(f"<circle cx='{fmt(c[0])}' cy='{fmt(c[1])}' r='{fmt(d / 2 * S)}' fill='{col}' fill-opacity='0.55' stroke='{col}' stroke-width='1'/>")
        svg.add(f"<circle cx='{fmt(c[0])}' cy='{fmt(c[1])}' r='2' fill='#4a3b2c'/>")
    # limite da parcela A
    svg.add(f"<path d='{poly_path(G.PARCEL_A, T)}' fill='none' stroke='#b0413e' stroke-width='1.6' stroke-dasharray='10 4 2 4'/>")
    # cotas / etiquetas
    labels = [
        ('R/C 37,00', 6.0, 3.0, '#ffffff', 11, 700), ('cobertura 40,45', 6.0, 1.6, '#d7d3cb', 9, 400),
        ('deck 37,00', 3.6, -3.9, INK, 9, 600), ('piscina 9 × 3', 3.5, -6.4, '#2f6f74', 9, 600),
        ('pátio 34,00', 12.3, -3.0, INK, 8.5, 600), ('garagem 34,20', -2.7, 4.6, INK, 8.5, 600),
        ('terraço norte 36,95', 7.0, 9.6, '#3e4d2c', 8.5, 600), ('miradouro · pinheiro-manso', 22.5, 2.0, '#3e4d2c', 8.5, 400),
        ('ESTRADA NOVA (área cedida 172,5 m²)', -9.6, 4.0, MID, 9, 600), ('portão pedonal ≈35,90', -1.8, -11.2, INK, 8.5, 600),
        ('Trav. de João Pires', -6.0, -13.8, MID, 9, 400), ('PARCELA A · 685,22 m²', 27.0, 4.0, '#b0413e', 10, 700),
        ('parcela B (rústica) · prado e pomar', -22.0, 4.0, '#6f7a55', 9, 400),
    ]
    for s, u, v, col, size, wt in labels:
        x, y = T(u, v)
        rot = None
        if 'ESTRADA' in s: rot = -52
        svg.add(text(s, x, y, size, col, weight=wt, rot=rot))
    # afastamento mínimo
    p1 = G.PARCEL_A.exterior.interpolate(G.PARCEL_A.exterior.project(Point(0.0, -1.33)))
    a, b = T(0.0, -1.33), T(p1.x, p1.y)
    svg.add(f"<line x1='{fmt(a[0])}' y1='{fmt(a[1])}' x2='{fmt(b[0])}' y2='{fmt(b[1])}' stroke='#b0413e' stroke-width='1'/>")
    svg.add(text(f'{Point(0, -1.33).distance(p1):.2f} m'.replace('.', ','), (a[0] + b[0]) / 2 - 4, (a[1] + b[1]) / 2 - 8, 9, '#b0413e', weight=600))
    svg.add(text('IMPLANTAÇÃO E ARRANJOS EXTERIORES', 18, 24, 14, INK, anchor='start', weight=700))
    svg.add(text('implantação 139,95 m² (≤ 140) · mesma posição e orientação do PIP', 18, 41, 10.5, MID, anchor='start'))
    north_arrow(svg, Wd - 46, 50, 0)
    scale_bar(svg, Wd - 230, Hd - 22, S, 10)
    svg.save(path)

# ============================================================================ CORTES
def section(path, u_cut, title, sub):
    S = 34.0
    vmin, vmax, zmin, zmax = -11.0, 16.5, 32.6, 43.4
    Wd = int((vmax - vmin) * S) + 120; Hd = int((zmax - zmin) * S) + 90
    X = lambda v: 70 + (v - vmin) * S
    Y = lambda z: 60 + (zmax - z) * S
    svg = SVG(Wd, Hd)
    # envelope do PIP (beirado +3,90; cumeeira +5,50)
    e1, e2 = G.Z_RC + 3.90, G.Z_RC + 5.50
    vm = (G.FOOT[1] + G.FOOT[3]) / 2
    svg.add(f"<path d='M{fmt(X(G.FOOT[1]))},{fmt(Y(e1))} L{fmt(X(vm))},{fmt(Y(e2))} L{fmt(X(G.FOOT[3]))},{fmt(Y(e1))}' fill='none' stroke='#b0413e' stroke-width='1' stroke-dasharray='6 4'/>")
    svg.add(text('envelope do PIP (beirado +3,90 · cumeeira +5,50)', X(vm), Y(e2) - 8, 9, '#b0413e'))
    # terreno natural (tracejado) e proposto
    vs = [vmin + i * 0.25 for i in range(int((vmax - vmin) / 0.25) + 1)]
    nat = [(X(v), Y(G.natural(u_cut, v))) for v in vs]
    svg.add("<polyline points='" + ' '.join(f'{fmt(a)},{fmt(b)}' for a, b in nat) + f"' fill='none' stroke='{MID}' stroke-width='0.9' stroke-dasharray='4 3'/>")
    # solo proposto (a partir do spec)
    import json, base64, struct
    spec = json.load(open('out/spec.json')); t = spec['terrain']
    Hh = struct.unpack('<%dh' % (t['nu'] * t['nv']), base64.b64decode(t['h']))
    def tz(u, v):
        i = round((u - t['u0']) / t['step']); j = round((v - t['v0']) / t['step'])
        return Hh[j * t['nu'] + i] / 100 + 30
    gp = []
    for v in vs:
        p = Point(u_cut, v)
        if G.FOOT_POLY.contains(p) or G.DECK_POLY.contains(p) or sbox(*G.PATIO).buffer(0.3).contains(p):
            gp.append(None); continue
        gp.append((X(v), Y(tz(u_cut, v))))
    seg = []
    for q in gp + [None]:
        if q is None:
            if len(seg) > 1:
                poly = seg + [(seg[-1][0], Y(zmin)), (seg[0][0], Y(zmin))]
                svg.add("<path d='M" + ' L'.join(f'{fmt(a)},{fmt(b)}' for a, b in poly) + f" Z' fill='#e9e3d6' stroke='none'/>")
                svg.add("<polyline points='" + ' '.join(f'{fmt(a)},{fmt(b)}' for a, b in seg) + f"' fill='none' stroke='{INK}' stroke-width='1.4'/>")
            seg = []
        else:
            seg.append(q)
    def rect(v0, z0, v1, z1, fill=POCHE, stroke='none', sw=0, op=1):
        svg.add(f"<rect x='{fmt(X(v0))}' y='{fmt(Y(z1))}' width='{fmt((v1 - v0) * S)}' height='{fmt((z1 - z0) * S)}' fill='{fill}' stroke='{stroke}' stroke-width='{sw}' fill-opacity='{op}'/>")
    cave_here = G.CAVE_POLY.contains(Point(u_cut, 0.0)) or True
    # --- cave (paredes e lajes cortadas)
    cave_v1 = 8.0 if u_cut < 9.58 else 3.80
    rect(G.FOOT[1], G.Z_FOOTING, cave_v1, 33.85, '#d2ccc0')                       # fundação/enrocamento (esquemático)
    rect(G.FOOT[1], 33.85, cave_v1, G.Z_CAVE, POCHE)
    rect(G.FOOT[1], G.Z_CAVE, G.FOOT[1] + E, G.Z_PLINTH_TOP, POCHE)
    rect(cave_v1 - E, G.Z_CAVE, cave_v1, G.Z_PLINTH_TOP, POCHE)
    if u_cut > 9.58:
        rect(cave_v1, 36.3, G.FOOT[3], 36.62, '#e9e3d6')                        # aterro sob laje (não escavado)
        svg.add(f"<rect x='{fmt(X(cave_v1))}' y='{fmt(Y(36.62))}' width='{fmt((G.FOOT[3] - cave_v1) * S)}' height='{fmt((36.62 - 33.9) * S)}' fill='#e9e3d6'/>")
    rect(G.FOOT[1], 36.62, G.FOOT[3], 37.0, POCHE)                                 # laje R/C
    # paredes R/C
    rect(G.FOOT[1], 37.0, G.FOOT[1] + E, G.Z_CEIL, POCHE)
    rect(G.FOOT[3] - E, 37.0, G.FOOT[3], G.Z_CEIL, POCHE)
    # vãos nas paredes sul/norte cortadas
    for o in G.OPEN['rc'] + G.OPEN['cave']:
        a0, b0, a1, b1 = o['r']
        if a0 <= u_cut <= a1 and (b1 - b0) < 0.4 and o['k'] not in ('door', 'pass'):
            rect(b0, o['z'][0], b1, o['z'][1], PAPER)
            svg.add(f"<line x1='{fmt(X((b0 + b1) / 2))}' y1='{fmt(Y(o['z'][0]))}' x2='{fmt(X((b0 + b1) / 2))}' y2='{fmt(Y(o['z'][1]))}' stroke='{INK}' stroke-width='1.2'/>")
    # paredes interiores cortadas (aprox.)
    for lvl, zb, zt in (('rc', 37.0, G.Z_CEIL), ('cave', G.Z_CAVE, G.Z_CAVE_SOFF)):
        for w in G.WALLS[lvl]:
            if w[4]: continue
            u0, v0, u1, v1, _ = w
            if u0 <= u_cut <= u1 and (u1 - u0) > (v1 - v0):
                blocked = any(o['r'][0] <= u_cut <= o['r'][2] and o['r'][1] <= v0 + 0.06 <= o['r'][3] for o in G.OPEN[lvl])
                rect(v0, zb, v1, zt if not blocked else zb + 0.0, POCHE)
                if blocked: rect(v0, 39.2 if lvl == 'rc' else 36.2, v1, zt, POCHE)
    # cobertura + pala
    rect(G.FOOT[1], G.Z_CEIL, G.FOOT[3], G.Z_ROOF_SLAB, POCHE)
    rect(G.FOOT[1], G.Z_ROOF_SLAB, G.FOOT[3], G.Z_ROOF_TOP, '#7c776f')
    if u_cut <= 9.4:
        rect(-3.33, G.Z_CEIL, G.FOOT[1], G.Z_PALA_TOP, POCHE)
    # deck, piscina, pátio
    if G.DECK_POLY.contains(Point(u_cut, -3.0)):
        rect(-8.20, 35.2, G.FOOT[1], G.Z_DECK, '#d8d2c4')
        rect(-8.20, G.Z_DECK - 0.05, G.FOOT[1], G.Z_DECK, POCHE)
        if G.POOL[0] <= u_cut <= G.POOL[2]:
            rect(G.POOL[1] - 0.25, G.Z_POOL_FLOOR - 0.25, G.POOL[3] + 0.25, G.Z_DECK, POCHE)
            rect(G.POOL[1], G.Z_POOL_FLOOR, G.POOL[3], G.Z_DECK, PAPER)
            rect(G.POOL[1], G.Z_POOL_FLOOR, G.POOL[3], G.Z_POOL_WATER, WATER)
            svg.add(text('piscina', X((G.POOL[1] + G.POOL[3]) / 2), Y(36.2), 9.5, '#2f6f74', weight=600))
        svg.add(text('deck', X(-2.9), Y(37.0) - 6, 9, MID))
    if G.PATIO[0] <= u_cut <= G.PATIO[2]:
        rect(-5.10, 33.6, -4.80, 36.0, '#6d6a64'); rect(G.PATIO[1], 33.7, G.PATIO[3], G.Z_PATIO, POCHE)
        svg.add(text('pátio afundado 34,00', X(-3.05), Y(34.0) + 16, 9, INK, weight=600))
        # árvore
        svg.add(f"<line x1='{fmt(X(-3.9))}' y1='{fmt(Y(34.0))}' x2='{fmt(X(-3.9))}' y2='{fmt(Y(36.4))}' stroke='#5b4b3c' stroke-width='3'/>")
        svg.add(f"<ellipse cx='{fmt(X(-3.9))}' cy='{fmt(Y(37.6))}' rx='{fmt(1.5 * S)}' ry='{fmt(1.2 * S)}' fill='#9fb784' fill-opacity='0.6' stroke='#6f8b52'/>")
        rect(-5.10, 37.03, -4.80, 38.05, '#9cc6cc', op=0.0)
    # níveis
    for z, lab in [(G.Z_CAVE, '34,10'), (G.Z_RC, '37,00'), (G.Z_CEIL, '39,85'), (G.Z_ROOF_TOP, '40,45')]:
        svg.add(f"<line x1='{fmt(X(G.FOOT[3]) + 8)}' y1='{fmt(Y(z))}' x2='{fmt(X(G.FOOT[3]) + 60)}' y2='{fmt(Y(z))}' stroke='{MID}' stroke-width='0.7'/>")
        svg.add(f"<path d='M{fmt(X(G.FOOT[3]) + 52)},{fmt(Y(z))} l-5,-6 l10,0 Z' fill='{INK}'/>")
        svg.add(f"<text x='{fmt(X(G.FOOT[3]) + 64)}' y='{fmt(Y(z) + 4)}' font-size='9.5' fill='{INK}' font-weight='600' stroke='{PAPER}' stroke-width='3' paint-order='stroke'>{lab}</text>")
    # pé-direito
    svg.add(text('pé-direito 2,85', X(5.6), Y(39.3), 9, MID)); svg.add(text('pé-direito 2,55', X(6.3), Y(36.2), 9, MID))
    # figuras humanas (escala)
    def person(v, z):
        x, y = X(v), Y(z)
        svg.add(f"<circle cx='{fmt(x)}' cy='{fmt(y - 1.62 * S + 4)}' r='4' fill='{MID}'/><path d='M{fmt(x - 5)},{fmt(y)} L{fmt(x - 3)},{fmt(y - 1.4 * S)} L{fmt(x + 3)},{fmt(y - 1.4 * S)} L{fmt(x + 5)},{fmt(y)} Z' fill='{MID}'/>")
    person(2.6, 37.0); person(-2.2, 37.0)
    if G.PATIO[0] <= u_cut <= G.PATIO[2]: person(-2.4, 34.0)
    else: person(4.5, 34.1)
    # rótulos sul / norte
    svg.add(text('SUL', X(vmin) + 14, Y(zmax) + 10, 10, MID, weight=700)); svg.add(text('NORTE', X(vmax) - 22, Y(zmax) + 10, 10, MID, weight=700))
    svg.add(text(title, 18, 24, 14, INK, anchor='start', weight=700)); svg.add(text(sub, 18, 41, 10.5, MID, anchor='start'))
    svg.add(f"<line x1='{fmt(X(vmin))}' y1='{fmt(Hd - 26)}' x2='{fmt(X(vmin) + 10 * S)}' y2='{fmt(Hd - 26)}' stroke='{INK}' stroke-width='2'/>")
    svg.add(text('10 m', X(vmin) + 5 * S, Hd - 12, 9, MID))
    svg.save(path)

# ============================================================================ ALÇADOS
def elev_south(path):
    S = 34.0
    umin, umax, zmin, zmax = -4.5, 19.0, 33.4, 43.0
    Wd = int((umax - umin) * S) + 80; Hd = int((zmax - zmin) * S) + 80
    X = lambda u: 40 + (u - umin) * S; Y = lambda z: 56 + (zmax - z) * S
    svg = SVG(Wd, Hd)
    def rect(u0, z0, u1, z1, fill, stroke='none', sw=0, extra=''):
        svg.add(f"<rect x='{fmt(X(u0))}' y='{fmt(Y(z1))}' width='{fmt((u1 - u0) * S)}' height='{fmt((z1 - z0) * S)}' fill='{fill}' stroke='{stroke}' stroke-width='{sw}' {extra}/>")
    svg.add("<defs><pattern id='bat' width='3.4' height='10' patternUnits='userSpaceOnUse'><rect width='3.4' height='10' fill='#2b2826'/><rect width='0.6' height='10' fill='#141312'/></pattern>"
            "<pattern id='board' width='20' height='5.1' patternUnits='userSpaceOnUse'><rect width='20' height='5.1' fill='#b4afa5'/><rect width='20' height='0.6' y='0' fill='#9a958b'/></pattern></defs>")
    # céu/fundo: árvores
    for (u, h, d) in [(19.0 - 1.0, 9.0, 7.5), (24.0 - 6.0, 11, 9)]:
        pass
    # casa (fachada sul, plano v=-1.33)
    rect(0.0, G.Z_RC, 15.0, G.Z_ROOF_TOP, 'url(#bat)')
    for o in G.OPEN['rc']:
        a0, b0, a1, b1 = o['r']
        if abs(b0 + 1.33) < 0.01 and o['k'] not in ('door', 'pass'):
            if o['k'] == 'entry':
                rect(a0, o['z'][0], a0 + 1.02, o['z'][1], '#a7774d', INK, 0.8); rect(a0 + 1.02, o['z'][0], a1, o['z'][1], '#2b2b2b')
            else:
                rect(a0, o['z'][0], a1, o['z'][1], '#9fb8bf', '#1d1d1b', 2)
                n = 3 if o['k'] == 'slide3' else (2 if o['k'] == 'slide2' else 1)
                for i in range(1, n):
                    x = a0 + (a1 - a0) * i / n
                    svg.add(f"<line x1='{fmt(X(x))}' y1='{fmt(Y(o['z'][0]))}' x2='{fmt(X(x))}' y2='{fmt(Y(o['z'][1]))}' stroke='#1d1d1b' stroke-width='2'/>")
    rect(11.85, G.Z_RC, 14.25, 38.10, '#cfe2e5', 'none', 0, "fill-opacity='0.35'")
    # embasamento visível (cave sul no pátio)
    rect(9.10, 33.7, 15.5, 36.9, 'url(#board)')
    for o in G.OPEN['cave']:
        a0, b0, a1, b1 = o['r']
        if abs(b0 + 1.33) < 0.01 and o['k'] not in ('door', 'pass'):
            rect(a0, o['z'][0], a1, o['z'][1], '#9fb8bf', '#1d1d1b', 2)
    # pala (à frente)
    rect(-1.20, G.Z_CEIL, 9.40, G.Z_PALA_TOP, '#c9c4ba', INK, 0.8)
    # deck/piscina: muro sul (à frente) + guarda
    rect(-1.30, 35.0, 9.40, 37.03, 'url(#board)', INK, 0.6)
    rect(-1.30, 37.0, 9.40, 37.05, '#d8d3c9')
    # degraus
    for i in range(7):
        z = 37.0 - (i + 1) * (37.0 - 35.7) / 7
        rect(8.15, z, 9.05, z + 0.02, INK)
    # pátio: muro sul (à frente, até 36,00) — corta a vista da cave
    rect(9.10, 34.6, 14.20, 36.0, '#8d887f', INK, 0.6)
    rect(15.20, 34.6, 15.50, 36.0, '#8d887f', INK, 0.6)
    # escada do pátio vista de frente
    for i in range(10):
        z = 35.8 - i * 0.18; rect(14.20, z - 0.02, 15.20, z, INK)
    # medronheiro no pátio
    svg.add(f"<line x1='{fmt(X(10.4))}' y1='{fmt(Y(36.0))}' x2='{fmt(X(10.4))}' y2='{fmt(Y(37.4))}' stroke='#5b4b3c' stroke-width='3'/>")
    svg.add(f"<ellipse cx='{fmt(X(10.4))}' cy='{fmt(Y(38.0))}' rx='{fmt(1.5 * S)}' ry='{fmt(1.1 * S)}' fill='#8fae74' fill-opacity='0.75' stroke='#5f844a'/>")
    # terreno à frente (limite sul ≈35,7–35,9) com sebe baixa
    svg.add(f"<path d='M{fmt(X(umin))},{fmt(Y(35.85))} L{fmt(X(9.0))},{fmt(Y(35.7))} L{fmt(X(16.0))},{fmt(Y(35.85))} L{fmt(X(umax))},{fmt(Y(36.4))} L{fmt(X(umax))},{fmt(Y(zmin))} L{fmt(X(umin))},{fmt(Y(zmin))} Z' fill='#e9e3d6' stroke='{INK}' stroke-width='1.2'/>")
    for u0 in [x * 0.9 for x in range(-4, 11)]:
        svg.add(f"<ellipse cx='{fmt(X(u0))}' cy='{fmt(Y(36.3))}' rx='{fmt(0.55 * S)}' ry='{fmt(0.5 * S)}' fill='#7f9a63' fill-opacity='0.55'/>")
    # árvores atrás
    for (u, zb, h, d, col) in []:
        svg.add(f"<line x1='{fmt(X(u))}' y1='{fmt(Y(zb))}' x2='{fmt(X(u))}' y2='{fmt(Y(zb + h * 0.55))}' stroke='#5b4b3c' stroke-width='3'/>")
        svg.add(f"<ellipse cx='{fmt(X(u))}' cy='{fmt(Y(zb + h * 0.72))}' rx='{fmt(d / 2 * S)}' ry='{fmt(h * 0.26 * S)}' fill='{col}' fill-opacity='0.45'/>")
    # envelope do PIP
    svg.add(f"<line x1='{fmt(X(0))}' y1='{fmt(Y(G.Z_RC + 3.9))}' x2='{fmt(X(15))}' y2='{fmt(Y(G.Z_RC + 3.9))}' stroke='#b0413e' stroke-dasharray='6 4'/>")
    svg.add(text('beirado máx. do PIP +3,90 (40,90)', X(15) - 4, Y(G.Z_RC + 3.9) - 5, 9, '#b0413e', anchor='end'))
    for z, lab in [(G.Z_RC, '37,00'), (G.Z_ROOF_TOP, '40,45'), (G.Z_PATIO, '34,00')]:
        svg.add(text(lab, X(umax) - 6, Y(z) + 4, 9.5, INK, anchor='end', weight=600))
        svg.add(f"<line x1='{fmt(X(umax) - 60)}' y1='{fmt(Y(z))}' x2='{fmt(X(umax) - 46)}' y2='{fmt(Y(z))}' stroke='{INK}'/>")
    svg.add(text('ALÇADO SUL', 18, 24, 14, INK, anchor='start', weight=700))
    svg.add(text('ripado de pinho carbonizado · pala e embasamento em betão de cofragem de tábua · caixilharia preta', 18, 41, 10.5, MID, anchor='start'))
    svg.save(path)

def elev_west(path):
    S = 34.0
    vmin, vmax, zmin, zmax = -10.5, 11.5, 33.0, 43.0
    Wd = int((vmax - vmin) * S) + 80; Hd = int((zmax - zmin) * S) + 80
    X = lambda v: 40 + (vmax - v) * S; Y = lambda z: 56 + (zmax - z) * S   # olhando para nascente: norte à esquerda
    svg = SVG(Wd, Hd)
    svg.add("<defs><pattern id='bat2' width='3.4' height='10' patternUnits='userSpaceOnUse'><rect width='3.4' height='10' fill='#2b2826'/><rect width='0.6' height='10' fill='#141312'/></pattern>"
            "<pattern id='board2' width='20' height='5.1' patternUnits='userSpaceOnUse'><rect width='20' height='5.1' fill='#b4afa5'/><rect width='20' height='0.6' y='0' fill='#9a958b'/></pattern>"
            "<pattern id='shut' width='4' height='10' patternUnits='userSpaceOnUse'><rect width='4' height='10' fill='#3a3330'/><rect width='1.2' height='10' fill='#171513'/></pattern></defs>")
    def rect(v0, z0, v1, z1, fill, stroke='none', sw=0, extra=''):
        xa, xb = X(v1), X(v0)
        svg.add(f"<rect x='{fmt(xa)}' y='{fmt(Y(z1))}' width='{fmt(xb - xa)}' height='{fmt((z1 - z0) * S)}' fill='{fill}' stroke='{stroke}' stroke-width='{sw}' {extra}/>")
    # árvores atrás
    for (v, h, d, col) in [(10.6, 4.6, 4.2, '#7d9a5c')]:
        svg.add(f"<ellipse cx='{fmt(X(v))}' cy='{fmt(Y(37.0 + h * 0.62))}' rx='{fmt(d / 2 * S)}' ry='{fmt(h * 0.3 * S)}' fill='{col}' fill-opacity='0.4'/>")
    # caixa de madeira
    rect(G.FOOT[1], G.Z_RC, G.FOOT[3], G.Z_ROOF_TOP, 'url(#bat2)')
    rect(-0.83, G.Z_RC, 4.67, G.Z_CEIL, '#9fb8bf', '#1d1d1b', 2)
    for v in (-0.83 + 5.5 / 3, -0.83 + 11 / 3):
        svg.add(f"<line x1='{fmt(X(v))}' y1='{fmt(Y(G.Z_RC))}' x2='{fmt(X(v))}' y2='{fmt(Y(G.Z_CEIL))}' stroke='#1d1d1b' stroke-width='2'/>")
    # portadas estacionadas (à frente, na varanda)
    for (va, vb) in [(4.78, 6.68), (5.40, 7.30), (6.02, 7.92)]:
        rect(va, G.Z_RC + 0.02, vb, G.Z_CEIL - 0.02, 'url(#shut)', '#111', 0.6)
    # pala (L) — ponta poente
    rect(-3.33, G.Z_CEIL, 8.0, G.Z_PALA_TOP, '#c9c4ba', INK, 0.8)
    # varanda (laje + guarda vidro)
    rect(1.70, 36.72, 8.0, 37.0, '#c9c4ba', INK, 0.6)
    rect(1.70, 37.0, 8.0, 38.05, '#cfe2e5', '#6a9aa3', 1, "fill-opacity='0.35'")
    # embasamento: parede poente da cave com portão
    rect(G.FOOT[1], 34.1, G.FOOT[3], 36.9, 'url(#board2)')
    rect(2.32, 34.1, 7.32, 36.40, '#8f8a81', INK, 0.8)
    for k in range(1, 5):
        z = 34.1 + k * 2.3 / 5; svg.add(f"<line x1='{fmt(X(7.32))}' y1='{fmt(Y(z))}' x2='{fmt(X(2.32))}' y2='{fmt(Y(z))}' stroke='#6f6a62' stroke-width='0.8'/>")
    # muros do pátio da garagem (cortados no limite) e deck
    rect(7.90, 33.8, 8.20, 37.95, '#6d6a64'); rect(1.40, 33.8, 1.70, 38.0, '#6d6a64')
    rect(-8.20, 35.0, 1.40, 37.03, 'url(#board2)', INK, 0.6)
    rect(-4.75, 37.0, 1.40, 38.05, '#cfe2e5', '#6a9aa3', 1, "fill-opacity='0.35'")
    # estrada (à frente) — perfil
    pts = [(v, G.road_z(0, v)) for v in [vmin + i * 0.5 for i in range(int((vmax - vmin) / 0.5) + 1)]]
    svg.add("<path d='M" + ' L'.join(f'{fmt(X(v))},{fmt(Y(z))}' for v, z in pts) + f" L{fmt(X(vmax))},{fmt(Y(zmin))} L{fmt(X(vmin))},{fmt(Y(zmin))} Z' fill='#e2ded6' stroke='{INK}' stroke-width='1.2'/>")
    svg.add(text('estrada nova (perfil aproximado)', X(-6.5), Y(G.road_z(0, -6.5)) + 18, 9, MID))
    svg.add(f"<line x1='{fmt(X(G.FOOT[3]))}' y1='{fmt(Y(G.Z_RC + 3.9))}' x2='{fmt(X(G.FOOT[1]))}' y2='{fmt(Y(G.Z_RC + 3.9))}' stroke='#b0413e' stroke-dasharray='6 4'/>")
    svg.add(text('+3,90 PIP', X(G.FOOT[1]) + 4, Y(G.Z_RC + 3.9) - 5, 9, '#b0413e', anchor='start'))
    for z, lab in [(G.Z_GPATIO, '34,20'), (G.Z_RC, '37,00'), (G.Z_ROOF_TOP, '40,45')]:
        svg.add(text(lab, X(vmax) + 4, Y(z) + 4, 9.5, INK, anchor='start', weight=600))
    svg.add(text('NORTE', X(vmax) + 10, Y(zmax) + 12, 10, MID, weight=700)); svg.add(text('SUL', X(vmin) - 14, Y(zmax) + 12, 10, MID, weight=700))
    svg.add(text('ALÇADO POENTE (frente da estrada, vista para o mar)', 18, 24, 14, INK, anchor='start', weight=700))
    svg.add(text('portão da garagem à face do embasamento · varanda em consola · portadas de correr em ripado', 18, 41, 10.5, MID, anchor='start'))
    svg.save(path)

if __name__ == '__main__':
    plan('rc', 'out/planta_rc.svg')
    plan('cave', 'out/planta_cave.svg', 'f1')
    plan('cave', 'out/planta_cave_f2.svg', 'f2')
    site('out/implantacao.svg')
    section('out/corte_aa.svg', 3.6, 'CORTE A-A · sala, deck e piscina', 'a casa fica 1,05 m abaixo do beirado e 2,05 m abaixo da cumeeira previstos no PIP')
    section('out/corte_bb.svg', 12.6, 'CORTE B-B · suites, Sala do Jardim e pátio afundado', 'dois jardins: o terraço norte ao nível do R/C e o pátio a sul ao nível da cave')
    elev_south('out/alcado_sul.svg')
    elev_west('out/alcado_poente.svg')
    print('ok')
