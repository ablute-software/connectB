// Terreno de poente (B), Carreço — cena three.js construída a partir de spec.json (gerado por build3d.py).
// Coordenadas locais (u, v, z) → three (x = u, y = z − zref, z = −v). Cada casa é um grupo com origem e rotação próprias.
export function buildScene(THREE, Sky, spec, opts = {}) {
  const zref = spec.zref;
  const P = (u, v, z) => new THREE.Vector3(u, z - zref, -v);
  const scene = new THREE.Scene();
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function canvasTex(size, draw, repeatMeters, srgb = true) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); draw(g, size);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / repeatMeters, 1 / repeatMeters); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  function noiseFill(g, n, base, amp, seed, cell = 2) {
    const r = rng(seed); g.fillStyle = base; g.fillRect(0, 0, n, n);
    for (let y = 0; y < n; y += cell) for (let x = 0; x < n; x += cell) { const k = (r() - 0.5) * amp; g.fillStyle = k > 0 ? `rgba(255,255,255,${k})` : `rgba(0,0,0,${-k})`; g.fillRect(x, y, cell, cell); }
  }
  const T = {};
  T.render = canvasTex(512, (g, n) => { noiseFill(g, n, '#efebe3', 0.05, 3, 2); const r = rng(4); for (let k = 0; k < 500; k++) { g.fillStyle = `rgba(120,110,95,${0.02 + r() * 0.03})`; g.fillRect(r() * n, r() * n, 6 + r() * 30, 3 + r() * 12); } }, 2.0);
  T.granite = canvasTex(512, (g, n) => {           // alvenaria de granito aparelhado irregular (Minho)
    const r = rng(17); g.fillStyle = '#5f5a52'; g.fillRect(0, 0, n, n);
    let y = 0;
    while (y < n) {
      const h = 34 + r() * 40; let x = -r() * 60;
      while (x < n) {
        const w = 50 + r() * 90; const l = 128 + r() * 50;
        g.fillStyle = `rgb(${l},${l - 4},${l - 12})`; g.fillRect(x + 2, y + 2, w - 4, h - 4);
        for (let k = 0; k < 40; k++) { const a = r(); g.fillStyle = a < 0.5 ? 'rgba(30,30,30,0.18)' : 'rgba(255,255,255,0.18)'; g.fillRect(x + 2 + r() * (w - 4), y + 2 + r() * (h - 4), 1 + r() * 2, 1 + r() * 2); }
        g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 2, y + h - 6, w - 4, 4);
        x += w;
      }
      y += h;
    }
  }, 1.6);
  T.granite_s = canvasTex(256, (g, n) => { const r = rng(8); g.fillStyle = '#c3bdb2'; g.fillRect(0, 0, n, n); for (let k = 0; k < 3200; k++) { const l = r(); g.fillStyle = l < 0.5 ? 'rgba(40,40,40,0.30)' : 'rgba(255,255,255,0.35)'; g.fillRect(r() * n, r() * n, 1 + r() * 2, 1 + r() * 2); } }, 0.6);
  T.deck = canvasTex(512, (g, n) => {             // lajes de granito amaciado 80 × 40
    const r = rng(9); noiseFill(g, n, '#cfc8bc', 0.05, 9, 2);
    for (let k = 0; k < 2600; k++) { g.fillStyle = r() < 0.5 ? 'rgba(60,55,50,0.18)' : 'rgba(255,255,255,0.2)'; g.fillRect(r() * n, r() * n, 1.5, 1.5); }
    g.strokeStyle = 'rgba(70,62,55,0.45)'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * n / 4); g.lineTo(n, i * n / 4); g.stroke(); }
    for (let i = 0; i < 4; i++) for (let j = 0; j <= 2; j++) { const x = (j * n / 2 + (i % 2) * n / 4) % n; g.beginPath(); g.moveTo(x, i * n / 4); g.lineTo(x, (i + 1) * n / 4); g.stroke(); }
  }, 1.6);
  T.timber = canvasTex(512, (g, n) => {           // ripado de pinho tratado (cor mel), ripas 6 cm + junta 2 cm
    const r = rng(23); g.fillStyle = '#3d2c1e'; g.fillRect(0, 0, n, n);
    const w = n / 12.5;
    for (let i = 0; i < 13; i++) { const x = i * w; const l = 150 + r() * 30; g.fillStyle = `rgb(${l},${l - 48},${l - 95})`; g.fillRect(x, 0, w * 0.75, n);
      for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(90,55,25,${0.05 + r() * 0.1})`; g.fillRect(x + r() * w * 0.7, r() * n, 1, 10 + r() * 50); } }
  }, 1.0);
  T.wood = canvasTex(512, (g, n) => { const r = rng(21); g.fillStyle = '#cbb497'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 10; i++) { const y = i * n / 10, l = 192 + r() * 22; g.fillStyle = `rgb(${l},${l - 26},${l - 58})`; g.fillRect(0, y, n, n / 10 - 1);
      for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(90,60,30,${0.05 + r() * 0.08})`; g.fillRect(0, y + r() * n / 10, n, 1); } g.fillStyle = 'rgba(60,40,20,0.35)'; g.fillRect(r() * n, y, 2, n / 10); } }, 2.0);
  T.tile = canvasTex(256, (g, n) => { noiseFill(g, n, '#d8d4cc', 0.05, 2, 2); g.strokeStyle = 'rgba(0,0,0,0.18)'; g.strokeRect(0, 0, n, n); }, 0.6);
  T.gravel = canvasTex(256, (g, n) => noiseFill(g, n, '#b9b3a8', 0.30, 13, 2), 0.8);
  T.gpatio = canvasTex(256, (g, n) => noiseFill(g, n, '#d6ccb8', 0.25, 14, 2), 0.8);
  T.concrete = canvasTex(256, (g, n) => { noiseFill(g, n, '#d9d5cd', 0.05, 5, 2); }, 1.2);
  T.ground = canvasTex(512, (g, n) => { const r = rng(41); g.fillStyle = '#ffffff'; g.fillRect(0, 0, n, n);
    for (let k = 0; k < 9000; k++) { const l = 150 + r() * 105; g.fillStyle = `rgba(${l},${l},${l},0.55)`; g.fillRect(r() * n, r() * n, 1 + r() * 2, 2 + r() * 4); } }, 3.0);
  T.water = canvasTex(256, (g, n) => { const r = rng(55); g.fillStyle = '#808080'; g.fillRect(0, 0, n, n); for (let k = 0; k < 400; k++) { g.strokeStyle = `rgba(255,255,255,${r() * 0.15})`; g.beginPath(); const x = r() * n, y = r() * n; g.ellipse(x, y, 6 + r() * 20, 2 + r() * 5, 0, 0, 7); g.stroke(); } }, 2.0, false);
  T.calcada = canvasTex(256, (g, n) => { const r = rng(61); g.fillStyle = '#b9b5ad'; g.fillRect(0, 0, n, n); for (let y = 0; y < n; y += 9) for (let x = (y / 9 % 2) * 4; x < n; x += 9) { const l = 170 + r() * 45; g.fillStyle = `rgb(${l},${l - 3},${l - 8})`; g.fillRect(x, y, 7.5, 7.5); } }, 0.9);

  const std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    render: std({ map: T.render, roughness: 0.95 }),
    plaster: std({ color: 0xf3f1ec, roughness: 0.92 }), ceiling: std({ color: 0xf6f4f0, roughness: 0.95 }),
    granite_wall: std({ map: T.granite, roughness: 0.95 }), granite_base: std({ map: T.granite_s, color: 0xd8d2c8, roughness: 0.85 }),
    granite: std({ map: T.granite_s, roughness: 0.75 }), coping: std({ map: T.granite_s, roughness: 0.7 }),
    deck: std({ map: T.deck, roughness: 0.8 }), concrete: std({ map: T.concrete, roughness: 0.9 }), soffit: std({ map: T.concrete, color: 0xeeeae3, roughness: 0.92 }),
    reveal: std({ color: 0x2d2a26, roughness: 0.6, metalness: 0.3 }), frame: std({ color: 0x3a342d, roughness: 0.45, metalness: 0.5 }),
    metal: std({ color: 0x3a342d, roughness: 0.5, metalness: 0.6 }), metal_black: std({ color: 0x151515, roughness: 0.5, metalness: 0.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xaec2c8, transparent: true, opacity: 0.2, roughness: 0.03, metalness: 0.0, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide }),
    glass_dark: new THREE.MeshPhysicalMaterial({ color: 0x5f7178, roughness: 0.05, metalness: 0.2, envMapIntensity: 1.4 }),
    a_wall: std({ color: 0xe8e3da, roughness: 0.9 }), a_roof: std({ color: 0x34383b, roughness: 0.6, metalness: 0.3 }),
    timber: std({ map: T.timber, roughness: 0.85 }), shutter: std({ map: T.timber, roughness: 0.85 }), oak: std({ color: 0xa8774c, roughness: 0.55 }), oak_panel: std({ color: 0xbd9165, roughness: 0.6 }),
    floor_int: std({ map: T.wood, roughness: 0.55 }), floor_wood: std({ map: T.wood, roughness: 0.55 }), tile: std({ map: T.tile, roughness: 0.4 }),
    cave_floor: std({ color: 0xa9a59d, roughness: 0.8 }), gravel: std({ map: T.gravel, roughness: 1.0 }), gpatio: std({ map: T.gpatio, roughness: 1.0 }),
    water: new THREE.MeshPhysicalMaterial({ color: 0x2f8a92, transparent: true, opacity: 0.86, roughness: 0.05, envMapIntensity: 1.8, bumpMap: T.water, bumpScale: 0.6, clearcoat: 1.0, clearcoatRoughness: 0.05 }),
    liner: std({ color: 0x8fb3b0, roughness: 0.6 }),
    furn_white: std({ color: 0xecebe7, roughness: 0.6 }), furn_oak: std({ color: 0xb98c5c, roughness: 0.6 }), furn_dark: std({ color: 0x3a3733, roughness: 0.6 }),
    stone_top: std({ color: 0xd8d3c9, roughness: 0.35 }), fabric: std({ color: 0xb7ae9f, roughness: 1.0 }), fabric_out: std({ color: 0xe8e2d6, roughness: 1.0 }),
    linen: std({ color: 0xefe9de, roughness: 1.0 }), rug: std({ color: 0xa7988a, roughness: 1.0 }), car: std({ color: 0x6a7076, roughness: 0.35, metalness: 0.6 }),
  };
  const mat = (k) => M[k] || M.plaster;
  const FACE_KEYS = ['+x', '-x', 'top', 'bot', '-y', '+y'];
  function boxGeo(a, b) {
    const x0 = a[0], x1 = b[0], y0 = a[2] - zref, y1 = b[2] - zref, z0 = -b[1], z1 = -a[1];
    const pos = [], nor = [], uv = [], idx = []; const geo = new THREE.BufferGeometry();
    function quad(p0, p1, p2, p3, n, uvs, g) { const s = pos.length / 3; [p0, p1, p2, p3].forEach((p, i) => { pos.push(...p); nor.push(...n); uv.push(...uvs[i]); }); idx.push(s, s + 1, s + 2, s, s + 2, s + 3); geo.addGroup(idx.length - 6, 6, g); }
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[-z1, y0], [-z0, y0], [-z0, y1], [-z1, y1]], 0);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]], 1);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]], 2);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], 3);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 4);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[-x1, y0], [-x0, y0], [-x0, y1], [-x1, y1]], 5);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); return geo;
  }
  const groups = { glass: [], roof: [], furn: [] };
  function prismMesh(p) {
    const sh = new THREE.Shape(p.p.map(([u, v]) => new THREE.Vector2(u, v)));
    for (const h of p.h) sh.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: p.z[1] - p.z[0], bevelEnabled: false });
    const g0 = geo.groups.find(g => g.materialIndex === 0), g1 = geo.groups.find(g => g.materialIndex === 1);
    const half = g0.count / 2; geo.clearGroups(); geo.addGroup(g0.start, half, 0); geo.addGroup(g0.start + half, half, 1); if (g1) geo.addGroup(g1.start, g1.count, 2);
    geo.rotateX(-Math.PI / 2); geo.translate(0, p.z[0] - zref, 0);
    // UV das faces laterais em metros (comprimento ao longo do contorno, altura)
    const m = new THREE.Mesh(geo, [mat(p.bot), mat(p.top), mat(p.side)]); m.castShadow = true; m.receiveShadow = true; return m;
  }
  function addGroup(gd, parent) {
    const grp = new THREE.Group(); grp.position.set(gd.o[0], 0, -gd.o[1]); grp.rotation.y = gd.a; parent.add(grp);
    for (const b of gd.boxes) {
      const mats = FACE_KEYS.map(k => mat((b.f && b.f[k.replace('x', 'u').replace('y', 'v')]) || (b.f && b.f[k]) || b.m));
      const mesh = new THREE.Mesh(boxGeo(b.a, b.b), mats);
      const isGlass = b.m === 'glass' || b.m === 'water';
      mesh.castShadow = !b.nc && !isGlass; mesh.receiveShadow = true;
      if (b.m === 'glass') { mesh.renderOrder = 2; groups.glass.push(mesh); }
      if (b.t === 'furn') groups.furn.push(mesh);
      grp.add(mesh);
    }
    for (const p of gd.prisms) {
      const m = prismMesh(p);
      if (p.t && (p.t.startsWith('roof') || p.t === 'parapet' || p.t === 'alp' || p.t === 'car')) groups.roof.push(m);
      grp.add(m);
    }
    if (gd.roof_tri) {
      const sh = new THREE.Shape(gd.roof_tri.map(([v, z]) => new THREE.Vector2(v, z - zref)));
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 15.6, bevelEnabled: false }); geo.rotateY(Math.PI / 2); geo.translate(-0.3, 0, 0);
      const m = new THREE.Mesh(geo, M.a_roof); m.castShadow = true; m.receiveShadow = true; grp.add(m);
      // empena poente em vidro (triângulo)
      const tri = new THREE.Shape(gd.roof_tri.map(([v, z]) => new THREE.Vector2(v, z - zref - 0.05)));
      const gg = new THREE.ShapeGeometry(tri); gg.rotateY(Math.PI / 2); gg.translate(-0.02, 0, 0);
      const gm = new THREE.Mesh(gg, M.glass_dark); grp.add(gm);
    }
    return grp;
  }
  const world = new THREE.Group(); scene.add(world);
  for (const gd of spec.groups) addGroup(gd, world);
  addGroup(spec.site, world);

  // ------------------------------------------------------------------ terreno de detalhe
  const t = spec.terrain; const hb = Uint8Array.from(atob(t.h), c => c.charCodeAt(0)); const H = new Int16Array(hb.buffer);
  const Cc = Uint8Array.from(atob(t.c), c => c.charCodeAt(0));
  const CLS_COL = { meadow: 0x84905c, lawn: 0x6e9150, path: 0xcdbd9c, paving: 0xbab4a9, bed: 0x5d6a3a, road: 0xb9b5ad, gpatio: 0xd2c7b2, under: 0x6f6a5f, field: 0x929a66 };
  const colArr = t.classes.map(c => new THREE.Color(CLS_COL[c] || 0x888888));
  const tpos = [], tcol = [], tuv = [], tidx = []; const r2 = rng(99);
  for (let j = 0; j < t.nv; j++) for (let i = 0; i < t.nu; i++) {
    const k = j * t.nu + i; const u = t.u0 + i * t.step, v = t.v0 + j * t.step; const z = H[k] / 100 + t.z0;
    tpos.push(u, z - zref, -v); tuv.push(u, v);
    const c = colArr[Cc[k]].clone(); const n = 0.9 + r2() * 0.2; const big = 0.92 + 0.08 * Math.sin(u * 0.37 + Math.cos(v * 0.29) * 2.0);
    tcol.push(c.r * n * big, c.g * n * big, c.b * n * big);
  }
  for (let j = 0; j < t.nv - 1; j++) for (let i = 0; i < t.nu - 1; i++) { const a = j * t.nu + i, b = a + 1, c = a + t.nu, d = c + 1; tidx.push(a, b, c, b, d, c); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3)); tg.setAttribute('color', new THREE.Float32BufferAttribute(tcol, 3));
  tg.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2)); tg.setIndex(tidx); tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, std({ vertexColors: true, map: T.ground, roughness: 1.0 })); terrain.receiveShadow = true; scene.add(terrain);
  const tH = (u, v) => { const i = Math.round((u - t.u0) / t.step), j = Math.round((v - t.v0) / t.step); if (i < 0 || j < 0 || i >= t.nu || j >= t.nv) return farFn(u, v); return H[j * t.nu + i] / 100 + t.z0; };

  // ------------------------------------------------------------------ paisagem distante + mar
  const farFn = (u, v) => { let z; if (u < -60) z = 31.0 + 0.030 * (u + 60) - 0.000004 * (u + 60) * (u + 60); else z = 33.0 + 0.06 * u; if (u > 40) z = 38.4 + 0.07 * (u - 40);
    z += 0.004 * v + 2.2 * Math.sin(u * 0.011) * Math.cos(v * 0.013) + 1.2 * Math.sin(v * 0.02 + u * 0.004); return Math.max(z, u < spec.sea.u ? -3 : 1.2); };
  const FN = 140, FS = 3200, fpos = [], fcol = [], fidx = [];
  for (let j = 0; j <= FN; j++) for (let i = 0; i <= FN; i++) {
    const u = -2000 + (i / FN) * FS, v = -1600 + (j / FN) * FS;
    const inside = u > t.u0 + 1 && u < t.u0 + (t.nu - 1) * t.step - 1 && v > t.v0 + 1 && v < t.v0 + (t.nv - 1) * t.step - 1;
    let z = farFn(u, v); if (inside) z -= 8.0; fpos.push(u, z - zref, -v);
    const c = new THREE.Color(u < spec.sea.u + 40 ? 0xb8ad8c : (Math.sin(u * 0.05) * Math.cos(v * 0.043) > 0.3 ? 0x5f7a40 : 0x748a4e)); const n = 0.85 + r2() * 0.25; fcol.push(c.r * n, c.g * n, c.b * n);
  }
  for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) { const a = j * (FN + 1) + i, b = a + 1, c = a + FN + 1, d = c + 1; fidx.push(a, b, c, b, d, c); }
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3)); fg.setAttribute('color', new THREE.Float32BufferAttribute(fcol, 3)); fg.setIndex(fidx); fg.computeVertexNormals();
  scene.add(new THREE.Mesh(fg, std({ vertexColors: true, roughness: 1.0 })));
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshPhysicalMaterial({ color: 0x3a6a85, roughness: 0.18, envMapIntensity: 1.2, clearcoat: 0.6 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(spec.sea.u - 6000 + 40, -zref, 0); scene.add(sea);
  const rr = rng(1234); const dummy = new THREE.Object3D();
  const hm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std({ color: 0xece8df, roughness: 0.9 }), 220);
  const roofGeo = new THREE.ConeGeometry(0.75, 0.45, 4); roofGeo.rotateY(Math.PI / 4);
  const rm = new THREE.InstancedMesh(roofGeo, std({ color: 0x9a5a3e, roughness: 0.85 }), 220); let nh = 0;
  while (nh < 220) { const u = -900 + rr() * 1500, v = -1100 + rr() * 2200; if (Math.abs(u + 20) < 140 && Math.abs(v) < 120) continue; if (u < spec.sea.u + 120 || (u < -380 && Math.abs(v) < 700)) continue;
    const w = 8 + rr() * 8, d = 7 + rr() * 6, h = 3 + rr() * 3.5, z = farFn(u, v) - zref;
    dummy.position.set(u, z + h / 2, -v); dummy.rotation.set(0, rr() * 3, 0); dummy.scale.set(w, h, d); dummy.updateMatrix(); hm.setMatrixAt(nh, dummy.matrix);
    dummy.position.set(u, z + h + 1.0, -v); dummy.scale.set(w * 1.05, 3.2, d * 1.05); dummy.updateMatrix(); rm.setMatrixAt(nh, dummy.matrix); nh++; }
  scene.add(hm); scene.add(rm);
  const ft = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), std({ color: 0x3c5630, roughness: 1, flatShading: true }), 1800);
  for (let k = 0; k < 1800; k++) { let u, v; do { u = -1100 + rr() * 1900; v = -1300 + rr() * 2600; } while ((Math.abs(u + 25) < 95 && Math.abs(v) < 75) || u < spec.sea.u + 80 || (u < -420 && Math.abs(v) < 800));
    const s = 3 + rr() * 5; const z = farFn(u, v) - zref; dummy.position.set(u, z + s * 0.9, -v); dummy.rotation.set(rr(), rr(), rr()); dummy.scale.set(s, s * (1.1 + rr() * 0.6), s); dummy.updateMatrix(); ft.setMatrixAt(k, dummy.matrix); }
  scene.add(ft);

  // ------------------------------------------------------------------ vegetação do projeto
  const trunkMat = std({ color: 0x5b4b3c, roughness: 1 });
  const crownCols = { oak: 0x4c6a2f, pine: 0x3a5229, euc: 0x5f7154, olive: 0x7f8c66, arbutus: 0x3b5d2e, fruit: 0x5e7f38, cypress: 0x2e4a2a };
  function crownGeo(seed) { const g = new THREE.SphereGeometry(1, 24, 16); const p = g.attributes.position; const r = rng(seed); const ph = [r() * 6, r() * 6, r() * 6];
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + 0.13 * Math.sin(x * 4 + ph[0]) * Math.cos(y * 5 + ph[1]) + 0.08 * Math.sin(z * 7 + ph[2]) + 0.05 * Math.sin(x * 13 + y * 11 + ph[2]); p.setXYZ(i, x * k, y * k, z * k); }
    g.computeVertexNormals(); return g; }
  const crowns = []; for (let k = 0; k < 12; k++) crowns.push(crownGeo(k * 7 + 3));
  const cmats = {}; for (const k in crownCols) cmats[k] = std({ color: crownCols[k], roughness: 0.95 });
  spec.trees.forEach(([kind, u, v, h, d], idx) => {
    const grp = new THREE.Group(); grp.position.copy(P(u, v, tH(u, v))); const cm = cmats[kind] || cmats.oak; const r = rng(idx * 13 + 5);
    if (kind === 'pine' || kind === 'euc') {
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.28, h * 0.85, 6), trunkMat); tr.position.y = h * 0.42; tr.rotation.z = (r() - 0.5) * 0.12; grp.add(tr);
      const nC = kind === 'pine' ? 3 : 4;
      for (let k = 0; k < nC; k++) { const c = new THREE.Mesh(crowns[(idx + k) % 12], cm); const s = d * (0.3 + r() * 0.12);
        c.scale.set(s, kind === 'pine' ? s * 0.55 : s * 0.9, s); c.position.set((r() - 0.5) * d * 0.4, h * (kind === 'pine' ? 0.84 : 0.68) + r() * h * 0.18, (r() - 0.5) * d * 0.4); grp.add(c); }
    } else if (kind === 'cypress') { const c = new THREE.Mesh(new THREE.ConeGeometry(d / 2, h, 10), cm); c.position.y = h / 2 + 0.3; grp.add(c);
    } else {
      const th = kind === 'olive' ? 0.35 : 0.45; const tr = new THREE.Mesh(new THREE.CylinderGeometry(d * 0.03, d * 0.05, h * th + 0.4, 7), trunkMat); tr.position.y = (h * th) / 2; grp.add(tr);
      const n = kind === 'oak' ? 5 : 3;
      for (let k = 0; k < n; k++) { const c = new THREE.Mesh(crowns[(idx + k) % 12], cm); const s = d * (0.32 + r() * 0.14); c.scale.set(s, s * (kind === 'olive' ? 0.7 : 0.85), s);
        c.position.set((r() - 0.5) * d * 0.45, h * th + (h - h * th) * (0.35 + r() * 0.3), (r() - 0.5) * d * 0.45); grp.add(c); }
    }
    grp.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); scene.add(grp);
  });
  const hedgeMat = std({ color: 0x4f6b3a, roughness: 1 });
  for (const hd of spec.hedges) {
    const [ua, va] = hd.a, [ub, vb] = hd.b; const len = Math.hypot(ub - ua, vb - va);
    const nseg = Math.max(1, Math.round(len / 3));
    for (let s = 0; s < nseg; s++) {
      const t0 = s / nseg, t1 = (s + 1) / nseg; const u0 = ua + (ub - ua) * t0, v0 = va + (vb - va) * t0, u1 = ua + (ub - ua) * t1, v1 = va + (vb - va) * t1;
      const L = Math.hypot(u1 - u0, v1 - v0);
      const g = new THREE.BoxGeometry(L + hd.w * 0.4, hd.h, hd.w, Math.max(2, Math.round(L * 2)), 3, 2); const p = g.attributes.position; const r = rng(Math.round(u0 * 100 + v0 * 7));
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + (r() - 0.5) * 0.08, p.getY(i) + (r() - 0.5) * 0.12, p.getZ(i) + (r() - 0.5) * 0.14);
      g.computeVertexNormals(); const m = new THREE.Mesh(g, hedgeMat); const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      m.position.copy(P(um, vm, tH(um, vm) + hd.h / 2 - 0.05)); m.rotation.y = Math.atan2(v1 - v0, u1 - u0); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    }
  }
  const shrubCols = [0x8d9a5a, 0xb9ad7c, 0x7a8a52, 0x8c84a6, 0x6c7f45];
  spec.shrubs.forEach(([u, v, s], k) => { const m = new THREE.Mesh(crowns[k % 12], std({ color: shrubCols[k % shrubCols.length], roughness: 1 })); m.scale.set(s * 0.6, s * 0.45, s * 0.6); m.position.copy(P(u, v, tH(u, v) + s * 0.25)); m.castShadow = true; scene.add(m); });

  // ------------------------------------------------------------------ céu, sol, luzes
  const sky = new Sky(); sky.scale.setScalar(20000); scene.add(sky);
  const sun = new THREE.DirectionalLight(0xffffff, 3.0); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera; sc.left = -62; sc.right = 62; sc.top = 62; sc.bottom = -62; sc.near = 1; sc.far = 320;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.05; scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xc7dbef, 0x6b6450, 0.55); scene.add(hemi);
  const interior = new THREE.Group(); scene.add(interior);
  for (const L of (spec.lights || [])) { const pl = new THREE.PointLight(0xffc98f, 0, L.d, 2); pl.position.copy(P(L.p[0], L.p[1], L.p[2])); pl.userData.i = L.i; interior.add(pl); }
  const center = P(spec.center[0], spec.center[1], spec.center[2]);
  function setTime(sunVec, dusk) {
    const dir = new THREE.Vector3(sunVec[0], sunVec[2], -sunVec[1]).normalize();
    sun.position.copy(center).addScaledVector(dir, 150); sun.target.position.copy(center);
    const alt = Math.asin(sunVec[2]) * 180 / Math.PI; const u = sky.material.uniforms;
    u.turbidity.value = dusk ? 9 : 3.5; u.rayleigh.value = dusk ? 2.8 : 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82; u.sunPosition.value.copy(dir);
    const warm = Math.max(0, Math.min(1, (25 - alt) / 22)); sun.color.setRGB(1, 0.96 - 0.22 * warm, 0.9 - 0.42 * warm);
    sun.intensity = dusk ? 1.8 : 2.2; hemi.intensity = dusk ? 0.3 : 0.45;
    interior.children.forEach(l => { l.intensity = dusk ? l.userData.i * 9 : 0; });
    scene.fog = new THREE.Fog(dusk ? 0xd8c4ab : 0xc6d3df, 600, 9000);
  }
  return { scene, P, setTime, groups, materials: M, sky, sun, center };
}
