// Casa Plinto — construção da cena three.js a partir de spec.json (gerado por build3d.py).
// Coordenadas locais (u, v, z) → three (x = u, y = z − zref, z = −v).
export function buildScene(THREE, Sky, spec, opts = {}) {
  const zref = spec.zref;
  const P = (u, v, z) => new THREE.Vector3(u, z - zref, -v);
  const scene = new THREE.Scene();

  // ------------------------------------------------------------------ texturas procedimentais
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function canvasTex(size, draw, repeatMeters, srgb = true) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); draw(g, size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / repeatMeters, 1 / repeatMeters);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  function noiseFill(g, n, base, amp, seed, cell = 2) {
    const r = rng(seed); g.fillStyle = base; g.fillRect(0, 0, n, n);
    for (let y = 0; y < n; y += cell) for (let x = 0; x < n; x += cell) {
      const k = (r() - 0.5) * amp; g.fillStyle = k > 0 ? `rgba(255,255,255,${k})` : `rgba(0,0,0,${-k})`; g.fillRect(x, y, cell, cell);
    }
  }
  const T = {};
  T.timber = canvasTex(512, (g, n) => {           // pinho carbonizado: ripas verticais 8 cm + junta 1,5 cm (1 m)
    const r = rng(3); g.fillStyle = '#121110'; g.fillRect(0, 0, n, n);
    const w = n / 10.5;
    for (let i = 0; i < 11; i++) {
      const x = i * w; const l = 18 + r() * 14;
      g.fillStyle = `rgb(${l + 4},${l + 1},${l - 2})`; g.fillRect(x, 0, w * 0.86, n);
      for (let k = 0; k < 140; k++) { const yy = r() * n; const a = r() * 0.25; g.fillStyle = `rgba(255,240,220,${a * 0.18})`; g.fillRect(x + r() * w * 0.8, yy, 1 + r() * 2, 6 + r() * 30); }
      for (let k = 0; k < 40; k++) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x + r() * w * 0.8, r() * n, 2, 1 + r() * 3); }
    }
  }, 1.0);
  T.shutter = T.timber;
  T.render = canvasTex(512, (g, n) => {          // betão à vista, cofragem de tábua de pinho (tábuas 15 cm)
    const r = rng(11); noiseFill(g, n, '#9a958b', 0.07, 11, 2);
    const bh = n / (1.2 / 0.15);
    for (let i = 0; i < 8; i++) {
      const y = i * bh; const l = (r() - 0.5) * 0.10;
      g.fillStyle = l > 0 ? `rgba(255,255,255,${l})` : `rgba(0,0,0,${-l})`; g.fillRect(0, y, n, bh);
      for (let k = 0; k < 50; k++) { g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`; g.fillRect(r() * n, y + r() * bh, 20 + r() * 120, 1); }
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, y, n, 1.5);
    }
  }, 1.2);
  T.concrete = canvasTex(256, (g, n) => {
    noiseFill(g, n, '#b8b3a9', 0.07, 5, 2);
    g.strokeStyle = 'rgba(0,0,0,0.05)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(0, i * n / 6); g.lineTo(n, i * n / 6); g.stroke(); }
  }, 1.2);
  T.deck = canvasTex(512, (g, n) => {             // porcelânico 120x60 pedra clara
    noiseFill(g, n, '#cdc7bc', 0.06, 9, 2);
    g.strokeStyle = 'rgba(80,70,60,0.35)'; g.lineWidth = 2;
    for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(0, i * n / 2); g.lineTo(n, i * n / 2); g.stroke(); }
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, n); g.stroke();
  }, 1.2);
  T.wood = canvasTex(512, (g, n) => {              // pavimento cerâmico efeito carvalho, tábuas 20 cm
    const r = rng(21); g.fillStyle = '#cbb497'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 10; i++) {
      const y = i * n / 10, l = 190 + r() * 25;
      g.fillStyle = `rgb(${l},${l - 26},${l - 58})`; g.fillRect(0, y, n, n / 10 - 1);
      for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(90,60,30,${0.05 + r() * 0.08})`; g.fillRect(0, y + r() * n / 10, n, 1); }
      g.fillStyle = 'rgba(60,40,20,0.35)'; g.fillRect(r() * n, y, 2, n / 10);
    }
  }, 2.0);
  T.tile = canvasTex(256, (g, n) => { noiseFill(g, n, '#d8d4cc', 0.05, 2, 2); g.strokeStyle = 'rgba(0,0,0,0.18)'; g.strokeRect(0, 0, n, n); }, 0.6);
  T.gravel = canvasTex(256, (g, n) => noiseFill(g, n, '#8e8981', 0.35, 13, 2), 0.8);
  T.stone = canvasTex(512, (g, n) => {             // betão ciclópico com granito da escavação
    const r = rng(17); noiseFill(g, n, '#8d887f', 0.08, 4, 2);
    for (let k = 0; k < 90; k++) {
      const x = r() * n, y = r() * n, rr = 10 + r() * 28; const l = 120 + r() * 70;
      g.fillStyle = `rgb(${l},${l - 4},${l - 12})`; g.beginPath();
      const nv = 5 + Math.floor(r() * 3), a0 = r() * 6;
      for (let q = 0; q < nv; q++) { const a = a0 + q * 6.283 / nv, rq = rr * (0.65 + r() * 0.5); const px = x + Math.cos(a) * rq, py = y + Math.sin(a) * rq * 0.75; q ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.stroke();
    }
  }, 1.6);
  T.granite = canvasTex(256, (g, n) => { const r = rng(8); g.fillStyle = '#c9c3b8'; g.fillRect(0, 0, n, n); for (let k = 0; k < 3000; k++) { const l = r(); g.fillStyle = l < 0.5 ? 'rgba(40,40,40,0.35)' : 'rgba(255,255,255,0.4)'; g.fillRect(r() * n, r() * n, 1 + r() * 2, 1 + r() * 2); } }, 0.5);
  T.garage = canvasTex(256, (g, n) => { noiseFill(g, n, '#8f8a81', 0.06, 31, 2); g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 1; i < 5; i++) g.fillRect(0, i * n / 5, n, 2); }, 0.55 * 5 / 5);
  T.ground = canvasTex(512, (g, n) => {             // modulação de relva/prado
    const r = rng(41); g.fillStyle = '#ffffff'; g.fillRect(0, 0, n, n);
    for (let k = 0; k < 9000; k++) { const l = 150 + r() * 105; g.fillStyle = `rgba(${l},${l},${l},0.55)`; g.fillRect(r() * n, r() * n, 1 + r() * 2, 2 + r() * 4); }
  }, 3.0);
  T.water = canvasTex(256, (g, n) => { const r = rng(55); g.fillStyle = '#808080'; g.fillRect(0, 0, n, n); for (let k = 0; k < 400; k++) { g.strokeStyle = `rgba(255,255,255,${r() * 0.15})`; g.beginPath(); const x = r() * n, y = r() * n; g.ellipse(x, y, 6 + r() * 20, 2 + r() * 5, 0, 0, 7); g.stroke(); } }, 2.0, false);

  // ------------------------------------------------------------------ materiais
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    timber: std({ map: T.timber, color: 0xffffff, roughness: 0.88, metalness: 0.0 }),
    shutter: std({ map: T.shutter, color: 0xffffff, roughness: 0.9 }),
    plaster: std({ color: 0xf1efea, roughness: 0.92 }),
    ceiling: std({ color: 0xf4f2ee, roughness: 0.95 }),
    render: std({ map: T.render, roughness: 0.95 }),
    concrete: std({ map: T.concrete, roughness: 0.9 }),
    soffit: std({ map: T.concrete, color: 0xe2ded6, roughness: 0.92 }),
    reveal: std({ color: 0x222426, roughness: 0.6, metalness: 0.3 }),
    frame: std({ color: 0x1a1b1d, roughness: 0.45, metalness: 0.5 }),
    metal: std({ color: 0x2b2d30, roughness: 0.5, metalness: 0.6 }),
    metal_black: std({ color: 0x141414, roughness: 0.5, metalness: 0.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xaec2c8, transparent: true, opacity: 0.22, roughness: 0.03, metalness: 0.0, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide }),
    deck: std({ map: T.deck, roughness: 0.75 }),
    floor_int: std({ map: T.wood, roughness: 0.55 }),
    floor_wood: std({ map: T.wood, roughness: 0.55 }),
    tile: std({ map: T.tile, roughness: 0.4 }),
    cave_floor: std({ color: 0xa9a59d, roughness: 0.8 }),
    cave_wall: std({ color: 0xd9d6d0, roughness: 0.95 }),
    gravel: std({ map: T.gravel, roughness: 1.0 }),
    water: new THREE.MeshPhysicalMaterial({ color: 0x2c7c84, transparent: true, opacity: 0.86, roughness: 0.05, metalness: 0.0, envMapIntensity: 1.8, bumpMap: T.water, bumpScale: 0.6, clearcoat: 1.0, clearcoatRoughness: 0.05 }),
    liner: std({ color: 0x3c5d5d, roughness: 0.6 }),
    coping: std({ map: T.granite, roughness: 0.7 }),
    granite: std({ map: T.granite, roughness: 0.75 }),
    stone: std({ map: T.stone, roughness: 0.95 }),
    patio_floor: std({ map: T.gravel, color: 0xd6cfc2, roughness: 1.0 }),
    gpatio: std({ map: T.gravel, color: 0xe2ddd3, roughness: 1.0 }),
    oak: std({ color: 0xb0835a, roughness: 0.55 }),
    stair: std({ color: 0xb0835a, roughness: 0.55 }),
    garage_door: std({ map: T.garage, roughness: 0.9 }),
    furn_white: std({ color: 0xecebe7, roughness: 0.6 }),
    furn_oak: std({ color: 0xb98c5c, roughness: 0.6 }),
    furn_dark: std({ color: 0x3a3733, roughness: 0.6 }),
    stone_top: std({ color: 0xd8d3c9, roughness: 0.35 }),
    fabric: std({ color: 0xb7ae9f, roughness: 1.0 }),
    fabric_out: std({ color: 0xe8e2d6, roughness: 1.0 }),
    linen: std({ color: 0xefe9de, roughness: 1.0 }),
    rug: std({ color: 0xa7988a, roughness: 1.0 }),
    car: std({ color: 0x6a7076, roughness: 0.35, metalness: 0.6 }),
    screen: std({ color: 0x0b0c0e, roughness: 0.15, metalness: 0.2 }),
  };
  M.stair = M.oak;
  const mat = (k) => M[k] || M.plaster;

  // ------------------------------------------------------------------ caixas com UV em metros e materiais por face
  // ordem dos grupos: +x(+u), -x(-u), +y(top), -y(bot), +z(-v), -z(+v)
  const FACE_KEYS = ['+u', '-u', 'top', 'bot', '-v', '+v'];
  function boxGeo(a, b) {
    const x0 = a[0], x1 = b[0], y0 = a[2] - zref, y1 = b[2] - zref, z0 = -b[1], z1 = -a[1];
    const pos = [], nor = [], uv = [], idx = []; const geo = new THREE.BufferGeometry();
    function quad(p0, p1, p2, p3, n, uvs, g) {
      const s = pos.length / 3;
      [p0, p1, p2, p3].forEach((p, i) => { pos.push(...p); nor.push(...n); uv.push(...uvs[i]); });
      idx.push(s, s + 1, s + 2, s, s + 2, s + 3);
      geo.addGroup(idx.length - 6, 6, g);
    }
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[-z1, y0], [-z0, y0], [-z0, y1], [-z1, y1]], 0);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]], 1);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[x0, -z1], [x1, -z1], [x1, -z0], [x0, -z0]], 2);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], 3);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], 4);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[-x1, y0], [-x0, y0], [-x0, y1], [-x1, y1]], 5);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  }
  const groups = { glass: [], shutter: [], furn: [], roof: [], water: [] };
  const house = new THREE.Group(); scene.add(house);
  for (const b of spec.boxes) {
    const mats = FACE_KEYS.map(k => mat((b.f && b.f[k]) || b.m));
    const mesh = new THREE.Mesh(boxGeo(b.a, b.b), mats);
    const isGlass = b.m === 'glass' || b.m === 'water';
    mesh.castShadow = !b.nc && !isGlass; mesh.receiveShadow = !b.nr;
    if (b.m === 'glass') { mesh.renderOrder = 2; groups.glass.push(mesh); }
    if (b.t === 'furn') groups.furn.push(mesh);
    if (b.m === 'water') groups.water.push(mesh);
    house.add(mesh);
  }
  for (const p of spec.prisms) {
    const sh = new THREE.Shape(p.p.map(([u, v]) => new THREE.Vector2(u, v)));
    for (const h of p.h) sh.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
    const depth = p.z[1] - p.z[0];
    const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
    const g0 = geo.groups.find(g => g.materialIndex === 0), g1 = geo.groups.find(g => g.materialIndex === 1);
    const half = g0.count / 2;
    geo.clearGroups(); geo.addGroup(g0.start, half, 0); geo.addGroup(g0.start + half, half, 1); if (g1) geo.addGroup(g1.start, g1.count, 2);
    geo.rotateX(-Math.PI / 2); geo.translate(0, p.z[0] - zref, 0);
    const mesh = new THREE.Mesh(geo, [mat(p.bot), mat(p.top), mat(p.side)]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    if (p.t === 'roof' || p.t === 'sky_frame' || p.t === 'pala') groups.roof.push(mesh);
    house.add(mesh);
  }
  for (const m of house.children) {
    const bb = new THREE.Box3().setFromObject(m);
    if (bb.min.y > 39.70 - zref && bb.max.x < 15.2 && bb.min.x > -1.3 && bb.min.z > -8.2 && bb.max.z < 1.5) groups.roof.push(m);
  }

  // ------------------------------------------------------------------ terreno de detalhe
  const t = spec.terrain;
  const hb = Uint8Array.from(atob(t.h), c => c.charCodeAt(0));
  const H = new Int16Array(hb.buffer);
  const C = Uint8Array.from(atob(t.c), c => c.charCodeAt(0));
  const CLS_COL = { meadow: 0x6f7f45, lawn: 0x5f8a3c, path: 0xc4ae86, paving: 0xbab4a9, bed: 0x5d6a3a, road: 0x4b4b49, gpatio: 0xb5ae9f, patio: 0xa69f91, field: 0x7d8a52, fieldB: 0x748f47, under: 0x6f6a5f };
  const colArr = t.classes.map(c => new THREE.Color(CLS_COL[c] || 0x888888));
  const tpos = [], tcol = [], tuv = [], tidx = [];
  const r2 = rng(99);
  for (let j = 0; j < t.nv; j++) for (let i = 0; i < t.nu; i++) {
    const k = j * t.nu + i; const u = t.u0 + i * t.step, v = t.v0 + j * t.step; const z = H[k] / 100 + 30;
    tpos.push(u, z - zref, -v); tuv.push(u, v);
    const c = colArr[C[k]].clone(); const n = 0.9 + r2() * 0.2; const big = 0.92 + 0.08 * Math.sin(u * 0.37 + Math.cos(v * 0.29) * 2.0);
    tcol.push(c.r * n * big, c.g * n * big, c.b * n * big);
  }
  for (let j = 0; j < t.nv - 1; j++) for (let i = 0; i < t.nu - 1; i++) {
    const a = j * t.nu + i, b = a + 1, c = a + t.nu, d = c + 1;
    tidx.push(a, b, c, b, d, c);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3));
  tg.setAttribute('color', new THREE.Float32BufferAttribute(tcol, 3));
  tg.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
  tg.setIndex(tidx); tg.computeVertexNormals();
  const terrainMat = std({ vertexColors: true, map: T.ground, roughness: 1.0 });
  const terrain = new THREE.Mesh(tg, terrainMat); terrain.receiveShadow = true; scene.add(terrain);

  // ------------------------------------------------------------------ paisagem distante + mar
  const farFn = (u, v) => {
    let z;
    if (u < -40) z = 34.0 + 0.032 * (u + 40) - 0.000004 * (u + 40) * (u + 40); else z = 34.8 + 0.06 * u;
    if (u > 60) z = 38.4 + 0.07 * (u - 60);
    z += 0.004 * v + 2.2 * Math.sin(u * 0.011) * Math.cos(v * 0.013) + 1.2 * Math.sin(v * 0.02 + u * 0.004);
    return Math.max(z, u < spec.sea.u ? -3 : 1.2);
  };
  const FN = 140, FS = 3200, fpos = [], fcol = [], fidx = [];
  for (let j = 0; j <= FN; j++) for (let i = 0; i <= FN; i++) {
    const u = -2000 + (i / FN) * FS, v = -1600 + (j / FN) * FS;
    const inside = u > t.u0 + 1 && u < t.u0 + (t.nu - 1) * t.step - 1 && v > t.v0 + 1 && v < t.v0 + (t.nv - 1) * t.step - 1;
    let z = farFn(u, v); if (inside) z -= 6.0;
    fpos.push(u, z - zref, -v);
    const c = new THREE.Color(u < spec.sea.u + 40 ? 0xb8ad8c : (Math.sin(u * 0.05) * Math.cos(v * 0.043) > 0.3 ? 0x6f8848 : 0x86985a));
    const n = 0.85 + r2() * 0.25; fcol.push(c.r * n, c.g * n, c.b * n);
  }
  for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) { const a = j * (FN + 1) + i, b = a + 1, c = a + FN + 1, d = c + 1; fidx.push(a, b, c, b, d, c); }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3)); fg.setAttribute('color', new THREE.Float32BufferAttribute(fcol, 3));
  fg.setIndex(fidx); fg.computeVertexNormals();
  const far = new THREE.Mesh(fg, std({ vertexColors: true, roughness: 1.0 })); far.receiveShadow = false; scene.add(far);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), new THREE.MeshPhysicalMaterial({ color: 0x3a6a85, roughness: 0.18, metalness: 0.0, envMapIntensity: 1.2, clearcoat: 0.6 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(spec.sea.u - 6000 + 40, -zref + 0.0, 0); scene.add(sea);

  // aldeia e arvoredo distantes (instanciados)
  const rr = rng(1234);
  const houseGeo = new THREE.BoxGeometry(1, 1, 1);
  const hm = new THREE.InstancedMesh(houseGeo, std({ color: 0xece8df, roughness: 0.9 }), 260);
  const roofGeo = new THREE.ConeGeometry(0.75, 0.45, 4); roofGeo.rotateY(Math.PI / 4);
  const rm = new THREE.InstancedMesh(roofGeo, std({ color: 0x9a5a3e, roughness: 0.85 }), 260);
  const dummy = new THREE.Object3D(); let nh = 0;
  while (nh < 260) {
    const u = -900 + rr() * 1500, v = -1100 + rr() * 2200;
    if (Math.abs(u - 5) < 110 && Math.abs(v) < 110) continue;
    if (u < spec.sea.u + 120 || (u < -380 && Math.abs(v) < 700)) continue;
    const w = 8 + rr() * 8, d = 7 + rr() * 6, h = 3 + rr() * 3.5, z = farFn(u, v) - zref;
    dummy.position.set(u, z + h / 2, -v); dummy.rotation.set(0, rr() * 3, 0); dummy.scale.set(w, h, d); dummy.updateMatrix(); hm.setMatrixAt(nh, dummy.matrix);
    dummy.position.set(u, z + h + 1.0, -v); dummy.scale.set(w * 1.05, 3.2, d * 1.05); dummy.updateMatrix(); rm.setMatrixAt(nh, dummy.matrix);
    nh++;
  }
  scene.add(hm); scene.add(rm);
  const ftG = new THREE.IcosahedronGeometry(1, 1);
  const ft = new THREE.InstancedMesh(ftG, std({ color: 0x3f5a30, roughness: 1, flatShading: true }), 1600);
  for (let k = 0; k < 1600; k++) {
    let u, v; do { u = -1100 + rr() * 1900; v = -1300 + rr() * 2600; } while ((Math.abs(u - 5) < 70 && Math.abs(v) < 70) || u < spec.sea.u + 80 || (u < -420 && Math.abs(v) < 800));
    const s = 3 + rr() * 5; const z = farFn(u, v) - zref;
    dummy.position.set(u, z + s * 0.9, -v); dummy.rotation.set(rr(), rr(), rr()); dummy.scale.set(s, s * (1.1 + rr() * 0.6), s); dummy.updateMatrix(); ft.setMatrixAt(k, dummy.matrix);
  }
  scene.add(ft);

  // ------------------------------------------------------------------ vegetação do projeto
  const tH = (u, v) => {
    const i = Math.round((u - t.u0) / t.step), j = Math.round((v - t.v0) / t.step);
    if (i < 0 || j < 0 || i >= t.nu || j >= t.nv) return farFn(u, v);
    return H[j * t.nu + i] / 100 + 30;
  };
  const trunkMat = std({ color: 0x5b4b3c, roughness: 1 });
  const crownCols = { oak: 0x4c6a2f, pine: 0x3e5a2c, olive: 0x7f8c66, arbutus: 0x3b5d2e, fruit: 0x5e7f38, cypress: 0x2e4a2a };
  function crownGeo(seed) {
    const g = new THREE.SphereGeometry(1, 28, 18); const p = g.attributes.position; const r = rng(seed);
    const ph = [r() * 6, r() * 6, r() * 6];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.13 * Math.sin(x * 4 + ph[0]) * Math.cos(y * 5 + ph[1]) + 0.08 * Math.sin(z * 7 + ph[2]) + 0.05 * Math.sin(x * 13 + y * 11 + ph[2]);
      p.setXYZ(i, x * k, y * k, z * k);
    }
    g.computeVertexNormals(); return g;
  }
  spec.trees.forEach(([kind, u, v, h, d], idx) => {
    const g0 = (kind === 'arbutus' && u > 9 && u < 15.3 && v < -1.3 && v > -4.9) ? spec.patioZ || 34.0 : tH(u, v);
    const grp = new THREE.Group(); grp.position.copy(P(u, v, g0));
    const cm = std({ color: crownCols[kind], roughness: 0.95 });
    if (kind === 'pine') {
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.32, h * 0.82, 8), trunkMat); tr.position.y = h * 0.41; tr.rotation.z = 0.08; grp.add(tr);
      for (let k = 0; k < 4; k++) { const c = new THREE.Mesh(crownGeo(idx * 7 + k), cm); c.scale.set(d * (0.32 + k * 0.03), d * 0.11, d * (0.3 + (3 - k) * 0.03)); c.position.set((k - 1.5) * d * 0.12, h * 0.86 + (k % 2) * 0.3, (k % 2 - 0.5) * d * 0.15); grp.add(c); }
    } else if (kind === 'cypress') {
      const c = new THREE.Mesh(new THREE.ConeGeometry(d / 2, h, 10), cm); c.position.y = h / 2 + 0.3; grp.add(c);
    } else {
      const th = kind === 'olive' ? 0.35 : 0.45;
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(d * 0.03, d * 0.05, h * th + 0.4, 7), trunkMat); tr.position.y = (h * th) / 2; grp.add(tr);
      const n = kind === 'oak' ? 5 : 3; const r = rng(idx * 13 + 5);
      for (let k = 0; k < n; k++) {
        const c = new THREE.Mesh(crownGeo(idx * 11 + k), cm); const s = d * (0.32 + r() * 0.14);
        c.scale.set(s, s * (kind === 'olive' ? 0.7 : 0.85), s);
        c.position.set((r() - 0.5) * d * 0.45, h * th + (h - h * th) * (0.35 + r() * 0.3), (r() - 0.5) * d * 0.45); grp.add(c);
      }
    }
    grp.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(grp);
  });
  const hedgeMat = std({ color: 0x34492a, roughness: 1 });
  for (const hd of spec.hedges) {
    const [ua, va] = hd.a, [ub, vb] = hd.b; const len = Math.hypot(ub - ua, vb - va);
    const g = new THREE.BoxGeometry(len + hd.w * 0.5, hd.h, hd.w, Math.max(2, Math.round(len * 2)), 3, 2);
    const p = g.attributes.position; const r = rng(Math.round(ua * 100));
    for (let i = 0; i < p.count; i++) { p.setXYZ(i, p.getX(i) + (r() - 0.5) * 0.08, p.getY(i) + (r() - 0.5) * 0.1, p.getZ(i) + (r() - 0.5) * 0.12); }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, hedgeMat); const um = (ua + ub) / 2, vm = (va + vb) / 2;
    m.position.copy(P(um, vm, tH(um, vm) + hd.h / 2 - 0.05)); m.rotation.y = Math.atan2(vb - va, ub - ua);
    m.castShadow = true; m.receiveShadow = true; scene.add(m);
  }
  const shrubCols = [0x8d9a5a, 0xb9ad7c, 0x7a8a52, 0x8c84a6, 0x6c7f45];
  spec.shrubs.forEach(([u, v, s], k) => {
    const m = new THREE.Mesh(crownGeo(500 + k), std({ color: shrubCols[k % shrubCols.length], roughness: 1 }));
    m.scale.set(s * 0.6, s * 0.45, s * 0.6); m.position.copy(P(u, v, tH(u, v) + s * 0.25)); m.castShadow = true; scene.add(m);
  });

  // ------------------------------------------------------------------ céu, sol, luzes
  const sky = new Sky(); sky.scale.setScalar(20000); scene.add(sky);
  const sun = new THREE.DirectionalLight(0xffffff, 3.0);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera; sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 260;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04;
  scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xc7dbef, 0x6b6450, 0.55); scene.add(hemi);
  const interior = new THREE.Group(); scene.add(interior);
  for (const L of spec.lights) {
    const pl = new THREE.PointLight(0xffc98f, 0, L.d, 2); pl.position.copy(P(L.p[0], L.p[1], L.p[2])); pl.userData.i = L.i; interior.add(pl);
  }
  const center = P(6.5, 1.5, 37.0);
  function setTime(sunVec, dusk) {
    const dir = new THREE.Vector3(sunVec[0], sunVec[2], -sunVec[1]).normalize();
    sun.position.copy(center).addScaledVector(dir, 120); sun.target.position.copy(center);
    const alt = Math.asin(sunVec[2]) * 180 / Math.PI;
    const u = sky.material.uniforms;
    u.turbidity.value = dusk ? 9 : 3.5; u.rayleigh.value = dusk ? 2.8 : 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(dir);
    const warm = Math.max(0, Math.min(1, (25 - alt) / 22));
    sun.color.setRGB(1, 0.96 - 0.22 * warm, 0.9 - 0.42 * warm);
    sun.intensity = dusk ? 1.7 : 2.1;
    hemi.intensity = dusk ? 0.25 : 0.42;
    interior.children.forEach(l => { l.intensity = dusk ? l.userData.i * 9 : 0; });
    scene.fog = new THREE.Fog(dusk ? 0xd8c4ab : 0xc6d3df, 600, 9000);
  }
  return { scene, P, setTime, groups, materials: M, sky, sun, center };
}
