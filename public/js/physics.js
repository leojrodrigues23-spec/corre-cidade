// Física arcade: fácil de dirigir, com derrapagem e pulos
import { BOUND, groundHeight, isOnRoad, rampHeight, snapToRoad } from './map.js';

const R = 1.95;
const SUB = 1 / 90;

export class CarBody {
  constructor(cfg, spawn) {
    this.cfg = cfg;
    this.x = spawn.x;
    this.z = spawn.z;
    this.y = groundHeight(spawn.x, spawn.z);
    this.h = spawn.h;
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.steer = 0;
    this.spinKick = 0;
    this.nitro = 60;
    this.usingNitro = false;
    this.grounded = true;
    this.drifting = false;
    this.lateral = 0;
    this.forward = 0;
    this.prevG = this.y;
    this.prevRamp = 0;
    this.impact = 0;
    this.landed = 0;
    this.accelVis = 0;
  }
  get speed() {
    return Math.hypot(this.vx, this.vz);
  }
  reset() {
    const p = snapToRoad(this.x, this.z, this.h);
    this.x = p.x;
    this.z = p.z;
    this.h = p.heading;
    this.y = groundHeight(p.x, p.z) + 0.3;
    this.vx = this.vz = this.vy = 0;
    this.grounded = false;
    this.prevRamp = 0;
    this.spinKick = 0;
  }
  step(dt, inp, city, others) {
    this.impact = 0;
    this.landed = 0;
    const n = Math.max(1, Math.ceil(dt / SUB));
    const sub = dt / n;
    for (let i = 0; i < n; i++) this.sub(sub, inp, city, others);
    this.nitro = Math.min(100, this.nitro + (this.usingNitro ? 0 : 1.6 * dt));
  }
  sub(dt, inp, city, others) {
    const c = this.cfg;
    const road = isOnRoad(this.x, this.z);
    const target = inp.steer;
    this.steer += (target - this.steer) * Math.min(1, dt * (target ? 7 : 11));

    let sf = Math.sin(this.h);
    let cf = Math.cos(this.h);
    let vF = this.vx * sf + this.vz * cf;
    this.usingNitro = !!inp.nitro && this.nitro > 0.5;

    const top = c.top * (road ? 1 : 0.72) * (this.usingNitro ? 1.38 : 1);
    if (this.grounded) {
      const dir = vF >= -0.5 ? 1 : -1;
      const turnBase = c.turn * Math.min(1, Math.abs(vF) / 6);
      const fade = 1 - 0.46 * Math.min(1, Math.abs(vF) / (c.top * 1.2));
      const hand = inp.drift && Math.abs(vF) > 5;
      this.h += this.steer * turnBase * fade * dir * (hand ? 1.45 : 1) * dt;
    } else {
      this.h += this.steer * 0.9 * dt;
    }
    this.h += this.spinKick * dt;
    this.spinKick *= Math.exp(-3.2 * dt);

    sf = Math.sin(this.h);
    cf = Math.cos(this.h);
    vF = this.vx * sf + this.vz * cf;
    let vL = this.vx * cf - this.vz * sf;

    let accelShown = 0;
    if (this.grounded) {
      const gas = inp.up || this.usingNitro;
      const a = c.accel * (this.usingNitro ? 1.9 : 1);
      if (gas) {
        if (vF < top) {
          const f = 1 - 0.72 * Math.max(0, vF / top);
          vF += a * f * dt;
          accelShown = 1;
        } else {
          vF -= (vF - top) * 1.3 * dt;
        }
      } else if (inp.down) {
        if (vF > 0.8) {
          vF -= 50 * dt;
          accelShown = -1;
        } else {
          vF = Math.max(vF - 17 * dt, -13);
        }
      } else {
        vF *= Math.exp(-(road ? 0.32 : 0.9) * dt);
        if (Math.abs(vF) < 0.15) vF = 0;
      }
      if (vF > top && !gas) vF -= (vF - top) * 1.3 * dt;
      if (!road) vF *= Math.exp(-0.18 * dt);

      const hand = inp.drift && Math.abs(vF) > 5;
      const grip = hand ? 1.7 : c.grip;
      vL *= Math.exp(-grip * dt);
      if (hand) vF *= Math.exp(-0.5 * dt);
      this.drifting = Math.abs(vL) > 5;
    } else {
      this.drifting = false;
      vL *= Math.exp(-0.35 * dt);
    }
    this.forward = vF;
    this.lateral = vL;
    this.accelVis += (accelShown - this.accelVis) * Math.min(1, dt * 7);
    if (this.usingNitro) this.nitro = Math.max(0, this.nitro - 26 * dt);

    this.vx = sf * vF + cf * vL;
    this.vz = cf * vF - sf * vL;

    const px = this.x;
    const pz = this.z;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.collide(city, others);

    // Lateral da rampa é uma parede
    let g = groundHeight(this.x, this.z);
    if (g - this.y > 0.75) {
      this.x = px;
      this.z = pz;
      this.impact = Math.max(this.impact, this.speed);
      this.vx *= -0.3;
      this.vz *= -0.3;
      g = groundHeight(this.x, this.z);
    }

    const ramp = rampHeight(this.x, this.z);
    if (this.grounded) {
      if (ramp > 0 || this.prevRamp > 0) {
        const sv = (g - this.prevG) / dt;
        if ((sv < 0 && this.vy > 1.5) || this.y - g > 0.5) {
          this.grounded = false;
        } else {
          this.vy = Math.max(0, sv);
          this.y = g;
        }
      } else {
        this.y += (g - this.y) * Math.min(1, dt * 22);
        this.vy = 0;
      }
    }
    if (!this.grounded) {
      this.vy -= 25 * dt;
      this.y += this.vy * dt;
      if (this.y <= g) {
        this.landed = Math.max(this.landed, -this.vy);
        this.y = g;
        this.vy = 0;
        this.grounded = true;
      }
    }
    this.prevG = g;
    this.prevRamp = ramp;
  }
  push(nx, nz, overlap, bounce = 0.32) {
    this.x += nx * overlap;
    this.z += nz * overlap;
    const vn = this.vx * nx + this.vz * nz;
    if (vn < 0) {
      this.impact = Math.max(this.impact, -vn);
      this.vx -= nx * vn * (1 + bounce);
      this.vz -= nz * vn * (1 + bounce);
    }
  }
  collide(city, others) {
    for (const o of city.query(this.x, this.z)) {
      if (o.t === 0) {
        const cx = Math.max(o.x0, Math.min(o.x1, this.x));
        const cz = Math.max(o.z0, Math.min(o.z1, this.z));
        let dx = this.x - cx;
        let dz = this.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < R * R) {
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            this.push(dx / d, dz / d, R - d);
          } else {
            // dentro do prédio: sai pelo lado mais próximo
            const l = this.x - o.x0;
            const r = o.x1 - this.x;
            const t = this.z - o.z0;
            const b = o.z1 - this.z;
            const m = Math.min(l, r, t, b);
            if (m === l) this.push(-1, 0, l + R);
            else if (m === r) this.push(1, 0, r + R);
            else if (m === t) this.push(0, -1, t + R);
            else this.push(0, 1, b + R);
          }
        }
      } else if (this.y < 7) {
        const dx = this.x - o.x;
        const dz = this.z - o.z;
        const min = R + o.r;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          this.push(dx / d, dz / d, min - d, 0.2);
        }
      }
    }
    for (const o of others) {
      if (Math.abs(o.y - this.y) > 1.9) continue;
      const dx = this.x - o.x;
      const dz = this.z - o.z;
      const min = 3.7;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        this.x += nx * (min - d) * 0.6;
        this.z += nz * (min - d) * 0.6;
        const rel = (this.vx - o.vx) * nx + (this.vz - o.vz) * nz;
        if (rel < 0) {
          this.impact = Math.max(this.impact, -rel);
          this.vx -= nx * rel * 0.75;
          this.vz -= nz * rel * 0.75;
        }
      }
    }
    if (Math.abs(this.x) > BOUND - R) {
      const s = Math.sign(this.x);
      this.push(-s, 0, Math.abs(this.x) - (BOUND - R));
    }
    if (Math.abs(this.z) > BOUND - R) {
      const s = Math.sign(this.z);
      this.push(0, -s, Math.abs(this.z) - (BOUND - R));
    }
  }
}
