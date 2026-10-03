# Imitação mínima da API do SketchUp para testar construir_casa_plinto.rb fora do SketchUp.
class Numeric; def m; self * 39.37007874; end; end
module Geom
  class Point3d
    attr_accessor :x, :y, :z
    def initialize(x = 0, y = 0, z = 0); @x, @y, @z = x.to_f, y.to_f, z.to_f; end
    def to_a; [x, y, z]; end
  end
  class Vector3d
    attr_accessor :x, :y, :z
    def initialize(x = 0, y = 0, z = 0); @x, @y, @z = x.to_f, y.to_f, z.to_f; end
    def transform(_t); self; end
  end
  class Transformation
    def self.translation(_p); new; end
    def self.scaling(*a); raise ArgumentError, 'scaling args' unless [1, 3, 4].include?(a.size); new; end
    def *(_o); Transformation.new; end
  end
  class PolygonMesh
    AUTO_SOFTEN = 4; SMOOTH_SOFT_EDGES = 8
    attr_reader :npts, :npolys
    def initialize(a = 0, b = 0); @pts = {}; @npolys = 0; end
    def add_point(p); k = p.to_a.map { |v| v.round(4) }; @pts[k] ||= @pts.size + 1; end
    def add_polygon(*i); raise 'bad index' if i.flatten.any? { |x| x < 1 || x > @pts.size }; @npolys += 1; end
  end
end
ORIGIN = Geom::Point3d.new; Z_AXIS = Geom::Vector3d.new(0, 0, 1); Y_AXIS = Geom::Vector3d.new(0, 1, 0)
module Sketchup
  class Color; def initialize(*a); raise 'color' unless a.size == 3; end; end
  class Entity
    attr_accessor :name, :layer, :material, :back_material
    def initialize(parent); @parent = parent; @valid = true; end
    def valid?; @valid; end
    def erase!; @valid = false; @parent.list.delete(self); end
  end
  class Face < Entity
    attr_reader :pts
    def initialize(parent, pts); super(parent); @pts = pts; end
    def normal
      nx = ny = nz = 0.0
      @pts.each_with_index { |a, i| b = @pts[(i + 1) % @pts.size]; nx += (a.y - b.y) * (a.z + b.z); ny += (a.z - b.z) * (a.x + b.x); nz += (a.x - b.x) * (a.y + b.y) }
      l = Math.sqrt(nx * nx + ny * ny + nz * nz); raise 'degenerate face' if l < 1e-9
      Geom::Vector3d.new(nx / l, ny / l, nz / l)
    end
    def area
      nx = ny = nz = 0.0
      @pts.each_with_index { |a, i| b = @pts[(i + 1) % @pts.size]; nx += (a.y - b.y) * (a.z + b.z); ny += (a.z - b.z) * (a.x + b.x); nz += (a.x - b.x) * (a.y + b.y) }
      Math.sqrt(nx * nx + ny * ny + nz * nz) / 2
    end
    def reverse!; @pts = @pts.reverse; self; end
    def pushpull(d)
      n = normal; raise 'pushpull not vertical' unless n.z.abs > 0.99 && d > 0
      top = @pts.map { |p| Geom::Point3d.new(p.x + n.x * d, p.y + n.y * d, p.z + n.z * d) }
      bottom = @pts
      @pts = top
      @parent.list << Face.new(@parent, bottom.reverse)
      bottom.each_with_index do |a, i|
        b = bottom[(i + 1) % bottom.size]; ta = top[i]; tb = top[(i + 1) % top.size]
        @parent.list << Face.new(@parent, [a, b, tb, ta])
      end
      $pushpulls += 1
    end
  end
  class Group < Entity
    attr_reader :entities
    def initialize(parent); super(parent); @entities = Entities.new; end
  end
  class Instance < Entity; end
  class Text < Entity; end
  class Entities
    attr_reader :list
    def initialize; @list = []; end
    def add_group; g = Group.new(self); @list << g; g; end
    def add_face(*a)
      pts = a.flatten
      pts = pts.map { |e| e.is_a?(Array) ? e : e } 
      raise 'add_face needs points' unless pts.all? { |p| p.is_a?(Geom::Point3d) }
      return nil if pts.size < 3
      f = Face.new(self, pts); @list << f; f
    end
    def add_circle(c, _n, r, n); (0...n).map { |i| a = 2 * Math::PI * i / n; Geom::Point3d.new(c.x + r * Math.cos(a), c.y + r * Math.sin(a), c.z) }; end
    def add_faces_from_mesh(m, flags, fm = nil, bm = nil); raise 'mesh' unless m.is_a?(Geom::PolygonMesh); $mesh_polys += m.npolys; m.npolys; end
    def add_instance(d, t); raise 'instance' unless d.is_a?(ComponentDefinition) && t.is_a?(Geom::Transformation); i = Instance.new(self); @list << i; i; end
    def add_text(s, p, v = nil); raise 'text' unless s.is_a?(String) && p.is_a?(Geom::Point3d); $texts += 1; t = Text.new(self); @list << t; t; end
    def grep(cls); @list.select { |e| e.is_a?(cls) }; end
  end
  class ComponentDefinition; attr_reader :entities, :name; def initialize(n); @name = n; @entities = Entities.new; end; end
  class Material; attr_accessor :color, :alpha, :name; def initialize(n); @name = n; end; end
  class Layer; attr_accessor :visible, :name; def initialize(n); @name = n; @visible = true; end; end
  class Coll
    def initialize(klass); @k = klass; @h = {}; end
    def [](n); n.is_a?(Integer) ? @h.values[n] : @h[n]; end
    def add(n); @h[n] = @k.new(n); end
    def size; @h.size; end
    def values; @h.values; end
  end
  class Pages < Coll
    attr_accessor :selected_page
    def initialize; super(Struct.new(:name)); end
    def add(n); $page_vis[n] = $model.layers.values.reject(&:visible).map(&:name); super(n); end
  end
  class Camera; attr_accessor :fov, :perspective, :height; def initialize(e, t, u); raise 'cam' unless [e, t].all? { |p| p.is_a?(Geom::Point3d) }; end; end
  class View; attr_accessor :camera; end
  class Model
    attr_reader :entities, :materials, :layers, :definitions, :pages, :active_view, :shadow_info
    def initialize; @entities = Entities.new; @materials = Coll.new(Material); @layers = Coll.new(Layer); @definitions = Coll.new(ComponentDefinition); @pages = Pages.new; @active_view = View.new; @shadow_info = {}; end
    def start_operation(*_a); end
    def commit_operation; $committed = true; end
    def abort_operation; end
  end
  def self.active_model; $model; end
end
$model = Sketchup::Model.new; $pushpulls = 0; $mesh_polys = 0; $texts = 0; $page_vis = {}
def require(n); n == 'sketchup.rb' ? true : super; end
load File.expand_path('out/construir_casa_plinto.rb', __dir__)
m = $model
puts "committed=#{$committed} pushpulls=#{$pushpulls} terrain/tree mesh polys=#{$mesh_polys} texts=#{$texts}"
puts "top-level groups (etiquetas):"
m.entities.list.each { |g| puts "  #{g.name.ljust(34)} layer=#{g.layer.name}  filhos=#{g.entities.list.size}" }
puts "materiais=#{m.materials.size} definições=#{m.definitions.size} cenas=#{m.pages.size} norte=#{m.shadow_info['NorthAngle']}"
$page_vis.each { |k, v| puts "  cena #{k}: escondidas #{v.inspect}" }
# verificação de materiais por face: parede sul do R/C (face −v deve ser pinho, +v estuque)
walls = m.entities.list.find { |g| g.name.start_with?('08') }
w = walls.entities.list.find { |g| g.entities.grep(Sketchup::Face).any? { |f| f.normal.y < -0.9 && f.material&.name == 'Pinho carbonizado (ripado)' } }
f_in = w.entities.grep(Sketchup::Face).find { |f| f.normal.y > 0.9 }
puts "parede exterior: face sul=pinho ok, face interior=#{f_in.material.name}"
unpainted = 0
m.entities.list.each { |g| g.entities.list.each { |sg| next unless sg.is_a?(Sketchup::Group); sg.entities.grep(Sketchup::Face).each { |f| unpainted += 1 if f.material.nil? } } }
puts "faces sem material: #{unpainted}"
