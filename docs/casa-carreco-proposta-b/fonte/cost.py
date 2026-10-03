# -*- coding: utf-8 -*-
"""Estimativa de custo da Casa Plinto (sem IVA, Minho 2026), com quantidades medidas sobre geom.py."""
import json, math
from shapely.geometry import Point, LineString, box as sbox
from shapely.ops import unary_union
import geom as G

def integ(poly, f, step=0.25):
    minx, miny, maxx, maxy = poly.bounds; s = 0.0
    y = miny + step / 2
    while y < maxy:
        x = minx + step / 2
        while x < maxx:
            if poly.contains(Point(x, y)): s += f(x, y) * step * step
            x += step
        y += step
    return s

# ------------------------------------------------------------- quantidades
exc_cave = integ(G.CAVE_POLY, lambda u, v: max(0, G.natural(u, v) - 33.80))
exc_patio = integ(sbox(9.10, -5.10, 15.50, -1.33), lambda u, v: max(0, G.natural(u, v) - 33.70))
exc_gpatio = integ(G.GPATIO_POLY, lambda u, v: max(0, G.natural(u, v) - 33.90))
deck_net = G.DECK_POLY.difference(sbox(*G.POOL))
fill_deck = integ(deck_net, lambda u, v: max(0, 36.80 - G.natural(u, v)))
nt = G.NORTH_TERRACE.intersection(G.PARCEL_A).difference(G.FOOT_POLY)
fill_north = integ(nt, lambda u, v: max(0, 36.85 - G.natural(u, v))) * 1.35   # + taludes
fill_south = integ(G.PARCEL_A.intersection(sbox(-3.0, -11.0, 9.1, -8.2)), lambda u, v: max(0, 35.75 - G.natural(u, v)))
exc = exc_cave + exc_patio + exc_gpatio
fill = fill_deck + fill_north + fill_south
cave_perim = G.CAVE_POLY.length
cave_wall_area = cave_perim * (G.Z_PLINTH_TOP - 33.80)
rc_perim = G.FOOT_POLY.length
op_rc_ext = sum((o['r'][2] - o['r'][0] + o['r'][3] - o['r'][1] - 0.30) * (o['z'][1] - o['z'][0]) for o in G.OPEN['rc'] if o['n'] != 'p')
rc_wall_gross = rc_perim * (G.Z_CEIL - G.Z_RC)
rc_wall_net = rc_wall_gross - op_rc_ext
clad_area = rc_wall_net + rc_perim * (G.Z_ROOF_TOP - G.Z_CEIL)
def area_of(names):
    return sum((o['r'][2] - o['r'][0] + o['r'][3] - o['r'][1] - 0.30) * (o['z'][1] - o['z'][0]) for lvl in ('rc', 'cave') for o in G.OPEN[lvl] if o['n'] in names)
slide_area = area_of({'V1', 'V2', 'V6', 'V15'})
win_area = area_of({'V4', 'V5', 'V7', 'V8', 'V9', 'V10', 'V13', 'V16'})
int_walls_len = sum(max(w[2] - w[0], w[3] - w[1]) for w in G.WALLS['rc'] if not w[4]) + sum(max(w[2] - w[0], w[3] - w[1]) for w in G.WALLS['cave'] if not w[4])
# muros exteriores (embasamento do deck, pátio afundado, pátio da garagem)
deck_edge = G.DECK_POLY.exterior.difference(G.FOOT_POLY.buffer(0.05))
deck_wall_area = 0.0
for i in range(200):
    p = deck_edge.interpolate(i / 200, normalized=True)
    deck_wall_area += (deck_edge.length / 200) * max(0.6, 37.0 - min(G.natural(p.x, p.y), 35.9) + 0.5)
patio_wall_area = 3.77 * (37.03 - 33.6) + 5.1 * (36.0 - 33.6) + 3.77 * (36.0 - 33.6)
gp_wall_area = 7.3 * (37.95 - 33.6)
interior_net_rc = sum(a for _, a in G.areas()['rc'])

Q = dict(exc=exc, fill=fill, exc_cave=exc_cave, exc_patio=exc_patio, exc_gpatio=exc_gpatio, fill_deck=fill_deck, fill_north=fill_north,
         cave_wall_area=cave_wall_area, rc_wall_net=rc_wall_net, clad_area=clad_area, slide_area=slide_area, win_area=win_area,
         int_walls_len=int_walls_len, deck_wall_area=deck_wall_area, patio_wall_area=patio_wall_area, gp_wall_area=gp_wall_area)

# ------------------------------------------------------------- orçamento na MESMA BASE DE PREÇOS do MQT v4.2 (€, sem IVA)
A_rc, A_cave = G.FOOT_POLY.area, G.CAVE_POLY.area
rc_int_len = sum(max(w[2] - w[0], w[3] - w[1]) for w in G.WALLS['rc'] if not w[4])
cave_int_len = sum(max(w[2] - w[0], w[3] - w[1]) for w in G.WALLS['cave'] if not w[4])
ext_walls = deck_wall_area + gp_wall_area
CH = ['Estaleiro e terras', 'Estrutura', 'Envolvente', 'Caixilharia, vidros e serralharia', 'Acabamentos, carpintarias e louças', 'Instalações', 'Arranjos exteriores']
items = [
 (CH[0], 'Estaleiro, implantação topográfica, demolição do anexo e abate da árvore (como v4.2)', 1, 'vg', 6523, 1),
 (CH[0], 'Decapagem da terra vegetal (guardada para o jardim)', 1, 'vg', 250, 1),
 (CH[0], 'Escavação: cave, pátio afundado e pátio da garagem', exc, 'm³', 7, 1),
 (CH[0], 'Aterro drenante no tardoz dos muros', 45, 'm³', 18, 1),
 (CH[0], 'Aterro do deck, terraço norte e caminho com as terras da obra (sem empréstimo)', fill, 'm³', 10, 1),
 (CH[0], 'Sobrante espalhado e modelado na parcela B; modelação final', 1, 'vg', 2500, 1),
 (CH[0], 'Contingência para rocha (granito)', 1, 'vg', 2730, 1),
 (CH[1], 'Betão de limpeza e sapatas (contínuas sob os muros + isoladas)', 37.5, 'm³', 182, 1),
 (CH[1], 'Muros da cave em bloco de cofragem perdida armado', cave_wall_area, 'm²', 70, 1),
 (CH[1], 'Laje térrea da cave', A_cave, 'm²', 39, 1),
 (CH[1], 'Pilares e vigas (R/C e cobertura, incl. vigas invertidas da pala)', 20.5, 'm³', 440, 1),
 (CH[1], 'Laje aligeirada do R/C', A_rc, 'm²', 48, 1),
 (CH[1], 'Laje da varanda poente em consola (1,20 m)', 7.6, 'm²', 60, 1),
 (CH[1], 'Laje aligeirada de cobertura (plana)', A_rc, 'm²', 48, 1),
 (CH[1], 'Pala em consola 2,00 m — laje maciça 0,30 em betão à vista', G.PALA_POLY.area * 0.30, 'm³', 480, 1),
 (CH[1], 'Escada interior em betão', 1.54, 'm³', 520, 1),
 (CH[1], 'Muros do embasamento (deck/estrada) e do pátio da garagem, bloco armado', ext_walls, 'm²', 70, 1),
 (CH[1], 'Sapatas em L desses muros', ext_walls * 0.26, 'm³', 190, 1),
 (CH[1], 'Pátio afundado: muro poente armado; muros sul e nascente em socalco de pedra seca (granito da obra)', 1, 'vg', 3900, 1),
 (CH[1], 'Degraus exteriores em granito (deck → caminho; pátio)', 17, 'un', 85, 1),
 (CH[2], 'Alvenaria exterior em tijolo 15 (R/C + platibanda)', rc_wall_net + 17, 'm²', 24, 1),
 (CH[2], 'Divisórias do R/C em gesso cartonado (normal, hidrófugo, acústico)', rc_int_len * 2.85, 'm²', 29, 1),
 (CH[2], 'Divisórias da cave em bloco 15', cave_int_len * 2.55, 'm²', 24, 1),
 (CH[2], 'Cobertura plana invertida: pendentes, impermeabilização, XPS 120, seixo, ralos e trop-plein', A_rc, 'm²', 52, 1),
 (CH[2], 'Capeamento da platibanda e da pala em chapa quinada preta', 58, 'm', 38, 1),
 (CH[2], 'Impermeabilização e drenagem dos muros enterrados (cave e muros exteriores)', 86 + ext_walls * 0.6, 'm²', 27, 1),
 (CH[2], 'Isolamento EPS 80 sob a laje do R/C (teto da cave); anti-radão; selagens EI', 1, 'vg', 3500, 1),
 (CH[2], 'Fachada: ripado de pinho autoclave cl.4 carbonizado pelo dono de obra + subestrutura + lã mineral 60', clad_area, 'm²', 60, 1),
 (CH[2], 'Remates de cantos, ombreiras e peitoris em chapa quinada preta', 90, 'm', 12, 1),
 (CH[2], 'Embasamento e muros: reboco areado pigmentado cor de granito (faces vistas)', 110, 'm²', 18, 1),
 (CH[2], 'Sobrecusto de betão à vista com cofragem de tábua (fachada da garagem, teto da pala)', 60, 'm²', 40, 1),
 (CH[3], 'Portas de correr (V1, V2, V6, V15) em PVC foliado preto, vidro de controlo solar a poente e sul', slide_area, 'm²', 300, 1),
 (CH[3], 'Janelas em PVC foliado preto (8 un.)', win_area, 'm²', 220, 1),
 (CH[3], 'Portas envidraçadas da cozinha e da lavandaria', 4.9, 'm²', 320, 1),
 (CH[3], 'Porta blindada + painel fixo até ao teto, ambos revestidos a carvalho', 1, 'vg', 1450, 1),
 (CH[3], 'Portão seccionado isolado, revestido à face do embasamento', 1, 'vg', 2800, 1),
 (CH[3], 'Claraboias fixas (ilha e escada) + 2 tubos de luz (WC 1 e passagem)', 1, 'vg', 3100, 1),
 (CH[3], 'Guardas em vidro laminado (varanda, deck poente, pátio, suite 1)', 19.7, 'm', 220, 1),
 (CH[3], 'Guarda metálica da escada', 4.2, 'm', 130, 1),
 (CH[3], 'Portadas de correr a poente: calha, carros e quadros em aço (ripado feito pelo dono de obra)', 1, 'vg', 2300, 1),
 (CH[3], 'Estores exteriores de lâminas, manuais, nos quartos (REH)', 16.1, 'm²', 150, 1),
 (CH[3], 'Portão pedonal + grelhas de ventilação da garagem', 1, 'vg', 485, 1),
 (CH[4], 'Betonilha de regularização do R/C', interior_net_rc, 'm²', 11, 1),
 (CH[4], 'Porcelânico efeito madeira: sala, cozinha, entrada, corredor, lavandaria e WC', 81, 'm²', 32, 1),
 (CH[4], 'SPC aspeto carvalho nos quartos, closets e passagem (colocado pelo dono de obra)', 39, 'm²', 25, 1),
 (CH[4], 'Impermeabilização e cerâmica só nos duches e salpicadeiras; rodapé cerâmico', 1, 'vg', 1100, 1),
 (CH[4], 'Estuque nas paredes e tetos; tetos falsos hidrófugos nos WC', 1, 'vg', 2800, 1),
 (CH[4], 'Portas interiores (13, compra direta) + porta EI30 da garagem + técnica', 1, 'vg', 2735, 1),
 (CH[4], 'Cozinha: móveis, bancada em pedra e ilha de 2,80 m', 1, 'vg', 6000, 1),
 (CH[4], 'Degraus da escada em betão afagado com focinho', 16, 'un', 30, 1),
 (CH[4], 'Loiças e torneiras dos 3 WC do R/C e lava-loiça', 1, 'vg', 2000, 1),
 (CH[4], 'Tintas e rodapés (compra do dono de obra; pintura pelo dono de obra)', 1, 'vg', 700, 1),
 (CH[5], 'Águas e esgotos, incl. estação elevatória PB1 da cave e ligação à rede', 1, 'vg', 10500, 1),
 (CH[5], 'Pluviais: 4 tubos de queda, rede enterrada, dreno periférico, PB2 (drena também o pátio afundado)', 1, 'vg', 8300, 1),
 (CH[5], 'Eletricidade e ITED (pontos repostos, iluminação de deck, pátio e caminho)', 1, 'vg', 12000, 1),
 (CH[5], 'AQS por bomba de calor 200 L; pré-instalação AC (5 un.); extração; grelhas', 1, 'vg', 6400, 1),
 (CH[6], 'Deck e varanda: laje armada sobre aterro + porcelânico exterior R11', G.DECK_POLY.difference(sbox(*G.POOL)).area + 7.6, 'm²', 62, 1),
 (CH[6], 'Pátio da garagem; pavimento do pátio afundado em granito', 1, 'vg', 1400, 1),
 (CH[6], 'Caminho do portão e terraço norte em saibro e lajes (materiais; feitos pelo dono de obra)', 1, 'vg', 800, 1),
 # ---- Fase 2 (depois da vistoria)
 ('Fase 2', 'Piscina 9,00 × 3,00 × 1,40: estrutura em bloco armado, liner armado, filtração salina, LED, capeamento em granito', 1, 'vg', 16500, 2),
 ('Fase 2', 'Sala do Jardim → quarto 3: SPC, WC 3 (loiças, cerâmica no duche), closet, portas', 1, 'vg', 3200, 2),
 ('Fase 2', 'Jardim: prado nativo, árvores, sebes, gramíneas, rega gota-a-gota (plantação pelo dono de obra)', 1, 'vg', 3800, 2),
 ('Fase 2', 'Salamandra + chaminé em inox preto', 1, 'vg', 3000, 2),
 ('Fase 2', 'Cisterna de 6 m³ para rega', 1, 'vg', 3500, 2),
 ('Fase 2', 'Closets modulares, armário da entrada, bancada da lavandaria, degraus em carvalho', 1, 'vg', 3100, 2),
]
rows = []
tot = {1: 0.0, 2: 0.0}; chap = {}
for c, it, q, un, p, f in items:
    v = q * p
    tot[f] += v; chap[c] = chap.get(c, 0) + v
    rows.append(dict(c=c, i=it, q=round(q, 1), u=un, p=p, v=round(v), f=f))
out = dict(rows=rows, f1=round(tot[1]), f2=round(tot[2]), total=round(tot[1] + tot[2]), chapters={k: round(v) for k, v in chap.items()},
           q={k: round(v, 1) for k, v in Q.items()}, area_total=round(A_rc + A_cave, 1))
out['eur_m2_f1'] = round(out['f1'] / (A_rc + A_cave))
out['v42'] = dict(total=224600, area=321, chapters={'Estaleiro e terras': 19900, 'Estrutura': 62300, 'Envolvente': 49300, 'Caixilharia, vidros e serralharia': 27400, 'Acabamentos, carpintarias e louças': 20600, 'Instalações': 36500, 'Arranjos exteriores': 8600}, fazer_depois=36700)
json.dump(out, open('out/cost.json', 'w'), ensure_ascii=False, indent=1)
for k, v in Q.items(): print(f'{k:16s} {v:8.1f}')
for k, v in out['chapters'].items(): print(f'{k:32s} {v/1000:7.1f} k€')
print('F1', out['f1'], 'F2', out['f2'], 'total', out['total'], '€/m2 F1', out['eur_m2_f1'])
