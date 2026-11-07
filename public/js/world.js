// Constrói toda a cidade em 3D. Geometria estática é agrupada por material para render rápido.
import * as THREE from '../vendor/three.module.min.js';
import { BOUND, CELL, HALF, N, RAMPS, ROAD_W, SIDEWALK, SIDEWALK_H, mulberry, roadCoord } from './map.js';

// Agrupador de geometria: faces soltas com posição, normal, uv e cor
class Batch {
  constructor() {
    this.p = [];
    this.n = [];
    this.u = [];
    this.c = [];
  }
  face(a, b, c, d, normal, uv, color) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const flip = cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2] < 0;
    const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    const pts = [a, b, c, d];
    for (const k of order) {
      this.p.push(...pts[k]);
      this.n.push(...normal);
      this.u.push(uv[k][0], uv[k][1]);
      this.c.push(color.r, color.g, color.b);
    }
  }
  // Plano horizontal com uv em coordenadas do mundo
  top(x0, x1, z0, z1, y, color, uvScale = 0.125) {
    const s = uvScale;
    this.face(
      [x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0],
      [[x0 * s, z0 * s], [x0 * s, z1 * s], [x1 * s, z1 * s], [x1 * s, z0 * s]], color
    );
  }
  // Paredes de um volume (sem topo)
  walls(x0, x1, y0, y1, z0, z1, color, uw = 1, uh = 1) {
    const W = x1 - x0;
    const D = z1 - z0;
    const H = y1 - y0;
    const f = (a, b, c, d, n, len) =>
      this.face(a, b, c, d, n, [[0, 0], [len * uw, 0], [len * uw, H * uh], [0, H * uh]], color);
    f([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], W);
    f([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], W);
    f([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], D);
    f([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], D);
  }
  box(cx, y0, cz, sx, sy, sz, color) {
    const x0 = cx - sx / 2;
    const x1 = cx + sx / 2;
    const z0 = cz - sz / 2;
    const z1 = cz + sz / 2;
    this.walls(x0, x1, y0, y0 + sy, z0, z1, color);
    this.top(x0, x1, z0, z1, y0 + sy, color);
  }
  mesh(material, { cast = false, receive = true } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    const m = new THREE.Mesh(g, material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.matrixAutoUpdate = false;
    return m;
  }
}

function canvasTexture(size, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  return t;
}

function noiseFill(ctx, size, base, spread, count) {
  const r = mulberry(size + count);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    const v = Math.floor(r() * spread);
    ctx.fillStyle = `rgba(${v},${v},${v},0.22)`;
    ctx.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
  }
}

function windowTexture(style) {
  return canvasTexture(256, (ctx, s) => {
    const r = mulberry(style * 77 + 5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    if (style === 0) {
      // torre de vidro
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const l = 28 + r() * 44;
          ctx.fillStyle = `hsl(${205 + r() * 12},52%,${l}%)`;
          ctx.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
        }
      }
    } else if (style === 1) {
      // apartamentos com janelas e varanda
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          ctx.fillStyle = r() < 0.2 ? '#ffe6a3' : '#27364a';
          ctx.fillRect(x * 64 + 14, y * 64 + 12, 36, 38);
          ctx.fillStyle = 'rgba(0,0,0,.35)';
          ctx.fillRect(x * 64 + 10, y * 64 + 50, 44, 4);
        }
      }
    } else if (style === 2) {
      // escritório com faixas horizontais
      for (let y = 0; y < 4; y++) {
        ctx.fillStyle = '#2f4659';
        ctx.fillRect(0, y * 64 + 18, s, 30);
        ctx.fillStyle = 'rgba(255,255,255,.75)';
        for (let x = 0; x < 8; x++) ctx.fillRect(x * 32, y * 64 + 18, 2, 30);
      }
    } else {
      // tijolinho
      ctx.fillStyle = '#efe6dc';
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = 'rgba(0,0,0,.08)';
      for (let y = 0; y < 32; y++) ctx.fillRect(0, y * 8, s, 1);
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          ctx.fillStyle = '#fafafa';
          ctx.fillRect(x * 85 + 20, y * 85 + 16, 46, 56);
          ctx.fillStyle = r() < 0.15 ? '#ffe6a3' : '#33475b';
          ctx.fillRect(x * 85 + 24, y * 85 + 20, 38, 48);
        }
      }
    }
  });
}

const FACADE_TINTS = [
  ['#dfeaf5', '#c9dcec', '#e8eef2'],
  ['#f2d7b6', '#e8b995', '#d9c8e8', '#bfe0d2', '#f4eadc'],
  ['#e8e8e4', '#cfd6dc', '#f0e7d5'],
  ['#c5664a', '#b35a44', '#cf8b5c', '#a85c52'],
];
const ACCENTS = ['#e63946', '#2a9d8f', '#f4a261', '#3a86ff', '#ffbe0b', '#8338ec'];

export function buildWorld(scene, city) {
  const root = new THREE.Group();
  scene.add(root);
  const col = (hex) => new THREE.Color(hex);

  // ---------- Materiais de chão ----------
  const asphaltTex = canvasTexture(256, (c, s) => noiseFill(c, s, '#34373d', 90, 7000));
  const walkTex = canvasTexture(256, (c, s) => {
    noiseFill(c, s, '#c6c4bc', 255, 1500);
    c.strokeStyle = 'rgba(70,70,70,.32)';
    c.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      c.beginPath(); c.moveTo(0, i * 64); c.lineTo(s, i * 64); c.stroke();
      c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, s); c.stroke();
    }
  });
  const grassTex = canvasTexture(256, (c, s) => noiseFill(c, s, '#ffffff', 140, 5000));

  const matAsphalt = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92 });
  const matWalk = new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.95, vertexColors: true });
  const matGrass = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1, vertexColors: true });
  const matPlain = new THREE.MeshStandardMaterial({ roughness: 0.75, vertexColors: true });
  const matPaint = new THREE.MeshStandardMaterial({
    roughness: 0.65, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });

  // Terreno externo
  const outer = new Batch();
  outer.top(-1400, 1400, -1400, 1400, -0.06, col('#6f9a54'), 0.03);
  root.add(outer.mesh(matGrass));

  // ---------- Vias ----------
  const roads = new Batch();
  const white = col('#f4f4ee');
  const yellow = col('#f7c52d');
  const WHITE = white;
  const end = HALF + ROAD_W / 2;
  for (let i = 0; i < N; i++) {
    const c = roadCoord(i);
    roads.top(c - ROAD_W / 2, c + ROAD_W / 2, -end, end, 0, white);
    roads.top(-end, end, c - ROAD_W / 2, c + ROAD_W / 2, 0, white);
  }
  root.add(roads.mesh(matAsphalt));

  // ---------- Sinalização pintada ----------
  const paint = new Batch();
  const Y = 0.03;
  // retângulo em coordenadas de via: "along" é o eixo da rua, "across" o transversal
  const rect = (axis, fixed, a0, a1, off0, off1, color) => {
    if (axis === 'z') paint.top(fixed + off0, fixed + off1, a0, a1, Y, color);
    else paint.top(a0, a1, fixed + off0, fixed + off1, Y, color);
  };
  const arrow = (axis, fixed, at, off, dir, color) => {
    // seta de sentido pintada na faixa
    const stem = 1.8;
    rect(axis, fixed, Math.min(at, at + dir * stem), Math.max(at, at + dir * stem), off - 0.16, off + 0.16, color);
    const tip = at + dir * (stem + 1.6);
    const base = at + dir * stem;
    const P = (al, ac) => (axis === 'z' ? [fixed + off + ac, Y, al] : [al, Y, fixed + off + ac]);
    const uv = [[0, 0], [0, 0], [0, 0], [0, 0]];
    paint.face(P(base, -0.65), P(base, 0.65), P(tip, 0.02), P(tip, -0.02), [0, 1, 0], uv, color);
  };

  for (const axis of ['z', 'x']) {
    for (let r = 0; r < N; r++) {
      const fixed = roadCoord(r);
      for (let s = 0; s < N - 1; s++) {
        const a = roadCoord(s) + ROAD_W / 2;
        const b = roadCoord(s + 1) - ROAD_W / 2;
        const zebra = 3.4;
        const stop = zebra + 1.1;
        const la = a + stop + 0.8;
        const lb = b - stop - 0.8;

        // linha dupla amarela central
        rect(axis, fixed, la, lb, -0.45, -0.17, yellow);
        rect(axis, fixed, la, lb, 0.17, 0.45, yellow);
        // bordas brancas contínuas
        rect(axis, fixed, a, b, -ROAD_W / 2 + 0.25, -ROAD_W / 2 + 0.5, white);
        rect(axis, fixed, a, b, ROAD_W / 2 - 0.5, ROAD_W / 2 - 0.25, white);
        // divisórias de faixa tracejadas
        for (let d = la + 1; d + 3.5 < lb; d += 8) {
          rect(axis, fixed, d, d + 3.5, -4.1, -3.9, white);
          rect(axis, fixed, d, d + 3.5, 3.9, 4.1, white);
        }
        // faixas de pedestre nas duas pontas
        for (let k = -7; k <= 6.2; k += 1.6) {
          rect(axis, fixed, a + 0.4, a + 0.4 + zebra - 0.6, k, k + 0.85, WHITE);
          rect(axis, fixed, b - 0.4 - zebra + 0.6, b - 0.4, k, k + 0.85, WHITE);
        }
        // linhas de parada (lado direito de quem chega)
        const stopSide = axis === 'z' ? -1 : 1;
        rect(axis, fixed, a + stop - 0.35, a + stop + 0.2, stopSide < 0 ? 0.3 : -7.6, stopSide < 0 ? 7.6 : -0.3, white);
        rect(axis, fixed, b - stop - 0.2, b - stop + 0.35, stopSide < 0 ? -7.6 : 0.3, stopSide < 0 ? -0.3 : 7.6, white);
        // setas de sentido: mão direita
        const mid = (a + b) / 2;
        const rightOfPlus = axis === 'z' ? -1 : 1; // direita de quem segue no sentido positivo
        for (const lane of [2, 6]) {
          arrow(axis, fixed, mid + 18, rightOfPlus * lane, 1, white);
          arrow(axis, fixed, mid - 18, -rightOfPlus * lane, -1, white);
        }
      }
    }
  }
  root.add(paint.mesh(matPaint));

  // ---------- Quarteirões, calçadas e guias ----------
  const walks = new Batch();
  const plain = new Batch();
  const grass = new Batch();
  const curb = col('#e8e6df');
  const cCurbDark = col('#8f8d86');
  const walkWhite = col('#ffffff');
  const H = SIDEWALK_H;
  const addCurb = (x0, x1, z0, z1) => {
    plain.walls(x0, x1, 0, H + 0.02, z0, z1, cCurbDark);
    // borda clara marcando bem o limite da rua
    const t = 0.32;
    plain.top(x0, x1, z0, z0 + t, H + 0.02, curb);
    plain.top(x0, x1, z1 - t, z1, H + 0.02, curb);
    plain.top(x0, x0 + t, z0, z1, H + 0.02, curb);
    plain.top(x1 - t, x1, z0, z1, H + 0.02, curb);
  };
  for (const b of city.blocks) {
    addCurb(b.x0, b.x1, b.z0, b.z1);
    walks.top(b.x0, b.x1, b.z0, b.z1, H, walkWhite);
    const ix0 = b.x0 + SIDEWALK;
    const ix1 = b.x1 - SIDEWALK;
    const iz0 = b.z0 + SIDEWALK;
    const iz1 = b.z1 - SIDEWALK;
    if (b.kind === 'park') {
      grass.top(ix0, ix1, iz0, iz1, H + 0.015, col('#6fb44c'), 0.08);
      const cx = (ix0 + ix1) / 2;
      const cz = (iz0 + iz1) / 2;
      plain.top(ix0, ix1, cz - 2, cz + 2, H + 0.03, col('#d8c9a0'));
      plain.top(cx - 2, cx + 2, iz0, iz1, H + 0.03, col('#d8c9a0'));
    } else if (b.kind === 'plaza') {
      grass.top(ix0, ix1, iz0, iz1, H + 0.015, col('#8bc06a'), 0.08);
      const cx = (ix0 + ix1) / 2;
      const cz = (iz0 + iz1) / 2;
      plain.top(cx - 19, cx + 19, cz - 19, cz + 19, H + 0.03, col('#e2d6bf'));
      plain.top(ix0, ix1, cz - 2.6, cz + 2.6, H + 0.03, col('#e2d6bf'));
      plain.top(cx - 2.6, cx + 2.6, iz0, iz1, H + 0.03, col('#e2d6bf'));
    } else {
      plain.top(ix0, ix1, iz0, iz1, H + 0.015, col('#a8a69f'));
    }
  }
  // Calçada externa em volta da cidade
  const o = HALF + ROAD_W / 2;
  const oo = BOUND + 8;
  for (const [x0, x1, z0, z1] of [
    [-oo, oo, o, oo], [-oo, oo, -oo, -o], [o, oo, -o, o], [-oo, -o, -o, o],
  ]) {
    walks.top(x0, x1, z0, z1, H, walkWhite);
  }
  // Guia externa, voltada para dentro (para a rua)
  const noUv = [[0, 0], [0, 0], [0, 0], [0, 0]];
  plain.face([-o, 0, o], [o, 0, o], [o, H, o], [-o, H, o], [0, 0, -1], noUv, cCurbDark);
  plain.face([-o, 0, -o], [o, 0, -o], [o, H, -o], [-o, H, -o], [0, 0, 1], noUv, cCurbDark);
  plain.face([o, 0, -o], [o, 0, o], [o, H, o], [o, H, -o], [-1, 0, 0], noUv, cCurbDark);
  plain.face([-o, 0, -o], [-o, 0, o], [-o, H, o], [-o, H, -o], [1, 0, 0], noUv, cCurbDark);

  // ---------- Rampas ----------
  const rampMat = new THREE.MeshStandardMaterial({ map: canvasTexture(128, (c, s) => {
    const stripes = 8;
    for (let i = 0; i < stripes; i++) {
      c.fillStyle = i % 2 ? '#ffd21e' : '#1f2125';
      c.beginPath();
      c.moveTo((i - 2) * (s / 4), s);
      c.lineTo((i - 1) * (s / 4), s);
      c.lineTo((i + 1) * (s / 4), 0);
      c.lineTo(i * (s / 4), 0);
      c.fill();
    }
  }), roughness: 0.6 });
  const rampBatch = new Batch();
  const rampSide = new Batch();
  const whiteC = col('#ffffff');
  const sideC = col('#50545c');
  for (const r of RAMPS) {
    const L = r.halfLen;
    const W = r.halfW;
    const P = (along, across, y) =>
      r.axis === 'z' ? [r.x + across, y, r.z + along] : [r.x + along, y, r.z + across];
    const slope = r.height / L;
    const nLen = Math.hypot(slope, 1);
    const n = (dir) =>
      r.axis === 'z' ? [0, 1 / nLen, (dir * slope) / nLen] : [(dir * slope) / nLen, 1 / nLen, 0];
    const uv = [[0, 0], [W * 0.5, 0], [W * 0.5, L * 0.25], [0, L * 0.25]];
    rampBatch.face(P(-L, -W, 0.04), P(-L, W, 0.04), P(0, W, r.height), P(0, -W, r.height), n(-1), uv, whiteC);
    rampBatch.face(P(L, W, 0.04), P(L, -W, 0.04), P(0, -W, r.height), P(0, W, r.height), n(1), uv, whiteC);
    for (const s of [-1, 1]) {
      const nSide = r.axis === 'z' ? [s, 0, 0] : [0, 0, s];
      const zero = [[0, 0], [0, 0], [0, 0], [0, 0]];
      rampSide.face(P(-L, s * W, 0), P(0, s * W, 0), P(0, s * W, r.height), P(-L, s * W, 0.03), nSide, zero, sideC);
      rampSide.face(P(0, s * W, 0), P(L, s * W, 0), P(L, s * W, 0.03), P(0, s * W, r.height), nSide, zero, sideC);
    }
  }
  root.add(rampBatch.mesh(rampMat, { cast: true }));

  // ---------- Prédios ----------
  const styles = [0, 1, 2, 3].map(() => new Batch());
  const roofs = new Batch();
  const detail = new Batch();
  const FLOOR = 3.5;
  const pick = (arr, t) => arr[Math.min(arr.length - 1, Math.floor(t * arr.length))];
  for (const b of city.buildings) {
    const x0 = b.x - b.w / 2;
    const x1 = b.x + b.w / 2;
    const z0 = b.z - b.d / 2;
    const z1 = b.z + b.d / 2;
    const tint = col(pick(FACADE_TINTS[b.style], b.tint));
    const windowsPerTex = [8, 4, 2, 3][b.style];
    const uvPerMeter = 1 / (FLOOR * windowsPerTex);
    const base = 4.2;
    styles[b.style].walls(x0, x1, H + base, H + b.h, z0, z1, tint, uvPerMeter * 0.9, uvPerMeter);
    // térreo de lojas com vitrine e toldo
    detail.walls(x0, x1, H, H + base, z0, z1, col('#2e3a46'));
    const acc = col(ACCENTS[b.accent]);
    const m = 0.5;
    detail.walls(x0 - m, x1 + m, H + 3.1, H + base, z0 - m, z1 + m, acc);
    detail.top(x0 - m, x1 + m, z0 - m, z1 + m, H + base, acc);
    roofs.top(x0, x1, z0, z1, H + b.h, col(b.roof < 0.5 ? '#6b7076' : '#585c61'), 0.1);
    // parapeito e casa de máquinas
    const pc = col('#7e848a');
    detail.walls(x0, x1, H + b.h, H + b.h + 0.6, z0, z0 + 0.3, pc);
    detail.walls(x0, x1, H + b.h, H + b.h + 0.6, z1 - 0.3, z1, pc);
    detail.walls(x0, x0 + 0.3, H + b.h, H + b.h + 0.6, z0, z1, pc);
    detail.walls(x1 - 0.3, x1, H + b.h, H + b.h + 0.6, z0, z1, pc);
    detail.box(b.x + (b.roof - 0.5) * 4, H + b.h, b.z - (b.roof - 0.5) * 4, 4, 2.2, 3.4, col('#8a9096'));
  }
  const glass = (i) => new THREE.MeshStandardMaterial({
    map: windowTexture(i), roughness: i === 0 ? 0.25 : 0.7, metalness: i === 0 ? 0.4 : 0.05, vertexColors: true,
  });
  styles.forEach((s, i) => root.add(s.mesh(glass(i), { cast: true })));
  root.add(roofs.mesh(matPlain));

  // ---------- Muro em volta do mapa ----------
  const wallTex = canvasTexture(128, (c, s) => {
    for (let i = 0; i < 4; i++) {
      c.fillStyle = i % 2 ? '#e8e8e8' : '#d7263d';
      c.fillRect(i * (s / 4), 0, s / 4, s);
    }
  });
  const wall = new Batch();
  const B = BOUND;
  const tw = 1;
  wall.walls(-B - tw, B + tw, 0, 2, B, B + tw, whiteC, 0.1, 0.25);
  wall.walls(-B - tw, B + tw, 0, 2, -B - tw, -B, whiteC, 0.1, 0.25);
  wall.walls(B, B + tw, 0, 2, -B, B, whiteC, 0.1, 0.25);
  wall.walls(-B - tw, -B, 0, 2, -B, B, whiteC, 0.1, 0.25);
  root.add(wall.mesh(new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8, vertexColors: true }), { cast: true }));

  // Skyline distante
  const sky = new Batch();
  const rs = mulberry(99);
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    const dist = 520 + rs() * 260;
    const w = 26 + rs() * 40;
    const h = 30 + rs() * 110;
    const shade = 0.55 + rs() * 0.2;
    sky.box(Math.cos(a) * dist, 0, Math.sin(a) * dist, w, h, w, new THREE.Color(shade * 0.8, shade * 0.88, shade));
  }
  root.add(sky.mesh(matPlain, { cast: false, receive: false }));

  // Fonte da praça
  const plaza = city.blocks.find((b) => b.kind === 'plaza');
  const pcx = (plaza.x0 + plaza.x1) / 2;
  const pcz = (plaza.z0 + plaza.z1) / 2;
  const stoneMat = new THREE.MeshStandardMaterial({ color: '#d7d3c8', roughness: 0.8 });
  const waterMat = new THREE.MeshStandardMaterial({ color: '#47b8e6', roughness: 0.15, metalness: 0.2 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(7.3, 7.6, 1.1, 32), stoneMat);
  basin.position.set(pcx, H + 0.55, pcz);
  basin.castShadow = basin.receiveShadow = true;
  const water = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.6, 0.1, 32), waterMat);
  water.position.set(pcx, H + 1.08, pcz);
  const col1 = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 4.4, 16), stoneMat);
  col1.position.set(pcx, H + 2.8, pcz);
  col1.castShadow = true;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 1, 0.8, 24), stoneMat);
  bowl.position.set(pcx, H + 5.1, pcz);
  bowl.castShadow = true;
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.75, 4, 12), new THREE.MeshStandardMaterial({ color: '#c8efff', transparent: true, opacity: 0.75 }));
  jet.position.set(pcx, H + 7.2, pcz);
  root.add(basin, water, col1, bowl, jet);

  // ---------- Árvores ----------
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3, 7);
  trunkGeo.translate(0, 1.5, 0);
  const leafGeo = new THREE.IcosahedronGeometry(2.3, 1);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#6b4a2f', roughness: 1 }), city.trees.length);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), city.trees.length);
  const dummy = new THREE.Object3D();
  const tc = new THREE.Color();
  city.trees.forEach((t, i) => {
    dummy.position.set(t.x, H, t.z);
    dummy.scale.setScalar(t.s);
    dummy.rotation.y = t.hue * 6;
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = H + 4.1 * t.s;
    dummy.scale.set(t.s * 1.05, t.s * 1.2, t.s * 1.05);
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
    tc.setHSL(0.27 + t.hue * 0.09, 0.55, 0.34 + t.hue * 0.1);
    leaves.setColorAt(i, tc);
  });
  trunks.castShadow = leaves.castShadow = true;
  root.add(trunks, leaves);

  // ---------- Postes ----------
  const poleB = new Batch();
  const dark = col('#3a3f45');
  const glow = new Batch();
  const glowC = col('#fff6cf');
  for (const l of city.lamps) {
    poleB.box(l.x, H, l.z, 0.22, 7.2, 0.22, dark);
    const dx = l.rot === Math.PI / 2 ? -1 : l.rot === -Math.PI / 2 ? 1 : 0;
    const dz = l.rot === 0 ? -1 : l.rot === Math.PI ? 1 : 0;
    poleB.box(l.x + dx * 1.2, H + 7.05, l.z + dz * 1.2, dx ? 2.5 : 0.14, 0.14, dz ? 2.5 : 0.14, dark);
    glow.box(l.x + dx * 2.2, H + 6.92, l.z + dz * 2.2, dx ? 0.9 : 0.4, 0.13, dz ? 0.9 : 0.4, glowC);
  }

  // ---------- Semáforos (animados) ----------
  const lightGroups = { ns: { r: new Batch(), y: new Batch(), g: new Batch() }, ew: { r: new Batch(), y: new Batch(), g: new Batch() } };
  const lightC = col('#ffffff');
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const cx = roadCoord(i);
      const cz = roadCoord(j);
      const o2 = ROAD_W / 2 + 1;
      const corners = [
        { x: cx - o2, z: cz - o2, g: 'ns', fz: -1, fx: 0 },
        { x: cx + o2, z: cz + o2, g: 'ns', fz: 1, fx: 0 },
        { x: cx + o2, z: cz - o2, g: 'ew', fz: 0, fx: 1 },
        { x: cx - o2, z: cz + o2, g: 'ew', fz: 0, fx: -1 },
      ];
      for (const c of corners) {
        if (Math.abs(c.x) > HALF + ROAD_W || Math.abs(c.z) > HALF + ROAD_W) continue;
        poleB.box(c.x, H, c.z, 0.2, 5.4, 0.2, dark);
        poleB.box(c.x, H + 3.9, c.z, 0.62, 1.7, 0.62, col('#1c1f23'));
        const off = 0.33;
        const gs = lightGroups[c.g];
        const bulb = (batch, y) => batch.box(c.x + c.fx * off, H + y, c.z + c.fz * off, c.fx ? 0.06 : 0.36, 0.36, c.fz ? 0.06 : 0.36, lightC);
        bulb(gs.r, 5.0);
        bulb(gs.y, 4.56);
        bulb(gs.g, 4.12);
      }
    }
  }
  const lightMats = {};
  for (const axis of ['ns', 'ew']) {
    lightMats[axis] = {};
    for (const [k, color] of [['r', '#ff2d2d'], ['y', '#ffc21a'], ['g', '#2dff6a']]) {
      const m = new THREE.MeshBasicMaterial({ color });
      lightMats[axis][k] = m;
      root.add(lightGroups[axis][k].mesh(m, { receive: false }));
    }
  }

  root.add(walks.mesh(matWalk));
  root.add(grass.mesh(matGrass));
  root.add(plain.mesh(matPlain));
  root.add(detail.mesh(matPlain, { cast: true }));
  root.add(poleB.mesh(matPlain, { cast: true }));
  root.add(glow.mesh(new THREE.MeshBasicMaterial({ vertexColors: true }), { receive: false }));
  root.add(rampSide.mesh(matPlain));

  // ---------- Nuvens ----------
  const clouds = new THREE.Group();
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true, transparent: true, opacity: 0.92, fog: false });
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  const rc = mulberry(7);
  for (let i = 0; i < 24; i++) {
    const g = new THREE.Group();
    const parts = 3 + Math.floor(rc() * 3);
    for (let k = 0; k < parts; k++) {
      const m = new THREE.Mesh(cloudGeo, cloudMat);
      m.position.set((k - parts / 2) * 26, rc() * 7, rc() * 16);
      m.scale.set(26 + rc() * 12, 10 + rc() * 6, 18 + rc() * 8);
      g.add(m);
    }
    g.position.set((rc() - 0.5) * 1500, 190 + rc() * 70, (rc() - 0.5) * 1500);
    clouds.add(g);
  }
  root.add(clouds);

  // ---------- Cones derrubáveis ----------
  const cones = [];
  const coneGeo = new THREE.ConeGeometry(0.36, 0.95, 12);
  coneGeo.translate(0, 0.47, 0);
  const coneMat = new THREE.MeshStandardMaterial({ color: '#ff6a13', roughness: 0.55 });
  const bandMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 });
  const bandGeo = new THREE.CylinderGeometry(0.235, 0.28, 0.18, 12);
  bandGeo.translate(0, 0.5, 0);
  const makeCone = (x, z) => {
    const g = new THREE.Group();
    const a = new THREE.Mesh(coneGeo, coneMat);
    a.castShadow = true;
    g.add(a, new THREE.Mesh(bandGeo, bandMat));
    g.position.set(x, 0.03, z);
    root.add(g);
    cones.push({ g, x, z, vx: 0, vy: 0, vz: 0, spinX: 0, spinZ: 0, t: -1 });
  };
  for (const r of RAMPS) {
    for (const s of [-1, 1]) {
      for (const e of [-1, 1]) {
        const al = e * (r.halfLen + 2.6);
        const ac = s * (r.halfW + 0.3);
        if (r.axis === 'z') makeCone(r.x + ac, r.z + al);
        else makeCone(r.x + al, r.z + ac);
      }
    }
  }

  // ---------- Atualização por quadro ----------
  let flash = 0;
  const update = (dt, carX, carZ, speed, onCone) => {
    flash += dt;
    // ciclo de 16 s: verde/amarelo em cada eixo
    const c = (flash % 16) / 16;
    const phase = (start) => {
      const t = (c - start + 1) % 1;
      return t < 0.42 ? 'g' : t < 0.5 ? 'y' : 'r';
    };
    const set = (axis, st) => {
      const m = lightMats[axis];
      m.r.color.set(st === 'r' ? '#ff2d2d' : '#3a1212');
      m.y.color.set(st === 'y' ? '#ffc21a' : '#3a2f12');
      m.g.color.set(st === 'g' ? '#2dff6a' : '#0f3319');
    };
    set('ns', phase(0));
    set('ew', phase(0.5));
    jet.scale.y = 1 + Math.sin(flash * 7) * 0.08;

    for (const k of cones) {
      if (k.t < 0) {
        const dx = k.x - carX;
        const dz = k.z - carZ;
        if (speed > 3 && dx * dx + dz * dz < 5.5) {
          const len = Math.hypot(dx, dz) || 1;
          const power = Math.min(24, 5 + speed * 0.6);
          k.vx = (dx / len) * power;
          k.vz = (dz / len) * power;
          k.vy = 5 + speed * 0.14;
          k.spinX = 6 + Math.random() * 8;
          k.spinZ = 6 + Math.random() * 8;
          k.t = 0;
          onCone?.();
        }
      } else {
        k.t += dt;
        k.vy -= 22 * dt;
        k.g.position.x += k.vx * dt;
        k.g.position.z += k.vz * dt;
        k.g.position.y += k.vy * dt;
        if (k.g.position.y < 0.2) {
          k.g.position.y = 0.2;
          k.vy *= -0.3;
          k.vx *= 0.65;
          k.vz *= 0.65;
          k.spinX *= 0.6;
          k.spinZ *= 0.6;
        }
        k.g.rotation.x += k.spinX * dt;
        k.g.rotation.z += k.spinZ * dt;
        if (k.t > 8) {
          k.t = -1;
          k.g.position.set(k.x, 0.03, k.z);
          k.g.rotation.set(0, 0, 0);
        }
      }
    }
  };

  return { update };
}

// Céu em gradiente + reflexos
export function buildSky(scene, renderer) {
  const top = new THREE.Color('#3d8fe0');
  const mid = new THREE.Color('#9fd0f4');
  const hor = new THREE.Color('#f7e7cf');
  const geo = new THREE.SphereGeometry(1, 24, 16);
  const colors = [];
  const pos = geo.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    if (h < 0) c.copy(hor);
    else if (h < 0.22) c.copy(hor).lerp(mid, h / 0.22);
    else c.copy(mid).lerp(top, Math.min(1, (h - 0.22) / 0.55));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false });
  const dome = new THREE.Mesh(geo, material);
  dome.scale.setScalar(1300);
  dome.renderOrder = -10;
  scene.add(dome);

  const envScene = new THREE.Scene();
  const envDome = new THREE.Mesh(geo, material);
  envDome.scale.setScalar(50);
  envScene.add(envDome);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(50, 16), new THREE.MeshBasicMaterial({ color: '#4c4f55' }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  return dome;
}
