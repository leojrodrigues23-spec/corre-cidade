import * as THREE from '../vendor/three.module.min.js';
import { BOUND, HALF, N, ROAD_W, generateCity, groundHeight, isOnRoad, roadCoord, streetName } from './map.js';
import { buildSky, buildWorld } from './world.js';
import { CARS, animateCar, buildCar, makeEmoji, makeLabel } from './car.js';
import { CarBody } from './physics.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const EMOTES = ['😂', '🔥', '👋', '😎'];
const COLORS = ['#ffd21e', '#ef233c', '#2b7fff', '#12b76a', '#ff7a00', '#c026d3', '#f5f5f5', '#22262e'];

const sound = new Sound();
const city = generateCity();

// ---------- Cena ----------
const canvas = $('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch {
  $('lobby-error').textContent = 'Seu navegador não conseguiu iniciar o WebGL, necessário para os gráficos 3D. Ative a aceleração de hardware ou tente outro navegador.';
  $('play').disabled = true;
  throw new Error('WebGL indisponível');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#dfe6e4', 240, 900);
const camera = new THREE.PerspectiveCamera(62, 1, 0.5, 2800);
const skyDome = buildSky(scene, renderer);

scene.add(new THREE.HemisphereLight('#cfe6ff', '#6f6a5c', 0.9));
const sun = new THREE.DirectionalLight('#fff0d8', 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SHADOW = 105;
Object.assign(sun.shadow.camera, { left: -SHADOW, right: SHADOW, top: SHADOW, bottom: -SHADOW, near: 10, far: 420 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);

const world = buildWorld(scene, city);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- Itens no mundo ----------
class ItemLayer {
  constructor(geometry, material, max) {
    this.items = [];
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.max = max;
    this.dummy = new THREE.Object3D();
    scene.add(this.mesh);
  }
  set(list) {
    this.items = list.slice(0, this.max).map(([id, x, z]) => ({ id, x, z, y: groundHeight(x, z) }));
  }
  add(id, x, z) {
    if (this.items.length < this.max) this.items.push({ id, x, z, y: groundHeight(x, z) });
  }
  remove(id) {
    const i = this.items.findIndex((c) => c.id === id);
    if (i < 0) return null;
    return this.items.splice(i, 1)[0];
  }
  update(t, height, scale = 1, bob = 0.2) {
    const d = this.dummy;
    this.items.forEach((c, i) => {
      d.position.set(c.x, c.y + height + Math.sin(t * 2.4 + c.id) * bob, c.z);
      d.rotation.set(0, t * 2.5 + c.id, 0);
      d.scale.setScalar(scale);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    });
    this.mesh.count = this.items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const coinGeo = new THREE.CylinderGeometry(0.95, 0.95, 0.22, 24);
coinGeo.rotateX(Math.PI / 2);
const coins = new ItemLayer(coinGeo, new THREE.MeshStandardMaterial({ color: '#ffc61a', emissive: '#a86a00', emissiveIntensity: 0.65, metalness: 0.65, roughness: 0.28 }), 300);
const nitroGeo = new THREE.OctahedronGeometry(1.2, 0);
const nitros = new ItemLayer(nitroGeo, new THREE.MeshStandardMaterial({ color: '#2cc8ff', emissive: '#0090ff', emissiveIntensity: 1.1, roughness: 0.2, metalness: 0.3, flatShading: true }), 30);

// Checkpoint: anel no chão + feixe de luz visível de longe
const cpGroup = new THREE.Group();
const cpRing = new THREE.Mesh(new THREE.TorusGeometry(10, 0.28, 10, 56), new THREE.MeshBasicMaterial({ color: '#ffe14d' }));
cpRing.rotation.x = Math.PI / 2;
cpRing.position.y = 0.5;
const beamGeo = new THREE.CylinderGeometry(9.5, 9.5, 320, 32, 1, true);
beamGeo.translate(0, 160, 0);
const beamTex = (() => {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 256, 0, 0);
  g.addColorStop(0, 'rgba(255,225,77,.5)');
  g.addColorStop(0.5, 'rgba(255,225,77,.16)');
  g.addColorStop(1, 'rgba(255,225,77,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(c);
})();
const cpBeam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false }));
cpGroup.add(cpRing, cpBeam);
cpGroup.visible = false;
scene.add(cpGroup);

// Seta que aponta o objetivo
const arrow = new THREE.Group();
{
  // Seta plana com contorno escuro, para ler bem sobre qualquer fundo
  const shape = (k) => {
    const s = new THREE.Shape();
    const pts = [[0, 1.05], [0.72, 0.1], [0.27, 0.1], [0.27, -0.9], [-0.27, -0.9], [-0.27, 0.1], [-0.72, 0.1]];
    pts.forEach(([x, y], i) => (i ? s.lineTo(x * k, y * k) : s.moveTo(x * k, y * k)));
    s.closePath();
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(Math.PI / 2); // deita a seta: frente em +Z, face para cima
    return g;
  };
  const opts = { depthTest: false, side: THREE.DoubleSide, transparent: true };
  const outline = new THREE.Mesh(shape(1.2), new THREE.MeshBasicMaterial({ color: '#2a2100', ...opts }));
  const fill = new THREE.Mesh(shape(1), new THREE.MeshBasicMaterial({ color: '#ffe14d', ...opts }));
  outline.renderOrder = 15;
  fill.renderOrder = 16;
  outline.position.z = 0;
  arrow.add(outline, fill);
  arrow.scale.setScalar(0.68);
  arrow.visible = false;
  scene.add(arrow);
}
const _ax = new THREE.Vector3();
const _ay = new THREE.Vector3();
const _az = new THREE.Vector3();
const _am = new THREE.Matrix4();

// ---------- Partículas ----------
const P_MAX = 160;
const pPos = new Float32Array(P_MAX * 3);
const pCol = new Float32Array(P_MAX * 4);
const parts = [];
for (let i = 0; i < P_MAX; i++) parts.push({ life: 0, max: 1, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, grav: 0 });
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 4));
const pTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const pMesh = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 1.3, map: pTex, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
pMesh.frustumCulled = false;
scene.add(pMesh);
let pNext = 0;
function emit(x, y, z, vx, vy, vz, life, r, g, b, grav = 0) {
  const p = parts[pNext];
  pNext = (pNext + 1) % P_MAX;
  Object.assign(p, { x, y, z, vx, vy, vz, life, max: life, r, g, b, grav });
}
function burst(x, y, z, count, power, r, g, b, grav = 18) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * 6.283;
    const s = power * (0.35 + Math.random() * 0.8);
    emit(x, y, z, Math.cos(a) * s, 3 + Math.random() * power * 0.6, Math.sin(a) * s, 0.45 + Math.random() * 0.45, r, g, b, grav);
  }
}
function updateParticles(dt) {
  parts.forEach((p, i) => {
    if (p.life > 0) {
      p.life -= dt;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
    pPos[i * 3] = p.x;
    pPos[i * 3 + 1] = p.life > 0 ? p.y : -50;
    pPos[i * 3 + 2] = p.z;
    pCol[i * 4] = p.r;
    pCol[i * 4 + 1] = p.g;
    pCol[i * 4 + 2] = p.b;
    pCol[i * 4 + 3] = Math.max(0, p.life / p.max) * 0.75;
  });
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}

// ---------- Marcas de pneu ----------
const SKID_MAX = 500;
const skidPos = new Float32Array(SKID_MAX * 6 * 3);
const skidGeo = new THREE.BufferGeometry();
skidGeo.setAttribute('position', new THREE.BufferAttribute(skidPos, 3));
skidGeo.setDrawRange(0, 0);
const skidMesh = new THREE.Mesh(skidGeo, new THREE.MeshBasicMaterial({ color: '#0b0b0d', transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false }));
skidMesh.frustumCulled = false;
scene.add(skidMesh);
let skidI = 0;
let skidCount = 0;
const lastSkid = [null, null];
function addSkid(side, x, y, z, nx, nz) {
  const w = 0.14;
  const a = [x + nx * w, y, z + nz * w];
  const b = [x - nx * w, y, z - nz * w];
  const prev = lastSkid[side];
  lastSkid[side] = { a, b };
  if (!prev) return;
  const off = skidI * 18;
  skidPos.set([...prev.a, ...prev.b, ...a, ...prev.b, ...b, ...a], off);
  skidI = (skidI + 1) % SKID_MAX;
  skidCount = Math.min(SKID_MAX, skidCount + 1);
  skidGeo.setDrawRange(0, skidCount * 6);
  skidGeo.attributes.position.needsUpdate = true;
}

// ---------- Estado ----------
const state = {
  mode: 'lobby',
  myId: null,
  body: null,
  myCar: null,
  metas: new Map(),
  remotes: new Map(),
  scores: new Map(),
  cp: null,
  phase: 'race',
  time: 0,
  room: 'geral',
  camFar: false,
  stuck: 0,
  shake: 0,
};
const profile = {
  name: localStorage.getItem('cc-nome') || '',
  car: localStorage.getItem('cc-carro') || 'esporte',
  color: localStorage.getItem('cc-cor') || COLORS[0],
};
if (!CARS[profile.car]) profile.car = 'esporte';
if (!COLORS.includes(profile.color)) profile.color = COLORS[0];
const urlRoom = new URLSearchParams(location.search).get('sala');
state.room = (urlRoom || 'geral').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16) || 'geral';

// ---------- Lobby ----------
$('name').value = profile.name;
$('room').value = state.room;
const statBar = (v) => `<i style="width:${v}%"></i>`;
const STATS = { hatch: [62, 96, 60], esporte: [98, 66, 66], picape: [55, 56, 100] };
$('cars').innerHTML = Object.entries(CARS).map(([k, c]) => `
  <button type="button" class="car-card" data-car="${k}" aria-pressed="false">
    <strong>${c.label}</strong><small>${c.desc}</small>
    <span class="stat"><em>Velocidade</em><b>${statBar(STATS[k][0])}</b></span>
    <span class="stat"><em>Curvas</em><b>${statBar(STATS[k][1])}</b></span>
    <span class="stat"><em>Força</em><b>${statBar(STATS[k][2])}</b></span>
  </button>`).join('');
$('colors').innerHTML = COLORS.map((c) => `<button type="button" class="swatch" data-color="${c}" style="--c:${c}" aria-label="Cor ${c}"></button>`).join('');

let preview = null;
function refreshPreview() {
  if (preview) scene.remove(preview.root);
  preview = buildCar(profile.car, profile.color);
  preview.root.position.set(roadCoord(2) - 4, 0, roadCoord(3) - 28);
  scene.add(preview.root);
  document.querySelectorAll('.car-card').forEach((b) => {
    const on = b.dataset.car === profile.car;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  });
  document.querySelectorAll('.swatch').forEach((b) => b.classList.toggle('on', b.dataset.color === profile.color));
}
$('cars').addEventListener('click', (e) => {
  const b = e.target.closest('.car-card');
  if (!b) return;
  profile.car = b.dataset.car;
  localStorage.setItem('cc-carro', profile.car);
  refreshPreview();
});
$('colors').addEventListener('click', (e) => {
  const b = e.target.closest('.swatch');
  if (!b) return;
  profile.color = b.dataset.color;
  localStorage.setItem('cc-cor', profile.color);
  refreshPreview();
});
refreshPreview();

$('lobby-form').addEventListener('submit', (e) => {
  e.preventDefault();
  profile.name = $('name').value.trim();
  localStorage.setItem('cc-nome', profile.name);
  state.room = $('room').value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16) || 'geral';
  sound.start();
  $('play').disabled = true;
  $('play').textContent = 'Conectando…';
  $('lobby-error').textContent = '';
  connect();
});

// ---------- Rede ----------
let ws = null;
let wantConnected = false;
let reconnectTimer = 0;
function connect() {
  wantConnected = true;
  clearTimeout(reconnectTimer);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ t: 'join', name: profile.name, color: profile.color, car: profile.car, room: state.room }));
  };
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => {
    if (!wantConnected) return;
    if (state.mode === 'lobby') {
      $('play').disabled = false;
      $('play').textContent = 'Acelerar!';
      $('lobby-error').textContent = 'Não consegui conectar ao servidor. Confira se ele está ligado e tente de novo.';
      return;
    }
    $('offline').hidden = false;
    state.myId = null;
    reconnectTimer = setTimeout(connect, 1500);
  };
}
const send = (o) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
};

setInterval(() => {
  const b = state.body;
  if (!b || !state.myId) return;
  const r = (v) => Math.round(v * 100) / 100;
  send({
    t: 'u', x: r(b.x), y: r(b.y), z: r(b.z), h: r(b.h), vx: r(b.vx), vz: r(b.vz), s: r(b.steer),
    f: (input.down && b.forward > 1 ? 1 : 0) | (b.usingNitro ? 2 : 0),
  });
}, 50);

function metaOf(id) {
  return state.metas.get(id);
}
const nameOf = (id) => (id === state.myId ? 'Você' : metaOf(id)?.name || 'Alguém');

function addRemote(meta) {
  state.metas.set(meta.id, meta);
  state.scores.set(meta.id, state.scores.get(meta.id) || 0);
  if (meta.id === state.myId || state.remotes.has(meta.id)) return;
  const car = buildCar(meta.car, meta.color);
  const label = makeLabel(meta.name, meta.color);
  label.position.y = 3.3;
  car.root.add(label);
  car.root.visible = false;
  scene.add(car.root);
  state.remotes.set(meta.id, {
    id: meta.id, car, buf: [], x: 0, y: 0, z: 0, vx: 0, vz: 0, speed: 0, steer: 0, flags: 0, pitch: 0, lastY: 0, label,
  });
}
function removeRemote(id) {
  const r = state.remotes.get(id);
  if (r) {
    scene.remove(r.car.root);
    state.remotes.delete(id);
  }
  state.metas.delete(id);
  state.scores.delete(id);
}
function clearRemotes() {
  for (const id of [...state.remotes.keys()]) removeRemote(id);
  state.metas.clear();
  state.scores.clear();
}

function setCheckpoint(cp) {
  state.cp = cp;
  cpGroup.position.set(cp.x, 0.03, cp.z);
  cpGroup.visible = true;
}

function handle(m) {
  if (m.t === 'full') {
    wantConnected = false;
    ws.close();
    state.mode = 'lobby';
    $('play').disabled = false;
    $('play').textContent = 'Acelerar!';
    $('lobby-error').textContent = m.why;
    return;
  }
  if (m.t === 'welcome') {
    const reconnecting = !!state.body;
    clearRemotes();
    state.myId = m.id;
    state.room = m.room;
    state.phase = m.phase;
    state.time = m.time;
    m.cars.forEach(addRemote);
    coins.set(m.coins);
    nitros.set(m.nitros);
    setCheckpoint(m.cp);
    $('offline').hidden = true;
    if (!reconnecting) enterGame(m.spawn);
    return;
  }
  if (!state.myId) return; // ainda entrando: o welcome traz tudo
  switch (m.t) {
    case 's': {
      state.time = m.time;
      const now = performance.now();
      for (const c of m.c) {
        state.scores.set(c[0], c[9]);
        if (c[0] === state.myId) continue;
        const r = state.remotes.get(c[0]);
        if (!r) continue;
        r.buf.push({ t: now, x: c[1], y: c[2], z: c[3], h: c[4], vx: c[5], vz: c[6], steer: c[7], flags: c[8] });
        if (r.buf.length > 12) r.buf.shift();
      }
      break;
    }
    case 'join':
      addRemote(m.car);
      if (!m.car.bot && m.car.id !== state.myId) feed(`<b>${esc(m.car.name)}</b> entrou na cidade`);
      break;
    case 'leave': {
      const meta = metaOf(m.id);
      if (meta && !meta.bot) feed(`<b>${esc(meta.name)}</b> saiu`);
      removeRemote(m.id);
      break;
    }
    case 'coin+':
      for (const [id, x, z] of m.list) coins.add(id, x, z);
      break;
    case 'coin-': {
      const c = coins.remove(m.id);
      if (m.by === state.myId) {
        sound.coin();
        popScore('+1', '#ffd21e');
        if (c) burst(c.x, c.y + 1.3, c.z, 6, 5, 1, 0.8, 0.15);
      }
      break;
    }
    case 'nitro+':
      nitros.add(m.item[0], m.item[1], m.item[2]);
      break;
    case 'nitro-': {
      nitros.remove(m.id);
      if (m.by === state.myId && state.body) {
        state.body.nitro = Math.min(100, state.body.nitro + 45);
        sound.nitroGet();
        popScore('+ Nitro', '#4fd6ff');
      }
      break;
    }
    case 'cp':
      setCheckpoint(m.cp);
      if (m.by === state.myId) {
        sound.checkpoint();
        bigToast('Checkpoint! +5');
        const b = state.body;
        if (b) burst(b.x, b.y + 1, b.z, 30, 15, 1, 0.9, 0.3, 14);
      } else {
        feed(`<b>${esc(nameOf(m.by))}</b> pegou o checkpoint — novo destino!`);
      }
      break;
    case 'hit':
      onHit(m);
      break;
    case 'horn': {
      if (m.id === state.myId) break;
      const r = state.remotes.get(m.id);
      const b = state.body;
      if (r && b) sound.horn(0.15 / (1 + Math.hypot(r.x - b.x, r.z - b.z) / 25));
      break;
    }
    case 'emote':
      showEmote(m.id, m.e);
      break;
    case 'end':
      showResults(m.ranking);
      state.phase = 'end';
      break;
    case 'start':
      state.phase = 'race';
      state.time = m.time;
      coins.set(m.coins);
      nitros.set(m.nitros);
      setCheckpoint(m.cp);
      $('results').hidden = true;
      bigToast('Nova rodada!');
      break;
    default:
  }
}

function onHit(m) {
  const b = state.body;
  if (!b) return;
  burst(m.x, 1.2, m.z, 22, 13, 1, 0.65, 0.15);
  const dist = Math.hypot(m.x - b.x, m.z - b.z);
  if (dist < 60 && m.vic !== state.myId && m.atk !== state.myId) sound.crash(0.4);
  if (m.vic === state.myId) {
    b.vx += m.ix;
    b.vz += m.iz;
    b.vy = 5;
    b.grounded = false;
    b.spinKick = (Math.random() < 0.5 ? -1 : 1) * 3.2;
    state.shake = 0.9;
    sound.crash(1);
    bigToast(m.lost ? `${nameOf(m.atk)} te acertou! −${m.lost}` : `${nameOf(m.atk)} te acertou!`, true);
  } else if (m.atk === state.myId) {
    state.shake = Math.max(state.shake, 0.45);
    sound.crash(0.8);
    bigToast(m.lost ? `Pancada! Pegue as ${m.lost} moeda${m.lost > 1 ? 's' : ''}` : 'Pancada!');
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- Entrada ----------
const input = { up: false, down: false, left: false, right: false, steer: 0, drift: false, nitro: false };
const held = new Set();
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight']);
addEventListener('keydown', (e) => {
  if (state.mode !== 'play') return;
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  held.add(e.code);
  switch (e.code) {
    case 'KeyH':
      doHorn();
      break;
    case 'KeyR':
      doReset();
      break;
    case 'KeyC':
      state.camFar = !state.camFar;
      break;
    case 'KeyM':
      toggleMute();
      break;
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
      send({ t: 'emote', e: Number(e.code.slice(-1)) - 1 });
      break;
    default:
  }
});
addEventListener('keyup', (e) => held.delete(e.code));
addEventListener('blur', () => held.clear());

const touch = { up: false, down: false, left: false, right: false, nitro: false, drift: false };
document.querySelectorAll('[data-touch]').forEach((b) => {
  const k = b.dataset.touch;
  const on = (e) => {
    e.preventDefault();
    try {
      b.setPointerCapture(e.pointerId);
    } catch { /* o botão funciona mesmo sem captura */ }
    touch[k] = true;
    b.classList.add('down');
  };
  const off = () => {
    touch[k] = false;
    b.classList.remove('down');
  };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('lostpointercapture', off);
});
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

function readInput() {
  input.up = held.has('ArrowUp') || held.has('KeyW') || touch.up;
  input.down = held.has('ArrowDown') || held.has('KeyS') || touch.down;
  input.left = held.has('ArrowLeft') || held.has('KeyA') || touch.left;
  input.right = held.has('ArrowRight') || held.has('KeyD') || touch.right;
  input.steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  input.drift = held.has('Space') || touch.drift;
  input.nitro = held.has('ShiftLeft') || held.has('ShiftRight') || held.has('KeyN') || touch.nitro;
}
function doHorn() {
  sound.horn(0.16);
  send({ t: 'horn' });
}
function doReset() {
  state.body?.reset();
  lastSkid[0] = lastSkid[1] = null;
  sound.whoosh();
}
function toggleMute() {
  sound.setMuted(!sound.muted);
  $('btn-mute').textContent = sound.muted ? '🔇' : '🔊';
}
$('btn-mute').textContent = sound.muted ? '🔇' : '🔊';
$('btn-mute').addEventListener('click', toggleMute);
$('btn-cam').addEventListener('click', () => { state.camFar = !state.camFar; });
$('btn-horn').addEventListener('click', doHorn);
$('btn-reset').addEventListener('click', doReset);
$('emotes').innerHTML = EMOTES.map((e, i) => `<button type="button" data-e="${i}" aria-label="Emoji ${e}">${e}<kbd>${i + 1}</kbd></button>`).join('');
$('emotes').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) {
    send({ t: 'emote', e: Number(b.dataset.e) });
    b.blur();
  }
});

// ---------- Emojis acima dos carros ----------
const liveEmotes = [];
function showEmote(id, e) {
  const target = id === state.myId ? state.myCar : state.remotes.get(id)?.car;
  if (!target) return;
  const s = makeEmoji(EMOTES[e] || EMOTES[0]);
  s.position.y = 3.6;
  target.root.add(s);
  liveEmotes.push({ s, parent: target.root, t: 0 });
}

// ---------- Interface ----------
function feed(html) {
  const el = document.createElement('div');
  el.innerHTML = html;
  $('feed').prepend(el);
  while ($('feed').children.length > 4) $('feed').lastChild.remove();
  setTimeout(() => el.remove(), 5200);
}
let toastT;
function bigToast(text, bad = false) {
  const t = $('toast');
  t.textContent = text;
  t.classList.toggle('bad', bad);
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 1800);
}
function popScore(text, color) {
  const el = document.createElement('span');
  el.textContent = text;
  el.style.color = color;
  $('score-pop').append(el);
  setTimeout(() => el.remove(), 800);
}

let inviteLink = '';
async function buildInvite() {
  let host = location.host;
  const privateNet = /^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
  $('invite-note').textContent = privateNet
    ? 'Funciona para quem está na mesma rede Wi-Fi que este computador.'
    : 'Funciona de qualquer lugar, é só abrir o link.';
  try {
    if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
      const info = await (await fetch('/info')).json();
      if (info.lan?.[0]) host = `${info.lan[0]}:${info.port}`;
    }
  } catch { /* mantém o endereço atual */ }
  inviteLink = `${location.protocol}//${host}/?sala=${encodeURIComponent(state.room)}`;
  $('invite-link').value = inviteLink;
}
$('btn-invite').addEventListener('click', () => {
  $('invite').hidden = !$('invite').hidden;
  $('btn-invite').blur();
});
$('invite-close').addEventListener('click', () => { $('invite').hidden = true; });
$('invite-copy').addEventListener('click', async () => {
  const input2 = $('invite-link');
  try {
    await navigator.clipboard.writeText(inviteLink);
  } catch {
    input2.select();
    document.execCommand('copy');
  }
  $('invite-copy').textContent = 'Copiado!';
  setTimeout(() => { $('invite-copy').textContent = 'Copiar'; }, 1500);
});

function showResults(ranking) {
  const humans = ranking;
  const winner = humans[0];
  const iWon = winner?.id === state.myId;
  $('results-title').textContent = iWon ? 'Você venceu! 🏆' : `${winner?.name || 'Ninguém'} venceu!`;
  $('results-list').innerHTML = humans.slice(0, 8).map((p, i) => `
    <li class="${p.id === state.myId ? 'me' : ''}"><span class="pos">${i + 1}º</span>
    <i style="background:${esc(p.color)}"></i><span class="nm">${esc(p.name)}</span><b>${p.score}</b></li>`).join('');
  $('results').hidden = false;
  if (iWon) sound.fanfare();
}

function enterGame(spawn) {
  state.mode = 'play';
  camera.clearViewOffset();
  if (preview) {
    scene.remove(preview.root);
    preview = null;
  }
  const cfg = CARS[profile.car];
  state.body = new CarBody(cfg, spawn);
  state.myCar = buildCar(profile.car, profile.color);
  scene.add(state.myCar.root);
  camState.h = spawn.h;
  camState.init = false;
  document.body.classList.add('playing');
  $('lobby').hidden = true;
  $('room-chip').textContent = state.room;
  history.replaceState(null, '', `?sala=${encodeURIComponent(state.room)}`);
  buildInvite();
  bigToast('Siga a seta até o feixe de luz!');
  $('hint').classList.add('show');
  setTimeout(() => $('hint').classList.remove('show'), 9000);
}

// ---------- Minimapa ----------
const mini = $('minimap');
const mctx = mini.getContext('2d');
const MINI = 200;
mini.width = mini.height = MINI * 2;
function drawMinimap(t) {
  const b = state.body;
  if (!b) return;
  const ctx = mctx;
  const c = MINI;
  const R2 = MINI - 8;
  const s = (MINI * 2) / 330;
  const cos = Math.cos(b.h);
  const sin = Math.sin(b.h);
  const sx = (x, z) => c - s * ((x - b.x) * cos - (z - b.z) * sin);
  const sy = (x, z) => c - s * ((x - b.x) * sin + (z - b.z) * cos);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, MINI * 2, MINI * 2);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, R2, 0, 7);
  ctx.fillStyle = 'rgba(16,20,26,.84)';
  ctx.fill();
  ctx.clip();

  ctx.save();
  ctx.setTransform(-s * cos, -s * sin, s * sin, -s * cos, c + s * (b.x * cos - b.z * sin), c + s * (b.x * sin + b.z * cos));
  ctx.fillStyle = '#39424e';
  ctx.fillRect(-BOUND, -BOUND, BOUND * 2, BOUND * 2);
  ctx.fillStyle = '#5b6673';
  for (const a of city.aabbs) ctx.fillRect(a.x0, a.z0, a.x1 - a.x0, a.z1 - a.z0);
  ctx.fillStyle = '#dfe5ec';
  const e = HALF + ROAD_W / 2;
  for (let i = 0; i < N; i++) {
    const r = roadCoord(i);
    ctx.fillRect(r - ROAD_W / 2, -e, ROAD_W, e * 2);
    ctx.fillRect(-e, r - ROAD_W / 2, e * 2, ROAD_W);
  }
  ctx.restore();

  ctx.fillStyle = '#c98f00';
  for (const k of coins.items) {
    ctx.beginPath();
    ctx.arc(sx(k.x, k.z), sy(k.x, k.z), 4, 0, 7);
    ctx.fill();
  }
  ctx.fillStyle = '#0aa9e6';
  for (const k of nitros.items) {
    const x = sx(k.x, k.z);
    const y = sy(k.x, k.z);
    ctx.fillRect(x - 5, y - 5, 10, 10);
  }
  for (const r of state.remotes.values()) {
    const meta = metaOf(r.id);
    if (!meta || !r.car.root.visible) continue;
    ctx.fillStyle = meta.color;
    ctx.strokeStyle = '#10141a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx(r.x, r.z), sy(r.x, r.z), 9, 0, 7);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // Objetivo (preso na borda quando está longe)
  if (state.cp) {
    let x = sx(state.cp.x, state.cp.z) - c;
    let y = sy(state.cp.x, state.cp.z) - c;
    const d = Math.hypot(x, y);
    const lim = R2 - 16;
    if (d > lim) {
      x *= lim / d;
      y *= lim / d;
    }
    const pulse = 13 + Math.sin(t * 6) * 3;
    ctx.fillStyle = '#ffe14d';
    ctx.strokeStyle = '#3b2f00';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(c + x, c + y, pulse, 0, 7);
    ctx.fill();
    ctx.stroke();
  }

  // Eu: seta no centro
  ctx.translate(c, c);
  ctx.fillStyle = profile.color === '#22262e' ? '#ffffff' : profile.color;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, -17);
  ctx.lineTo(12, 13);
  ctx.lineTo(0, 7);
  ctx.lineTo(-12, 13);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- Câmera ----------
const camState = { h: 0, init: false, x: 0, y: 0, z: 0 };
function cameraBlocked(fromX, fromZ, toX, toZ) {
  // recua menos se houver prédio entre o carro e a câmera
  const steps = 7;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = fromX + (toX - fromX) * t;
    const z = fromZ + (toZ - fromZ) * t;
    for (const o of city.query(x, z)) {
      if (o.t === 0 && x > o.x0 - 0.8 && x < o.x1 + 0.8 && z > o.z0 - 0.8 && z < o.z1 + 0.8) return (i - 1) / steps;
    }
  }
  return 1;
}
function updateCamera(dt, t) {
  const b = state.body;
  const forwardDir = b.forward < -4 ? b.h + Math.PI : b.h;
  let diff = (forwardDir - camState.h) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  camState.h += diff * Math.min(1, dt * (b.drifting ? 2.8 : 4.4));

  const dist = state.camFar ? 13.5 : 8.6;
  const height = state.camFar ? 6.2 : 3.5;
  const hx = Math.sin(camState.h);
  const hz = Math.cos(camState.h);
  const k = cameraBlocked(b.x, b.z, b.x - hx * dist, b.z - hz * dist);
  const d = Math.max(3.5, dist * k);
  const tx = b.x - hx * d;
  const tz = b.z - hz * d;
  const ty = b.y + height + (dist - d) * 0.28;
  if (!camState.init) {
    camState.x = tx;
    camState.y = ty;
    camState.z = tz;
    camState.init = true;
  }
  const f = Math.min(1, dt * 13);
  camState.x += (tx - camState.x) * f;
  camState.y += (ty - camState.y) * Math.min(1, dt * 7);
  camState.z += (tz - camState.z) * f;
  state.shake = Math.max(0, state.shake - dt * 1.8);
  const sh = state.shake * state.shake * 0.8;
  camera.position.set(
    camState.x + Math.sin(t * 57) * sh,
    Math.max(0.9, camState.y + Math.sin(t * 71) * sh),
    camState.z + Math.cos(t * 49) * sh
  );
  camera.lookAt(b.x + hx * 5, b.y + 1.5, b.z + hz * 5);
  const speedK = Math.min(1, b.speed / 55);
  const wantFov = 62 + speedK * 15 + (b.usingNitro ? 7 : 0);
  camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
}

// ---------- Laço principal ----------
function updateRemotes(dt, t) {
  const renderT = performance.now() - 110;
  const list = [];
  for (const r of state.remotes.values()) {
    const buf = r.buf;
    if (buf.length === 0) continue;
    let a = buf[0];
    let b2 = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].t <= renderT && buf[i + 1].t >= renderT) {
        a = buf[i];
        b2 = buf[i + 1];
        break;
      }
    }
    let x; let y; let z; let h;
    if (renderT >= b2.t) {
      // sem dados novos: projeta um pouco para a frente
      const ex = Math.min(0.2, (renderT - b2.t) / 1000);
      x = b2.x + b2.vx * ex;
      y = b2.y;
      z = b2.z + b2.vz * ex;
      h = b2.h;
    } else {
      const k = b2.t === a.t ? 1 : Math.max(0, Math.min(1, (renderT - a.t) / (b2.t - a.t)));
      x = a.x + (b2.x - a.x) * k;
      y = a.y + (b2.y - a.y) * k;
      z = a.z + (b2.z - a.z) * k;
      let dh = (b2.h - a.h) % (Math.PI * 2);
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      h = a.h + dh * k;
    }
    const s = buf[buf.length - 1];
    const speed = Math.hypot(s.vx, s.vz);
    const dy = dt > 0 ? (y - r.lastY) / dt : 0;
    r.lastY = y;
    const wantPitch = speed > 2 ? -Math.atan2(dy, speed) * 0.8 : 0;
    r.pitch += (wantPitch - r.pitch) * Math.min(1, dt * 8);
    Object.assign(r, { x, y, z, vx: s.vx, vz: s.vz, speed, steer: s.steer, flags: s.flags });
    r.car.root.visible = true;
    r.car.root.position.set(x, y, z);
    r.car.root.rotation.y = h;
    animateCar(r.car, dt, {
      speed, steer: s.steer, brake: s.flags & 1, nitro: s.flags & 2, pitch: r.pitch, time: t,
      roll: s.steer * Math.min(1, speed / 30) * 0.06,
    });
    if (s.flags & 2 && Math.random() < 0.5) {
      emit(x - Math.sin(h) * 2.4, y + 0.5, z - Math.cos(h) * 2.4, 0, 1, 0, 0.3, 0.4, 0.8, 1);
    }
    list.push(r);
  }
  return list;
}

let lastHud = 0;
function updateHud(t) {
  const b = state.body;
  $('speed').textContent = Math.round(b.speed * 3.6);
  $('nitro-fill').style.width = `${b.nitro}%`;
  $('nitro').classList.toggle('active', b.usingNitro);
  $('nitro').classList.toggle('empty', b.nitro < 2);
  const myScore = state.scores.get(state.myId) || 0;
  $('score').textContent = myScore;

  if (t - lastHud < 0.2) return;
  lastHud = t;
  const sec = Math.max(0, Math.ceil(state.time));
  $('time').textContent = state.phase === 'end'
    ? `Próxima em ${sec}s`
    : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  $('time').classList.toggle('low', state.phase === 'race' && sec <= 20);

  const rows = [...state.scores.entries()]
    .filter(([id]) => state.metas.has(id))
    .sort((p, q) => q[1] - p[1]);
  $('board').innerHTML = rows.slice(0, 7).map(([id, s], i) => {
    const m = metaOf(id);
    return `<li class="${id === state.myId ? 'me' : ''}"><span>${i + 1}</span><i style="background:${esc(m.color)}"></i><em>${esc(id === state.myId ? 'Você' : m.name)}</em><b>${s}</b></li>`;
  }).join('');
  const humansCount = [...state.metas.values()].filter((m) => !m.bot).length;
  $('players-chip').textContent = `${humansCount} ${humansCount === 1 ? 'jogador' : 'jogadores'}`;

  const street = streetName(b.x, b.z);
  $('street').textContent = street || 'Fora da pista';
  $('street').classList.toggle('off', !street);
  if (state.cp) {
    $('goal-dist').textContent = `${Math.round(Math.hypot(state.cp.x - b.x, state.cp.z - b.z))} m`;
  }
  $('stuck').hidden = state.stuck < 3;
}

const clock = new THREE.Clock();
let lobbyAngle = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;

  coins.update(t, 1.45);
  nitros.update(t, 1.6, 1, 0.3);
  cpRing.scale.setScalar(1 + Math.sin(t * 4) * 0.025);
  cpRing.rotation.z = t;
  updateParticles(dt);
  for (let i = liveEmotes.length - 1; i >= 0; i--) {
    const e = liveEmotes[i];
    e.t += dt;
    e.s.position.y = 3.6 + e.t * 0.9;
    e.s.material.opacity = Math.min(1, 3 - e.t * 1.2);
    if (e.t > 2.4) {
      e.parent.remove(e.s);
      e.s.material.map.dispose();
      e.s.material.dispose();
      liveEmotes.splice(i, 1);
    }
  }

  if (state.mode === 'lobby') {
    lobbyAngle += dt * 0.42;
    const p = preview.root.position;
    preview.root.rotation.y = lobbyAngle;
    animateCar(preview, 0, { speed: 0, steer: 0, brake: false, nitro: false });
    // Centraliza o carro no espaço livre ao lado do painel
    const wide = innerWidth > 900;
    const panel = wide ? Math.min(450, innerWidth) : 0;
    camera.setViewOffset(innerWidth, innerHeight, panel / 2, wide ? 0 : innerHeight * 0.28, innerWidth, innerHeight);
    const dist = wide ? 11 : 13;
    camera.position.set(p.x + 3.2, 3.1, p.z - dist);
    camera.lookAt(p.x, 0.9, p.z);
    camera.fov = 40;
    camera.updateProjectionMatrix();
    sun.target.position.copy(p);
    sun.position.set(p.x + 80, 150, p.z + 40);
    world.update(dt, 1e6, 1e6, 0);
    skyDome.position.copy(camera.position);
    renderer.render(scene, camera);
    return;
  }

  // ---- jogando ----
  readInput();
  const b = state.body;
  const others = updateRemotes(dt, t);
  b.step(dt, input, city, others);

  if (b.impact > 7) {
    sound.crash(b.impact / 26);
    state.shake = Math.max(state.shake, Math.min(0.75, b.impact / 34));
    burst(b.x, b.y + 0.8, b.z, Math.min(14, 4 + b.impact * 0.5), 9, 1, 0.75, 0.25);
  }
  if (b.landed > 4) {
    sound.land();
    state.shake = Math.max(state.shake, Math.min(0.5, b.landed / 26));
    for (let i = 0; i < 6; i++) emit(b.x + (Math.random() - 0.5) * 2, b.y + 0.2, b.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 6, 1, (Math.random() - 0.5) * 6, 0.5, 0.75, 0.74, 0.7);
  }
  const wantsToMove = input.up || input.down;
  state.stuck = wantsToMove && b.speed < 1.5 ? state.stuck + dt : Math.max(0, state.stuck - dt * 2);

  // Modelo do meu carro
  const car = state.myCar;
  car.root.position.set(b.x, b.y, b.z);
  car.root.rotation.y = b.h;
  const pitchAir = b.grounded ? -Math.atan2(b.vy, Math.max(6, b.speed)) : -Math.atan2(b.vy, Math.max(10, b.speed)) * 0.75;
  const pitch = pitchAir - b.accelVis * 0.022;
  const roll = b.steer * Math.min(1, b.speed / 30) * 0.075 + Math.max(-0.14, Math.min(0.14, b.lateral * -0.012));
  animateCar(car, dt, {
    speed: b.forward, steer: b.steer, brake: input.down && b.forward > 1, nitro: b.usingNitro, roll, pitch, time: t, airborne: !b.grounded && b.y - groundHeight(b.x, b.z) > 1.5,
  });

  // Fumaça e marcas de pneu
  const sf = Math.sin(b.h);
  const cf = Math.cos(b.h);
  const skidding = b.grounded && (b.drifting || (input.down && b.forward > 12));
  if (skidding) {
    const off = car.cfg.wheelbase[1];
    const tr = car.cfg.track;
    const ground = b.y + 0.04;
    addSkid(0, b.x + sf * off + cf * tr, ground, b.z + cf * off - sf * tr, cf, -sf);
    addSkid(1, b.x + sf * off - cf * tr, ground, b.z + cf * off + sf * tr, cf, -sf);
    if (Math.random() < 0.5) {
      const side = Math.random() < 0.5 ? 1 : -1;
      emit(b.x + sf * off + cf * tr * side, ground + 0.25, b.z + cf * off - sf * tr * side, (Math.random() - 0.5) * 2, 1.4, (Math.random() - 0.5) * 2, 0.7, 0.86, 0.86, 0.86);
    }
  } else {
    lastSkid[0] = lastSkid[1] = null;
  }
  if (b.usingNitro) {
    emit(b.x - sf * 2.6, b.y + 0.45, b.z - cf * 2.6, -sf * 6, 0.8, -cf * 6, 0.32, 0.4, 0.82, 1);
  }

  // Seta para o objetivo
  if (state.cp) {
    const a = Math.atan2(state.cp.x - b.x, state.cp.z - b.z);
    arrow.visible = true;
    arrow.position.set(b.x, b.y + 3.05 + Math.sin(t * 3) * 0.06, b.z);
  }

  world.update(dt, b.x, b.z, b.speed, () => sound.cone());
  updateCamera(dt, t);

  // A seta inclina para a câmera, assim a face fica sempre legível
  if (state.cp) {
    // A face da seta olha para a câmera: objetivo à frente aponta para cima na tela, como uma bússola
    _az.set(state.cp.x - b.x, 0, state.cp.z - b.z).normalize();
    _ay.subVectors(camera.position, arrow.position).normalize();
    _ay.y += 0.7;
    _ay.normalize();
    _az.addScaledVector(_ay, -_az.dot(_ay)).normalize();
    _ax.crossVectors(_ay, _az).normalize();
    _am.makeBasis(_ax, _ay, _az);
    arrow.quaternion.setFromRotationMatrix(_am);
    // O feixe some quando a câmera está perto, para não cobrir a tela
    const cpDist = Math.hypot(state.cp.x - camera.position.x, state.cp.z - camera.position.z);
    cpBeam.material.opacity = Math.max(0, Math.min(1, (cpDist - 14) / 50));
    cpBeam.visible = cpBeam.material.opacity > 0.01;
  }

  const camTarget = { x: Math.round(b.x), z: Math.round(b.z) };
  sun.target.position.set(camTarget.x, 0, camTarget.z);
  sun.position.set(camTarget.x + 70, 170, camTarget.z + 46);
  skyDome.position.copy(camera.position);

  sound.engine(Math.min(1, b.speed / (b.cfg.top * 1.35)), input.up ? 1 : input.down ? 0.5 : 0, b.usingNitro, skidding);
  updateHud(t);
  drawMinimap(t);
  renderer.render(scene, camera);
}

frame();
