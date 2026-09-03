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
if (chatFile) chatFile.accept = 'image/*,audio/*,.mp3,.wav,.ogg,.webm';

joinGate.style.display = 'flex';
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
for (const w of MAP.walls) {
  const [x1, z1, x2, z2] = w;
  const wallH = Number(w[4]) || 4;
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(Math.abs(x2 - x1), .5), wallH, Math.max(Math.abs(z2 - z1), .5)), matWall); m.position.set((x1 + x2) / 2, wallH / 2, (z1 + z2) / 2); scene.add(m);
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

// Movimento de rede: o alvo do servidor nunca é aplicado instantaneamente.
// Cada atualização cria uma pequena janela de interpolação, eliminando o efeito de teleporte.
const botMotion = {
  A: { from: new THREE.Vector3(), to: new THREE.Vector3(), started: performance.now(), duration: 220 },
  B: { from: new THREE.Vector3(), to: new THREE.Vector3(), started: performance.now(), duration: 220 },
};
for (const side of ['A', 'B']) botMotion[side].from.copy(bots[side].position);

const supplyLayer = new THREE.Group(); scene.add(supplyLayer);
const supplyObjects = new Map();
function createSupplyObject(supply) {
  const g = new THREE.Group();
  if (supply.type === 'ammo') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.15, 1.8), new THREE.MeshStandardMaterial({ color: 0x344b38, roughness: .7 }));
    box.position.y = .65; g.add(box);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.72, .18, 1.92), new THREE.MeshStandardMaterial({ color: 0xd3a22c, roughness: .55 }));
    stripe.position.y = 1.24; g.add(stripe);
    const label = makeText('MUNIÇÃO', { background: 'rgba(0,0,0,.55)', font: 'bold 16px sans-serif', scaleX: 5.5, scaleY: 1.1 });
    label.position.y = 2.8; g.add(label);
  } else {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, .22, 8, 24), new THREE.MeshStandardMaterial({ color: 0x62b8ff, emissive: 0x1d4f77, emissiveIntensity: .7, roughness: .3 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 1.1; g.add(ring);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(.72, .72, .18, 24), new THREE.MeshStandardMaterial({ color: 0x8bd0ff, emissive: 0x2c719f, emissiveIntensity: .9, roughness: .25 }));
    core.position.y = .2; g.add(core);
    const label = makeText('ESCUDO', { background: 'rgba(0,0,0,.55)', font: 'bold 16px sans-serif', scaleX: 4.7, scaleY: 1.1 });
    label.position.y = 2.8; g.add(label);
  }
  supplyLayer.add(g); return g;
}
function updateSupplies(list = []) {
  const seen = new Set();
  for (const s of list) {
    if (!s?.active) continue;
    const key = String(s.id); seen.add(key);
    let o = supplyObjects.get(key);
    if (!o) { o = createSupplyObject(s); supplyObjects.set(key, o); }
    o.position.set(Number(s.x) || 0, 0, Number(s.z) || 0);
    o.visible = true;
    o.rotation.y += .008;
  }
  for (const [key, o] of supplyObjects) if (!seen.has(key)) o.visible = false;
}

function createArenaHud() {
  const style = document.createElement('style');
  style.textContent = `
    #arenaHud{position:fixed;inset:0;pointer-events:none;font-family:Inter,system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000}
    #arenaTop{position:absolute;top:18px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:16px;background:rgba(8,10,14,.82);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:10px 18px;backdrop-filter:blur(10px);box-shadow:0 10px 30px rgba(0,0,0,.3)}
    #arenaScore{font-size:26px;font-weight:900;letter-spacing:2px} #arenaTimer{font-size:14px;font-weight:800;opacity:.8}
    .arenaCard{position:absolute;top:92px;width:285px;background:rgba(9,12,16,.84);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px 14px;backdrop-filter:blur(9px);box-shadow:0 12px 28px rgba(0,0,0,.25)}
    .arenaCard.a{left:18px}.arenaCard.b{right:18px}.arenaName{font-weight:900;font-size:16px;letter-spacing:1px}.arenaState{float:right;font-size:10px;opacity:.65;margin-top:4px}.arenaBar{height:7px;background:#252a30;border-radius:8px;overflow:hidden;margin:8px 0}.arenaHp{height:100%;width:100%;background:linear-gradient(90deg,#e6e6e6,#8d8d8d);transition:width .15s}.arenaStats{display:flex;justify-content:space-between;font-size:12px;opacity:.9}.arenaAmmo{font-size:20px;font-weight:900;margin-top:6px}.arenaSub{font-size:10px;opacity:.62}
    #arenaSupplies{position:absolute;left:18px;bottom:18px;background:rgba(9,12,16,.78);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:9px 12px;font-size:11px;min-width:180px}.supplyRow{display:flex;justify-content:space-between;gap:18px;margin:3px 0}.supplyRow b{font-weight:900}
    #arenaMoment{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);background:rgba(9,12,16,.82);border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:8px 16px;font-size:12px;max-width:min(70vw,720px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  `;
  document.head.appendChild(style);
  const hud = document.createElement('div'); hud.id = 'arenaHud';
  hud.innerHTML = `<div id="arenaTop"><span id="arenaPhase">AO VIVO</span><span id="arenaScore">0 : 0</span><span id="arenaTimer">--</span></div>
    <div class="arenaCard a"><span id="arenaNameA" class="arenaName">RUBI</span><span id="arenaStateA" class="arenaState">MOVING</span><div class="arenaBar"><div id="arenaHpA" class="arenaHp"></div></div><div class="arenaStats"><span id="arenaArmorA">🛡 100</span><span id="arenaKillsA">☠ 0</span></div><div id="arenaAmmoA" class="arenaAmmo">3 / 9</div><div class="arenaSub">MUNIÇÃO NO PENTE / RESERVA</div></div>
    <div class="arenaCard b"><span id="arenaNameB" class="arenaName">TROVÃO</span><span id="arenaStateB" class="arenaState">MOVING</span><div class="arenaBar"><div id="arenaHpB" class="arenaHp"></div></div><div class="arenaStats"><span id="arenaArmorB">🛡 100</span><span id="arenaKillsB">☠ 0</span></div><div id="arenaAmmoB" class="arenaAmmo">3 / 9</div><div class="arenaSub">MUNIÇÃO NO PENTE / RESERVA</div></div>
    <div id="arenaSupplies"><b>SUPRIMENTOS</b><div class="supplyRow"><span>📦 Munição</span><b id="arenaAmmoBox">ATIVA</b></div><div class="supplyRow"><span>🛡 Escudo</span><b id="arenaShieldBox">ATIVO</b></div></div>
    <div id="arenaMoment">Aguardando combate...</div>`;
  document.body.appendChild(hud);
}
createArenaHud();

const spectatorLayer = new THREE.Group(); scene.add(spectatorLayer);
const spectatorObjects = new Map();
function spectatorPosition(index, total) {
  const t = total <= 1 ? .5 : index / (total - 1);
  return new THREE.Vector3(12 + t * (MAP.size.x - 24), .05, index % 2 ? MAP.size.z - 10 : 10);
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
    const target = Number.isFinite(Number(b.x)) && Number.isFinite(Number(b.z)) ? new THREE.Vector3(Number(b.x), Number.isFinite(Number(b.y)) ? Number(b.y) : .05, Number(b.z)) : spectatorPosition(i, list.length);
    o.userData.target = target; o.userData.rotation = Number(b.rotation || 0); o.visible = true;
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

const audioCache = new Map();
const playedSoundIds = new Set();
const pendingArenaSounds = [];
let audioUnlocked = false;
let audioContext = null;

function getArenaAudioContext() {
  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    return audioContext;
  } catch { return null; }
}

function normalizeArenaAudioUrl(raw) {
  const url = String(raw || '').trim();
  if (!url.startsWith('data:')) return url;
  // Alguns uploads chegam como data:audio/mpeg, mas o conteúdo é Ogg/Vorbis
  // (começa com "OggS"). Corrige o MIME antes do HTMLAudio tentar tocar.
  if (/^data:audio\/mpeg[;,]/i.test(url) && /;base64,T2dnUw/i.test(url)) {
    return url.replace(/^data:audio\/mpeg/i, 'data:audio/ogg');
  }
  return url;
}

function unlockArenaAudio() {
  const ctx = getArenaAudioContext();
  const resume = ctx?.resume ? ctx.resume().catch(() => {}) : Promise.resolve();
  Promise.resolve(resume).then(() => {
    const probe = new Audio();
    probe.volume = 0;
    probe.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
    return probe.play().then(() => {
      probe.pause();
      audioUnlocked = true;
      const pending = pendingArenaSounds.splice(0);
      for (const sound of pending) playArenaSound(sound, true);
    }).catch(() => {
      // Continua bloqueado; o próximo clique/touch tenta novamente.
    });
  });
}
addEventListener('pointerdown', unlockArenaAudio, { passive: true });
addEventListener('keydown', unlockArenaAudio, { passive: true });

function playArenaSound(sound, fromQueue = false) {
  const rawUrl = String(sound?.url || '').trim();
  const url = normalizeArenaAudioUrl(rawUrl);
  if (!url || playedSoundIds.has(sound.id)) return;
  if (!audioUnlocked && !fromQueue) {
    if (pendingArenaSounds.length < 40) pendingArenaSounds.push({ ...sound, url });
    return;
  }
  playedSoundIds.add(sound.id);
  if (playedSoundIds.size > 300) playedSoundIds.delete(playedSoundIds.values().next().value);
  let a = audioCache.get(url);
  if (!a) {
    a = new Audio();
    a.preload = 'auto';
    a.src = url;
    a.crossOrigin = 'anonymous';
    audioCache.set(url, a);
  }
  a.pause(); a.currentTime = 0;
  a.volume = THREE.MathUtils.clamp(Number(sound.volume ?? .85), 0, 1);
  a.playbackRate = THREE.MathUtils.clamp(Number(sound.pitch ?? 1), .96, 1.04);
  const promise = a.play();
  if (promise?.catch) promise.catch(err => {
    // Se o navegador ainda considerar autoplay bloqueado, devolve o evento à fila.
    playedSoundIds.delete(sound.id);
    if (!audioUnlocked && pendingArenaSounds.length < 40) pendingArenaSounds.push({ ...sound, url });
    console.debug('Arena sound não reproduzido:', err?.message || err);
  });
}
function processSoundEvents(list = [], soundboard = {}) {
  for (const e of list) {
    // Eventos do motor podem chegar antes do /?media=1. Quando houver URL no
    // próprio evento, toca imediatamente; caso contrário espera o soundboard.
    const sb = soundboard[e.name];
    const url = sb?.url || e.url;
    if (url) playArenaSound({ ...e, url });
  }
}

const boardLayer = new THREE.Group(); scene.add(boardLayer);
const boardObjects = new Map();
function createWorldBoard(b) {
  const group = new THREE.Group();
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 5.5), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  group.add(plane); group.userData.started = performance.now(); group.userData.finalX = Number.isFinite(Number(b.x)) ? Number(b.x) : CENTER.x; group.userData.finalZ = Number.isFinite(Number(b.z)) ? Number(b.z) : CENTER.z;
  group.userData.finalY = Number.isFinite(Number(b.y)) ? Math.max(0.25, Number(b.y)) : 2.0;
  group.position.set(group.userData.finalX, group.userData.finalY + 4.5, group.userData.finalZ); group.rotation.x = 0;
  const texture = new THREE.TextureLoader().load(b.image, t => { t.colorSpace = THREE.SRGBColorSpace; plane.material.map = t; plane.material.needsUpdate = true; });
  plane.material.map = texture; boardLayer.add(group); return group;
}
function updateWorldBoards(list = []) {
  const seen = new Set();
  for (const b of list) {
    if (!b?.id || !b.image) continue; seen.add(String(b.id));
    let o = boardObjects.get(String(b.id)); if (!o) { o = createWorldBoard(b); boardObjects.set(String(b.id), o); }
    const age = Math.max(0, performance.now() - Number(b.at || Date.now()));
    const t = THREE.MathUtils.clamp(age / 650, 0, 1); const eased = 1 - Math.pow(1 - t, 3);
    const finalY = Number.isFinite(Number(b.y)) ? Math.max(0.25, Number(b.y)) : 2.0;
    o.userData.finalY = finalY;
    // Cai alguns metros e para no chão; nunca continua descendo para o void.
    o.position.y = finalY + 4.5 * (1 - eased);
    o.rotation.x = 0;
    o.position.x = Number.isFinite(Number(b.x)) ? Number(b.x) : CENTER.x;
    o.position.z = Number.isFinite(Number(b.z)) ? Number(b.z) : CENTER.z;
  }
  // Respostas normais da API podem trazer boards sem a imagem para economizar banda.
  // Nesse caso NÃO remova os boards que já estão renderizados.
  if (list.some(b => b?.image)) {
    for (const [id, o] of boardObjects) if (!seen.has(id)) { o.traverse(n => { if (n.material?.map) n.material.map.dispose?.(); n.geometry?.dispose?.(); }); boardLayer.remove(o); boardObjects.delete(id); }
  }
}

let mediaRevision = -1, mediaLoaded = false, mediaSeq = 0;
let data = null, camMode = 'auto', keys = Object.create(null), yaw = 0, pitch = -.25, pointerLocked = false;
let viewerPositionSynced = false;
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
    const audio = m.audioName ? `<div class="chatAudio">🔊 soundboard: ${escapeHtml(m.audioName)}</div>` : '';
    return `<div class="chatMsg"><span class="chatName">${escapeHtml(m.name)}</span> ${rank}<div class="chatText">${escapeHtml(m.message || '')}</div>${image}${audio}</div>`;
  }).join('');
  chatLog.scrollTop = chatLog.scrollHeight;
}
async function refreshArenaMedia(revision) {
  if (!id || revision === mediaRevision) return;
  try {
    const r = await fetch(`${apiBase}/api/aposta/${encodeURIComponent(id)}?viewer=${encodeURIComponent(viewer || '')}&media=1`, { cache: 'no-store' });
    const p = await r.json();
    if (r.ok && p.ok) {
      mediaRevision = Number(p.mediaRevision ?? revision);
      if (data) { data.soundboard = p.soundboard || {}; data.worldBoards = p.worldBoards || []; }
      mediaLoaded = true;
    }
  } catch {}
}

function processMediaEvents(events = []) {
  for (const e of events) {
    const seq = Number(e.seq || 0);
    if (seq <= mediaSeq) continue;
    mediaSeq = Math.max(mediaSeq, seq);
    if (e.type === 'sound') {
      data = data || {};
      data.soundboard = data.soundboard || {};
      data.soundboard[e.name] = { name: e.name, url: e.url, owner: e.owner };
      playArenaSound({ id: `media-${seq}`, name: e.name, url: e.url, pitch: 1, volume: .9 });
    } else if (e.type === 'board') {
      data = data || {};
      data.worldBoards = data.worldBoards || [];
      updateWorldBoards([...data.worldBoards.filter(b => b.id !== e.id), e]);
    }
  }
}

function updateUI(d) {
  document.querySelector('#round').textContent = `ROUND ${d.round || 1}`;
  document.querySelector('#score').textContent = `${d.score?.A || 0} : ${d.score?.B || 0}`;
  const phase = d.status === 'betting' ? 'APOSTAS' : d.roundPhase === 'break' ? 'INTERVALO' : d.status === 'finished' ? 'FIM' : 'AO VIVO';
  document.querySelector('#phase').textContent = phase; if (connection) connection.textContent = phase;
  if (d.mediaRevision !== mediaRevision) void refreshArenaMedia(Number(d.mediaRevision || 0));
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
    const motion = botMotion[side];
    motion.from.copy(bots[side].position);
    motion.to.set(Number(f.x) || 0, 0, Number(f.z) || 0);
    motion.started = performance.now();
    motion.duration = Math.max(180, Math.min(260, Number(d.snapshot?.at ? Date.now() - d.snapshot.at : 0) + 180));
    botTargets[side].copy(motion.to); botRotations[side] = f.rotation || 0; bots[side].visible = f.hp > 0;
    const hudSide = side;
    document.querySelector('#arenaName' + hudSide).textContent = f.name.toUpperCase();
    document.querySelector('#arenaState' + hudSide).textContent = String(f.state || 'moving').replaceAll('-', ' ').toUpperCase();
    document.querySelector('#arenaHp' + hudSide).style.width = `${Math.max(0, f.hp / Math.max(1, f.maxHp) * 100)}%`;
    document.querySelector('#arenaArmor' + hudSide).textContent = `🛡 ${Math.round(f.armor || 0)}`;
    document.querySelector('#arenaKills' + hudSide).textContent = `☠ ${f.kills || 0}`;
    document.querySelector('#arenaAmmo' + hudSide).textContent = `${f.ammo} / ${f.reserveAmmo ?? 0}`;
  }
  document.querySelector('#timer').textContent = d.status === 'betting' ? fmt(d.bettingEndsAt - Date.now()) : d.roundPhase === 'live' ? fmt(d.roundEndsAt - Date.now()) : d.status === 'finished' ? 'FINAL' : 'INTERVALO';
  document.querySelector('#betting').textContent = d.status === 'betting' ? 'APOSTAS ABERTAS' : d.status === 'finished' ? 'ARENA ENCERRADA' : `POOL ${new Intl.NumberFormat('pt-BR').format((d.pool?.A || 0) + (d.pool?.B || 0))}`;
  const lines = (d.events || []).slice(-8).reverse();
  document.querySelector('#arenaScore').textContent = `${d.score?.A || 0} : ${d.score?.B || 0}`;
  document.querySelector('#arenaPhase').textContent = phase;
  document.querySelector('#arenaTimer').textContent = document.querySelector('#timer').textContent;
  const ammoSupply = (d.supplies || []).find(s => s.type === 'ammo');
  const shieldSupply = (d.supplies || []).find(s => s.type === 'shield');
  document.querySelector('#arenaAmmoBox').textContent = ammoSupply?.active ? 'ATIVA' : 'PEGARAM';
  document.querySelector('#arenaShieldBox').textContent = shieldSupply?.active ? 'ATIVO' : 'PEGARAM';
  const latestArenaEvent = (d.events || []).slice(-1)[0];
  if (latestArenaEvent?.text) document.querySelector('#arenaMoment').textContent = latestArenaEvent.text;
  document.querySelector('#feed').innerHTML = lines.map(e => `<div class="event">${new Date(e.at).toLocaleTimeString()} — ${escapeHtml(e.text || '')}</div>`).join('');
  const c = (d.commentary || []).slice(-1)[0]; if (c) document.querySelector('#commentaryText').textContent = c.text;
  updateSpectators(d.bettors || []); updateProjectiles(d.projectiles || []); updateSupplies(d.supplies || []); processSoundEvents(d.soundEvents || [], data?.soundboard || d.soundboard || {});
  if (Array.isArray(d.worldBoards) && d.worldBoards.some(b => b?.image)) updateWorldBoards(d.worldBoards);
  if (d.viewer?.publicId && !viewerPositionSynced) {
    const vx = Number(d.viewer.x), vy = Number(d.viewer.y), vz = Number(d.viewer.z);
    if (Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz)) {
      freePos.set(vx, Math.max(2, vy + 1.7), vz);
      camera.position.copy(freePos);
      viewerPositionSynced = true;
    }
  }
  renderChat(d.chat || []);
  if (d.serverName) joinServer.textContent = `Servidor: ${d.serverName} · use o nome que está no ranking.`;
  if (d.joined) joinGate.style.display = 'none';
  else joinGate.style.display = 'flex';
}

async function poll() {
  if (!id) return;
  try {
    const r = await fetch(`${api()}&mediaSince=${encodeURIComponent(mediaSeq)}`, { cache: 'no-store' }); if (!r.ok) throw new Error(`API ${r.status}`);
    const p = await r.json(); if (!p.ok) throw new Error(p.error || 'API inválida'); data = p; processMediaEvents(p.mediaEvents || []); updateUI(p);
  } catch (e) {
    console.warn('Arena API', e); document.querySelector('#phase').textContent = 'RECONECTANDO'; if (connection) connection.textContent = 'RECONECTANDO';
  }
  setTimeout(poll, 180);
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
    if (p.viewer) {
      const vx = Number(p.viewer.x), vy = Number(p.viewer.y), vz = Number(p.viewer.z);
      if (Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz)) {
        freePos.set(vx, Math.max(2, vy + 1.7), vz);
        camera.position.copy(freePos);
        viewerPositionSynced = true;
      }
    }
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
  let audio = null, audioName = '';
  if (file) {
    if (file.size > 900 * 1024) { joinError.textContent = 'A mídia deve ter no máximo 900 KB.'; return; }
    const reader = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
    if (/^audio\//i.test(file.type) || /\.(mp3|wav|ogg|webm)$/i.test(file.name)) { audio = reader; audioName = file.name; }
    else if (/^image\//i.test(file.type) || /\.(png|jpe?g|gif|webp)$/i.test(file.name)) image = reader;
    else { joinError.textContent = 'Use uma imagem ou MP3/WAV/OGG.'; return; }
  }
  if (chatFile) chatFile.accept = 'image/*,audio/*,.mp3,.wav,.ogg,.webm';
  const message = chatInput.value.trim(); if (!message && !image && !audio) return;
  try {
    const r = await fetch(`${apiBase}/api/aposta/${encodeURIComponent(id)}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewer, message, image, audio, audioName }) });
    const p = await r.json(); if (!r.ok || !p.ok) throw new Error(p.error || 'Falha no chat.');
    renderChat(p.chat || []);
    processMediaEvents(p.mediaEvents || []);
    if (Array.isArray(p.soundEvents)) processSoundEvents(p.soundEvents, data?.soundboard || {});
    if (Array.isArray(p.worldBoards)) updateWorldBoards(p.worldBoards);
    if (p.mediaRevision != null && Number(p.mediaRevision) !== mediaRevision) void refreshArenaMedia(Number(p.mediaRevision));
    chatInput.value = ''; chatFile.value = '';
  } catch (error) { console.warn('Arena chat', error); }
});

let lastSpectatorSend = 0;
function syncSpectatorMovement(now) {
  if (!viewer || camMode !== 'free' || now - lastSpectatorSend < 80) return;
  lastSpectatorSend = now;
  const feetY = Math.max(0, freePos.y - 1.7);
  fetch(`${apiBase}/api/aposta/${encodeURIComponent(id)}/mover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ viewer, x: freePos.x, y: feetY, z: freePos.z, rotation: yaw }) }).catch(() => {});
  // Não espere o próximo poll para mover o boneco local.
  const me = spectatorObjects.get(String(data?.viewer?.publicId || ''));
  if (me) {
    me.userData.target = new THREE.Vector3(freePos.x, feetY, freePos.z);
    me.userData.rotation = yaw;
  }
}

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
  if (keys.a) freePos.addScaledVector(right, speed); if (keys.d) freePos.addScaledVector(right, -speed);
  if (keys.space) freePos.y += speed; if (keys.control) freePos.y -= speed;
  freePos.x = THREE.MathUtils.clamp(freePos.x, 5, MAP.size.x - 5); freePos.z = THREE.MathUtils.clamp(freePos.z, 5, MAP.size.z - 5); freePos.y = THREE.MathUtils.clamp(freePos.y, 2, 100);
  camera.position.lerp(freePos, .18);
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)); camera.lookAt(camera.position.clone().add(dir));
  const me = spectatorObjects.get(String(data?.viewer?.publicId || ''));
  if (me) { me.userData.target = new THREE.Vector3(freePos.x, Math.max(0, freePos.y - 1.7), freePos.z); me.userData.rotation = yaw; }
}
function animate() {
  requestAnimationFrame(animate);
  for (const side of ['A', 'B']) { const m = botMotion[side]; const alpha = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp((performance.now() - m.started) / m.duration, 0, 1), 0, 1); bots[side].position.lerpVectors(m.from, m.to, alpha); bots[side].rotation.y = THREE.MathUtils.lerp(bots[side].rotation.y, botRotations[side], .12); }
  for (const o of spectatorLayer.children) { if (o.userData.target) { o.position.lerp(o.userData.target, .22); o.rotation.y = THREE.MathUtils.lerp(o.rotation.y, Number(o.userData.rotation || 0), .22); } }
  if (camMode === 'free') { updateFreeCamera(); syncSpectatorMovement(performance.now()); }
  else { const t = targetFor(); if (camMode === 'overview' || (camMode === 'auto' && data?.camera?.target === 'overview')) { const desired = CENTER.clone().add(new THREE.Vector3(0, Math.max(62, MAP.size.x * .29), Math.max(12, MAP.size.z * .08))); camera.position.lerp(desired, .035); } else camera.position.lerp(t.clone().add(new THREE.Vector3(-13, 8, -13)), .06); camera.lookAt(t); }
  for (const o of spectatorLayer.children) { const label = o.children[2]; if (label) label.lookAt(camera.position); }
  renderer.render(scene, camera);
}
animate(); poll();
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
