import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const qs = new URLSearchParams(location.search);
const id = qs.get('id') || location.pathname.split('/').filter(Boolean).pop();
const apiBase = (window.ARENA_API_BASE || 'https://carlos-4rxr.onrender.com').replace(/\/$/, '');
const ASSET_BASE = (window.CARLOS_ASSET_BASE || new URL('.', location.href).href).replace(/\/$/, '');
const api = () => `${apiBase}/api/aposta/${encodeURIComponent(id)}?viewer=${encodeURIComponent(getViewer())}`;

let viewer = localStorage.getItem('carlos-arena-viewer');
if (!viewer) {
  viewer = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
  localStorage.setItem('carlos-arena-viewer', viewer);
}
function getViewer() { return viewer; }

const viewport = document.querySelector('#viewport');
const connection = document.querySelector('#connection');
let MAP = null;
let data = null;
let pollTimer = null;

try {
  const mapResponse = await fetch(`${ASSET_BASE}/map.json`, { cache: 'no-store' });
  if (!mapResponse.ok) throw new Error(`map.json ${mapResponse.status}`);
  MAP = await mapResponse.json();
} catch (error) {
  console.error('Falha carregando mapa da Arena:', error);
  if (connection) connection.textContent = 'ERRO NO MAPA';
  throw error;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080b0f);
scene.fog = new THREE.Fog(0x080b0f, 55, 125);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 250);
camera.position.set(50, 34, 35);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
viewport.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xdde5ff, 0x22210f, 2.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(30, 70, 20);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(MAP.size.x, MAP.size.z),
  new THREE.MeshStandardMaterial({ color: 0x394038, roughness: 0.95 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(50, 0, 35);
scene.add(ground);

const grid = new THREE.GridHelper(100, 20, 0x526052, 0x263026);
grid.position.set(50, 0.02, 35);
grid.material.opacity = 0.24;
grid.material.transparent = true;
scene.add(grid);

const matWall = new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.9 });
const matCover = new THREE.MeshStandardMaterial({ color: 0x7b6b52, roughness: 0.8 });
const matSite = new THREE.MeshStandardMaterial({ color: 0x8d774d, roughness: 0.9 });

for (const [x1, z1, x2, z2] of MAP.walls) {
  const w = x2 - x1;
  const d = z2 - z1;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(w, 0.5), 4, Math.max(d, 0.5)),
    matWall,
  );
  mesh.position.set((x1 + x2) / 2, 2, (z1 + z2) / 2);
  scene.add(mesh);
}

for (const c of MAP.cover) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d), matCover);
  mesh.position.set(c.x, c.h / 2, c.z);
  scene.add(mesh);
}

function makeText(text, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = options.width || 256;
  canvas.height = options.height || 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = options.background || 'rgba(5,7,9,.72)';
  if (options.background) ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = options.color || '#fff';
  ctx.font = options.font || 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(options.scaleX || 5.5, options.scaleY || 2.1, 1);
  return sprite;
}

for (const [side, p] of Object.entries(MAP.sites)) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.08, 32), matSite);
  mesh.position.set(p.x, 0.06, p.z);
  scene.add(mesh);
  const label = makeText(side, { background: 'rgba(0,0,0,.55)', scaleX: 4.5, scaleY: 1.8 });
  label.position.set(p.x, 5, p.z);
  scene.add(label);
}

const bots = { A: null, B: null };
function makeBot(side) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: side === 'A' ? 0xeeeeee : 0x999999, roughness: 0.55 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.15, 1.7, 6, 12), material);
  body.position.y = 2;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), material);
  head.position.y = 3.8;
  group.add(head);
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.3, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x17191c, metalness: 0.5 }),
  );
  gun.position.set(0, 2.3, 1.25);
  group.add(gun);
  scene.add(group);
  return group;
}
bots.A = makeBot('A');
bots.B = makeBot('B');

const spectatorLayer = new THREE.Group();
scene.add(spectatorLayer);
const spectatorObjects = new Map();

function spectatorPosition(index, total) {
  const t = total <= 1 ? 0.5 : index / (total - 1);
  const side = index % 2 === 0 ? 1 : -1;
  return new THREE.Vector3(8 + t * 84, 0, side > 0 ? 5 : 65);
}

function createSpectator(bettor) {
  const group = new THREE.Group();
  const headMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.34, depthWrite: false });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 12), headMaterial);
  head.position.y = 2.25;
  group.add(head);
  const bodyMaterial = new THREE.MeshBasicMaterial({ color: bettor.side === 'A' ? 0xdedede : 0x9d9d9d, transparent: true, opacity: 0.13, depthWrite: false });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.82, 1.2, 5, 8), bodyMaterial);
  body.position.y = 0.95;
  group.add(body);

  const rank = bettor.rankPosition ? `#${bettor.rankPosition}` : '#?';
  const label = makeText(`${rank} ${bettor.name}`, {
    background: 'rgba(0,0,0,.35)',
    font: 'bold 20px sans-serif',
    scaleX: 5.8,
    scaleY: 1.35,
  });
  label.position.y = 4.1;
  group.add(label);
  spectatorLayer.add(group);
  return group;
}

function updateSpectators(bettors = []) {
  const seen = new Set();
  bettors.forEach((bettor, index) => {
    const key = String(bettor.userId);
    seen.add(key);
    let object = spectatorObjects.get(key);
    if (!object) {
      object = createSpectator(bettor);
      spectatorObjects.set(key, object);
    }
    object.position.copy(spectatorPosition(index, bettors.length));
    object.userData.bettor = bettor;
    object.visible = true;
  });
  for (const [key, object] of spectatorObjects) {
    if (!seen.has(key)) object.visible = false;
  }
}

let camMode = 'auto';
const keys = Object.create(null);
let yaw = 0.8;
let pitch = -0.28;
const freePos = new THREE.Vector3(50, 25, 35);
const lookDirection = new THREE.Vector3();

function setCam(mode) {
  camMode = mode;
  document.querySelectorAll('#cameraBar button').forEach(button => {
    button.classList.toggle('active', button.dataset.cam === mode);
  });
  if (mode === 'free') {
    freePos.copy(camera.position);
    if (renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock();
  } else if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock();
  }
}

document.querySelectorAll('#cameraBar button').forEach(button => {
  button.addEventListener('click', () => setCam(button.dataset.cam));
});

addEventListener('keydown', event => {
  keys[event.key.toLowerCase()] = true;
  if (event.code === 'Space') keys.space = true;
  if (event.key === '1') setCam('auto');
  if (event.key === '2') setCam('A');
  if (event.key === '3') setCam('B');
  if (event.key === '4') setCam('overview');
  if (event.key === '5') setCam('free');
});
addEventListener('keyup', event => {
  keys[event.key.toLowerCase()] = false;
  if (event.code === 'Space') keys.space = false;
});

renderer.domElement.addEventListener('click', () => {
  if (camMode === 'free' && document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock?.();
  }
});

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  document.body.classList.toggle('free-camera', locked && camMode === 'free');
});

document.addEventListener('mousemove', event => {
  if (camMode !== 'free' || document.pointerLockElement !== renderer.domElement) return;
  yaw -= event.movementX * 0.0025;
  pitch -= event.movementY * 0.0022;
  pitch = Math.max(-1.45, Math.min(1.45, pitch));
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmt(ms) {
  const seconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function updateUI(d) {
  document.querySelector('#round').textContent = `ROUND ${d.round || 1}`;
  document.querySelector('#score').textContent = `${d.score?.A || 0} : ${d.score?.B || 0}`;
  const phase = d.status === 'betting'
    ? 'APOSTAS'
    : d.roundPhase === 'break'
      ? 'INTERVALO'
      : d.status === 'finished'
        ? 'FIM'
        : 'AO VIVO';
  document.querySelector('#phase').textContent = phase;
  if (connection) connection.textContent = phase;
  document.querySelector('#spectators').textContent = d.spectators || 0;
  document.querySelector('#poolA').textContent = new Intl.NumberFormat('pt-BR').format(d.pool?.A || 0);
  document.querySelector('#poolB').textContent = new Intl.NumberFormat('pt-BR').format(d.pool?.B || 0);

  for (const side of ['A', 'B']) {
    const f = d.fighters?.[side];
    if (!f) continue;
    document.querySelector(`#name${side}`).textContent = f.name.toUpperCase();
    document.querySelector(`#state${side}`).textContent = (f.state || '').toUpperCase();
    document.querySelector(`#hp${side}`).style.width = `${Math.max(0, (f.hp / Math.max(1, f.maxHp)) * 100)}%`;
    document.querySelector(`#armor${side}`).textContent = `ARM ${f.armor}`;
    document.querySelector(`#ammo${side}`).textContent = `${f.ammo} / ${f.maxAmmo}`;
    bots[side].position.set(f.x, 0, f.z);
    bots[side].rotation.y = f.rotation || 0;
    bots[side].visible = f.hp > 0;
  }

  document.querySelector('#timer').textContent = d.status === 'betting'
    ? fmt(d.bettingEndsAt - Date.now())
    : d.roundPhase === 'live'
      ? fmt(d.roundEndsAt - Date.now())
      : d.status === 'finished'
        ? 'FINAL'
        : 'INTERVALO';
  document.querySelector('#betting').textContent = d.status === 'betting'
    ? 'APOSTAS ABERTAS'
    : d.status === 'finished'
      ? 'ARENA ENCERRADA'
      : `POOL ${new Intl.NumberFormat('pt-BR').format((d.pool?.A || 0) + (d.pool?.B || 0))}`;

  const lines = (d.events || []).slice(-8).reverse();
  document.querySelector('#feed').innerHTML = lines
    .map(event => `<div class="event">${new Date(event.at).toLocaleTimeString()} — ${escapeHtml(event.text || '')}</div>`)
    .join('');

  const commentary = (d.commentary || []).slice(-1)[0];
  if (commentary) document.querySelector('#commentaryText').textContent = commentary.text;
  updateSpectators(d.bettors || []);
}

async function poll() {
  if (!id) return;
  try {
    const response = await fetch(api(), { cache: 'no-store' });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || 'API inválida');
    data = payload;
    document.querySelector('#connection').textContent = payload.status === 'betting' ? 'APOSTAS' : 'CONECTADO';
    updateUI(payload);
  } catch (error) {
    console.warn('Arena API:', error);
    document.querySelector('#phase').textContent = 'RECONECTANDO';
    if (connection) connection.textContent = 'RECONECTANDO';
  } finally {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, 700);
  }
}
poll();

function targetFor() {
  if (!data) return new THREE.Vector3(50, 0, 35);
  if (camMode === 'A') return bots.A.position.clone().add(new THREE.Vector3(0, 2, 0));
  if (camMode === 'B') return bots.B.position.clone().add(new THREE.Vector3(0, 2, 0));
  if (camMode === 'overview') return new THREE.Vector3(50, 0, 35);
  const target = data.camera?.target;
  return target === 'A'
    ? bots.A.position.clone().add(new THREE.Vector3(0, 2, 0))
    : target === 'B'
      ? bots.B.position.clone().add(new THREE.Vector3(0, 2, 0))
      : new THREE.Vector3(50, 0, 35);
}

function updateFreeCamera() {
  const speed = keys.shift ? 1.5 : 0.7;
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  if (keys.w) freePos.addScaledVector(forward, speed);
  if (keys.s) freePos.addScaledVector(forward, -speed);
  if (keys.d) freePos.addScaledVector(right, speed);
  if (keys.a) freePos.addScaledVector(right, -speed);
  if (keys.space) freePos.y += speed;
  if (keys.control) freePos.y -= speed;
  freePos.x = THREE.MathUtils.clamp(freePos.x, 3, 97);
  freePos.z = THREE.MathUtils.clamp(freePos.z, 3, 67);
  freePos.y = THREE.MathUtils.clamp(freePos.y, 2, 65);
  camera.position.lerp(freePos, 0.18);
  lookDirection.set(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  );
  camera.lookAt(camera.position.clone().add(lookDirection));
}

function animate() {
  requestAnimationFrame(animate);
  if (camMode === 'free') {
    updateFreeCamera();
  } else {
    const target = targetFor();
    if (camMode === 'overview' || (camMode === 'auto' && data?.camera?.target === 'overview')) {
      const desired = new THREE.Vector3(50, 34, 35);
      camera.position.lerp(desired, 0.035);
    } else {
      const desired = target.clone().add(new THREE.Vector3(-10, 7, -10));
      camera.position.lerp(desired, 0.06);
    }
    camera.lookAt(target);
  }
  spectatorLayer.children.forEach(object => {
    const label = object.children[2];
    if (label) label.lookAt(camera.position);
  });
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
