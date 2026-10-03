# -*- coding: utf-8 -*-
"""Exporta a Casa Plinto para SketchUp a partir de out/spec.json (a mesma geometria das plantas e renders):
  out/construir_casa_plinto.rb  — script Ruby que constrói o modelo nativo no SketchUp (grupos, etiquetas, materiais, cenas)
  out/casa_plinto.dae           — COLLADA para Ficheiro > Importar (alternativa sem Ruby)
Coordenadas: x = u (ao longo da casa, ENE), y = v (NNW), z = cota − 37,00 (R/C = 0,00). Metros."""
import json, math, base64, struct
import numpy as np
import mapbox_earcut as earcut
from shapely.geometry import Polygon, Point, box as sbox
from shapely.geometry.polygon import orient
from shapely.prepared import prep
import geom as G

Z0 = 37.0
spec = json.load(open('out/spec.json'))

# ----------------------------------------------------------------------------- materiais (nome SketchUp, RGB, opacidade)
MATS = {
    'timber': ('Pinho carbonizado (ripado)', (30, 28, 26), 1.0), 'shutter': ('Portadas em ripado carbonizado', (40, 34, 30), 1.0),
    'plaster': ('Estuque branco', (241, 239, 234), 1.0), 'ceiling': ('Teto branco', (244, 242, 238), 1.0),
    'render': ('Betão cofragem de tábua', (154, 149, 139), 1.0), 'concrete': ('Betão à vista (pala e lajes)', (184, 179, 169), 1.0),
    'soffit': ('Betão à vista (intradorso)', (214, 210, 202), 1.0), 'reveal': ('Remate preto', (34, 36, 38), 1.0),
    'frame': ('Caixilho preto', (26, 27, 29), 1.0), 'metal': ('Aço preto', (43, 45, 48), 1.0), 'metal_black': ('Aço preto mate', (20, 20, 20), 1.0),
    'glass': ('Vidro', (174, 194, 200), 0.30), 'deck': ('Porcelânico exterior', (205, 199, 188), 1.0),
    'floor_int': ('Pavimento efeito carvalho', (203, 180, 151), 1.0), 'floor_wood': ('SPC carvalho', (196, 172, 140), 1.0),
    'tile': ('Cerâmico WC', (216, 212, 204), 1.0), 'cave_floor': ('Betonilha afagada', (169, 165, 157), 1.0),
    'cave_wall': ('Bloco pintado', (217, 214, 208), 1.0), 'gravel': ('Seixo (cobertura)', (142, 137, 129), 1.0),
    'water': ('Água', (44, 124, 132), 0.65), 'liner': ('Liner cor de pedra', (60, 93, 93), 1.0),
    'coping': ('Granito amaciado', (201, 195, 184), 1.0), 'granite': ('Granito (degraus)', (190, 184, 173), 1.0),
    'stone': ('Betão ciclópico com granito', (141, 136, 127), 1.0), 'patio_floor': ('Lajeado de granito', (185, 178, 166), 1.0),
    'gpatio': ('Saibro estabilizado', (200, 194, 182), 1.0), 'oak': ('Carvalho', (176, 131, 90), 1.0),
    'garage_door': ('Portão revestido', (143, 138, 129), 1.0),
    'furn_white': ('Móvel branco', (236, 235, 231), 1.0), 'furn_oak': ('Móvel carvalho', (185, 140, 92), 1.0),
    'furn_dark': ('Móvel escuro', (58, 55, 51), 1.0), 'stone_top': ('Bancada em pedra', (216, 211, 201), 1.0),
    'fabric': ('Tecido', (183, 174, 159), 1.0), 'fabric_out': ('Tecido exterior', (232, 226, 214), 1.0),
    'linen': ('Linho', (239, 233, 222), 1.0), 'rug': ('Tapete', (167, 152, 138), 1.0), 'car': ('Carro', (106, 112, 118), 1.0),
    't_meadow': ('Prado', (111, 127, 69), 1.0), 't_lawn': ('Relva', (95, 138, 60), 1.0), 't_path': ('Saibro', (196, 174, 134), 1.0),
    't_paving': ('Lajes de granito', (186, 180, 169), 1.0), 't_bed': ('Canteiro', (93, 106, 58), 1.0), 't_road': ('Asfalto', (75, 75, 73), 1.0),
    't_field': ('Campo', (125, 138, 82), 1.0),
    'v_trunk': ('Tronco', (91, 75, 60), 1.0), 'v_oak': ('Copa carvalho', (76, 106, 47), 1.0), 'v_pine': ('Copa pinheiro-manso', (62, 90, 44), 1.0),
    'v_olive': ('Copa oliveira', (127, 140, 102), 1.0), 'v_arbutus': ('Copa medronheiro', (59, 93, 46), 1.0), 'v_fruit': ('Copa fruteira', (94, 127, 56), 1.0),
    'v_cypress': ('Copa cipreste', (46, 74, 42), 1.0), 'v_hedge': ('Sebe', (52, 73, 42), 1.0), 'north': ('Seta norte', (176, 65, 62), 1.0),
}

TAGS = ['01 Terreno', '02 Muros exteriores e pátios', '03 Deck e piscina', '04 Cave · paredes', '05 Cave · pavimentos',
        '06 Cave · caixilharia e vidros', '07 Laje do R/C e varanda', '08 R/C · paredes', '09 R/C · pavimentos',
        '10 R/C · caixilharia e vidros', '11 Escadas', '12 Cobertura e claraboias', '13 Pala', '14 Mobiliário',
        '15 Vegetação', '16 Textos R/C', '17 Textos cave', '18 Norte']
T = {k: i for i, k in enumerate(TAGS)}

def in_stair(a, b):
    return 6.6 <= a[0] and b[0] <= 7.7 and 1.2 <= a[1] and b[1] <= 5.5

def box_tag(bx):
    a, b, m, t = bx['a'], bx['b'], bx['m'], bx.get('t')
    rc = a[2] >= 36.88
    inside = a[0] >= -0.01 and b[0] <= 15.01 and a[1] >= -1.34 and b[1] <= 8.01
    if t == 'furn': return '14 Mobiliário'
    if m == 'granite' or (m == 'oak' and in_stair(a, b)): return '11 Escadas'
    if m in ('water', 'liner', 'coping'): return '03 Deck e piscina'
    if m == 'glass' and a[2] > 40.0: return '12 Cobertura e claraboias'
    if m in ('glass', 'frame', 'garage_door', 'shutter', 'metal', 'oak'):
        return '10 R/C · caixilharia e vidros' if rc else '06 Cave · caixilharia e vidros'
    if m == 'stone' or (m == 'render' and not inside): return '02 Muros exteriores e pátios'
    if m in ('render', 'cave_wall'): return '04 Cave · paredes'
    return '08 R/C · paredes' if rc else '04 Cave · paredes'

def prism_tag(p):
    t = p.get('t'); z0 = p['z'][0]
    return {'slab_rc': '07 Laje do R/C e varanda', 'balcony': '07 Laje do R/C e varanda', 'slab_cave': '05 Cave · pavimentos',
            'roof': '12 Cobertura e claraboias', 'sky_frame': '12 Cobertura e claraboias', 'pala': '13 Pala',
            'deck_body': '03 Deck e piscina', 'deck_top': '03 Deck e piscina', 'patio': '02 Muros exteriores e pátios',
            'gpatio': '02 Muros exteriores e pátios', 'parapet': '02 Muros exteriores e pátios', 'glass': '10 R/C · caixilharia e vidros',
            'reveal': '08 R/C · paredes'}.get(t) or ('09 R/C · pavimentos' if z0 >= 36.88 else '05 Cave · pavimentos')

FACE_KEYS = ['+u', '-u', '+v', '-v', 'top', 'bot']
def r3(x): return round(x, 3)

# ----------------------------------------------------------------------------- terreno recortado (sem casa, deck, pátios)
t = spec['terrain']
Hh = struct.unpack('<%dh' % (t['nu'] * t['nv']), base64.b64decode(t['h']))
Cc = base64.b64decode(t['c'])
CLS = t['classes']
CMAP = {'meadow': 't_meadow', 'lawn': 't_lawn', 'path': 't_path', 'paving': 't_paving', 'bed': 't_bed', 'road': 't_road',
        'gpatio': 't_paving', 'patio': 't_paving', 'field': 't_field', 'fieldB': 't_field', 'under': 't_bed'}
U_A, U_B, V_A, V_B = -30.0, 42.0, -22.0, 30.0
i0 = int(round((U_A - t['u0']) / t['step'])); i1 = int(round((U_B - t['u0']) / t['step']))
j0 = int(round((V_A - t['v0']) / t['step'])); j1 = int(round((V_B - t['v0']) / t['step']))
HOLE = prep(G.FOOT_POLY.union(G.DECK_POLY).union(sbox(9.10, -5.10, 15.50, -1.33)).union(G.GPATIO_POLY).buffer(0.02))
def H(i, j): return Hh[j * t['nu'] + i] / 100 + 30
tri = {}   # material -> list of triangles (3 pontos)
for j in range(j0, j1):
    for i in range(i0, i1):
        u = t['u0'] + i * t['step']; v = t['v0'] + j * t['step']; s = t['step']
        cells = [((i, j), (i + 1, j), (i + 1, j + 1)), ((i, j), (i + 1, j + 1), (i, j + 1))]
        for c in cells:
            cu = sum(t['u0'] + a * t['step'] for a, _ in c) / 3; cv = sum(t['v0'] + b * t['step'] for _, b in c) / 3
            if HOLE.contains(Point(cu, cv)): continue
            k = CMAP[CLS[Cc[c[0][1] * t['nu'] + c[0][0]]]]
            tri.setdefault(k, []).append([(r3(t['u0'] + a * t['step']), r3(t['v0'] + b * t['step']), r3(H(a, b) - Z0)) for a, b in c])

def terrain_z(u, v):
    i = int(round((u - t['u0']) / t['step'])); j = int(round((v - t['v0']) / t['step']))
    return H(i, j)

# ----------------------------------------------------------------------------- etiquetas de compartimentos
labels = []
for lvl, z in (('rc', G.Z_RC), ('cave', G.Z_CAVE)):
    for name, rect, _ in G.ROOMS[lvl]:
        poly = G.room_poly(lvl, name, rect)
        c = poly.representative_point()
        labels.append(('16 Textos R/C' if lvl == 'rc' else '17 Textos cave', f'{name} · {poly.area:.1f} m²'.replace('.', ','), r3(c.x), r3(c.y), r3(z + 0.02 - Z0)))

# ============================================================================= RUBY
def rb_str(s): return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'
def rb_arr(a): return '[' + ','.join(rb_val(x) for x in a) + ']'
def rb_val(x):
    if isinstance(x, str): return rb_str(x)
    if isinstance(x, (list, tuple)): return rb_arr(x)
    if isinstance(x, float): return repr(round(x, 3))
    return str(x)

B = []
for bx in spec['boxes']:
    f = bx.get('f') or {}
    faces = [f.get(k, '') for k in FACE_KEYS]
    B.append([T[box_tag(bx)], bx['m'], *[r3(x) for x in bx['a'][:2]], r3(bx['a'][2] - Z0), *[r3(x) for x in bx['b'][:2]], r3(bx['b'][2] - Z0), faces if any(faces) else 0])
PR = []
for p in spec['prisms']:
    PR.append([T[prism_tag(p)], p['top'], p['side'], p['bot'], r3(p['z'][0] - Z0), r3(p['z'][1] - Z0), [[r3(a), r3(b)] for a, b in p['p']], [[[r3(a), r3(b)] for a, b in h] for h in p['h']]])
TREES = [[k, r3(u), r3(v), r3((G.Z_PATIO if (k == 'arbutus' and 9 < u < 15.3 and -4.9 < v < -1.3) else terrain_z(u, v)) - Z0), r3(h), r3(d)] for k, u, v, h, d in spec['trees']]
HEDGES = []
for hd in spec['hedges']:
    (ua, va), (ub, vb) = hd['a'], hd['b']
    HEDGES.append([r3(ua), r3(va), r3(ub), r3(vb), r3(terrain_z((ua + ub) / 2, (va + vb) / 2) - Z0 - 0.05), hd['h'], hd['w']])
CAMS = {}
for k, c in spec['cams'].items():
    CAMS[k] = [[r3(c['p'][0]), r3(c['p'][1]), r3(c['p'][2] - Z0)], [r3(c['t'][0]), r3(c['t'][1]), r3(c['t'][2] - Z0)], c['fov']]
north = (math.sin(G.ANG), math.cos(G.ANG))

L = []
w = L.append
w('# encoding: UTF-8')
w('# Casa Plinto — Proposta B, parcela A, Trav. de João Pires, Carreço (Viana do Castelo).')
w('# Constrói no SketchUp o modelo da proposta B (mesma geometria das plantas, cortes, alçados e renders).')
w('# Gerado por skp.py a partir de out/spec.json — não editar à mão.')
w('#')
w('# COMO USAR (SketchUp 2017 ou mais recente, Windows ou Mac):')
w('#   1. Abrir um modelo novo em metros (modelo "Arquitetura — Metros").')
w('#   2. Janela > Consola de Ruby (Extensions > Developer > Ruby Console nas versões em inglês).')
w("#   3. Escrever:  load 'C:/caminho/para/construir_casa_plinto.rb'   e Enter (no Mac: load '/Users/.../construir_casa_plinto.rb').")
w('#   4. Esperar ~10–30 s. Fica tudo num grupo por etiqueta (tag), com materiais e cenas. Gravar como .skp.')
w('#')
w('# Coordenadas: eixo vermelho (x) ao longo da casa (ENE), verde (y) para NNW, azul (z) com o R/C a 0,00.')
w('#   Cota absoluta = z + 37,00 (cave 34,10 → −2,90; topo da platibanda 40,45 → +3,45).')
w('#   Origem = canto SW da implantação do estudo v4 (ETRS89/PT-TM06 x=-60409,15 y=229931,92); o eixo x está a 19,95° do nascente.')
w('#   O norte geográfico fica a 19,95° do eixo verde, no sentido dos ponteiros; o script desenha uma seta (etiqueta 17 Norte)')
w('#   e acerta o ângulo do norte solar para os estudos de sombras.')
w('')
w('require "sketchup.rb"')
w('')
w('module CasaPlinto')
w('  MATS = {')
for k, (n, rgb, a) in MATS.items():
    w(f'    {rb_str(k)} => [{rb_str(n)}, {list(rgb)}, {a}],')
w('  }')
w('  TAGS = ' + rb_arr(TAGS))
w('  FACE_KEYS = ' + rb_arr(FACE_KEYS))
w('  # [etiqueta, material, u0, v0, z0, u1, v1, z1, materiais por face (+u, -u, +v, -v, topo, base) ou 0]')
w('  BOXES = [')
for b in B: w('    ' + rb_arr(b) + ',')
w('  ]')
w('  # [etiqueta, mat. topo, mat. lados, mat. base, z0, z1, contorno [[u,v]...], furos [[[u,v]...]...]]')
w('  PRISMS = [')
for p in PR: w('    ' + rb_arr(p) + ',')
w('  ]')
w('  TREES = ' + rb_arr(TREES))
w('  HEDGES = ' + rb_arr(HEDGES))
w('  LABELS = ' + rb_arr([list(l) for l in labels]))
w('  CAMS = {')
for k, c in CAMS.items(): w(f'    {rb_str(k)} => {rb_arr(c)},')
w('  }')
w('  NORTH = ' + rb_arr([round(north[0], 5), round(north[1], 5)]))
w('  # terreno: triângulos por material [[u,v,z],[u,v,z],[u,v,z]] (grelha de 0,5 m, recortada à volta da casa, deck e pátios)')
w('  TERRAIN = {')
for k, tl in tri.items():
    flat = []
    for tr_ in tl:
        for p in tr_: flat.extend(p)
    w(f'    {rb_str(k)} => ' + rb_arr(flat) + ',')
w('  }')
w(r'''
  def self.p3(u, v, z)
    Geom::Point3d.new(u.to_f.m, v.to_f.m, z.to_f.m)
  end

  def self.material(model, key)
    @mats ||= {}
    return @mats[key] if @mats[key]
    name, rgb, alpha = MATS[key] || ["Material #{key}", [200, 200, 200], 1.0]
    m = model.materials[name] || model.materials.add(name)
    m.color = Sketchup::Color.new(*rgb)
    m.alpha = alpha if alpha < 1.0
    @mats[key] = m
  end

  def self.layer(model, idx)
    @layers ||= {}
    @layers[idx] ||= (model.layers[TAGS[idx]] || model.layers.add(TAGS[idx]))
  end

  def self.face_key(n)
    return "top" if n.z > 0.9
    return "bot" if n.z < -0.9
    return "+u" if n.x > 0.9
    return "-u" if n.x < -0.9
    return "+v" if n.y > 0.9
    "-v"
  end

  def self.extrude(ents, pts, holes, h)
    outer = ents.add_face(pts)
    return nil unless outer
    holes.each do |hp|
      hf = ents.add_face(hp)
      hf.erase! if hf && hf.valid?
    end
    base = ents.grep(Sketchup::Face).max_by(&:area)
    base.reverse! if base.normal.z < 0
    base.pushpull(h.m)
    true
  end

  def self.paint(ents, model, default_key, per_face)
    ents.grep(Sketchup::Face).each do |f|
      key = default_key
      if per_face
        k = per_face[FACE_KEYS.index(face_key(f.normal))]
        key = k unless k.nil? || k == ""
      end
      mat = material(model, key)
      f.material = mat
      f.back_material = mat
    end
  end

  def self.paint_prism(ents, model, top, side, bot)
    ents.grep(Sketchup::Face).each do |f|
      n = f.normal
      key = n.z > 0.9 ? top : (n.z < -0.9 ? bot : side)
      mat = material(model, key)
      f.material = mat
      f.back_material = mat
    end
  end

  def self.unit_sphere_mesh(rx, ry, rz, cz)
    t = (1.0 + Math.sqrt(5.0)) / 2.0
    v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    v = v.map { |p| l = Math.sqrt(p[0]**2 + p[1]**2 + p[2]**2); [p[0] / l, p[1] / l, p[2] / l] }
    f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
         [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
    cache = {}
    mid = lambda do |a, b|
      key = a < b ? [a, b] : [b, a]
      cache[key] ||= begin
        p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]
        l = Math.sqrt(p[0]**2 + p[1]**2 + p[2]**2)
        v << [p[0] / l, p[1] / l, p[2] / l]
        v.size - 1
      end
    end
    f2 = []
    f.each do |a, b, c|
      ab = mid.call(a, b); bc = mid.call(b, c); ca = mid.call(c, a)
      f2 << [a, ab, ca] << [b, bc, ab] << [c, ca, bc] << [ab, bc, ca]
    end
    mesh = Geom::PolygonMesh.new(v.size, f2.size)
    idx = v.map { |p| mesh.add_point(Geom::Point3d.new((p[0] * rx).m, (p[1] * ry).m, (cz + p[2] * rz).m)) }
    f2.each { |a, b, c| mesh.add_polygon(idx[a], idx[b], idx[c]) }
    mesh
  end

  # árvore unitária: 1 m de altura, copa de 1 m de diâmetro (a instância escala para o tamanho real)
  def self.tree_definition(model, kind)
    @trees ||= {}
    return @trees[kind] if @trees[kind]
    names = { "oak" => "carvalho-alvarinho", "pine" => "pinheiro-manso", "olive" => "oliveira", "arbutus" => "medronheiro", "fruit" => "fruteira", "cypress" => "cipreste" }
    d = model.definitions.add("Árvore — #{names[kind] || kind}")
    ents = d.entities
    trunk_h = { "pine" => 0.82, "olive" => 0.40, "cypress" => 0.15 }[kind] || 0.48
    c = ents.add_circle(ORIGIN, Z_AXIS, 0.035.m, 8)
    tf = ents.add_face(c)
    tf.reverse! if tf.normal.z < 0
    tf.pushpull(trunk_h.m)
    paint(ents, model, "v_trunk", nil)
    crown = case kind
            when "pine" then unit_sphere_mesh(0.5, 0.5, 0.12, 0.86)
            when "cypress" then unit_sphere_mesh(0.5, 0.5, 0.5, 0.52)
            when "olive" then unit_sphere_mesh(0.5, 0.5, 0.34, 0.62)
            else unit_sphere_mesh(0.5, 0.5, 0.40, 0.62)
            end
    ents.add_faces_from_mesh(crown, Geom::PolygonMesh::AUTO_SOFTEN | Geom::PolygonMesh::SMOOTH_SOFT_EDGES, material(model, "v_#{kind}"), material(model, "v_#{kind}"))
    @trees[kind] = d
  end

  def self.ti(prefix)
    TAGS.index { |t| t.start_with?(prefix) }
  end

  def self.category_group(model, idx)
    @cats ||= {}
    @cats[idx] ||= begin
      g = model.entities.add_group
      g.name = TAGS[idx]
      g.layer = layer(model, idx)
      g
    end
  end

  def self.build
    model = Sketchup.active_model
    model.start_operation("Casa Plinto", true)
    @mats = @layers = @cats = @trees = nil
    t0 = Time.now

    BOXES.each do |tg, mk, u0, v0, z0, u1, v1, z1, faces|
      g = category_group(model, tg).entities.add_group
      ok = extrude(g.entities, [p3(u0, v0, z0), p3(u1, v0, z0), p3(u1, v1, z0), p3(u0, v1, z0)], [], z1 - z0)
      if ok
        paint(g.entities, model, mk, faces == 0 ? nil : faces)
      else
        g.erase!
      end
    end

    PRISMS.each do |tg, top, side, bot, z0, z1, outer, holes|
      g = category_group(model, tg).entities.add_group
      pts = outer.map { |u, v| p3(u, v, z0) }
      hps = holes.map { |h| h.map { |u, v| p3(u, v, z0) } }
      ok = extrude(g.entities, pts, hps, z1 - z0)
      if ok
        paint_prism(g.entities, model, top, side, bot)
      else
        g.erase!
      end
    end

    tg = category_group(model, ti("01")).entities.add_group
    tg.name = "Terreno (aproximado; o levantamento manda)"
    TERRAIN.each do |mk, flat|
      n = flat.size / 9
      mesh = Geom::PolygonMesh.new(n * 3, n)
      n.times do |i|
        a = flat[i * 9, 9]
        i1 = mesh.add_point(p3(a[0], a[1], a[2]))
        i2 = mesh.add_point(p3(a[3], a[4], a[5]))
        i3 = mesh.add_point(p3(a[6], a[7], a[8]))
        mesh.add_polygon(i1, i2, i3)
      end
      mat = material(model, mk)
      tg.entities.add_faces_from_mesh(mesh, Geom::PolygonMesh::AUTO_SOFTEN | Geom::PolygonMesh::SMOOTH_SOFT_EDGES, mat, mat)
    end

    veg = category_group(model, ti("15"))
    TREES.each do |kind, u, v, z, h, d|
      tr = Geom::Transformation.translation(p3(u, v, z)) * Geom::Transformation.scaling(d, d, h)
      veg.entities.add_instance(tree_definition(model, kind), tr)
    end
    HEDGES.each do |ua, va, ub, vb, z, h, w|
      dx = ub - ua; dy = vb - va; l = Math.sqrt(dx * dx + dy * dy)
      next if l < 0.05
      nx = -dy / l * w / 2.0; ny = dx / l * w / 2.0
      g = veg.entities.add_group
      g.name = "Sebe"
      if extrude(g.entities, [p3(ua + nx, va + ny, z), p3(ub + nx, vb + ny, z), p3(ub - nx, vb - ny, z), p3(ua - nx, va - ny, z)], [], h)
        paint(g.entities, model, "v_hedge", nil)
      end
    end

    LABELS.each do |tag, s, u, v, z|
      category_group(model, TAGS.index(tag)).entities.add_text(s, p3(u, v, z), Geom::Vector3d.new(0, 0, 0.6.m))
    end

    # seta do norte geográfico, sobre o terreno a noroeste da casa
    ng = category_group(model, ti("18")).entities.add_group
    ng.name = "Norte geográfico"
    cx, cy, cz = -6.0, 19.0, 0.2
    nx, ny = NORTH
    ex, ey = ny, -nx
    tip = p3(cx + nx * 3.0, cy + ny * 3.0, cz)
    nf = ng.entities.add_face(tip, p3(cx - nx + ex * 0.9, cy - ny + ey * 0.9, cz), p3(cx, cy, cz), p3(cx - nx - ex * 0.9, cy - ny - ey * 0.9, cz))
    if nf
      nf.material = material(model, "north")
      nf.back_material = material(model, "north")
    end
    ng.entities.add_text("N", tip, Geom::Vector3d.new((nx * 0.8).m, (ny * 0.8).m, 0))

    si = model.shadow_info
    { "NorthAngle" => 19.95, "Latitude" => 41.74, "Longitude" => -8.87, "City" => "Carreço", "Country" => "Portugal" }.each do |k, val|
      begin
        si[k] = val
      rescue StandardError
        nil
      end
    end

    # cenas: as vistas dos renders + duas plantas de topo
    begin
      view = model.active_view
      names = { "aerial" => "Aérea de sudoeste", "hero" => "Deck ao fim da tarde", "road" => "Da estrada", "living" => "Sala", "patio" => "Pátio afundado", "cutaway" => "Maquete sem cobertura" }
      hide_for = {
        "cutaway" => ["12", "13"],
        "Planta R/C (sem cobertura)" => ["12", "13", "15", "17"],
        "Planta da cave" => ["07", "08", "09", "10", "12", "13", "14", "15", "16"]
      }
      show = lambda do |key|
        hidden = (hide_for[key] || []).map { |p| ti(p) }
        TAGS.each_index { |i| layer(model, i).visible = !hidden.include?(i) }
      end
      ["aerial", "hero", "road", "living", "patio", "cutaway"].each do |k|
        e, tgt, fov = CAMS[k]
        cam = Sketchup::Camera.new(p3(*e), p3(*tgt), Z_AXIS)
        cam.fov = fov
        view.camera = cam
        show.call(k)
        model.pages.add(names[k])
      end
      ["Planta R/C (sem cobertura)", "Planta da cave"].each do |nm|
        cam = Sketchup::Camera.new(p3(7.5, 2.0, 40.0), p3(7.5, 2.0, 0.0), Y_AXIS)
        cam.perspective = false
        cam.height = 24.m
        view.camera = cam
        show.call(nm)
        model.pages.add(nm)
      end
      show.call("")
      model.pages.selected_page = model.pages[0]
    rescue StandardError => err
      puts "Cenas não criadas: #{err.message}"
    end

    model.commit_operation
    puts format("Casa Plinto: %d caixas, %d prismas, %d árvores construídas em %.1f s.", BOXES.size, PRISMS.size, TREES.size, Time.now - t0)
  rescue StandardError => err
    model.abort_operation if model
    puts "Erro a construir a Casa Plinto: #{err.message}"
    puts err.backtrace.first(5).join("\n")
    raise
  end
end

CasaPlinto.build
''')
open('out/construir_casa_plinto.rb', 'w', encoding='utf-8').write('\n'.join(L))

# ============================================================================= COLLADA
def box_tris(a, b, faces, m):
    x0, y0, z0 = a; x1, y1, z1 = b
    P = lambda x, y, z: (x, y, z - Z0)
    q = {
        '+u': [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)],
        '-u': [P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1)],
        '+v': [P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1)],
        '-v': [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)],
        'top': [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
        'bot': [P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0), P(x0, y0, z0)],
    }
    out = []
    for k, (p0, p1, p2, p3_) in q.items():
        mk = (faces or {}).get(k) or m
        out.append((mk, (p0, p1, p2))); out.append((mk, (p0, p2, p3_)))
    return out

def prism_tris(p):
    poly = orient(Polygon(p['p'], p['h']), 1.0)
    rings = [list(poly.exterior.coords)[:-1]] + [list(r.coords)[:-1] for r in poly.interiors]
    verts = np.array([pt for r in rings for pt in r], dtype=np.float64)
    ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    idx = earcut.triangulate_float64(verts, ends).reshape(-1, 3)
    z0, z1 = p['z'][0] - Z0, p['z'][1] - Z0
    out = []
    for a, b, c in idx:
        A, Bq, C = verts[a], verts[b], verts[c]
        cross = (Bq[0] - A[0]) * (C[1] - A[1]) - (Bq[1] - A[1]) * (C[0] - A[0])
        if cross < 0: Bq, C = C, Bq
        out.append((p['top'], ((A[0], A[1], z1), (Bq[0], Bq[1], z1), (C[0], C[1], z1))))
        out.append((p['bot'], ((A[0], A[1], z0), (C[0], C[1], z0), (Bq[0], Bq[1], z0))))
    for r in rings:
        for i in range(len(r)):
            a, b = r[i], r[(i + 1) % len(r)]
            q0, q1, q2, q3 = (a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)
            out.append((p['side'], (q0, q1, q2))); out.append((p['side'], (q0, q2, q3)))
    return out

geo = {}   # tag -> material -> triangles
for bx in spec['boxes']:
    for mk, trg in box_tris(bx['a'], bx['b'], bx.get('f'), bx['m']):
        geo.setdefault(box_tag(bx), {}).setdefault(mk, []).append(trg)
for p in spec['prisms']:
    for mk, trg in prism_tris(p):
        geo.setdefault(prism_tag(p), {}).setdefault(mk, []).append(trg)
for mk, tl in tri.items():
    for tr_ in tl:
        geo.setdefault('01 Terreno', {}).setdefault(mk, []).append(tuple(tuple(x) for x in tr_))
# vegetação simples (troncos como prismas octogonais, copas como icosaedros)
def ico(cx, cy, cz, rx, ry, rz):
    tt = (1 + 5 ** 0.5) / 2
    V = [(-1, tt, 0), (1, tt, 0), (-1, -tt, 0), (1, -tt, 0), (0, -1, tt), (0, 1, tt), (0, -1, -tt), (0, 1, -tt), (tt, 0, -1), (tt, 0, 1), (-tt, 0, -1), (-tt, 0, 1)]
    Fc = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    n = (1 + tt * tt) ** 0.5
    P = [(cx + a / n * rx, cy + b / n * ry, cz + c / n * rz) for a, b, c in V]
    return [(P[a], P[b], P[c]) for a, b, c in Fc]
for kind, u, v, z, h, d in TREES:
    th = {'pine': 0.82, 'olive': 0.40, 'cypress': 0.15}.get(kind, 0.48) * h
    r = 0.035 * d
    for k in range(8):
        a0, a1 = 2 * math.pi * k / 8, 2 * math.pi * (k + 1) / 8
        p0 = (u + r * math.cos(a0), v + r * math.sin(a0)); p1 = (u + r * math.cos(a1), v + r * math.sin(a1))
        geo.setdefault('15 Vegetação', {}).setdefault('v_trunk', []).extend([((p0[0], p0[1], z), (p1[0], p1[1], z), (p1[0], p1[1], z + th)), ((p0[0], p0[1], z), (p1[0], p1[1], z + th), (p0[0], p0[1], z + th))])
    rz, cz = {'pine': (0.12, 0.86), 'cypress': (0.5, 0.52), 'olive': (0.34, 0.62)}.get(kind, (0.40, 0.62))
    geo['15 Vegetação'].setdefault('v_' + kind, []).extend(ico(u, v, z + cz * h, 0.5 * d, 0.5 * d, rz * h))
for ua, va, ub, vb, z, h, wd in HEDGES:
    dx, dy = ub - ua, vb - va; l = math.hypot(dx, dy)
    if l < 0.05: continue
    nx, ny = -dy / l * wd / 2, dx / l * wd / 2
    pr = dict(p=[(ua + nx, va + ny), (ub + nx, vb + ny), (ub - nx, vb - ny), (ua - nx, va - ny)], h=[], z=[z + Z0, z + Z0 + h], top='v_hedge', side='v_hedge', bot='v_hedge')
    for mk, trg in prism_tris(pr):
        geo['15 Vegetação'].setdefault(mk, []).append(trg)

def esc(s): return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
used = sorted({mk for g in geo.values() for mk in g})
X = ['<?xml version="1.0" encoding="utf-8"?>', '<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">',
     '<asset><contributor><authoring_tool>Casa Plinto skp.py</authoring_tool></contributor><unit name="meter" meter="1"/><up_axis>Z_UP</up_axis></asset>',
     '<library_effects>']
for mk in used:
    n, rgb, a = MATS[mk]
    c = ' '.join(f'{x / 255:.4f}' for x in rgb)
    tr = f'<transparent opaque="A_ONE"><color>1 1 1 {a:.2f}</color></transparent><transparency><float>1</float></transparency>' if a < 1 else ''
    X.append(f'<effect id="fx-{mk}"><profile_COMMON><technique sid="common"><lambert><diffuse><color>{c} 1</color></diffuse>{tr}</lambert></technique></profile_COMMON></effect>')
X.append('</library_effects><library_materials>')
for mk in used:
    X.append(f'<material id="mat-{mk}" name="{esc(MATS[mk][0])}"><instance_effect url="#fx-{mk}"/></material>')
X.append('</library_materials><library_geometries>')
nodes = []
for gi, (tag, mats) in enumerate(sorted(geo.items())):
    gid = f'geo{gi}'
    pts = []; pidx = {}; parts = []
    for mk, tl in mats.items():
        ids = []
        for trg in tl:
            for p in trg:
                key = (round(p[0], 4), round(p[1], 4), round(p[2], 4))
                if key not in pidx:
                    pidx[key] = len(pts); pts.append(key)
                ids.append(pidx[key])
        parts.append((mk, ids))
    X.append(f'<geometry id="{gid}" name="{esc(tag)}"><mesh><source id="{gid}-pos"><float_array id="{gid}-pos-a" count="{len(pts) * 3}">'
             + ' '.join(f'{a:g} {b:g} {c:g}' for a, b, c in pts) + f'</float_array><technique_common><accessor source="#{gid}-pos-a" count="{len(pts)}" stride="3">'
             '<param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>'
             f'<vertices id="{gid}-vtx"><input semantic="POSITION" source="#{gid}-pos"/></vertices>')
    for mk, ids in parts:
        X.append(f'<triangles material="m-{mk}" count="{len(ids) // 3}"><input semantic="VERTEX" source="#{gid}-vtx" offset="0"/><p>' + ' '.join(map(str, ids)) + '</p></triangles>')
    X.append('</mesh></geometry>')
    nodes.append((gid, tag, [mk for mk, _ in parts]))
X.append('</library_geometries><library_visual_scenes><visual_scene id="cena" name="Casa Plinto">')
for gid, tag, mks in nodes:
    X.append(f'<node id="n-{gid}" name="{esc(tag)}"><instance_geometry url="#{gid}"><bind_material><technique_common>'
             + ''.join(f'<instance_material symbol="m-{mk}" target="#mat-{mk}"/>' for mk in mks) + '</technique_common></bind_material></instance_geometry></node>')
X.append('</visual_scene></library_visual_scenes><scene><instance_visual_scene url="#cena"/></scene></COLLADA>')
open('out/casa_plinto.dae', 'w', encoding='utf-8').write('\n'.join(X))

import os
ntri = sum(len(tl) for g in geo.values() for tl in g.values())
print('rb KB', os.path.getsize('out/construir_casa_plinto.rb') // 1024, '| dae KB', os.path.getsize('out/casa_plinto.dae') // 1024,
      '| boxes', len(B), 'prisms', len(PR), 'terrain tris', sum(len(v) for v in tri.values()), '| dae tris', ntri)
