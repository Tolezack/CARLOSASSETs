import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const qs = new URLSearchParams(location.search);
const id = qs.get('id') || location.pathname.split('/').filter(Boolean).pop();
const apiBase = (window.ARENA_API_BASE || 'https://carlos-4rxr.onrender.com').replace(/\/$/, '');
const ASSET_BASE = (window.CARLOS_ASSET_BASE || new URL('.', location.href).href).replace(/\/$/, '');
let viewer = localStorage.getItem('carlos-arena-viewer') || '';
let viewerName = localStorage.getItem('carlos-arena-player') || '';
const api = () => `${apiBase}/api/aposta/${encodeURIComponent(id)}?viewer=${encodeURIComponent(viewer)}`;

const viewport = document.querySelector('#viewport');
const connection = document.querySelector('#connection');
const joinGate = document.querySelector('#joinGate');
const joinName = document.querySelector('#joinName');
const joinButton = document.querySelector('#joinButton');
const joinError = document.querySelector('#joinError');
const joinRank = document.querySelector('#joinRank');
const joinServer = document.querySelector('#joinServer');
const chatLog = document.querySelector('#chatLog');
const chatForm = document.querySelector('#chatForm');
const chatInput = document.querySelector('#chatInput');
const chatFile = document.querySelector('#chatFile');

if (viewerName) joinName.value = viewerName;

let MAP;
try {
  const response = await fetch(`${ASSET_BASE}/map.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`map.json ${response.status}`);
  MAP = await response.json();
} catch (error) {
  console.error('Falha carregando mapa:', error);
  joinError.textContent = 'Não foi possível carregar o mapa. Atualize a página.';
  throw error;
}
const CENTER = new THREE.Vector3(MAP.size.x / 2, 0, MAP.size.z / 2);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080b0f);
scene.fog = new THREE.Fog(0x080b0f, 95, Math.max(MAP.size.x, MAP.size.z) * 1.2);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, Math.max(500, MAP.size.x * 2));
camera.position.set(CENTER.x, 58, CENTER.z + 20);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
viewport.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xdde5ff, 0x22210f, 2.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(80, 120, 30); scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP.size.x, MAP.size.z), new THREE.MeshStandardMaterial({ color: 0x394038, roughness: .95 }));
ground.rotation.x = -Math.PI / 2; ground.position.copy(CENTER); scene.add(ground);
const grid = new THREE.GridHelper(Math.max(MAP.size.x, MAP.size.z), Math.round(Math.max(MAP.size.x, MAP.size.z) / 5), 0x526052, 0x263026);
grid.position.copy(CENTER); grid.position.y = .02; grid.material.opacity = .22; grid.material.transparent = true; scene.add(grid);

const matWall = new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: .9 });
const matCover = new THREE.MeshStandardMaterial({ color: 0x7b6b52, roughness: .8 });
const matSite = new THREE.MeshStandardMaterial({ color: 0x8d774d, roughness: .9 });
for (const [x1, z1, x2, z2] of MAP.walls) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(Math.abs(x2 - x1), .5), 4, Math.max(Math.abs(z2 - z1), .5)), matWall);
  m.position.set((x1 + x2) / 2, 2, (z1 + z2) / 2); scene.add(m);
}
for (const c of MAP.cover) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(c.w, c.h, c.d), matCover);
  m.position.set(c.x, c.h / 2, c.z); scene.add(m);
}

function makeText(text, opts = {}) {
  const c = document.createElement('canvas'); c.width = opts.width || 320; c.height = opts.height || 80;
  const x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height);
  if (opts.background) { x.fillStyle = opts.background; x.fillRect(0, 0, c.width, c.height); }
  x.fillStyle = opts.color || '#fff'; x.font = opts.font || 'bold 28px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }));
  s.scale.set(opts.scaleX || 7, opts.scaleY || 1.8, 1); return s;
}
for (const [side, p] of Object.entries(MAP.sites)) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, .08, 32), matSite); m.position.set(p.x, .06, p.z); scene.add(m);
  const label = makeText(side, { background: 'rgba(0,0,0,.55)', scaleX: 4.5, scaleY: 1.8 }); label.position.set(p.x, 5, p.z); scene.add(label);
}
for (const [side, p] of Object.entries(MAP.spawns)) {
  const label = makeText(`${side} SPAWN`, { background: 'rgba(0,0,0,.38)', font: 'bold 18px sans-serif', scaleX: 8, scaleY: 1.4 });
  label.position.set(p.x, 4.5, p.z); scene.add(label);
}

const bots = { A: null, B: null };
const botTargets = { A: new THREE.Vector3(), B: new THREE.Vector3() };
const botRotations = { A: 0, B: 0 };
function makeBot(side) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: side === 'A' ? 0xeeeeee : 0x999999, roughness: .55 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.15, 1.7, 6, 12), mat); body.position.y = 2; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.75, 16, 12), mat); head.position.y = 3.8; g.add(head);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(.3, .3, 2.4), new THREE.MeshStandardMaterial({ color: 0x17191c, metalness: .5 })); gun.position.set(0, 2.3, 1.25); g.add(gun);
  scene.add(g); return g;
}
bots.A = makeBot('A'); bots.B = makeBot('B');

const spectatorLayer = new THREE.Group(); scene.add(spectatorLayer);
const spectatorObjects = new Map();
function spectatorPosition(index, total) {
  // Espectadores ficam nas laterais, fora das rotas dos bots.
  const t = total <= 1 ? .5 : index / (total - 1);
  return new THREE.Vector3(8 + t * (MAP.size.x - 16), .05, index % 2 ? MAP.size.z - 7 : 7);
}
function createSpectator(b) {
  const g = new THREE.Group();
  const hm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .32, depthWrite: false, depthTest: false });
  const h = new THREE.Mesh(new THREE.SphereGeometry(.72, 16, 12), hm); h.position.y = 2.25; g.add(h);
  const bm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .10, depthWrite: false, depthTest: false });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.82, 1.2, 5, 8), bm); body.position.y = .95; g.add(body);
  const rank = b.rankPosition ? `#${b.rankPosition}` : '#?';
  const label = makeText(`${rank} ${b.name}`, { background: 'rgba(0,0,0,.32)', font: 'bold 19px sans-serif', scaleX: 7.2, scaleY: 1.35 });
  label.position.y = 4.1; g.add(label);
  spectatorLayer.add(g); return g;
}
function updateSpectators(list = []) {
  const seen = new Set();
  list.forEach((b, i) => {
    const key = String(b.userId); seen.add(key);
    let o = spectatorObjects.get(key);
    if (!o) { o = createSpectator(b); spectatorObjects.set(key, o); }
    o.position.copy(spectatorPosition(i, list.length)); o.visible = true;
    const label = o.children[2]; if (label) label.material.opacity = key === data?.viewer?.publicId ? .72 : .52;
  });
  for (const [key, o] of spectatorObjects) if (!seen.has(key)) o.visible = false;
}

const projectileLayer = new THREE.Group(); scene.add(projectileLayer);
const projectileObjects = new Map();
const projectileMaterials = {
  A: new THREE.LineBasicMaterial({ color: 0xf4f4f4, transparent: true, opacity: .95 }),
  B: new THREE.LineBasicMaterial({ color: 0xbcbcbc, transparent: true, opacity: .95 }),
};
function updateProjectiles(projectiles = []) {
  const now = Date.now(); const seen = new Set();
  for (const p of projectiles) {
    const age = now - Number(p.at || 0), duration = Math.max(60, Number(p.duration || 140));
    if (age < -100 || age > duration + 120) continue;
    const key = String(p.id); seen.add(key);
    let obj = projectileObjects.get(key);
    if (!obj) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      obj = new THREE.Line(geo, projectileMaterials[p.from] || projectileMaterials.A); projectileLayer.add(obj); projectileObjects.set(key, obj);
    }
    const t = THREE.MathUtils.clamp(age / duration, 0, 1);
    obj.geometry.setFromPoints([new THREE.Vector3(p.x, 2.35, p.z), new THREE.Vector3(p.x + (p.toX - p.x) * t, 2.35, p.z + (p.toZ - p.z) * t)]);
    obj.visible = true;
  }
  for (const [key, obj] of projectileObjects) if (!seen.has(key)) { obj.geometry.dispose(); obj.visible = false; projectileObjects.delete(key); }
}

let data = null, camMode = 'auto', keys = Object.create(null), yaw = 0, pitch = -.25, pointerLocked = false;
const freePos = new THREE.Vector3(MAP.size.x / 2, 35, MAP.size.z / 2);
function setCam(mode) {
  camMode = mode;
  document.querySelectorAll('#cameraBar button').forEach(b => b.classList.toggle('active', b.dataset.cam === mode));
  if (mode === 'free') { freePos.copy(camera.position); yaw = camera.rotation.y; renderer.domElement.requestPointerLock?.(); }
  else if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
}
document.querySelectorAll('#cameraBar button').forEach(b => b.onclick = () => setCam(b.dataset.cam));
addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; if (e.code === 'Space') keys.space = true; if (e.key === '1') setCam('auto'); if (e.key === '2') setCam('A'); if (e.key === '3') setCam('B'); if (e.key === '4') setCam('overview'); if (e.key === '5') setCam('free'); });
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; if (e.code === 'Space') keys.space = false; });
renderer.domElement.addEventListener('click', () => { if (camMode === 'free' && document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock?.(); });
document.addEventListener('pointerlockchange', () => { pointerLocked = document.pointerLockElement === renderer.domElement; document.body.classList.toggle('free-camera', pointerLocked && camMode === 'free'); });
document.addEventListener('mousemove', e => { if (camMode !== 'free' || !pointerLocked) return; yaw -= e.movementX * .0025; pitch -= e.movementY * .0022; pitch = THREE.MathUtils.clamp(pitch, -1.45, 1.45); });

function escapeHtml(v) { return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(ms) { const s = Math.max(0, Math.ceil(Number(ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function renderChat(list = []) {
  chatLog.innerHTML = list.map(m => {
    const rank = m.rankPosition ? `<span class="chatRank">#${m.rankPosition}</span>` : '';
    const image = m.image ? `<img class="chatImg" src="${escapeHtml(m.image)}" alt="imagem enviada" loading="lazy">` : '';
    return `<div class="chatMsg"><span class="chatName">${escapeHtml(m.name)}</span> ${rank}<div class="chatText">${escapeHtml(m.message || '')}</div>${image}</div>`;
  }).join('');
  chatLog.scrollTop = chatLog.scrollHeight;
}
function updateUI(d) {
  document.querySelector('#round').textContent = `ROUND ${d.round || 1}`;
  document.querySelector('#score').textContent = `${d.score?.A || 0} : ${d.score?.B || 0}`;
  const phase = d.status === 'betting' ? 'APOSTAS' : d.roundPhase === 'break' ? 'INTERVALO' : d.status === 'finished' ? 'FIM' : 'AO VIVO';
  document.querySelector('#phase').textContent = phase; if (connection) connection.textContent = phase;
  document.querySelector('#spectators').textContent = d.spectators || 0;
  document.querySelector('#poolA').textContent = new Intl.NumberFormat('pt-BR').format(d.pool?.A || 0);
  document.querySelector('#poolB').textContent = new Intl.NumberFormat('pt-BR').format(d.pool?.B || 0);
  for (const side of ['A', 'B']) {
    const f = d.fighters?.[side]; if (!f) continue;
    document.querySelector('#name' + side).textContent = f.name.toUpperCase();
    document.querySelector('#state' + side).textContent = (f.state || '').toUpperCase();
    document.querySelector('#hp' + side).style.width = `${Math.max(0, f.hp / Math.max(1, f.maxHp) * 100)}%`;
    document.querySelector('#armor' + side).textContent = `ARM ${f.armor}`;
    document.querySelector('#ammo' + side).textContent = `${f.ammo} / ${f.maxAmmo}`;
    botTargets[side].set(f.x, 0, f.z); botRotations[side] = f.rotation || 0; bots[side].visible = f.hp > 0;
  }
  document.querySelector('#timer').textContent = d.status === 'betting' ? fmt(d.bettingEndsAt - Date.now()) : d.roundPhase === 'live' ? fmt(d.roundEndsAt - Date.now()) : d.status === 'finished' ? 'FINAL' : 'INTERVALO';
  document.querySelector('#betting').textContent = d.status === 'betting' ? 'APOSTAS ABERTAS' : d.status === 'finished' ? 'ARENA ENCERRADA' : `POOL ${new Intl.NumberFormat('pt-BR').format((d.pool?.A || 0) + (d.pool?.B || 0))}`;
  const lines = (d.events || []).slice(-8).reverse();
  document.querySelector('#feed').innerHTML = lines.map(e => `<div class="event">${new Date(e.at).toLocaleTimeString()} — ${escapeHtml(e.text || '')}</div>`).join('');
  const c = (d.commentary || []).slice(-1)[0]; if (c) document.querySelector('#commentaryText').textContent = c.text;
  updateSpectators(d.bettors || []); updateProjectiles(d.projectiles || []); renderChat(d.chat || []);
  if (d.serverName) joinServer.textContent = `Servidor: ${d.serverName} · use o nome que está no ranking.`;
  if (d.joined) joinGate.style.display = 'none';
}

async function poll() {
  if (!id) return;
  try {
    const r = await fetch(api(), { cache: 'no-store' }); if (!r.ok) throw new Error(`API ${r.status}`);
    const p = await r.json(); if (!p.ok) throw new Error(p.error || 'API inválida'); data = p; updateUI(p);
  } catch (e) {
    console.warn('Arena API', e); document.querySelector('#phase').textContent = 'RECONECTANDO'; if (connection) connection.textContent = 'RECONECTANDO';
  }
  setTimeout(poll, 700);
}

joinButton.addEventListener('click', async () => {
  const name = joinName.value.trim();
  joinError.textContent = ''; joinRank.textContent = '';
  if (!name) { joinError.textContent = 'Digite o nome do player.'; return; }
  joinButton.disabled = true; joinButton.textContent = 'PROCURANDO NO RANK...';
  try {
    const r = await fetch(`${apiBase}/api/aposta/${encodeURIComponent(id)}/entrar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const p = await r.json();
    if (!r.ok || !p.ok) throw new Error(p.error || 'Player não encontrado.');
    viewer = p.viewerId; viewerName = p.viewer?.name || name;
    localStorage.setItem('carlos-arena-viewer', viewer); localStorage.setItem('carlos-arena-player', viewerName);
    joinRank.textContent = `Rank encontrado: #${p.viewer?.rankPosition || '?' } · ${p.viewer?.name || name}`;
    data = p; updateUI(p); joinGate.style.display = 'none';
  } catch (error) {
    joinError.textContent = error.message || 'Não foi possível entrar.';
  } finally {
    joinButton.disabled = false; joinButton.textContent = 'ENTRAR COMO ESPECTADOR';
  }
});

chatForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (!viewer) { joinGate.style.display = 'flex'; return; }
  let image = null;
  const file = chatFile.files?.[0];
  if (file) {
    if (file.size > 420 * 1024) { joinError.textContent = 'A imagem deve ter no máximo 420 KB.'; return; }
    image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  }
  const message = chatInput.value.trim(); if (!message && !image) return;
  try {
    const r = await fetch(`${apiBase}/api/aposta/${encodeURIComponent(id)}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewer, message, image }) });
    const p = await r.json(); if (!r.ok || !p.ok) throw new Error(p.error || 'Falha no chat.');
    renderChat(p.chat || []); chatInput.value = ''; chatFile.value = '';
  } catch (error) { console.warn('Arena chat', error); }
});

function targetFor() {
  if (!data) return CENTER;
  if (camMode === 'A') return bots.A.position.clone().add(new THREE.Vector3(0, 2, 0));
  if (camMode === 'B') return bots.B.position.clone().add(new THREE.Vector3(0, 2, 0));
  if (data.camera?.target === 'A') return bots.A.position.clone().add(new THREE.Vector3(0, 2, 0));
  if (data.camera?.target === 'B') return bots.B.position.clone().add(new THREE.Vector3(0, 2, 0));
  return CENTER;
}
function updateFreeCamera() {
  const speed = keys.shift ? 2.0 : .85;
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  if (keys.w) freePos.addScaledVector(forward, speed); if (keys.s) freePos.addScaledVector(forward, -speed);
  if (keys.d) freePos.addScaledVector(right, speed); if (keys.a) freePos.addScaledVector(right, -speed);
  if (keys.space) freePos.y += speed; if (keys.control) freePos.y -= speed;
  freePos.x = THREE.MathUtils.clamp(freePos.x, 5, MAP.size.x - 5); freePos.z = THREE.MathUtils.clamp(freePos.z, 5, MAP.size.z - 5); freePos.y = THREE.MathUtils.clamp(freePos.y, 2, 100);
  camera.position.lerp(freePos, .18);
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)); camera.lookAt(camera.position.clone().add(dir));
}
function animate() {
  requestAnimationFrame(animate);
  for (const side of ['A', 'B']) { bots[side].position.lerp(botTargets[side], .16); bots[side].rotation.y = THREE.MathUtils.lerp(bots[side].rotation.y, botRotations[side], .16); }
  if (camMode === 'free') updateFreeCamera();
  else { const t = targetFor(); if (camMode === 'overview' || (camMode === 'auto' && data?.camera?.target === 'overview')) { const desired = CENTER.clone().add(new THREE.Vector3(0, Math.max(62, MAP.size.x * .29), Math.max(12, MAP.size.z * .08))); camera.position.lerp(desired, .035); } else camera.position.lerp(t.clone().add(new THREE.Vector3(-13, 8, -13)), .06); camera.lookAt(t); }
  for (const o of spectatorLayer.children) { const label = o.children[2]; if (label) label.lookAt(camera.position); }
  renderer.render(scene, camera);
}
animate(); poll();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
