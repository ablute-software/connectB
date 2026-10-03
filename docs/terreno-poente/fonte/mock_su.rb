# encoding: UTF-8
# Imitação (mock) mínima, mas fiel, da API Ruby do SketchUp, para testar construir_terreno_poente.rb sem o SketchUp.
# Só implementa o que o script usa, com o comportamento da API real: unidades internas em polegadas (Numeric#m),
# transformações 4×4 a sério (translação, rotação, escala, composição), add_circle devolve arestas, add_face aceita
# pontos ou arestas e recusa pontos duplicados ou não coplanares, um furo desenhado dentro de uma face fica como
# laço interior, pushpull extrude ao longo da normal, as cenas guardam a câmara e as etiquetas escondidas.
#
# Uso, a partir de fonte/:
#   ruby -r ./mock_su.rb ../sketchup/construir_terreno_poente.rb
#   ruby mock_su.rb [caminho do .rb]
# No fim imprime um relatório e verifica: operação confirmada, nenhuma peça falhada, caixas envolventes das casas
# iguais às calculadas diretamente do spec.json (origem + rotação de cada grupo), todas as faces pintadas, cenas,
# etiquetas e norte. Sai com código 1 se alguma verificação falhar.
require 'json'

INCH_PER_M = 39.37007874015748
class Numeric
  def m; self * INCH_PER_M; end
  def to_m; self / INCH_PER_M; end
  def degrees; self * Math::PI / 180.0; end
end

module Geom
  TOL = 0.001 # polegadas, a tolerância do SketchUp
  class Point3d
    attr_accessor :x, :y, :z
    def initialize(x = 0, y = 0, z = 0)
      x, y, z = x if x.is_a?(Array)
      raise ArgumentError, 'Point3d: coordenadas não numéricas' unless [x, y, z].all? { |c| c.is_a?(Numeric) }
      @x, @y, @z = x.to_f, y.to_f, z.to_f
    end
    def to_a; [x, y, z]; end
    def -(o); o.is_a?(Point3d) ? Vector3d.new(x - o.x, y - o.y, z - o.z) : Point3d.new(x - o.x, y - o.y, z - o.z); end
    def +(v); Point3d.new(x + v.x, y + v.y, z + v.z); end
    def ==(o); o.respond_to?(:x) && (x - o.x).abs < TOL && (y - o.y).abs < TOL && (z - o.z).abs < TOL; end
    def distance(o); Math.sqrt((x - o.x)**2 + (y - o.y)**2 + (z - o.z)**2); end
    def transform(t); t * self; end
  end
  class Vector3d
    attr_accessor :x, :y, :z
    def initialize(x = 0, y = 0, z = 0)
      x, y, z = x if x.is_a?(Array)
      @x, @y, @z = x.to_f, y.to_f, z.to_f
    end
    def to_a; [x, y, z]; end
    def length; Math.sqrt(x * x + y * y + z * z); end
    def normalize; l = length; raise ArgumentError, 'vetor nulo' if l < 1e-12; Vector3d.new(x / l, y / l, z / l); end
    def *(o); Vector3d.new(y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x); end # produto vetorial (como no SketchUp)
    def %(o); x * o.x + y * o.y + z * o.z; end                                          # produto escalar
    def dot(o); self % o; end
    def parallel?(o); (self * o).length < 1e-9 * [length * o.length, 1e-12].max; end
    def transform(t); t * self; end
  end
  class Transformation
    attr_reader :m # 4×4, por linhas
    I4 = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0].freeze
    def initialize(arg = nil)
      @m = case arg
           when nil then I4.dup
           when Point3d, Vector3d then [1.0, 0, 0, arg.x, 0, 1.0, 0, arg.y, 0, 0, 1.0, arg.z, 0, 0, 0, 1.0]
           when Transformation then arg.m.dup
           when Array
             raise ArgumentError, 'Transformation.new(array) precisa de 16 valores' unless arg.size == 16
             (0...16).map { |k| arg[(k % 4) * 4 + k / 4].to_f } # to_a do SketchUp é por colunas
           else raise ArgumentError, "Transformation.new: argumento inválido (#{arg.class})"
           end
    end
    def self.from_rows(r); t = new; t.instance_variable_set(:@m, r); t; end
    def self.translation(v)
      raise ArgumentError, 'translation precisa de Point3d ou Vector3d' unless v.is_a?(Point3d) || v.is_a?(Vector3d)
      new(Vector3d.new(v.x, v.y, v.z))
    end
    def self.rotation(pt, axis, angle)
      raise ArgumentError, 'rotation(ponto, eixo, ângulo)' unless pt.is_a?(Point3d) && axis.is_a?(Vector3d) && angle.is_a?(Numeric)
      a = axis.normalize; c = Math.cos(angle); s = Math.sin(angle); t = 1 - c
      r = [t * a.x * a.x + c, t * a.x * a.y - s * a.z, t * a.x * a.z + s * a.y,
           t * a.x * a.y + s * a.z, t * a.y * a.y + c, t * a.y * a.z - s * a.x,
           t * a.x * a.z - s * a.y, t * a.y * a.z + s * a.x, t * a.z * a.z + c]
      tr = [pt.x - (r[0] * pt.x + r[1] * pt.y + r[2] * pt.z), pt.y - (r[3] * pt.x + r[4] * pt.y + r[5] * pt.z), pt.z - (r[6] * pt.x + r[7] * pt.y + r[8] * pt.z)]
      from_rows([r[0], r[1], r[2], tr[0], r[3], r[4], r[5], tr[1], r[6], r[7], r[8], tr[2], 0, 0, 0, 1.0])
    end
    def self.scaling(*a)
      pt = a.first.is_a?(Point3d) ? a.shift : Point3d.new
      raise ArgumentError, "scaling: #{a.size} fatores (1 ou 3)" unless [1, 3].include?(a.size) && a.all? { |v| v.is_a?(Numeric) }
      sx, sy, sz = a.size == 1 ? [a[0]] * 3 : a
      from_rows([sx.to_f, 0, 0, pt.x * (1 - sx), 0, sy.to_f, 0, pt.y * (1 - sy), 0, 0, sz.to_f, pt.z * (1 - sz), 0, 0, 0, 1.0])
    end
    def *(o)
      case o
      when Transformation
        r = Array.new(16, 0.0)
        4.times { |i| 4.times { |j| r[i * 4 + j] = (0...4).inject(0.0) { |s, k| s + @m[i * 4 + k] * o.m[k * 4 + j] } } }
        Transformation.from_rows(r)
      when Point3d
        Point3d.new(@m[0] * o.x + @m[1] * o.y + @m[2] * o.z + @m[3], @m[4] * o.x + @m[5] * o.y + @m[6] * o.z + @m[7], @m[8] * o.x + @m[9] * o.y + @m[10] * o.z + @m[11])
      when Vector3d
        Vector3d.new(@m[0] * o.x + @m[1] * o.y + @m[2] * o.z, @m[4] * o.x + @m[5] * o.y + @m[6] * o.z, @m[8] * o.x + @m[9] * o.y + @m[10] * o.z)
      else raise ArgumentError, "Transformation * #{o.class}"
      end
    end
    def origin; Point3d.new(@m[3], @m[7], @m[11]); end
    def to_a; (0...16).map { |k| @m[(k % 4) * 4 + k / 4] }; end
  end
  class PolygonMesh
    AUTO_SOFTEN = 4; HIDE_BASED_ON_INDEX = 1; NO_SMOOTH_OR_HIDE = 0; SOFTEN_BASED_ON_INDEX = 2; SMOOTH_SOFT_EDGES = 8
    attr_reader :points, :polygons
    def initialize(_npts = 0, _npolys = 0); @points = []; @index = {}; @polygons = []; end
    def add_point(p)
      raise ArgumentError, 'add_point precisa de Point3d' unless p.is_a?(Point3d)
      k = [(p.x / TOL).round, (p.y / TOL).round, (p.z / TOL).round]
      @index[k] ||= (@points << p; @points.size) # índices a partir de 1; pontos repetidos devolvem o índice existente
    end
    def add_polygon(*idx)
      idx = idx.flatten.map { |i| i.is_a?(Point3d) ? add_point(i) : i }
      raise ArgumentError, 'add_polygon: precisa de 3 ou mais pontos' if idx.size < 3
      raise ArgumentError, "add_polygon: índice inválido #{idx.inspect}" if idx.any? { |i| !i.is_a?(Integer) || i.abs < 1 || i.abs > @points.size }
      raise ArgumentError, "add_polygon: pontos repetidos #{idx.inspect}" if idx.map(&:abs).uniq.size < idx.size
      @polygons << idx.map(&:abs); @polygons.size
    end
    def count_points; @points.size; end
    def count_polygons; @polygons.size; end
    def point_at(i); @points[i - 1]; end
  end
end
ORIGIN = Geom::Point3d.new(0, 0, 0)
X_AXIS = Geom::Vector3d.new(1, 0, 0); Y_AXIS = Geom::Vector3d.new(0, 1, 0); Z_AXIS = Geom::Vector3d.new(0, 0, 1)

module UI
  MB_OK = 0
  IDOK = 1
  @janelas = []
  class << self; attr_reader :janelas; end
  # UI.messagebox(mensagem, tipo = MB_OK) → IDOK (a janela real é modal; aqui só regista e escreve)
  def self.messagebox(msg, type = MB_OK)
    @janelas << msg.to_s
    puts "[janela] " + msg.to_s.gsub("\n", " | ")
    IDOK
  end
end

module Sketchup
  class Color
    attr_reader :red, :green, :blue, :alpha
    def initialize(*a)
      a = a.first if a.size == 1 && a.first.is_a?(Array)
      raise ArgumentError, "Color.new: #{a.inspect}" unless [3, 4].include?(a.size) && a.all? { |c| c.is_a?(Integer) && c.between?(0, 255) }
      @red, @green, @blue = a; @alpha = a[3] || 255
    end
  end
  class Entity
    attr_reader :parent
    def initialize(parent); @parent = parent; @valid = true; end
    def valid?; @valid; end
    def erase!; raise 'erase! de entidade já apagada' unless @valid; @valid = false; @parent.list.delete(self); true; end
  end
  class Drawingelement < Entity
    attr_accessor :material, :back_material
    attr_reader :layer
    def layer=(l)
      raise ArgumentError, 'layer= precisa de Layer ou nome' unless l.is_a?(Layer) || l.is_a?(String)
      @layer = l.is_a?(String) ? $model.layers.add(l) : l
    end
  end
  class Vertex; attr_reader :position; def initialize(p); @position = p; end; end
  class Edge < Drawingelement
    attr_reader :start, :end
    def initialize(parent, a, b); super(parent); @start = Vertex.new(a); @end = Vertex.new(b); end
  end
  class Face < Drawingelement
    attr_reader :outer, :inner
    def initialize(parent, pts); super(parent); @outer = pts; @inner = []; end
    def self.newell(pts)
      nx = ny = nz = 0.0
      pts.each_with_index do |a, i|
        b = pts[(i + 1) % pts.size]
        nx += (a.y - b.y) * (a.z + b.z); ny += (a.z - b.z) * (a.x + b.x); nz += (a.x - b.x) * (a.y + b.y)
      end
      Geom::Vector3d.new(nx, ny, nz)
    end
    def normal; Face.newell(@outer).normalize; end
    def area; Face.newell(@outer).length / 2 - @inner.inject(0.0) { |s, l| s + Face.newell(l).length / 2 }; end
    def loops; [@outer] + @inner; end
    def points; @outer; end
    def reverse!; @outer = @outer.reverse; @inner = @inner.map(&:reverse); self; end
    def add_inner(pts); @inner << pts; end
    # pushpull de uma face solta: a face desloca-se ao longo da normal, fica uma base virada ao contrário no sítio
    # original, e cada laço (exterior e furos) dá faces laterais
    def pushpull(d, _copy = false)
      raise ArgumentError, 'pushpull precisa de distância numérica' unless d.is_a?(Numeric)
      raise 'pushpull de face já apagada' unless valid?
      return nil if d.abs < 1e-9
      n = normal; off = Geom::Vector3d.new(n.x * d, n.y * d, n.z * d)
      base = Face.new(@parent, @outer.reverse)
      @inner.each { |l| base.add_inner(l.reverse) }
      loops.each do |l|
        top = l.map { |p| p + off }
        l.each_index do |i|
          j = (i + 1) % l.size
          @parent.list << Face.new(@parent, d > 0 ? [l[i], l[j], top[j], top[i]] : [l[j], l[i], top[i], top[j]])
        end
      end
      @outer = @outer.map { |p| p + off }; @inner = @inner.map { |l| l.map { |p| p + off } }
      @parent.list << base
      $stats[:pushpulls] += 1
      nil
    end
  end
  class Entities
    include Enumerable
    attr_reader :list, :meshes
    def initialize; @list = []; @meshes = []; end
    def each(&b); @list.dup.each(&b); end
    def size; @list.size; end
    alias length size
    def grep(cls); @list.select { |e| cls === e }; end
    def add_group(*ents); raise ArgumentError, 'add_group com entidades não suportado neste mock' unless ents.empty?; g = Group.new(self); @list << g; g; end
    def add_circle(center, normal, radius, numsegs = 24)
      raise ArgumentError, 'add_circle(centro, normal, raio, segmentos)' unless center.is_a?(Geom::Point3d) && normal.is_a?(Geom::Vector3d) && radius > 0 && numsegs >= 3
      n = normal.normalize; a = n.parallel?(Z_AXIS) ? X_AXIS : (Z_AXIS * n).normalize; b = n * a
      pts = (0...numsegs).map { |i| t = 2 * Math::PI * i / numsegs; center + Geom::Vector3d.new((a.x * Math.cos(t) + b.x * Math.sin(t)) * radius, (a.y * Math.cos(t) + b.y * Math.sin(t)) * radius, (a.z * Math.cos(t) + b.z * Math.sin(t)) * radius) }
      edges = pts.each_index.map { |i| Edge.new(self, pts[i], pts[(i + 1) % pts.size]) }
      @list.concat(edges); edges
    end
    def add_face(*args)
      items = args.flatten
      pts = if items.all? { |e| e.is_a?(Edge) } then items.map { |e| e.start.position }
            elsif items.all? { |e| e.is_a?(Geom::Point3d) } then items
            else raise ArgumentError, "add_face: argumentos inválidos (#{items.map(&:class).uniq.join(', ')})"
            end
      raise ArgumentError, 'Not enough points: at least 3 required' if pts.size < 3
      pts.each_with_index { |p, i| pts[(i + 1)..-1].each { |q| raise ArgumentError, 'Duplicate points in array' if p == q } }
      nv = Face.newell(pts)
      raise ArgumentError, 'Points are collinear' if nv.length < 1e-9
      n = nv.normalize
      raise ArgumentError, 'Points are not planar' if pts.any? { |p| ((p - pts[0]) % n).abs > 0.01 }
      host = grep(Face).find { |f| f.normal.parallel?(n) && ((pts[0] - f.outer[0]) % n).abs < 0.01 && pts.all? { |p| Entities.inside?(f.outer, p, n) } }
      f = Face.new(self, pts)
      host.add_inner(pts) if host # desenhar dentro de uma face divide-a: fica com um laço interior
      @list << f; f
    end
    def self.inside?(poly, p, n)
      ax = n.z.abs > 0.5 ? [:x, :y] : (n.x.abs > 0.5 ? [:y, :z] : [:x, :z])
      c = false; j = poly.size - 1
      poly.each_with_index do |a, i|
        b = poly[j]
        if (a.send(ax[1]) > p.send(ax[1])) != (b.send(ax[1]) > p.send(ax[1]))
          xi = (b.send(ax[0]) - a.send(ax[0])) * (p.send(ax[1]) - a.send(ax[1])) / (b.send(ax[1]) - a.send(ax[1])) + a.send(ax[0])
          c = !c if p.send(ax[0]) < xi
        end
        j = i
      end
      c
    end
    def add_faces_from_mesh(mesh, smooth = 0, fmat = nil, bmat = nil)
      raise ArgumentError, 'add_faces_from_mesh precisa de PolygonMesh' unless mesh.is_a?(Geom::PolygonMesh)
      raise ArgumentError, 'material inválido' unless [fmat, bmat].all? { |m| m.nil? || m.is_a?(Material) || m.is_a?(String) }
      @meshes << [mesh, fmat]; $stats[:mesh_polys] += mesh.count_polygons; mesh.count_polygons
    end
    def add_instance(defn, tr)
      raise ArgumentError, 'add_instance(definição, transformação)' unless defn.is_a?(ComponentDefinition) && tr.is_a?(Geom::Transformation)
      i = ComponentInstance.new(self, defn, tr); @list << i; defn.instances << i; i
    end
    def add_text(s, pt, vec = nil)
      raise ArgumentError, 'add_text(texto, ponto, vetor)' unless s.is_a?(String) && pt.is_a?(Geom::Point3d) && (vec.nil? || vec.is_a?(Geom::Vector3d))
      t = Text.new(self, s, pt); @list << t; t
    end
  end
  class Group < Drawingelement
    attr_accessor :name
    attr_reader :entities, :transformation
    def initialize(parent); super(parent); @entities = Entities.new; @transformation = Geom::Transformation.new; @name = ''; end
    def transformation=(t); raise ArgumentError, 'transformation= precisa de Transformation' unless t.is_a?(Geom::Transformation); @transformation = t; end
  end
  class ComponentInstance < Drawingelement
    attr_reader :definition, :transformation
    def initialize(parent, d, t); super(parent); @definition = d; @transformation = t; end
  end
  class Text < Drawingelement
    attr_reader :text, :point
    def initialize(parent, s, p); super(parent); @text = s; @point = p; end
  end
  class ComponentDefinition
    attr_reader :entities, :name, :instances
    def initialize(n); @name = n; @entities = Entities.new; @instances = []; end
  end
  class Material
    attr_reader :name, :color, :alpha
    def initialize(n); @name = n; @alpha = 1.0; end
    def color=(c); @color = c.is_a?(Color) ? c : Color.new(*Array(c)); end
    def alpha=(a); raise ArgumentError, "alpha fora de 0..1: #{a}" unless a.is_a?(Numeric) && a.between?(0.0, 1.0); @alpha = a.to_f; end
  end
  class Layer
    attr_reader :name
    def initialize(n); @name = n; @visible = true; end
    def visible?; @visible; end
    def visible=(v); raise ArgumentError, 'visible= precisa de true/false' unless v == true || v == false; @visible = v; end
  end
  class Coll
    include Enumerable
    def initialize(klass); @k = klass; @h = {}; end
    def [](n); n.is_a?(Integer) ? @h.values[n] : @h[n]; end
    def size; @h.size; end
    alias length size
    def each(&b); @h.values.each(&b); end
    def unique(n); return n unless @h[n]; k = 1; k += 1 while @h["#{n}#{k}"]; "#{n}#{k}"; end
  end
  class Materials < Coll
    def initialize; super(Material); end
    def add(n); raise ArgumentError, 'nome de material' unless n.is_a?(String); u = unique(n); @h[u] = Material.new(u); end
  end
  class Definitions < Coll
    def initialize; super(ComponentDefinition); end
    def add(n); u = unique(n); @h[u] = ComponentDefinition.new(u); end
  end
  class Layers < Coll
    def initialize; super(Layer); @h['Layer0'] = Layer.new('Layer0'); end
    def add(n); raise ArgumentError, 'nome de etiqueta' unless n.is_a?(String); @h[n] ||= Layer.new(n); end # devolve a existente
  end
  class Page
    attr_reader :name, :camera, :hidden_layers
    def initialize(n, cam, hidden); @name = n; @camera = cam; @hidden_layers = hidden; end
  end
  class Pages < Coll
    attr_reader :selected_page
    def initialize; super(Page); end
    def add(n = nil, _flags = nil, _index = nil)
      n ||= "Cena #{size + 1}"; u = unique(n)
      cam = $model.active_view.camera
      raise 'pages.add sem câmara na vista' unless cam
      @h[u] = Page.new(u, cam.dup, $model.layers.reject(&:visible?).map(&:name))
    end
    def selected_page=(p); raise ArgumentError, 'selected_page= precisa de Page' unless p.is_a?(Page); @selected_page = p; end
  end
  class Camera
    attr_reader :eye, :target, :up, :fov, :height
    def initialize(eye = Geom::Point3d.new(0, 0, 1), target = ORIGIN, up = Y_AXIS, perspective = true, fov = 35.0)
      raise ArgumentError, 'Camera.new(olho, alvo, cima)' unless eye.is_a?(Geom::Point3d) && target.is_a?(Geom::Point3d) && up.is_a?(Geom::Vector3d)
      d = target - eye
      raise ArgumentError, 'câmara: olho e alvo coincidem' if d.length < 1e-6
      raise ArgumentError, 'câmara: vetor "cima" paralelo à direção de vista' if d.parallel?(up)
      @eye, @target, @up, @perspective, @fov, @height = eye, target, up, perspective, fov, nil
    end
    def perspective?; @perspective; end
    def perspective=(v); @perspective = v ? true : false; end
    def fov=(v); raise ArgumentError, "fov fora de 1..120: #{v}" unless v.is_a?(Numeric) && v.between?(1, 120); @fov = v; end
    def height=(h); raise 'height= só em vista ortogonal (perspective = false primeiro)' if @perspective; raise ArgumentError, 'altura > 0' unless h > 0; @height = h; end
  end
  class View
    attr_reader :camera
    def camera=(c); raise ArgumentError, 'camera= precisa de Camera' unless c.is_a?(Camera); @camera = c; end
    def zoom_extents; self; end
  end
  class ShadowInfo
    KEYS = %w[City Country Dark DayOfYear DisplayNorth DisplayOnAllFaces DisplayOnGroundPlane DisplayShadows EdgesCastShadows Latitude Light
              Longitude NorthAngle ShadowTime ShadowTime_time_t SunDirection SunRise SunRise_time_t SunSet SunSet_time_t TZOffset UseSunForAllShading].freeze
    def initialize; @h = { 'NorthAngle' => 0.0, 'Latitude' => 40.018, 'Longitude' => -105.276, 'City' => 'Boulder (CO)', 'Country' => 'USA', 'TZOffset' => -7.0 }; end
    def [](k); raise ArgumentError, "ShadowInfo: chave desconhecida #{k}" unless KEYS.include?(k); @h[k]; end
    def []=(k, v)
      raise ArgumentError, "ShadowInfo: chave desconhecida #{k}" unless KEYS.include?(k)
      raise ArgumentError, "ShadowInfo: #{k} só de leitura" if %w[SunDirection SunRise SunSet SunRise_time_t SunSet_time_t].include?(k)
      ok = case k
           when 'NorthAngle' then v.is_a?(Numeric) && v.between?(-360, 360)
           when 'Latitude' then v.is_a?(Numeric) && v.between?(-90, 90)
           when 'Longitude' then v.is_a?(Numeric) && v.between?(-180, 180)
           when 'TZOffset' then v.is_a?(Numeric) && v.between?(-13, 14)
           when 'City', 'Country' then v.is_a?(String)
           else true
           end
      raise ArgumentError, "ShadowInfo: valor inválido para #{k}: #{v.inspect}" unless ok
      @h[k] = v
    end
    def keys; KEYS; end
  end
  class Model
    attr_reader :entities, :materials, :layers, :definitions, :pages, :active_view, :shadow_info, :ops
    def initialize
      @entities = Entities.new; @materials = Materials.new; @layers = Layers.new; @definitions = Definitions.new
      @pages = Pages.new; @active_view = View.new; @shadow_info = ShadowInfo.new; @ops = []
    end
    def title; 'Sem título'; end
    def start_operation(name, _disable_ui = false, _next_transparent = false, _transparent = false)
      raise 'start_operation com outra operação aberta' if @open
      raise ArgumentError, 'nome da operação' unless name.is_a?(String)
      @open = name; true
    end
    def commit_operation; raise 'commit_operation sem operação aberta' unless @open; @ops << [@open, :ok]; @open = nil; true; end
    def abort_operation; @ops << [@open, :abortada] if @open; @open = nil; true; end
  end
  def self.active_model; $model; end
  def self.version; '17.3.116'; end
end

$model = Sketchup::Model.new
$stats = Hash.new(0)
def require(n); n == 'sketchup.rb' ? true : super; end

# ---------------------------------------------------------------------------------------------------- relatório
module MockReport
  module_function
  def walk(ents, tr, &b)
    ents.list.each do |e|
      yield e, tr
      case e
      when Sketchup::Group then walk(e.entities, tr * e.transformation, &b)
      when Sketchup::ComponentInstance then walk(e.definition.entities, tr * e.transformation, &b)
      end
    end
  end
  def bbox(ents, tr0 = Geom::Transformation.new)
    lo = [Float::INFINITY] * 3; hi = [-Float::INFINITY] * 3
    add = lambda { |p| q = p.to_a.map(&:to_m); 3.times { |k| lo[k] = [lo[k], q[k]].min; hi[k] = [hi[k], q[k]].max } }
    walk(ents, tr0) do |e, tr|
      e.loops.each { |l| l.each { |p| add.call(tr * p) } } if e.is_a?(Sketchup::Face)
    end
    walk_meshes(ents, tr0) { |mesh, tr| mesh.points.each { |p| add.call(tr * p) } }
    [lo, hi]
  end
  def walk_meshes(ents, tr, &b)
    ents.meshes.each { |mesh, _m| yield mesh, tr }
    ents.list.each do |e|
      walk_meshes(e.entities, tr * e.transformation, &b) if e.is_a?(Sketchup::Group)
    end
  end
  def fmt(bb); '[' + bb[0].map { |v| format('%.2f', v) }.join(', ') + '] … [' + bb[1].map { |v| format('%.2f', v) }.join(', ') + ']'; end

  def run(path)
    fails = []
    check = lambda { |ok, msg| puts "  #{ok ? 'ok   ' : 'FALHA'} #{msg}"; fails << msg unless ok }
    m = $model
    puts "\n================ relatório do mock (#{File.basename(path)}) ================"
    check.call(m.ops.any? { |_, s| s == :ok } && m.ops.none? { |_, s| s == :abortada }, "operação confirmada (#{m.ops.inspect})")
    if defined?(TerrenoPoente) && TerrenoPoente.respond_to?(:resumo) && TerrenoPoente.resumo
      r = TerrenoPoente.resumo
      puts "  resumo do script: #{r.inspect}"
      check.call(r[:falhas] == 0, "nenhuma peça falhada (falhas = #{r[:falhas]})")
    else
      check.call(false, 'TerrenoPoente.resumo existe')
    end
    groups = 0; faces = 0; inst = 0; texts = 0; unpainted = []
    walk(m.entities, Geom::Transformation.new) do |e, _|
      groups += 1 if e.is_a?(Sketchup::Group)
      inst += 1 if e.is_a?(Sketchup::ComponentInstance)
      texts += 1 if e.is_a?(Sketchup::Text)
      next unless e.is_a?(Sketchup::Face)
      faces += 1
      unpainted << e if e.material.nil? || e.back_material.nil?
    end
    def_faces = m.definitions.inject(0) { |s, d| s + d.entities.grep(Sketchup::Face).size }
    def_polys = m.definitions.inject(0) { |s, d| s + d.entities.meshes.inject(0) { |t, (mesh, _)| t + mesh.count_polygons } }
    terr_polys = 0; walk_meshes(m.entities, Geom::Transformation.new) { |mesh, _| terr_polys += mesh.count_polygons }
    puts "  grupos=#{groups} faces (sólidos)=#{faces} pushpulls=#{$stats[:pushpulls]} triângulos de malha no modelo=#{terr_polys}"
    puts "  definições=#{m.definitions.size} (#{m.definitions.map(&:name).join(', ')}) — faces=#{def_faces}, triângulos de copa=#{def_polys}; instâncias=#{inst}; textos=#{texts}"
    puts "  materiais=#{m.materials.size}; etiquetas=#{m.layers.map(&:name).join(' | ')}"
    check.call(unpainted.empty?, "todas as faces pintadas (sem material: #{unpainted.size})")
    check.call(m.layers.all?(&:visible?), 'todas as etiquetas visíveis no fim')
    puts '  grupos de topo:'
    m.entities.list.each do |g|
      next unless g.is_a?(Sketchup::Group)
      subs = g.entities.list.grep(Sketchup::Group).map { |s| "#{s.name}#{s.layer ? " [#{s.layer.name}]" : ''} (#{s.entities.list.size})" }
      subs = subs.group_by { |x| x }.map { |x, v| v.size > 1 ? "#{v.size}× #{x}" : x } if subs.size > 12
      puts "    #{g.name} [#{g.layer && g.layer.name}] filhos=#{g.entities.list.size}  caixa=#{fmt(bbox(g.entities, g.transformation))}"
      puts "        sub-grupos: #{subs.join('; ')}" unless subs.empty?
    end
    # caixas envolventes das casas: transformação do mock vs. fórmula do spec (u = o + R(a)·(X, Y), z − 33)
    spec_path = File.join(__dir__, 'out', 'spec.json')
    if File.exist?(spec_path)
      spec = JSON.parse(File.read(spec_path))
      names = { 'N' => 'Casa do Pátio', 'S' => 'Casa Comprida', 'A' => 'Casa da parcela A' }
      spec['groups'].each do |sg|
        g = m.entities.list.find { |e| e.is_a?(Sketchup::Group) && e.name.start_with?(names[sg['n']] || "Grupo #{sg['n']}") }
        unless g then check.call(false, "grupo da casa #{sg['n']} existe"); next end
        c = Math.cos(sg['a']); s = Math.sin(sg['a']); ox, oy = sg['o']; pts = []
        sg['boxes'].each { |b| [b['a'][0], b['b'][0]].each { |x| [b['a'][1], b['b'][1]].each { |y| [b['a'][2], b['b'][2]].each { |z| pts << [x, y, z] } } } }
        sg['prisms'].each { |p| p['p'].each { |x, y| p['z'].each { |z| pts << [x, y, z] } } }
        (sg['roof_tri'] || []).each { |y, z| [-0.3, 15.3].each { |x| pts << [x, y, z] } }
        w = pts.map { |x, y, z| [ox + x * c - y * s, oy + x * s + y * c, z - 33.0] }
        exp = [(0..2).map { |k| w.map { |p| p[k] }.min }, (0..2).map { |k| w.map { |p| p[k] }.max }]
        got = bbox(g.entities, g.transformation)
        err = (0..1).map { |a| (0..2).map { |k| (exp[a][k] - got[a][k]).abs }.max }.max
        check.call(err < 0.005, "caixa de '#{g.name}' = spec (erro máx. #{format('%.4f', err)} m; spec #{fmt(exp)})")
      end
      t = spec['terrain']
      tg = m.entities.list.find { |e| e.is_a?(Sketchup::Group) && e.name.start_with?('Terreno') }
      if tg
        bb = bbox(tg.entities, tg.transformation)
        ue = t['u0'] + (t['nu'] - 1) * t['step']; ve = t['v0'] + (t['nv'] - 1) * t['step']
        ok = (bb[0][0] - t['u0']).abs < 0.01 && (bb[1][0] - ue).abs < 0.01 && (bb[0][1] - t['v0']).abs < 0.01 && (bb[1][1] - ve).abs < 0.01
        check.call(ok, "terreno cobre o campo de alturas (u #{t['u0']}…#{ue}, v #{t['v0']}…#{ve}); z #{format('%.2f', bb[0][2])}…#{format('%.2f', bb[1][2])}")
      else
        check.call(false, 'grupo do terreno existe')
      end
      check.call(inst >= spec['trees'].size, "uma instância por árvore (#{spec['trees'].size} árvores, #{inst} instâncias com arbustos)")
      exp_cams = spec['cams'].size + 1
      check.call(m.pages.size == exp_cams, "cenas: #{m.pages.size} (esperadas #{exp_cams})")
    end
    puts '  cenas:'
    m.pages.each do |p|
      c = p.camera
      puts format('    %-28s olho=(%.1f, %.1f, %.1f) alvo=(%.1f, %.1f, %.1f) %s  escondidas=%s', p.name, *c.eye.to_a.map(&:to_m), *c.target.to_a.map(&:to_m),
                  c.perspective? ? "fov=#{c.fov}" : format('ortogonal, altura=%.1f m', c.height.to_m), p.hidden_layers.inspect)
    end
    maq = m.pages['Maquete']
    check.call(maq && maq.hidden_layers.include?('05 Coberturas'), "cena Maquete sem coberturas")
    planta = m.pages.find { |p| p.name.start_with?('Planta') }
    check.call(planta && !planta.camera.perspective?, 'cena de planta ortogonal')
    si = m.shadow_info
    puts "  sombras: NorthAngle=#{si['NorthAngle']} Latitude=#{si['Latitude']} Longitude=#{si['Longitude']} City=#{si['City']} TZOffset=#{si['TZOffset']}"
    check.call((si['NorthAngle'] - 19.951).abs < 0.01, 'ângulo do norte 19,951° (norte à direita do eixo verde)')
    check.call((si['Latitude'] - 41.742).abs < 0.01 && (si['Longitude'] + 8.874).abs < 0.01, 'local Carreço')
    glass = m.materials.find { |mt| mt.name == 'Vidro' }; water = m.materials.find { |mt| mt.name == 'Água' }
    check.call(glass && (glass.alpha - 0.3).abs < 1e-6 && water && (water.alpha - 0.65).abs < 1e-6, 'vidro a 30 % e água a 65 % de opacidade')
    puts(fails.empty? ? "TUDO OK (#{faces} faces em sólidos, #{terr_polys} triângulos de terreno/malha)" : "#{fails.size} VERIFICAÇÃO(ÕES) FALHADA(S): #{fails.join(' | ')}")
    fails.empty?
  end
end

if $PROGRAM_NAME == __FILE__
  path = File.expand_path(ARGV[0] || File.join(__dir__, '..', 'sketchup', 'construir_terreno_poente.rb'))
  load path
  exit(MockReport.run(path) ? 0 : 1)
else
  at_exit do
    if $!.nil? || ($!.is_a?(SystemExit) && $!.success?)
      ok = MockReport.run($PROGRAM_NAME)
      exit(1) unless ok
    else
      puts "O script terminou com erro: #{$!.class}: #{$!.message}"
    end
  end
end
