# -*- coding: utf-8 -*-
"""Cortes e alçados a partir do modelo 3D (out/spec.json): o que o plano corta sai a negro (poché),
o que está para lá sai em alçado, mais claro com a distância. Serve as duas casas, o sítio e a casa de A."""
import math, json
import numpy as np
from shapely.geometry import Polygon, LineString, Point, box as sbox
import sitio as S
import casas as C
from draw import SVG, text, fmt, num, POCHE, PAPER, INK, MID, LIGHT, WATER, ground_final, north_arrow, spec

FILL = {
    'render': '#f3f1ec', 'plaster': '#efede7', 'ceiling': '#f3f1ec', 'granite_wall': '#a39d92', 'granite_base': '#cfc8bc', 'granite': '#c9c2b6',
    'coping': '#d6d0c5', 'deck': '#d9d2c6', 'concrete': '#dedad2', 'soffit': '#e6e2da', 'reveal': '#3a342d', 'frame': '#3a342d', 'metal': '#3a342d',
    'metal_black': '#222', 'glass': '#b9d0d6', 'glass_dark': '#6f8288', 'a_wall': '#e8e3da', 'a_roof': '#4a4e52', 'timber': '#b98a57', 'shutter': '#b98a57',
    'oak': '#a8774c', 'oak_panel': '#c49a6c', 'floor_int': '#cbb497', 'floor_wood': '#cbb497', 'tile': '#d8d4cc', 'cave_floor': '#a9a59d',
    'gravel': '#a39d94', 'gpatio': '#d6ccb8', 'water': '#8cc6cc', 'liner': '#9fbfbc', 'car': '#a3a8ad',
}
CUT_SKIP = {'furn'}

def elements():
    """Todos os sólidos em coordenadas locais: (polígono, z0, z1, material, etiqueta, grupo)."""
    out = []
    for g in spec['groups'] + [spec['site']]:
        ou, ov = g['o']; a = g['a']; c, s = math.cos(a), math.sin(a)
        L = lambda x, y: (ou + x * c - y * s, ov + x * s + y * c)
        for b in g['boxes']:
            (x0, y0, z0), (x1, y1, z1) = b['a'], b['b']
            poly = Polygon([L(x0, y0), L(x1, y0), L(x1, y1), L(x0, y1)])
            m = b['m']
            # material da face exterior visível (paredes exteriores): usa o primeiro material de fachada
            if b.get('f'):
                fm = [v for k, v in b['f'].items() if k not in ('top', 'bot') and v not in ('reveal', 'plaster')]
                if fm: m = fm[0]
            out.append(dict(p=poly, z=(z0, z1), m=m, t=b.get('t'), g=g['n']))
        for p in g['prisms']:
            poly = Polygon([L(*q) for q in p['p']], [[L(*q) for q in h] for h in p['h']]).buffer(0)
            if poly.is_empty: continue
            out.append(dict(p=poly, z=tuple(p['z']), m=p['side'] if p['t'] not in ('floor',) else p['top'], t=p['t'], g=g['n'], top=p['top']))
        if g.get('roof_tri'):
            tri = g['roof_tri']
            # telhado de A: fatias de 0,25 m em v para cortes/alçados
            vs = [q[0] for q in tri]; zs = [q[1] for q in tri]
            ridge_v = tri[2][0]; ridge_z = tri[2][1]; v0, v1 = tri[0][0], tri[1][0]; ze = tri[0][1]
            vv = v0
            while vv < v1 - 1e-6:
                va, vb = vv, min(v1, vv + 0.25)
                vm = (va + vb) / 2
                zt = ze + (ridge_z - ze) * (1 - abs(vm - ridge_v) / (ridge_v - v0 if vm < ridge_v else v1 - ridge_v))
                poly = Polygon([L(-0.3, va), L(15.3, va), L(15.3, vb), L(-0.3, vb)])
                out.append(dict(p=poly, z=(ze, zt), m='a_roof', t='roofA', g='A')); vv = vb
    return out
ELS = elements()

class Section:
    """Plano vertical pela reta O + s·d; olha para o lado n (normal à esquerda de d se look='left')."""
    def __init__(self, O, d, look='left', smin=0.0, smax=50.0, zmin=30.0, zmax=40.0, Sc=30.0, title='', sub='', labels=None):
        self.O = np.array(O, float); d = np.array(d, float); self.d = d / np.linalg.norm(d)
        n = np.array([-self.d[1], self.d[0]]); self.n = n if look == 'left' else -n
        self.smin, self.smax, self.zmin, self.zmax, self.Sc = smin, smax, zmin, zmax, Sc
        self.W = (smax - smin) * Sc + 140; self.H = (zmax - zmin) * Sc + 110
        self.svg = SVG(self.W, self.H); self.title, self.sub = title, sub
    def X(self, s): return 70 + (s - self.smin) * self.Sc
    def Y(self, z): return 64 + (self.zmax - z) * self.Sc
    def sd(self, p): q = np.array(p) - self.O; return float(q @ self.d), float(q @ self.n)
    def rect(self, s0, z0, s1, z1, fill, op=1.0, stroke='none', sw=0.0, extra=''):
        s0, s1 = max(s0, self.smin), min(s1, self.smax)
        z0, z1 = max(z0, self.zmin), min(z1, self.zmax)
        if s1 <= s0 or z1 <= z0: return
        self.svg.add(f"<rect x='{fmt(self.X(s0))}' y='{fmt(self.Y(z1))}' width='{fmt((s1 - s0) * self.Sc)}' height='{fmt(max(0.6, (z1 - z0) * self.Sc))}' fill='{fill}' fill-opacity='{op:.2f}' stroke='{stroke}' stroke-width='{sw}' {extra}/>")
    def draw(self, depth_max=60.0, groups=None, ground=True, natural=True):
        cut, beyond = [], []
        for e in ELS:
            if groups and e['g'] not in groups: continue
            pts = list(e['p'].exterior.coords)
            sds = [self.sd(p) for p in pts]
            ds = [q[1] for q in sds]; ss = [q[0] for q in sds]
            if max(ss) < self.smin or min(ss) > self.smax: continue
            if min(ds) < 0 < max(ds):
                line = LineString([tuple(self.O + self.d * (self.smin - 5)), tuple(self.O + self.d * (self.smax + 5))])
                ix = e['p'].intersection(line)
                if ix.is_empty: continue
                for g in (ix.geoms if hasattr(ix, 'geoms') else [ix]):
                    cs = list(g.coords) if hasattr(g, 'coords') else []
                    if len(cs) < 2: continue
                    s_ = [self.sd(c)[0] for c in cs]
                    cut.append((min(s_), max(s_), e))
            elif min(ds) >= 0 and min(ds) < depth_max:
                beyond.append((min(ds), min(ss), max(ss), e))
        # alçado para lá do plano: do mais longe para o mais perto
        beyond.sort(key=lambda q: -q[0])
        for dep, s0, s1, e in beyond:
            m = e['m']; z0, z1 = e['z']
            if e['t'] in ('floor', 'terrace_body', 'deck_body', 'slab_bar', 'slab_box', 'alp_floor', 'car_floor') and dep > 0.5: continue
            col = FILL.get(m, '#ddd'); fade = max(0.25, 1.0 - dep / depth_max * 0.85)
            if e['t'] == 'furn': col = '#e2ddd3'
            if m == 'glass':
                self.rect(s0, z0, s1, z1, col, 0.55 * fade, '#6f8f96', 0.3); continue
            sw = 0.6 if (s1 - s0) * self.Sc > 3 else 0.3
            self.rect(s0, z0, s1, z1, col, 1.0, INK, sw * fade, f"stroke-opacity='{fade:.2f}'")
            if m in ('timber', 'shutter') and (s1 - s0) > 0.2:
                for k in range(int((s1 - s0) / 0.08)):
                    x = self.X(s0 + k * 0.08)
                    self.svg.add(f"<line x1='{fmt(x)}' y1='{fmt(self.Y(z1))}' x2='{fmt(x)}' y2='{fmt(self.Y(z0))}' stroke='#7d5a33' stroke-width='0.4' stroke-opacity='{fade * 0.7:.2f}'/>")
            if m == 'granite_wall' and (s1 - s0) > 0.3:
                zz = z0 + 0.3
                while zz < z1:
                    self.svg.add(f"<line x1='{fmt(self.X(s0))}' y1='{fmt(self.Y(zz))}' x2='{fmt(self.X(s1))}' y2='{fmt(self.Y(zz))}' stroke='#6f685e' stroke-width='0.5' stroke-opacity='{fade * 0.6:.2f}'/>"); zz += 0.32
            # véu de profundidade
            if fade < 0.98: self.rect(s0, z0, s1, z1, PAPER, (1 - fade) * 0.8)
        # terreno ao longo do plano
        ss = np.arange(self.smin, self.smax + 0.01, 0.25)
        if ground:
            pts = [(self.X(s), self.Y(ground_final(*(self.O + self.d * s)))) for s in ss]
            poly = pts + [(pts[-1][0], self.Y(self.zmin)), (pts[0][0], self.Y(self.zmin))]
            self.svg.add("<path d='M" + ' L'.join(f'{fmt(a)},{fmt(b)}' for a, b in poly) + f" Z' fill='#e9e3d6' stroke='none'/>")
            self.svg.add("<polyline points='" + ' '.join(f'{fmt(a)},{fmt(b)}' for a, b in pts) + f"' fill='none' stroke='{INK}' stroke-width='1.3'/>")
        if natural:
            pts = [(self.X(s), self.Y(S.natural(*(self.O + self.d * s)))) for s in ss]
            self.svg.add("<polyline points='" + ' '.join(f'{fmt(a)},{fmt(b)}' for a, b in pts) + f"' fill='none' stroke='{MID}' stroke-width='0.9' stroke-dasharray='4 3'/>")
        # cortado
        for s0, s1, e in cut:
            if e['t'] in CUT_SKIP:
                self.rect(s0, e['z'][0], s1, e['z'][1], '#e2ddd3', 1, MID, 0.5); continue
            m = e['m']; z0, z1 = e['z']
            if m == 'glass': self.rect(s0, z0, s1, z1, '#a9c9cf', 0.9); continue
            if m == 'water': self.rect(s0, z0 - 1.3, s1, z1, WATER, 1); continue
            if e['t'] in ('roofA',): self.rect(s0, z0, s1, z1, '#55595d', 1); continue
            col = POCHE
            if e['g'] == 'A': self.rect(s0, z0, s1, z1, '#8f8a82', 1); continue
            if e['t'] in ('slab_bar', 'slab_box') and z1 - z0 > 0.4:
                self.rect(s0, z0, s1, z1 - 0.25, '#d8d1c3', 1); self.rect(s0, z1 - 0.25, s1, z1, POCHE, 1); continue
            if e['t'] in ('deck_body', 'terrace_body'): col = '#cfc8bc'
            if e['t'] == 'hedge': col = '#9db586'
            if m == 'granite_wall': col = '#6d675e'
            self.rect(s0, z0, s1, z1, col, 1)
    def level(self, s, z, lab, side='right'):
        x, y = self.X(s), self.Y(z)
        self.svg.add(f"<line x1='{fmt(x - 26)}' y1='{fmt(y)}' x2='{fmt(x + 26)}' y2='{fmt(y)}' stroke='{MID}' stroke-width='0.7'/>")
        self.svg.add(f"<path d='M{fmt(x)},{fmt(y)} l-5,-7 l10,0 Z' fill='{INK}'/>")
        self.svg.add(text(lab, x + (8 if side == 'right' else -8), y - 3, 9, INK, anchor='start' if side == 'right' else 'end', weight=600, halo=True))
    def label(self, s, z, t_, size=9, col=MID, weight=400, anchor='middle', italic=False):
        self.svg.add(text(t_, self.X(s), self.Y(z), size, col, anchor=anchor, weight=weight, italic=italic, halo=True))
    def person(self, s, z):
        x, y = self.X(s), self.Y(z); S_ = self.Sc
        self.svg.add(f"<circle cx='{fmt(x)}' cy='{fmt(y - 1.62 * S_ + 4)}' r='{fmt(0.11 * S_)}' fill='{MID}'/><path d='M{fmt(x - 0.16 * S_)},{fmt(y)} L{fmt(x - 0.1 * S_)},{fmt(y - 1.4 * S_)} L{fmt(x + 0.1 * S_)},{fmt(y - 1.4 * S_)} L{fmt(x + 0.16 * S_)},{fmt(y)} Z' fill='{MID}'/>")
    def tree(self, s, z, h, d, col='#9fb784'):
        self.svg.add(f"<line x1='{fmt(self.X(s))}' y1='{fmt(self.Y(z))}' x2='{fmt(self.X(s))}' y2='{fmt(self.Y(z + h * 0.5))}' stroke='#7b6a55' stroke-width='2'/>")
        self.svg.add(f"<ellipse cx='{fmt(self.X(s))}' cy='{fmt(self.Y(z + h * 0.68))}' rx='{fmt(d / 2 * self.Sc)}' ry='{fmt(h * 0.3 * self.Sc)}' fill='{col}' fill-opacity='0.45' stroke='#7c9a5a' stroke-width='0.7'/>")
    def finish(self, path, left='', right='', bar=10):
        self.svg.add(text(self.title, 18, 24, 14, INK, anchor='start', weight=700))
        self.svg.add(text(self.sub, 18, 41, 10.5, MID, anchor='start'))
        if left: self.svg.add(text(left, self.X(self.smin) + 4, self.Y(self.zmax) + 12, 10, MID, anchor='start', weight=700))
        if right: self.svg.add(text(right, self.X(self.smax) - 4, self.Y(self.zmax) + 12, 10, MID, anchor='end', weight=700))
        x0 = self.X(self.smin); y = self.H - 24
        self.svg.add(f"<line x1='{fmt(x0)}' y1='{fmt(y)}' x2='{fmt(x0 + bar * self.Sc)}' y2='{fmt(y)}' stroke='{INK}' stroke-width='2'/>")
        for k in range(bar + 1):
            self.svg.add(f"<line x1='{fmt(x0 + k * self.Sc)}' y1='{fmt(y - 3)}' x2='{fmt(x0 + k * self.Sc)}' y2='{fmt(y + 3)}' stroke='{INK}' stroke-width='0.8'/>")
        self.svg.add(text(f'{bar} m', x0 + bar * self.Sc + 18, y + 4, 9, MID))
        self.svg.save(path)

def house_line(H, p0, p1):
    """reta no referencial da casa → (O, d) em coordenadas locais."""
    a, b = H.H2L(*p0), H.H2L(*p1); return a, (b[0] - a[0], b[1] - a[1])

# ============================================================================ cortes
def corte_vista_A(path):
    v0 = 5.0
    sec = Section((18.0, v0), (-1.0, 0.0), look='right', smin=0.0, smax=82.0, zmin=30.6, zmax=45.0, Sc=17.0,
                  title='CORTE PELA VISTA DA CASA DE A · sala de A → estrada → Casa do Pátio',
                  sub='a caixa alta da Casa do Pátio fica 1,40 m abaixo dos olhos de quem está de pé na sala de A; a piscina fica na sombra da vista')
    sec.draw(depth_max=26.0)
    eye = (18.5, 38.6)
    def S_(u): return 18.0 - u
    # linha rasante pelo topo poente da caixa
    bx = C.N.polyL(C.N.box_poly).bounds
    top = C.N.F + C.BOX_TOP; s_top = S_(bx[0])
    s_far = 80.0; z_far = eye[1] + (top - eye[1]) * (s_far - eye[0]) / (s_top - eye[0])
    sec.svg.add(f"<line x1='{fmt(sec.X(eye[0]))}' y1='{fmt(sec.Y(eye[1]))}' x2='{fmt(sec.X(s_far))}' y2='{fmt(sec.Y(z_far))}' stroke='#b0413e' stroke-width='1.2' stroke-dasharray='7 4'/>")
    sec.svg.add(f"<line x1='{fmt(sec.X(eye[0]))}' y1='{fmt(sec.Y(eye[1]))}' x2='{fmt(sec.X(81.5))}' y2='{fmt(sec.Y(eye[1] - 0.0035 * 63))}' stroke='#2b6b66' stroke-width='1.2' stroke-dasharray='2 3'/>")
    sec.label(60.0, 39.25, 'linha do horizonte (mar) — passa por cima de tudo', 9, '#2b6b66', italic=True)
    sec.label(64.0, 36.55, 'rasante pelo topo da caixa: o que fica por baixo não se vê de A', 9, '#b0413e', italic=True)
    sec.svg.add(f"<circle cx='{fmt(sec.X(eye[0]))}' cy='{fmt(sec.Y(eye[1]))}' r='3.5' fill='#b0413e'/>")
    sec.label(eye[0] + 0.3, eye[1] + 0.5, 'olhos 38,60', 9, '#b0413e', weight=600, anchor='start')
    sec.person(19.0, 37.0)
    sec.person(S_(-41.0), C.N.Sz)
    for z, lab, s in [(37.0, 'R/C A 37,00', 13.5), (top, 'topo da caixa ' + num(top), S_(bx[2]) - 0.5), (C.N.Sz, 'sala e piscina ' + num(C.N.Sz), S_(-44.0))]:
        sec.level(s, z, lab)
    sec.label(S_(-14.0), 34.9, 'estrada nova', 9, MID, italic=True)
    sec.label(S_(-42.5), 31.2, 'piscina', 9, '#2f6f74', weight=600)
    sec.label(S_(-35.4), 35.8, 'alpendre', 8.5, MID)
    sec.label(S_(-29.8), 34.4, 'sala (pé-direito 4,11)', 8.5, MID)
    sec.svg.add(text('CASA DE A', sec.X(10.5), sec.Y(40.2), 10, '#f3efe6', weight=700)); sec.svg.add(text('NordicSea, só volumetria', sec.X(10.5), sec.Y(39.6), 8.5, '#f3efe6'))
    sec.finish(path, left='NASCENTE', right='POENTE')

def corte_patios(path):
    xline = 15.5
    O = C._line_frame(xline, -21.0); P1 = C._line_frame(xline, 31.0)
    d = (P1[0] - O[0], P1[1] - O[1])
    sec = Section(O, d, look='right', smin=0.0, smax=52.0, zmin=30.4, zmax=41.0, Sc=24.0,
                  title='CORTE PELOS DOIS PÁTIOS · perpendicular à linha de divisão',
                  sub='jardim sul e sala da Casa Comprida · muro de meação e sebe · piscina e quartos da Casa do Pátio · ângulos do sol ao meio-dia')
    sec.draw(depth_max=18.0, groups=['N', 'S', 'site'])
    s_line = 21.0
    sec.svg.add(f"<line x1='{fmt(sec.X(s_line))}' y1='{fmt(sec.Y(30.6))}' x2='{fmt(sec.X(s_line))}' y2='{fmt(sec.Y(40.6))}' stroke='#b0413e' stroke-width='1' stroke-dasharray='10 4 2 4'/>")
    sec.label(s_line, 40.75, 'limite B-sul | B-norte', 9, '#b0413e', weight=600)
    # sebe junto ao muro (lado norte)
    zg = ground_final(*C._line_frame(xline, 0.9))
    sec.svg.add(f"<ellipse cx='{fmt(sec.X(s_line + 0.9))}' cy='{fmt(sec.Y(zg + 1.15))}' rx='{fmt(0.55 * sec.Sc)}' ry='{fmt(1.15 * sec.Sc)}' fill='#9db586' fill-opacity='0.7' stroke='#6f8b52'/>")
    # sol ao meio-dia (altura aparente no plano do corte)
    box_top = C.SH.F + C.BOX_TOP; s_box_n = None
    for e in ELS:
        pass
    sb = 21.0 - 3.2
    for alt, nm, col in [(29.5, '21 dez · 12h (≈ 30° no plano do corte)', '#9a5b12'), (75.0, '21 jun · 12h', '#c09030')]:
        L = 12.0; x2 = sb + L * math.cos(math.radians(alt)); z2 = box_top - L * math.sin(math.radians(alt))
        zz = max(z2, C.N.Sz)
        s_hit = sb + (box_top - C.N.Sz) / math.tan(math.radians(alt))
        sec.svg.add(f"<line x1='{fmt(sec.X(sb))}' y1='{fmt(sec.Y(box_top))}' x2='{fmt(sec.X(s_hit))}' y2='{fmt(sec.Y(C.N.Sz))}' stroke='{col}' stroke-width='1.1' stroke-dasharray='5 3'/>")
        sec.label(s_hit - 0.4 if alt > 60 else s_hit - 6.5, C.N.Sz + (1.6 if alt > 60 else 2.6), nm, 8.5, col, anchor='end' if alt > 60 else 'start', italic=True)
    for H, s, lab in [(C.SH, 9.0, 'Casa Comprida'), (C.N, 33.5, 'Casa do Pátio')]:
        sec.label(s, 39.4, lab, 11, '#a4632a' if H.key == 'S' else '#3f6e8c', weight=700)
    sec.level(3.0, C.SH.Sz, 'jardim sul ' + num(C.SH.Sz), 'right')
    sec.level(14.0, box_top, 'topo ' + num(box_top), 'right')
    sec.level(31.6, C.N.Sz, 'deck/piscina ' + num(C.N.Sz), 'right')
    sec.level(41.0, C.N.F + C.BAR_TOP, 'topo da ala ' + num(C.N.F + C.BAR_TOP), 'right')
    sec.person(4.0, C.SH.Sz); sec.person(27.0, C.N.Sz)
    sec.finish(path, left='SUDESTE', right='NOROESTE')

def corte_casa_patio(path):
    H = C.N
    O, d = house_line(H, (17.4, -11.0), (17.4, 11.0))
    sec = Section(O, d, look='right', smin=0.0, smax=22.0, zmin=31.4, zmax=38.2, Sc=46.0,
                  title='CORTE A-A · CASA DO PÁTIO · pela caixa da sala (sul → norte)',
                  sub='sala 3 degraus abaixo da cozinha: pé-direito 4,11 na sala e 3,60 na cozinha · clerestório no lado fechado · quartos a 2,60')
    sec.draw(depth_max=12.0, groups=['N', 'site'])
    F, Sz = H.F, H.Sz
    for z, lab, s in [(Sz, 'sala ' + num(Sz), 4.0), (F, 'cozinha · jantar ' + num(F), 15.2), (F + C.BOX['ceil'], 'teto ' + num(F + C.BOX['ceil']), 8.0), (F + C.BOX_TOP, 'topo ' + num(F + C.BOX_TOP), 16.6)]:
        sec.level(s, z, lab)
    sec.label(8.6, Sz + 2.0, 'pé-direito 4,11', 9, MID); sec.label(14.0, F + 1.8, 'pé-direito 3,60', 9, MID)
    sec.person(7.5, Sz); sec.person(13.6, F)
    sec.finish(path, left='SUL', right='NORTE', bar=5)

def corte_casa_comprida(path):
    H = C.SH
    O, d = house_line(H, (-25.5, 2.4), (27.0, 2.4))
    sec = Section(O, d, look='left', smin=0.0, smax=52.5, zmin=31.0, zmax=39.0, Sc=30.0,
                  title='CORTE B-B · CASA COMPRIDA · da piscina ao portão (poente → nascente)',
                  sub='piscina e alpendre ao nível da sala · caixa alta · ala dos quartos · alpendre de estacionamento à cota da rampa')
    sec.draw(depth_max=14.0, groups=['S', 'site'])
    F, Sz = H.F, H.Sz
    for z, lab, s in [(Sz, 'deck · sala ' + num(Sz), 3.0), (F, 'quartos · cozinha ' + num(F), 30.0), (H.C, 'alpendre ' + num(H.C), 44.5), (F + C.BOX_TOP, 'topo ' + num(F + C.BOX_TOP), 18.0), (F + C.BAR_TOP, 'topo ' + num(F + C.BAR_TOP), 35.0)]:
        sec.level(s, z, lab)
    sec.person(6.0, Sz); sec.person(17.0, Sz); sec.person(31.0, F)
    sec.label(5.8, Sz - 0.9, 'piscina', 9, '#2f6f74', weight=600)
    sec.finish(path, left='POENTE', right='NASCENTE', bar=5)

def alcado(H, path, title, sub, y_front, xr, zr, Sc):
    O, d = house_line(H, (xr[0], y_front), (xr[1], y_front))
    sec = Section(O, d, look='left', smin=0.0, smax=xr[1] - xr[0], zmin=zr[0], zmax=zr[1], Sc=Sc, title=title, sub=sub)
    sec.draw(depth_max=24.0, groups=[H.key], natural=False)
    return sec

def alcado_patio(path):
    H = C.N
    sec = alcado(H, path, 'ALÇADO SUL · CASA DO PÁTIO · visto do pátio', 'ala dos quartos com pala e portadas de madeira · alpendre da piscina com muro de granito · caixa alta da sala · alpendre de estacionamento',
                 -8.6, (-2.0, 31.0), (31.6, 38.4), 36.0)
    for z, lab in [(H.F + C.BAR_TOP, num(H.F + C.BAR_TOP)), (H.F + C.BOX_TOP, num(H.F + C.BOX_TOP)), (H.Sz, num(H.Sz))]:
        sec.level(32.0, z, lab)
    sec.finish(path, left='POENTE', right='NASCENTE', bar=5)

def alcado_comprida(path):
    H = C.SH
    sec = alcado(H, path, 'ALÇADO SUL · CASA COMPRIDA · visto do jardim', 'piscina e alpendre · caixa alta com o vão da sala e do jantar · ala dos quartos com pala e portadas · entrada e alpendre de estacionamento',
                 -6.4, (-26.0, 26.5), (31.6, 38.6), 28.0)
    for z, lab in [(H.F + C.BAR_TOP, num(H.F + C.BAR_TOP)), (H.F + C.BOX_TOP, num(H.F + C.BOX_TOP)), (H.Sz, num(H.Sz))]:
        sec.level(51.5, z, lab)
    sec.finish(path, left='POENTE', right='NASCENTE', bar=5)

if __name__ == '__main__':
    corte_vista_A('out/corte_vista_A.svg'); corte_patios('out/corte_patios.svg')
    corte_casa_patio('out/corte_aa.svg'); corte_casa_comprida('out/corte_bb.svg')
    alcado_patio('out/alcado_patio.svg'); alcado_comprida('out/alcado_comprida.svg')
    print('ok')
