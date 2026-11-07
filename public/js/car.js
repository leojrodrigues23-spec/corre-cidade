// Modelos 3D dos carros, feitos só com geometria (silhueta extrudada e detalhes)
import * as THREE from '../vendor/three.module.min.js';

export const CARS = {
  hatch: {
    label: 'Compacto', desc: 'Ágil nas curvas', accel: 19, top: 38, grip: 10.5, turn: 2.75,
    width: 1.84, wheelR: 0.36, wheelbase: [1.28, -1.24], track: 0.86,
    profile: [
      // da traseira para a frente, parte de cima da carroceria
      [-1.98, 0.72], [-2.02, 1.0], [-1.86, 1.1], [-1.2, 1.14], [0.55, 1.14], [1.6, 0.98], [2.02, 0.84], [2.04, 0.55],
    ],
    bottomY: 0.28,
    cabin: [[-1.86, 1.08], [-1.5, 1.72], [-0.2, 1.76], [0.56, 1.12]],
    cabinW: 1.6, roof: { x0: -1.42, x1: -0.22, y: 1.74 },
  },
  esporte: {
    label: 'Esportivo', desc: 'Mais rápido na reta', accel: 21, top: 44, grip: 9, turn: 2.45,
    width: 1.95, wheelR: 0.37, wheelbase: [1.42, -1.42], track: 0.92,
    profile: [
      [-2.26, 0.62], [-2.3, 0.86], [-2.0, 0.96], [-0.9, 0.98], [0.5, 0.92], [1.75, 0.72], [2.32, 0.54], [2.36, 0.38],
    ],
    bottomY: 0.2,
    cabin: [[-1.72, 0.94], [-0.9, 1.34], [-0.2, 1.36], [0.72, 0.9]],
    cabinW: 1.58, roof: { x0: -0.86, x1: -0.22, y: 1.34 }, spoiler: true,
  },
  picape: {
    label: 'Picape', desc: 'Bate mais forte', accel: 17, top: 36, grip: 8.5, turn: 2.35,
    width: 2.02, wheelR: 0.47, wheelbase: [1.5, -1.42], track: 0.92,
    profile: [
      [-2.42, 0.82], [-2.44, 1.2], [-0.42, 1.2], [0.52, 1.28], [1.82, 1.2], [2.36, 1.04], [2.4, 0.66],
    ],
    bottomY: 0.42,
    cabin: [[-0.5, 1.2], [-0.32, 1.96], [0.5, 2.0], [1.08, 1.26]],
    cabinW: 1.7, roof: { x0: -0.3, x1: 0.48, y: 1.98 }, bed: true,
  },
};

const tireGeo = new THREE.CylinderGeometry(1, 1, 1, 22);
tireGeo.rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.04, 12);
hubGeo.rotateZ(Math.PI / 2);
const tireMat = new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.9 });
const hubMat = new THREE.MeshStandardMaterial({ color: '#c9ced4', metalness: 0.75, roughness: 0.28 });
const spokeGeo = new THREE.BoxGeometry(1.06, 0.16, 1.1);
const glassMat = new THREE.MeshStandardMaterial({ color: '#17222e', roughness: 0.08, metalness: 0.5 });
const darkMat = new THREE.MeshStandardMaterial({ color: '#1b1d21', roughness: 0.6 });
const chromeMat = new THREE.MeshStandardMaterial({ color: '#d8dce0', metalness: 0.85, roughness: 0.2 });

function extrudeProfile(points, width, material, closeBottomY, cfg) {
  const s = new THREE.Shape();
  const r = cfg ? cfg.wheelR + 0.08 : 0;
  s.moveTo(points[0][0], closeBottomY ?? points[0][1]);
  if (cfg) {
    const [f, b] = cfg.wheelbase;
    const cy = cfg.wheelR;
    // borda inferior com os recortes dos para-lamas
    s.lineTo(b - r, closeBottomY);
    s.absarc(b, cy, r, Math.PI - Math.asin(Math.min(1, Math.max(-1, (closeBottomY - cy) / r))), Math.asin(Math.min(1, Math.max(-1, (closeBottomY - cy) / r))), true);
    s.lineTo(f - r, closeBottomY);
    s.absarc(f, cy, r, Math.PI - Math.asin(Math.min(1, Math.max(-1, (closeBottomY - cy) / r))), Math.asin(Math.min(1, Math.max(-1, (closeBottomY - cy) / r))), true);
    s.lineTo(points[points.length - 1][0], closeBottomY);
    for (let i = points.length - 1; i >= 0; i--) s.lineTo(points[i][0], points[i][1]);
  } else {
    s.lineTo(points[points.length - 1][0], closeBottomY ?? points[points.length - 1][1]);
    for (let i = points.length - 1; i >= 0; i--) s.lineTo(points[i][0], points[i][1]);
  }
  s.closePath();
  const bevel = cfg ? 0.07 : 0.03;
  const g = new THREE.ExtrudeGeometry(s, {
    depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps: 1, curveSegments: 10,
  });
  g.rotateY(-Math.PI / 2);
  g.translate((width - bevel * 2) / 2, 0, 0);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return m;
}

function box(w, h, d, x, y, z, material, cast = false) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  return m;
}

export function buildCar(type, color) {
  const cfg = CARS[type] || CARS.hatch;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.02, roughness: 0.42, clearcoat: 0.8, clearcoatRoughness: 0.12,
  });

  body.add(extrudeProfile(cfg.profile, cfg.width, paint, cfg.bottomY, cfg));
  body.add(extrudeProfile(cfg.cabin, cfg.cabinW, glassMat, cfg.cabin[0][1]));

  // Teto e colunas pintados
  const { roof } = cfg;
  const roofLen = roof.x1 - roof.x0;
  body.add(box(cfg.cabinW + 0.02, 0.07, roofLen + 0.1, 0, roof.y, (roof.x0 + roof.x1) / 2, paint, true));

  // Saia inferior escura
  const skirtLen = cfg.profile[cfg.profile.length - 1][0] - cfg.profile[0][0];
  const skirtCenter = (cfg.profile[cfg.profile.length - 1][0] + cfg.profile[0][0]) / 2;
  body.add(box(cfg.width - 0.2, 0.1, skirtLen - 0.2, 0, cfg.bottomY - 0.02, skirtCenter, darkMat));

  const front = cfg.profile[cfg.profile.length - 1][0];
  const backZ = cfg.profile[0][0];
  const frontY = cfg.profile[cfg.profile.length - 1][1];
  const backY = cfg.profile[0][1];

  // Faróis e grade
  const headMat = new THREE.MeshStandardMaterial({ color: '#fffbe0', emissive: '#fff4bf', emissiveIntensity: 1.3 });
  const hw = cfg.width / 2 - 0.34;
  body.add(box(0.46, 0.14, 0.06, hw, frontY + 0.07, front + 0.04, headMat));
  body.add(box(0.46, 0.14, 0.06, -hw, frontY + 0.07, front + 0.04, headMat));
  body.add(box(cfg.width - 1.1, 0.16, 0.05, 0, frontY - 0.06, front + 0.05, darkMat));
  body.add(box(cfg.width - 0.3, 0.12, 0.12, 0, cfg.bottomY + 0.12, front + 0.04, type === 'picape' ? chromeMat : darkMat));

  // Lanternas (acendem ao frear)
  const tailMat = new THREE.MeshStandardMaterial({ color: '#7a0d12', emissive: '#ff1a1a', emissiveIntensity: 0.3 });
  body.add(box(0.5, 0.16, 0.06, hw, backY + 0.1, backZ - 0.05, tailMat));
  body.add(box(0.5, 0.16, 0.06, -hw, backY + 0.1, backZ - 0.05, tailMat));
  body.add(box(cfg.width - 0.3, 0.12, 0.12, 0, cfg.bottomY + 0.12, backZ - 0.03, type === 'picape' ? chromeMat : darkMat));
  // Placa
  const plate = new THREE.MeshStandardMaterial({ color: '#eef2f5', roughness: 0.4 });
  body.add(box(0.5, 0.15, 0.03, 0, backY - 0.14, backZ - 0.07, plate));

  // Retrovisores
  const mirrorZ = cfg.cabin[cfg.cabin.length - 1][0] - 0.12;
  const mirrorY = cfg.cabin[cfg.cabin.length - 1][1] + 0.06;
  body.add(box(0.2, 0.1, 0.1, cfg.width / 2 + 0.06, mirrorY, mirrorZ, paint));
  body.add(box(0.2, 0.1, 0.1, -cfg.width / 2 - 0.06, mirrorY, mirrorZ, paint));

  if (cfg.spoiler) {
    body.add(box(cfg.width - 0.1, 0.05, 0.36, 0, 1.28, backZ + 0.18, darkMat, true));
    body.add(box(0.07, 0.3, 0.2, 0.62, 1.1, backZ + 0.2, darkMat));
    body.add(box(0.07, 0.3, 0.2, -0.62, 1.1, backZ + 0.2, darkMat));
    body.add(box(0.9, 0.03, 0.9, 0, 0.77, 0.95, darkMat)); // entrada de ar no capô
  }
  if (cfg.bed) {
    // caçamba aberta
    const bedLen = 1.9;
    const bz = -1.42;
    body.add(box(cfg.width - 0.28, 0.1, bedLen, 0, 1.2, bz, darkMat));
    body.add(box(0.06, 0.15, bedLen, cfg.width / 2 - 0.06, 1.26, bz, chromeMat));
    body.add(box(0.06, 0.15, bedLen, -cfg.width / 2 + 0.06, 1.26, bz, chromeMat));
    // Santo antônio
    body.add(box(cfg.width - 0.3, 0.06, 0.06, 0, 1.68, -0.58, chromeMat));
    body.add(box(0.06, 0.48, 0.06, cfg.width / 2 - 0.24, 1.44, -0.58, chromeMat));
    body.add(box(0.06, 0.48, 0.06, -cfg.width / 2 + 0.24, 1.44, -0.58, chromeMat));
  }

  // Rodas
  const wheels = [];
  const fronts = [];
  const W = 0.28;
  const addWheel = (x, z, isFront) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, cfg.wheelR, z);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.scale.set(W, cfg.wheelR, cfg.wheelR);
    tire.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.scale.set(W, cfg.wheelR, cfg.wheelR);
    const spoke = new THREE.Mesh(spokeGeo, darkMat);
    spoke.scale.set(W, cfg.wheelR, cfg.wheelR);
    spoke.visible = true;
    spin.add(tire, hub, spoke);
    pivot.add(spin);
    root.add(pivot);
    wheels.push(spin);
    if (isFront) fronts.push(pivot);
  };
  const tx = cfg.track;
  addWheel(tx, cfg.wheelbase[0], true);
  addWheel(-tx, cfg.wheelbase[0], true);
  addWheel(tx, cfg.wheelbase[1], false);
  addWheel(-tx, cfg.wheelbase[1], false);

  // Chamas do nitro
  const flameMat = new THREE.MeshBasicMaterial({ color: '#7ad7ff', transparent: true, opacity: 0.85 });
  const flameGeo = new THREE.ConeGeometry(0.16, 1.2, 10);
  flameGeo.rotateX(-Math.PI / 2);
  const flames = new THREE.Group();
  for (const sx of [0.42, -0.42]) {
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.set(sx, cfg.bottomY + 0.2, backZ - 0.65);
    flames.add(f);
  }
  flames.visible = false;
  body.add(flames);

  // Sombra de contato suave
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(cfg.width + 0.6, skirtLen + 0.9),
    new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55 })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.05;
  root.add(blob);

  return {
    root, body, wheels, fronts, flames, flameMat, tailMat, paint, blob, cfg, spin: 0,
  };
}

let _blob;
function blobTexture() {
  if (_blob) return _blob;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 8, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,.9)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _blob = new THREE.CanvasTexture(c);
  return _blob;
}

export function animateCar(car, dt, { speed, steer, brake, nitro, roll = 0, pitch = 0, time = 0, airborne = false }) {
  car.spin += (speed / car.cfg.wheelR) * dt;
  for (const w of car.wheels) w.rotation.x = car.spin;
  for (const f of car.fronts) f.rotation.y += (steer * 0.5 - f.rotation.y) * Math.min(1, dt * 12);
  car.tailMat.emissiveIntensity = brake ? 3 : 0.3;
  car.flames.visible = !!nitro;
  if (nitro) {
    const s = 0.75 + Math.sin(time * 60) * 0.25 + Math.random() * 0.2;
    car.flames.scale.set(1, 1, s);
  }
  car.body.rotation.z = roll;
  car.body.rotation.x = pitch;
  car.blob.visible = !airborne;
}

// Etiqueta com o nome do jogador
export function makeLabel(text, color) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.font = '700 52px system-ui, "Segoe UI", sans-serif';
  const w = Math.min(490, ctx.measureText(text).width + 64);
  const x = (512 - w) / 2;
  ctx.fillStyle = 'rgba(12,14,20,.78)';
  ctx.beginPath();
  ctx.roundRect(x, 24, w, 80, 40);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + 34, 64, 11, 0, 7);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 54, 66, w - 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
  s.scale.set(6.4, 1.6, 1);
  s.renderOrder = 20;
  return s;
}

export function makeEmoji(char) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.font = '96px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, 64, 72);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
  s.scale.set(3.4, 3.4, 1);
  s.renderOrder = 21;
  return s;
}
