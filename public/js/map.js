// Mapa da cidade. Compartilhado entre o navegador e o servidor (mesma semente = mesma cidade).

export const ROAD_W = 16;
export const CELL = 108;
export const N = 6; // avenidas por eixo
export const HALF = ((N - 1) * CELL) / 2;
export const SIDEWALK = 4;
export const BOUND = HALF + ROAD_W / 2 + SIDEWALK + 3;
export const LANE = 4;

export const roadCoord = (i) => -HALF + i * CELL;

export function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ruas com nome: X = vias que correm ao longo de Z (x fixo), Z = vias que correm ao longo de X (z fixo)
export const NAMES_X = ['Rua das Palmeiras', 'Rua do Sol', 'Av. Central', 'Av. da Liberdade', 'Rua dos Ipês', 'Rua da Praia'];
export const NAMES_Z = ['Rua das Flores', 'Av. do Porto', 'Rua da Estação', 'Av. Brasil', 'Rua do Mercado', 'Rua da Serra'];

const PLAZA = '2,2';
const PARKS = new Set(['0,3', '4,1', '3,4']);

export const RAMPS = [
  { axis: 'z', road: 1, seg: 1, side: 1 },
  { axis: 'z', road: 4, seg: 3, side: -1 },
  { axis: 'x', road: 1, seg: 3, side: 1 },
  { axis: 'x', road: 4, seg: 1, side: -1 },
  { axis: 'x', road: 2, seg: 0, side: -1 },
  { axis: 'z', road: 3, seg: 4, side: 1 },
  { axis: 'x', road: 0, seg: 2, side: 1 },
  { axis: 'x', road: 5, seg: 2, side: -1 },
  { axis: 'z', road: 0, seg: 1, side: 1 },
  { axis: 'z', road: 5, seg: 3, side: -1 },
].map((r) => {
  const along = roadCoord(r.seg) + CELL / 2;
  const across = roadCoord(r.road) + r.side * LANE;
  return r.axis === 'z'
    ? { axis: 'z', x: across, z: along, halfLen: 11, halfW: 3.6, height: 2.6 }
    : { axis: 'x', x: along, z: across, halfLen: 11, halfW: 3.6, height: 2.6 };
});

export function rampHeight(x, z) {
  for (const r of RAMPS) {
    const along = r.axis === 'z' ? z - r.z : x - r.x;
    const across = r.axis === 'z' ? x - r.x : z - r.z;
    if (Math.abs(across) <= r.halfW && Math.abs(along) <= r.halfLen) {
      return r.height * (1 - Math.abs(along) / r.halfLen);
    }
  }
  return 0;
}

function onRoadStrip(v) {
  const k = Math.round((v + HALF) / CELL);
  if (k < 0 || k >= N) return false;
  return Math.abs(v - roadCoord(k)) <= ROAD_W / 2;
}

export function isOnRoad(x, z) {
  if (Math.abs(x) > HALF + ROAD_W / 2 || Math.abs(z) > HALF + ROAD_W / 2) return false;
  return onRoadStrip(x) || onRoadStrip(z);
}

export const SIDEWALK_H = 0.2;
export function groundHeight(x, z) {
  return isOnRoad(x, z) ? rampHeight(x, z) : SIDEWALK_H;
}

// Nome da rua em que a posição está
export function streetName(x, z) {
  if (!isOnRoad(x, z)) return null;
  const onX = onRoadStrip(x);
  const onZ = onRoadStrip(z);
  if (onX && onZ) {
    return `${NAMES_X[Math.round((x + HALF) / CELL)]} × ${NAMES_Z[Math.round((z + HALF) / CELL)]}`;
  }
  return onX ? NAMES_X[Math.round((x + HALF) / CELL)] : NAMES_Z[Math.round((z + HALF) / CELL)];
}

// Ponto aleatório no meio de uma rua, na faixa correta
export function randomRoadPoint(rand = Math.random) {
  const road = Math.floor(rand() * N);
  const along = -HALF + rand() * HALF * 2;
  const lane = (rand() < 0.5 ? -1 : 1) * (rand() < 0.5 ? LANE : LANE * 0.5);
  return rand() < 0.5
    ? { x: roadCoord(road) + lane, z: along, axis: 'z' }
    : { x: along, z: roadCoord(road) + lane, axis: 'x' };
}

// Ponto de rua mais próximo, para o "voltar à pista"
export function snapToRoad(x, z, heading) {
  const ix = Math.max(0, Math.min(N - 1, Math.round((x + HALF) / CELL)));
  const iz = Math.max(0, Math.min(N - 1, Math.round((z + HALF) / CELL)));
  const rx = roadCoord(ix);
  const rz = roadCoord(iz);
  const clampedX = Math.max(-HALF, Math.min(HALF, x));
  const clampedZ = Math.max(-HALF, Math.min(HALF, z));
  if (Math.abs(x - rx) < Math.abs(z - rz)) {
    const dir = Math.cos(heading) >= 0 ? 1 : -1;
    return { x: rx - dir * LANE, z: clampedZ, heading: dir > 0 ? 0 : Math.PI };
  }
  const dir = Math.sin(heading) >= 0 ? 1 : -1;
  return { x: clampedX, z: rz + dir * LANE, heading: dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
}

// ---------- Geração estática da cidade ----------
export function generateCity() {
  const rand = mulberry(20261107);
  const buildings = [];
  const trees = [];
  const lamps = [];
  const blocks = [];
  const aabbs = [];
  const circles = [];

  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < N - 1; j++) {
      const x0 = roadCoord(i) + ROAD_W / 2;
      const x1 = roadCoord(i + 1) - ROAD_W / 2;
      const z0 = roadCoord(j) + ROAD_W / 2;
      const z1 = roadCoord(j + 1) - ROAD_W / 2;
      const key = `${i},${j}`;
      const kind = key === PLAZA ? 'plaza' : PARKS.has(key) ? 'park' : 'city';
      blocks.push({ x0, x1, z0, z1, kind, i, j });

      // árvores e postes nas calçadas
      const edge = 1.6;
      const size = x1 - x0;
      for (let k = 1; k <= 3; k++) {
        const t = (k / 4) * size;
        const pts = [
          [x0 + t, z0 + edge, 0], [x0 + t, z1 - edge, Math.PI],
          [x0 + edge, z0 + t, Math.PI / 2], [x1 - edge, z0 + t, -Math.PI / 2],
        ];
        for (const [px, pz, rot] of pts) {
          if (k === 2) lamps.push({ x: px, z: pz, rot });
          else trees.push({ x: px, z: pz, s: 0.75 + rand() * 0.35, hue: rand() });
        }
      }

      const ix0 = x0 + SIDEWALK;
      const ix1 = x1 - SIDEWALK;
      const iz0 = z0 + SIDEWALK;
      const iz1 = z1 - SIDEWALK;

      if (kind === 'city') {
        const k = rand() < 0.45 ? 2 : 3;
        const gap = 3;
        const lot = (ix1 - ix0 - gap * (k - 1)) / k;
        const distCenter = Math.hypot(i - 2, j - 2);
        for (let a = 0; a < k; a++) {
          for (let b = 0; b < k; b++) {
            const lx = ix0 + a * (lot + gap);
            const lz = iz0 + b * (lot + gap);
            const shrink = rand() * 2;
            const w = lot - shrink;
            const d = lot - rand() * 2;
            const base = Math.max(10, 58 - distCenter * 15);
            const h = base * (0.55 + rand() * 0.75) + 6;
            const b0 = {
              x: lx + lot / 2, z: lz + lot / 2, w, d, h,
              style: Math.floor(rand() * 4), tint: rand(), accent: Math.floor(rand() * 6),
              roof: rand(),
            };
            buildings.push(b0);
            aabbs.push({ x0: b0.x - w / 2, x1: b0.x + w / 2, z0: b0.z - d / 2, z1: b0.z + d / 2 });
          }
        }
      } else if (kind === 'park') {
        for (let t = 0; t < 26; t++) {
          const px = ix0 + 3 + rand() * (ix1 - ix0 - 6);
          const pz = iz0 + 3 + rand() * (iz1 - iz0 - 6);
          const cx = (ix0 + ix1) / 2;
          const cz = (iz0 + iz1) / 2;
          if (Math.abs(px - cx) < 4 || Math.abs(pz - cz) < 4) continue; // caminho do parque livre
          trees.push({ x: px, z: pz, s: 1 + rand() * 0.9, hue: rand() });
        }
      } else {
        circles.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: 7.5 });
        for (let t = 0; t < 8; t++) {
          const a = (t / 8) * Math.PI * 2 + 0.39;
          trees.push({
            x: (x0 + x1) / 2 + Math.cos(a) * 26, z: (z0 + z1) / 2 + Math.sin(a) * 26,
            s: 0.9, hue: 0.3,
          });
        }
      }
    }
  }

  for (const t of trees) circles.push({ x: t.x, z: t.z, r: 0.55 });
  for (const l of lamps) circles.push({ x: l.x, z: l.z, r: 0.3 });

  // Índice espacial simples para as colisões
  const SIZE = 30;
  const grid = new Map();
  const put = (x, z, item) => {
    const k = `${Math.floor(x / SIZE)},${Math.floor(z / SIZE)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(item);
  };
  const M = 5; // margem
  for (const a of aabbs) {
    for (let cx = Math.floor((a.x0 - M) / SIZE); cx <= Math.floor((a.x1 + M) / SIZE); cx++) {
      for (let cz = Math.floor((a.z0 - M) / SIZE); cz <= Math.floor((a.z1 + M) / SIZE); cz++) {
        put(cx * SIZE, cz * SIZE, { t: 0, ...a });
      }
    }
  }
  for (const c of circles) {
    for (let cx = Math.floor((c.x - c.r - M) / SIZE); cx <= Math.floor((c.x + c.r + M) / SIZE); cx++) {
      for (let cz = Math.floor((c.z - c.r - M) / SIZE); cz <= Math.floor((c.z + c.r + M) / SIZE); cz++) {
        put(cx * SIZE, cz * SIZE, { t: 1, ...c });
      }
    }
  }
  const EMPTY = [];
  const query = (x, z) => grid.get(`${Math.floor(x / SIZE)},${Math.floor(z / SIZE)}`) || EMPTY;

  return { buildings, trees, lamps, blocks, aabbs, circles, query };
}
