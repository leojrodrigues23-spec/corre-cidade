// Corre Cidade — servidor do jogo (sem dependências: basta ter Node instalado)
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOUND, CELL, HALF, LANE, N, groundHeight, randomRoadPoint, roadCoord } from './public/js/map.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TICK = 20;
const ROUND_SECONDS = Number(process.env.RONDA) || 180;
const END_SECONDS = 10;
const MAX_PLAYERS = 16;
const MAX_ROOMS = 100;
const MIN_CARS = 4; // bots completam até este número
const COIN_TARGET = 70;
const NITRO_TARGET = 8;
const CAR_TYPES = ['hatch', 'esporte', 'picape'];
const WEIGHT = { hatch: 0.9, esporte: 1, picape: 1.35 };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
};

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    // Endereços internos só para quem está na própria máquina
    const local = /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '') && !req.headers['x-forwarded-for'];
    res.end(JSON.stringify({ lan: local ? lanAddresses() : [], port: PORT }));
    return;
  }
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------- WebSocket mínimo (RFC 6455) ----------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsFrame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

class Conn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.alive = true;
    this.onmessage = null;
    this.onclose = null;
    socket.on('data', (d) => this.feed(d));
    socket.on('close', () => this.closed());
    socket.on('error', () => socket.destroy());
  }
  closed() {
    if (!this.alive) return;
    this.alive = false;
    this.onclose?.();
  }
  send(obj, droppable = false) {
    if (!this.alive) return;
    if (droppable && this.socket.writableLength > 256 * 1024) return;
    this.socket.write(wsFrame(1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj))));
  }
  feed(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = b0 & 0x80;
      const opcode = b0 & 0x0f;
      const masked = b1 & 0x80;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        this.socket.destroy(); // nenhuma mensagem do jogo é tão grande
        return;
      }
      if (!masked || !fin || len > 4096) {
        this.socket.destroy();
        return;
      }
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);

      if (opcode === 1) {
        let msg;
        try {
          msg = JSON.parse(payload.toString());
        } catch {
          continue;
        }
        this.onmessage?.(msg);
      } else if (opcode === 8) {
        this.socket.end(wsFrame(8, Buffer.alloc(0)));
        return;
      } else if (opcode === 9) {
        this.socket.write(wsFrame(10, payload));
      }
    }
  }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (new URL(req.url, 'http://x').pathname !== '/ws' || !key) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true);
  // Conexão muda por 30 s é conexão morta: libera a vaga e tira o carro fantasma
  socket.setTimeout(30000, () => socket.destroy());
  handleConn(new Conn(socket));
});

// ---------- Salas ----------
const rooms = new Map();
let nextId = 1;
const BOT_NAMES = ['Zeca', 'Dona Lia', 'Tião', 'Nina', 'Beto', 'Jade'];
const BOT_COLORS = ['#ff8a00', '#14b8a6', '#a855f7', '#ef4444', '#84cc16', '#f472b6'];

const num = (v, min, max, d = 0) => (Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : d);

class Room {
  constructor(code) {
    this.code = code;
    this.cars = new Map();
    this.coins = new Map();
    this.nitros = new Map();
    this.nextItem = 1;
    this.phase = 'race';
    this.time = ROUND_SECONDS;
    this.cp = null;
    this.cpN = 0;
    this.seedItems();
    this.newCheckpoint();
    this.syncBots();
  }
  humans() {
    return [...this.cars.values()].filter((c) => !c.bot);
  }
  broadcast(obj, droppable) {
    const s = JSON.stringify(obj);
    for (const c of this.cars.values()) c.conn?.send(s, droppable);
  }
  meta(c) {
    return { id: c.id, name: c.name, color: c.color, car: c.car, bot: !!c.bot };
  }
  seedItems() {
    this.coins.clear();
    this.nitros.clear();
    while (this.coins.size < COIN_TARGET) this.spawnCoinTrail(false);
    while (this.nitros.size < NITRO_TARGET) this.spawnNitro(false);
  }
  spawnCoinTrail(notify = true) {
    const p = randomRoadPoint();
    const added = [];
    const dirX = p.axis === 'x' ? 1 : 0;
    const dirZ = p.axis === 'z' ? 1 : 0;
    for (let i = 0; i < 5; i++) {
      const x = p.x + dirX * i * 7;
      const z = p.z + dirZ * i * 7;
      if (Math.abs(x) > HALF + 6 || Math.abs(z) > HALF + 6) continue;
      added.push(this.addCoin(x, z));
    }
    if (notify && added.length) this.broadcast({ t: 'coin+', list: added });
  }
  addCoin(x, z) {
    const id = this.nextItem++;
    this.coins.set(id, { id, x, z });
    return [id, Math.round(x * 10) / 10, Math.round(z * 10) / 10];
  }
  spawnNitro(notify = true) {
    const p = randomRoadPoint();
    const id = this.nextItem++;
    this.nitros.set(id, { id, x: p.x, z: p.z });
    if (notify) this.broadcast({ t: 'nitro+', item: [id, p.x, p.z] });
  }
  newCheckpoint() {
    let p;
    let tries = 0;
    do {
      p = randomRoadPoint();
      tries++;
    } while (this.cp && Math.hypot(p.x - this.cp.x, p.z - this.cp.z) < 170 && tries < 30);
    // centraliza na via para o checkpoint ficar bem no meio da rua
    const i = Math.round((p.axis === 'z' ? p.x + HALF : p.z + HALF) / CELL);
    if (p.axis === 'z') p.x = roadCoord(i);
    else p.z = roadCoord(i);
    this.cp = { x: p.x, z: p.z, n: ++this.cpN };
    return this.cp;
  }
  snapshotInit(me) {
    return {
      t: 'welcome',
      id: me.id,
      room: this.code,
      cars: [...this.cars.values()].map((c) => this.meta(c)),
      coins: [...this.coins.values()].map((c) => [c.id, c.x, c.z]),
      nitros: [...this.nitros.values()].map((c) => [c.id, c.x, c.z]),
      cp: this.cp,
      phase: this.phase,
      time: this.time,
      spawn: me.spawn,
    };
  }
  syncBots() {
    const humans = this.humans().length;
    const want = Math.max(0, MIN_CARS - humans);
    const bots = [...this.cars.values()].filter((c) => c.bot);
    for (let i = bots.length; i < want; i++) {
      const b = makeBot(i);
      this.cars.set(b.id, b);
      this.broadcast({ t: 'join', car: this.meta(b) });
    }
    for (let i = want; i < bots.length; i++) {
      this.cars.delete(bots[i].id);
      this.broadcast({ t: 'leave', id: bots[i].id });
    }
  }
  tick(dt) {
    this.time -= dt;
    if (this.phase === 'race' && this.time <= 0) {
      this.phase = 'end';
      this.time = END_SECONDS;
      const ranking = [...this.cars.values()]
        .sort((a, b) => b.score - a.score)
        .map((c) => ({ id: c.id, name: c.name, score: c.score, color: c.color, bot: !!c.bot }));
      this.broadcast({ t: 'end', ranking });
    } else if (this.phase === 'end' && this.time <= 0) {
      this.phase = 'race';
      this.time = ROUND_SECONDS;
      for (const c of this.cars.values()) c.score = 0;
      this.seedItems();
      this.newCheckpoint();
      this.broadcast({
        t: 'start',
        time: this.time,
        cp: this.cp,
        coins: [...this.coins.values()].map((c) => [c.id, c.x, c.z]),
        nitros: [...this.nitros.values()].map((c) => [c.id, c.x, c.z]),
      });
    }

    for (const c of this.cars.values()) {
      if (c.bot) updateBot(c, dt, this);
      if (c.cool > 0) c.cool -= dt;
    }
    if (this.phase === 'race') {
      this.checkPickups();
      this.checkBumps();
      if (this.coins.size < COIN_TARGET - 5) this.spawnCoinTrail();
      if (this.nitros.size < NITRO_TARGET) this.spawnNitro();
    }

    const r = (v) => Math.round(v * 100) / 100;
    this.broadcast(
      {
        t: 's',
        time: Math.max(0, Math.round(this.time * 10) / 10),
        c: [...this.cars.values()].map((c) => [
          c.id, r(c.x), r(c.y), r(c.z), r(c.h), r(c.vx), r(c.vz), r(c.steer), c.flags, c.score,
        ]),
      },
      true
    );
  }
  checkPickups() {
    for (const c of this.cars.values()) {
      if (!c.ready) continue;
      for (const coin of this.coins.values()) {
        if (Math.abs(coin.x - c.x) < 3.6 && Math.abs(coin.z - c.z) < 3.6) {
          this.coins.delete(coin.id);
          c.score += 1;
          this.broadcast({ t: 'coin-', id: coin.id, by: c.id });
        }
      }
      for (const n of this.nitros.values()) {
        if (Math.hypot(n.x - c.x, n.z - c.z) < 4) {
          this.nitros.delete(n.id);
          this.broadcast({ t: 'nitro-', id: n.id, by: c.id });
        }
      }
      if (Math.hypot(this.cp.x - c.x, this.cp.z - c.z) < 11) {
        c.score += 5;
        const cp = this.newCheckpoint();
        this.broadcast({ t: 'cp', by: c.id, cp });
      }
    }
  }
  checkBumps() {
    const list = [...this.cars.values()].filter((c) => c.ready);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.bot && b.bot) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        if (dx * dx + dz * dz > 22 || Math.abs(a.y - b.y) > 2) continue;
        const rel = Math.hypot(a.vx - b.vx, a.vz - b.vz);
        if (rel < 13) continue;
        const speedA = Math.hypot(a.vx, a.vz) * WEIGHT[a.car];
        const speedB = Math.hypot(b.vx, b.vz) * WEIGHT[b.car];
        const atk = speedA >= speedB ? a : b;
        const vic = atk === a ? b : a;
        if (vic.cool > 0) continue;
        vic.cool = 2;
        const len = Math.hypot(atk.vx, atk.vz) || 1;
        const power = Math.min(34, rel * 0.9 * WEIGHT[atk.car]);
        const ix = (atk.vx / len) * power;
        const iz = (atk.vz / len) * power;
        const lost = Math.min(3, vic.score);
        vic.score -= lost;
        const dropped = [];
        for (let k = 0; k < lost; k++) {
          const a2 = Math.random() * Math.PI * 2;
          const nx = num(vic.x + Math.cos(a2) * (5 + k * 2), -BOUND + 5, BOUND - 5);
          const nz = num(vic.z + Math.sin(a2) * (5 + k * 2), -BOUND + 5, BOUND - 5);
          dropped.push(this.addCoin(nx, nz));
        }
        if (dropped.length) this.broadcast({ t: 'coin+', list: dropped });
        if (vic.bot) {
          vic.stun = 0.9;
          vic.ivx = ix;
          vic.ivz = iz;
        }
        this.broadcast({
          t: 'hit', atk: atk.id, vic: vic.id, ix: Math.round(ix * 10) / 10, iz: Math.round(iz * 10) / 10,
          lost, x: Math.round(vic.x), z: Math.round(vic.z),
        });
      }
    }
  }
}

// ---------- Bots ----------
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function makeBot(index) {
  const i = Math.floor(Math.random() * N);
  const j = Math.floor(Math.random() * N);
  const b = {
    id: nextId++,
    bot: true,
    name: `${BOT_NAMES[index % BOT_NAMES.length]} 🤖`,
    color: BOT_COLORS[index % BOT_COLORS.length],
    car: CAR_TYPES[index % 3],
    x: roadCoord(i), z: roadCoord(j), y: 0, h: 0, vx: 0, vz: 0, steer: 0, flags: 0,
    score: 0, ready: true, cool: 0, stun: 0, ivx: 0, ivz: 0,
    speed: 0, top: 22 + Math.random() * 7,
    node: [i, j], dir: [0, 0], wps: [],
  };
  return b;
}

function chooseNext(b, room) {
  const [i, j] = b.node;
  const options = DIRS.filter(([dx, dz]) => {
    const ni = i + dx;
    const nj = j + dz;
    if (ni < 0 || nj < 0 || ni >= N || nj >= N) return false;
    return !(dx === -b.dir[0] && dz === -b.dir[1] && (dx || dz));
  });
  const chase = Math.random() < 0.65;
  let pick = options[Math.floor(Math.random() * options.length)];
  if (chase) {
    let best = Infinity;
    for (const o of options) {
      const d = Math.hypot(roadCoord(i + o[0]) - room.cp.x, roadCoord(j + o[1]) - room.cp.z);
      if (d < best) {
        best = d;
        pick = o;
      }
    }
  }
  const [dx, dz] = pick;
  // mão brasileira: direita da direção de viagem
  const rx = -dz * LANE;
  const rz = dx * LANE;
  const ax = roadCoord(i);
  const az = roadCoord(j);
  const bx = roadCoord(i + dx);
  const bz = roadCoord(j + dz);
  b.wps = [
    { x: ax + dx * 14 + rx, z: az + dz * 14 + rz, slow: false },
    { x: bx - dx * 16 + rx, z: bz - dz * 16 + rz, slow: true },
  ];
  b.node = [i + dx, j + dz];
  b.dir = [dx, dz];
}

function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function updateBot(b, dt, room) {
  if (b.stun > 0) {
    b.stun -= dt;
    b.x = num(b.x + b.ivx * dt, -BOUND, BOUND);
    b.z = num(b.z + b.ivz * dt, -BOUND, BOUND);
    b.h += (b.ivx - b.ivz) * 0.015 * dt * 20;
    b.ivx *= 0.93;
    b.ivz *= 0.93;
    b.speed = 0;
    b.vx = b.ivx;
    b.vz = b.ivz;
    b.y = groundHeight(b.x, b.z);
    return;
  }
  if (!b.wps.length) chooseNext(b, room);
  const wp = b.wps[0];
  const dx = wp.x - b.x;
  const dz = wp.z - b.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 7) {
    b.wps.shift();
    return;
  }
  const want = Math.atan2(dx, dz);
  const err = angleDiff(want, b.h);
  const turnRate = 2.1;
  const turn = Math.max(-turnRate * dt, Math.min(turnRate * dt, err));
  b.h += turn;
  b.steer = Math.max(-1, Math.min(1, err * 2));
  const targetSpeed = Math.abs(err) > 0.5 ? 11 : wp.slow && dist < 30 ? 15 : b.top;
  b.speed += Math.max(-26 * dt, Math.min(11 * dt, targetSpeed - b.speed));
  b.vx = Math.sin(b.h) * b.speed;
  b.vz = Math.cos(b.h) * b.speed;
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  const g = groundHeight(b.x, b.z);
  b.y += (g - b.y) * Math.min(1, dt * 14);
  b.flags = targetSpeed < b.speed - 3 ? 1 : 0;
}

// ---------- Conexões ----------
const COLOR_RE = /^#[0-9a-f]{6}$/i;

function handleConn(conn) {
  let room = null;
  let me = null;

  conn.onmessage = (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join' && !me) {
      const code = String(m.room || 'geral').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16) || 'geral';
      room = rooms.get(code);
      if (!room) {
        if (rooms.size >= MAX_ROOMS) {
          conn.send({ t: 'full', why: 'O servidor está lotado. Tente mais tarde.' });
          return;
        }
        room = new Room(code);
        rooms.set(code, room);
      }
      if (room.humans().length >= MAX_PLAYERS) {
        conn.send({ t: 'full', why: `A sala está cheia (${MAX_PLAYERS} jogadores).` });
        room = null;
        return;
      }
      const spawn = randomRoadPoint();
      const heading = spawn.axis === 'z' ? 0 : Math.PI / 2;
      me = {
        id: nextId++,
        conn,
        name: String(m.name || '').replace(/\s+/g, ' ').trim().slice(0, 14) || 'Piloto',
        color: COLOR_RE.test(m.color) ? m.color : '#ffd21e',
        car: CAR_TYPES.includes(m.car) ? m.car : 'hatch',
        x: spawn.x, y: 0, z: spawn.z, h: heading, vx: 0, vz: 0, steer: 0, flags: 0,
        score: 0, cool: 0, ready: false,
        spawn: { x: spawn.x, z: spawn.z, h: heading },
      };
      room.cars.set(me.id, me);
      room.broadcast({ t: 'join', car: room.meta(me) });
      room.syncBots();
      conn.send(room.snapshotInit(me));
      return;
    }
    if (!me) return;
    if (m.t === 'u') {
      me.ready = true;
      me.x = num(m.x, -BOUND, BOUND, me.x);
      me.y = num(m.y, -1, 60, me.y);
      me.z = num(m.z, -BOUND, BOUND, me.z);
      me.h = num(m.h, -1e4, 1e4, me.h);
      me.vx = num(m.vx, -90, 90);
      me.vz = num(m.vz, -90, 90);
      me.steer = num(m.s, -1, 1);
      me.flags = (m.f | 0) & 7;
    } else if (m.t === 'horn') {
      if (me.hornAt && Date.now() - me.hornAt < 250) return;
      me.hornAt = Date.now();
      room.broadcast({ t: 'horn', id: me.id });
    } else if (m.t === 'emote') {
      if (me.emoteAt && Date.now() - me.emoteAt < 800) return;
      me.emoteAt = Date.now();
      room.broadcast({ t: 'emote', id: me.id, e: Math.max(0, Math.min(3, m.e | 0)) });
    }
  };

  conn.onclose = () => {
    if (!room || !me) return;
    room.cars.delete(me.id);
    room.broadcast({ t: 'leave', id: me.id });
    if (room.humans().length === 0) {
      rooms.delete(room.code);
    } else {
      room.syncBots();
    }
  };
}

setInterval(() => {
  for (const room of rooms.values()) room.tick(1 / TICK);
}, 1000 / TICK);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  A porta ${PORT} já está em uso. Feche o outro programa ou rode com outra porta.\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  🏁 CORRE CIDADE no ar!\n');
  console.log(`  Neste computador:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  Na mesma rede Wi-Fi: http://${ip}:${PORT}`);
  console.log('\n  Para encerrar, pressione Ctrl+C.\n');
});
