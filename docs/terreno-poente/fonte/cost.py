# -*- coding: utf-8 -*-
"""Estimativa de custo das duas casas (sem IVA), com quantidades medidas sobre casas.py e os preços
unitários da MESMA BASE do MQT v4.2 da casa de A (Norte de Portugal 2025/26). Os artigos sem par no MQT
estão marcados «estimativa» e devem ser confirmados com orçamentos."""
import json, math
from shapely.geometry import Point, box as sbox, Polygon
from shapely.ops import unary_union
import sitio as S
import casas as C

def integ(poly, f, step=0.25):
    minx, miny, maxx, maxy = poly.bounds; s = 0.0; y = miny + step / 2
    while y < maxy:
        x = minx + step / 2
        while x < maxx:
            if poly.contains(Point(x, y)): s += f(x, y) * step * step
            x += step
        y += step
    return s

CH = ['Estaleiro e terras', 'Estrutura', 'Envolvente (paredes, cobertura, fachadas)', 'Caixilharia, vidros e serralharia',
      'Acabamentos, carpintarias e loiças', 'Instalações', 'Exteriores (deck, alpendres, muros, acessos)', 'Piscina', 'Fase 2 — depois da licença de utilização']

def quantities(H):
    F, Sz = H.F, H.Sz
    q = {}
    bar = sbox(0, 0, C.BAR['L'], C.BAR['W']); boxp = H.box_poly; fp = unary_union([bar, boxp])
    q['A_bar'], q['A_box'] = bar.area, boxp.area
    q['A_fp'] = fp.area
    # paredes exteriores: comprimento × altura (até à laje), descontando vãos
    ext = [w for w in H.walls if w['ext'] in ('-x', '+x', '-y', '+y')]
    gross = sum(max(w['r'][2] - w['r'][0], w['r'][3] - w['r'][1]) * (w['z'][1] - w['z'][0]) for w in ext)
    ops = [o for o in H.open if o['k'] not in ('door', 'pass')]
    op_area = lambda kinds: sum(max(o['r'][2] - o['r'][0], o['r'][3] - o['r'][1]) * (o['z'][1] - o['z'][0]) for o in ops if o['k'] in kinds)
    q['vaos_correr'] = op_area(('slide2', 'slide3'))
    q['vaos_janela'] = op_area(('win',))
    q['vaos_fixos'] = op_area(('fixed', 'fixed2'))
    q['portas_entrada'] = len([o for o in ops if o['k'] == 'entry'])
    q['parede_ext_liq'] = gross - q['vaos_correr'] - q['vaos_janela'] - q['vaos_fixos'] - q['portas_entrada'] * 2.2
    # fachada (ETICS + reboco de cal): paredes + platibandas, menos as faces encostadas entre a ala e a caixa
    platib = bar.length * (C.BAR_TOP - C.BAR['ceil']) + boxp.length * (C.BOX_TOP - C.BOX['ceil'])
    junta = C.BAR['W'] * (C.BAR['ceil'] + 0.55) * 2
    q['fachada'] = q['parede_ext_liq'] + platib - junta
    q['perim'] = sum(max(w['r'][2] - w['r'][0], w['r'][3] - w['r'][1]) for w in ext)
    # divisórias interiores (gesso cartonado), excluindo a cápsula de madeira
    q['divisorias'] = sum(max(w['r'][2] - w['r'][0], w['r'][3] - w['r'][1]) * (w['z'][1] - w['z'][0]) for w in H.walls if w['ext'] is None and w['mo'] != 'oak_panel')
    q['capsula'] = sum(max(w['r'][2] - w['r'][0], w['r'][3] - w['r'][1]) * (w['z'][1] - w['z'][0]) for w in H.walls if w['mo'] == 'oak_panel')
    rooms = {r['n']: r['g'].area for r in H.rooms}
    q['pav_wc'] = sum(a for n, a in rooms.items() if n.startswith('WC') or n.startswith('Lav'))
    q['pav_quartos'] = sum(a for n, a in rooms.items() if n in ('Suite', 'Quarto 2', 'Quarto 3'))
    q['pav_social'] = sum(a for n, a in rooms.items() if n in ('Sala', 'Cozinha · jantar', 'Galeria', 'Degraus'))
    q['util'] = sum(r['g'].area for r in H.rooms if r['tag'] == 'util')
    # terras (no referencial local)
    L = lambda g: H.polyL(g)
    nat = lambda u, v: S.natural(u, v)
    poolL = L(sbox(*H.pool))
    q['esc_piscina'] = poolL.area * (1.45 + 0.25 + 0.15) * 1.15
    q['esc_fundacoes'] = q['perim'] * 0.7 * 0.6 + 12 * 0.6
    boxL = L(H.box_poly)
    q['esc_corte'] = integ(boxL, lambda u, v: max(0.0, nat(u, v) - (Sz - 0.35))) + integ(L(bar), lambda u, v: max(0.0, nat(u, v) - (F - 0.35)))
    deckL = L(H.deck.difference(sbox(*H.pool)).union(H.alp))
    q['aterro_casa'] = integ(boxL, lambda u, v: max(0.0, (Sz - 0.35) - nat(u, v))) + integ(L(bar), lambda u, v: max(0.0, (F - 0.35) - nat(u, v)))
    q['aterro_deck'] = integ(deckL, lambda u, v: max(0.0, (Sz - 0.25) - nat(u, v))) + integ(L(H.terrace), lambda u, v: max(0.0, (F - 0.25) - nat(u, v)))
    car = H.car.union(H.store)
    q['aterro_acesso'] = integ(L(car), lambda u, v: max(0.0, (H.C - 0.25) - nat(u, v))) + integ(L(H.forecourt).intersection(H.lot), lambda u, v: max(0.0, (H.C + 0.3 - 0.25) - nat(u, v)))
    q['A_deck'] = H.deck.difference(sbox(*H.pool)).difference(H.alp).difference(sbox(*H.box_poly.bounds)).area
    q['A_terraco'] = H.terrace.area + 3 * 0.27 * H.steps_out['x1']
    q['A_alp'] = H.alp.area; q['A_car'] = car.area; q['A_store'] = H.store.area
    q['A_acesso'] = L(H.forecourt).intersection(H.lot).area + (H.path.area if H.key == 'N' else 0)
    q['A_pala'] = C.BAR['L'] * 0.9
    q['A_lote'] = H.lot.area
    q['A_jardim'] = H.lot.area - unary_union([L(fp), deckL, L(car), L(H.terrace), L(H.forecourt).intersection(H.lot), poolL]).area
    return q

def walls_share():
    """muros de granito (m de muro × altura), repartidos: o de meação a meias; o resto por lote."""
    from build3d import div, C as _C   # noqa — só para garantir a mesma geometria
    return None

def estimate(H):
    q = quantities(H)
    exc = q['esc_piscina'] + q['esc_fundacoes'] + q['esc_corte']
    fill = q['aterro_casa'] + q['aterro_deck'] + q['aterro_acesso']
    reuse = min(exc * 0.85, fill); borrow = max(0.0, fill - reuse); spare = max(0.0, exc * 0.85 - fill)
    perim = q['perim']
    # muros: meação 47,7 m × 1,8 (metade para cada lote); frente da estrada 15,45 m × 1,2; B-sul: limite sul ≈ 52 m × 1,8
    muro_meacao = 47.72 * 1.80 / 2
    muro_estrada = 15.45 * 1.20
    muro_sul = 30.0 * 1.80 if H.key == 'S' else 0.0       # só junto à piscina e ao jardim; o resto é sebe
    sebe = 75.0 if H.key == 'N' else 44.0
    pool_m2 = (H.pool[2] - H.pool[0]) * (H.pool[3] - H.pool[1])
    items = [
     (CH[0], 'Estaleiro (vedação, instalações, energia e água de obra, PSS) — como o 01.01', 1, 'vg', 4500),
     (CH[0], 'Implantação topográfica em ETRS89 (01.02)', 1, 'vg', 650),
     (CH[0], 'Decapagem da terra vegetal sob a casa, deck e acessos (guardada para o jardim) — 02.08', 1, 'vg', 300),
     (CH[0], 'Escavação: fundações, piscina' + (' e rebaixo da sala' if q['esc_corte'] > 3 else '') + ' (02.01)', exc, 'm³', 7),
     (CH[0], 'Reutilização das terras da obra nos aterros da casa, deck e acessos (02.03)', reuse, 'm³', 4),
     (CH[0], 'Aterro compactado sob lajes e deck (02.05)', fill, 'm³', 6),
     (CH[0], 'Terras de empréstimo para completar o aterro (02.06)' if borrow > 0.5 else 'Sobrante espalhado e modelado no próprio lote (02.04)', borrow if borrow > 0.5 else spare, 'm³', 14 if borrow > 0.5 else 5),
     (CH[0], 'Modelação final do terreno e taludes 1:4 (02.04)', 220, 'm²', 5),
     (CH[0], 'Contingência para rocha (granito) — metade do 02.R1 (escavação pequena)', 1, 'vg', 1365),
     (CH[1], 'Betão de limpeza (03.01)', perim * 0.7 * 0.1 + 1.0, 'm³', 95),
     (CH[1], 'Sapatas contínuas 0,70 × 0,40 sob as paredes exteriores + isoladas dos alpendres (03.02)', perim * 0.7 * 0.4 + 2.0, 'm³', 190),
     (CH[1], 'Laje térrea armada e=0,15 da ala e da caixa, em dois níveis (03.05)', q['A_fp'], 'm²', 39),
     (CH[1], 'Lintel/muro de 0,51 entre a cozinha e a sala, em betão armado', 7.2 * 0.6 * 0.25, 'm³', 460),
     (CH[1], 'Pilares, cintas e vigas (lintéis dos vãos grandes, viga de bordo da pala) — 03.06/03.08', 7.5, 'm³', 445),
     (CH[1], 'Laje aligeirada de cobertura h=0,25/0,30 (03.11)', q['A_fp'], 'm²', 48),
     (CH[1], 'Pala de 0,90 m sobre a fachada dos quartos — laje maciça (03.09b)', q['A_pala'] * 0.25, 'm³', 480),
     (CH[2], 'Alvenaria exterior em tijolo 15 / bloco térmico, com vergas (04.01)', q['parede_ext_liq'], 'm²', 24),
     (CH[2], 'Divisórias em gesso cartonado (normal e hidrófugo nos WC) — 04.02/04.02b', q['divisorias'], 'm²', 28.5),
     (CH[2], 'Cápsula de serviço em contraplacado de carvalho sobre estrutura leve (WC social + lavandaria)', q['capsula'], 'm²', 65),
     (CH[2], 'Cobertura plana invertida: pendentes, impermeabilização, XPS 120, seixo, ralos, trop-plein (base Plinto)', q['A_fp'], 'm²', 52),
     (CH[2], 'Capeamento das platibandas e topo da pala em chapa quinada (05.04)', H.box_poly.length + C.BAR['L'] * 2 + C.BAR['W'] * 2 + 1.8, 'm', 38),
     (CH[2], 'Fachada ETICS EPS 80 mm com acabamento areado fino branco (cal) — 07.01', q['fachada'], 'm²', 48),
     (CH[2], 'Embasamento: faixa de granito amaciado 0,30 na base das fachadas (estimativa)', perim, 'm', 32),
     (CH[2], 'Isolamento XPS 60 sob a laje térrea + membrana anti-radão (06.04 + 06.R4)', q['A_fp'], 'm²', 14),
     (CH[2], 'Membrana anti-radão e despressurização passiva (06.R4)', 1, 'vg', 600),
     (CH[3], 'Portas de correr em PVC foliado bronze, vidro duplo baixo-emissivo (08.02) — sala, jantar, quartos', q['vaos_correr'], 'm²', 290),
     (CH[3], 'Sobrecusto de vidro de controlo solar nos vãos a sul e poente (08.02b)', q['vaos_correr'] * 0.6, 'm²', 35),
     (CH[3], 'Vãos fixos: clerestório da caixa e janelas altas da galeria (08.01)', q['vaos_fixos'], 'm²', 150),
     (CH[3], 'Janelas (WC e suite) em PVC foliado (08.04)', q['vaos_janela'], 'm²', 220),
     (CH[3], 'Porta de entrada pivotante revestida a madeira, blindada (base Plinto)', 1, 'vg', 1450),
     (CH[3], 'Portadas de correr em ripado de pinho tratado nos 3 quartos: calhas e quadros em aço (ripado pelo dono de obra)', 3, 'un', 520),
     (CH[3], 'Estores/blackout interiores nos quartos', 3, 'un', 90),
     (CH[4], 'Betonilha de regularização (09.00)', q['util'], 'm²', 11),
     (CH[4], 'Pavimento vinílico SPC aspeto carvalho — sala, cozinha, galeria (09.01b)', q['pav_social'], 'm²', 25),
     (CH[4], 'Pavimento laminado AC4 aspeto carvalho — quartos (09.02)', q['pav_quartos'], 'm²', 13),
     (CH[4], 'Porcelânico antiderrapante nos WC e lavandaria + azulejo nos duches (09.04 + 09.04b)', q['pav_wc'], 'm²', 52),
     (CH[4], 'Estuque projetado nas paredes interiores (09.07)', q['parede_ext_liq'] * 0.92 + q['divisorias'] * 0.0, 'm²', 11),
     (CH[4], 'Tetos em estuque projetado direto na laje; teto falso hidrófugo nos WC (09.08)', q['A_fp'] - 3.0, 'm²', 13),
     (CH[4], 'Degraus interiores (3 × 6,60 m) em betão afagado com focinho de madeira', 3, 'un', 160),
     (CH[4], 'Portas interiores (7) — compra direta do dono de obra (10.01)', 7, 'un', 165),
     (CH[4], 'Cozinha: móveis, bancada em pedra e ilha (10.04, com ilha)', 1, 'vg', 5500),
     (CH[4], 'Loiças e torneiras: 3 WC e lava-loiça (cap. 11 do MQT)', 1, 'vg', 2100),
     (CH[4], 'Tintas e rodapés — compra do dono de obra (09.11/09.12)', 1, 'vg', 650),
     (CH[5], 'Águas e esgotos: ramal, rede interior (14 pontos), coletores enterrados, 2 caixas de visita (cap. 12)', 1, 'vg', 6900),
     (CH[5], 'Estação elevatória de esgotos — CONTINGÊNCIA: só se a ligação à rede da estrada não for gravítica (12.08)', 1, 'vg', 2100),
     (CH[5], 'Pluviais: 4 tubos de queda, rede enterrada, poço de infiltração no jardim (cap. 13)', 1, 'vg', 3100),
     (CH[5], 'Eletricidade e ITED: ligação, quadro, ≈ 30 pontos de luz, ≈ 45 tomadas, exterior, terras, pré-FV e pré-carregador (cap. 14)', 1, 'vg', 9600),
     (CH[5], 'AQS por bomba de calor 200 L; pré-instalação AC (4 un); extração contínua; grelhas (cap. 15)', 1, 'vg', 4500),
     (CH[6], 'Deck da piscina em lajes de granito amaciado sobre laje armada (base Plinto)', q['A_deck'], 'm²', 62),
     (CH[6], 'Terraço dos quartos e degraus em granito (base Plinto, 16.05)', q['A_terraco'], 'm²', 70),
     (CH[6], 'Alpendre da piscina: laje maciça 0,25 + pilar metálico + muro de granito do fundo', 1, 'vg', round(q['A_alp'] * 0.25 * 480 + 450 + 4.0 * 2.6 * 150)),
     (CH[6], 'Alpendre de estacionamento: laje maciça 0,25 sobre pilares metálicos + arrumos em bloco e ripado', 1, 'vg', round(q['A_car'] * 0.25 * 480 + 900 + q['A_store'] * 2.4 * 2 * 40)),
     (CH[6], 'Pavimento do alpendre, pátio de entrada e rampa em saibro estabilizado / grelha (16.02)', q['A_acesso'] + q['A_car'], 'm²', 22),
     (CH[6], 'Muro de meação em granito, h 1,80 (metade do muro, partilhado com o vizinho) — estimativa', muro_meacao, 'm² face', 150),
     (CH[6], 'Muro baixo de granito na frente da estrada, h 1,20, com portão pedonal (estimativa + 08.21)', muro_estrada, 'm² face', 150),
    ]
    if muro_sul: items.append((CH[6], 'Muro de granito no limite sul, só no troço da piscina e do jardim (≈ 30 m), h 1,80 — estimativa', muro_sul, 'm² face', 150))
    items += [
     (CH[6], 'Sebes nos restantes limites (loureiro/pitósporo, plantas e rega; plantação pelo dono de obra)', sebe, 'm', 22),
     (CH[6], 'Pré-instalação do portão automóvel (tubo, caixa) — o portão fica para depois (08.22b)', 1, 'vg', 80),
     (CH[7], f"Piscina {num_(H.pool[2] - H.pool[0])} × {num_(H.pool[3] - H.pool[1])} × 1,40: bloco armado, liner armado, filtração salina, LED, capeamento em granito (base Plinto)", 1, 'vg', round(16500 * pool_m2 / 27.0 / 50) * 50),
     (CH[8], 'Fechar o alpendre da piscina: 2 frentes de correr (≈ 20 m²), isolamento, pavimento, teto, duche/WC pequeno → escritório/estúdio', 1, 'vg', 11800),
     (CH[8], 'Portão automóvel de correr 4 m em aço lacado (08.22)', 1, 'vg', 2200),
     (CH[8], 'Jardim: terra vegetal, relvado nos pátios, árvores (oliveiras, medronheiros, carvalho), rega gota-a-gota (16.06)', round(q['A_jardim'] * 0.55), 'm²', 9),
     (CH[8], 'Salamandra + chaminé em inox preto (05.06 + 10.05)', 1, 'vg', 3000),
    ]
    rows, chap, tot = [], {}, {'f1': 0.0, 'pool': 0.0, 'f2': 0.0}
    for c, it, qq, un, p in items:
        v = qq * p; chap[c] = chap.get(c, 0) + v
        k = 'pool' if c == CH[7] else ('f2' if c == CH[8] else 'f1'); tot[k] += v
        rows.append(dict(c=c, i=it, q=round(qq, 1), u=un, p=p, v=round(v)))
    A_ = C.areas(H)
    return dict(casa=H.name, key=H.key, rows=rows, chapters={k: round(v) for k, v in chap.items()},
                f1=round(tot['f1']), pool=round(tot['pool']), f2=round(tot['f2']), total=round(tot['f1'] + tot['pool'] + tot['f2']),
                q={k: round(v, 1) for k, v in q.items()}, abc=A_['abc'], util=A_['util'],
                eur_m2=round(tot['f1'] / A_['abc']), terras=dict(esc=round(exc, 1), aterro=round(fill, 1), reuso=round(reuse, 1), emprestimo=round(borrow, 1), sobrante=round(spare, 1)))

def num_(x): return f'{x:.2f}'.replace('.', ',')

if __name__ == '__main__':
    out = dict(base='MQT v4.2 (casa de A), Norte de Portugal 2025/26, sem IVA', casas=[estimate(H) for H in C.HOUSES])
    out['v42'] = dict(total=224600, area=321)
    json.dump(out, open('out/cost.json', 'w'), ensure_ascii=False, indent=1)
    for c in out['casas']:
        print('=====', c['casa'], 'ABC', c['abc'], 'útil', c['util'])
        for k, v in c['chapters'].items(): print(f'  {k:52s} {v / 1000:7.1f} k€')
        print('  F1 (casa) %.1f k€ · %d €/m² | piscina %.1f | F2 %.1f | total %.1f' % (c['f1'] / 1000, c['eur_m2'], c['pool'] / 1000, c['f2'] / 1000, c['total'] / 1000))
        print('  terras', c['terras'])
        print('  q', {k: c['q'][k] for k in ('parede_ext_liq', 'fachada', 'vaos_correr', 'vaos_fixos', 'vaos_janela', 'divisorias', 'A_deck', 'A_acesso', 'A_jardim')})
