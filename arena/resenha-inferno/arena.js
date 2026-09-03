import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

const qs = new URLSearchParams(location.search);
const id = qs.get('id') || location.pathname.split('/').filter(Boolean).pop();
const apiBase = (window.ARENA_API_BASE || 'https://carlos-4rxr.onrender.com').replace(/\/$/, '');
const ASSET_BASE = (window.CARLOS_ASSET_BASE || new URL('.', location.href).href).replace(/\/$/, '');
let viewer = localStorage.getItem('carlos-arena-viewer');
if (!viewer) { viewer = Math.random().toString(36).slice(2); localStorage.setItem('carlos-arena-viewer', viewer); }
const api = () => `${apiBase}/api/aposta/${encodeURIComponent(id)}?viewer=${encodeURIComponent(viewer)}`;

const viewport = document.querySelector('#viewport');
const connection = document.querySelector('#connection');
const MAP = await fetch(`${ASSET_BASE}/map.json`, { cache: 'no-store' }).then(r => {
  if (!r.ok) throw new Error(`map.json ${r.status}`);
  return r.json();
});
const CENTER = new THREE.Vector3(MAP.size.x / 2, 0, MAP.size.z / 2);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080b0f);
scene.fog = new THREE.Fog(0x080b0f, 70, Math.max(MAP.size.x, MAP.size.z) * 1.15);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, Math.max(400, MAP.size.x * 2));
camera.position.set(CENTER.x, 42, CENTER.z);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
viewport.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xdde5ff, 0x22210f, 2.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(60, 100, 30); scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP.size.x, MAP.size.z), new THREE.MeshStandardMaterial({ color: 0x394038, roughness: .95 }));
ground.rotation.x = -Math.PI / 2; ground.position.copy(CENTER); scene.add(ground);
const grid = new THREE.GridHelper(Math.max(MAP.size.x, MAP.size.z), Math.round(Math.max(MAP.size.x, MAP.size.z) / 5), 0x526052, 0x263026);
grid.position.copy(CENTER); grid.position.y = .02; grid.material.opacity = .24; grid.material.transparent = true; scene.add(grid);

const matWall = new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: .9 });
const matCover = new THREE.MeshStandardMaterial({ color: 0x7b6b52, roughness: .8 });
const matSite = new THREE.MeshStandardMaterial({ color: 0x8d774d, roughness: .9 });
for (const [x1,z1,x2,z2] of MAP.walls) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(Math.abs(x2-x1), .5), 4, Math.max(Math.abs(z2-z1), .5)), matWall);
  m.position.set((x1+x2)/2, 2, (z1+z2)/2); scene.add(m);
}
for (const c of MAP.cover) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(c.w,c.h,c.d), matCover);
  m.position.set(c.x,c.h/2,c.z); scene.add(m);
}

function makeText(text, opts = {}) {
  const c = document.createElement('canvas'); c.width = opts.width || 256; c.height = opts.height || 80;
  const x = c.getContext('2d'); x.clearRect(0,0,c.width,c.height);
  if (opts.background) { x.fillStyle = opts.background; x.fillRect(0,0,c.width,c.height); }
  x.fillStyle = opts.color || '#fff'; x.font = opts.font || 'bold 28px sans-serif'; x.textAlign='center'; x.textBaseline='middle';
  x.fillText(text, c.width/2, c.height/2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map:t, transparent:true, depthWrite:false }));
  s.scale.set(opts.scaleX || 6, opts.scaleY || 1.8, 1); return s;
}
for (const [side,p] of Object.entries(MAP.sites)) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(5,5,.08,32), matSite); m.position.set(p.x,.06,p.z); scene.add(m);
  const label = makeText(side, { background:'rgba(0,0,0,.55)', scaleX:4.5, scaleY:1.8 }); label.position.set(p.x,5,p.z); scene.add(label);
}

const bots = { A:null, B:null };
function makeBot(side) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color:side==='A'?0xeeeeee:0x999999, roughness:.55 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.15,1.7,6,12), mat); body.position.y=2; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.75,16,12), mat); head.position.y=3.8; g.add(head);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(.3,.3,2.4), new THREE.MeshStandardMaterial({color:0x17191c,metalness:.5})); gun.position.set(0,2.3,1.25); g.add(gun);
  scene.add(g); return g;
}
bots.A = makeBot('A'); bots.B = makeBot('B');

const spectatorLayer = new THREE.Group(); scene.add(spectatorLayer);
const spectatorObjects = new Map();
function spectatorPosition(index,total) {
  const t = total <= 1 ? .5 : index/(total-1);
  return new THREE.Vector3(10 + t*(MAP.size.x-20), .05, index%2 ? MAP.size.z-7 : 7);
}
function createSpectator(b) {
  const g = new THREE.Group();
  const hm = new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.32,depthWrite:false});
  const h = new THREE.Mesh(new THREE.SphereGeometry(.72,16,12),hm); h.position.y=2.25; g.add(h);
  const bm = new THREE.MeshBasicMaterial({color:b.side==='A'?0xdedede:0x9d9d9d,transparent:true,opacity:.12,depthWrite:false});
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.82,1.2,5,8),bm); body.position.y=.95; g.add(body);
  const rank = b.rankPosition ? `#${b.rankPosition}` : '#?'; const label=makeText(`${rank} ${b.name}`,{background:'rgba(0,0,0,.35)',font:'bold 20px sans-serif',scaleX:6.2,scaleY:1.35}); label.position.y=4.1; g.add(label);
  spectatorLayer.add(g); return g;
}
function updateSpectators(list=[]) {
  const seen=new Set(); list.forEach((b,i)=>{const k=String(b.userId);seen.add(k);let o=spectatorObjects.get(k);if(!o){o=createSpectator(b);spectatorObjects.set(k,o)}o.position.copy(spectatorPosition(i,list.length));o.visible=true});
  for(const [k,o] of spectatorObjects) if(!seen.has(k)) o.visible=false;
}

const projectileLayer = new THREE.Group(); scene.add(projectileLayer);
const projectileObjects = new Map();
const projectileMaterials = {
  A: new THREE.LineBasicMaterial({color:0xf4f4f4,transparent:true,opacity:.9}),
  B: new THREE.LineBasicMaterial({color:0xbcbcbc,transparent:true,opacity:.9}),
};
function updateProjectiles(projectiles=[]) {
  const now=Date.now(); const seen=new Set();
  for(const p of projectiles){
    const age=now-Number(p.at||0), duration=Math.max(60,Number(p.duration||140));
    if(age < -100 || age > duration+120) continue;
    seen.add(String(p.id));
    let obj=projectileObjects.get(String(p.id));
    if(!obj){
      const geo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]);
      obj=new THREE.Line(geo,projectileMaterials[p.from]||projectileMaterials.A); projectileLayer.add(obj); projectileObjects.set(String(p.id),obj);
    }
    const t=THREE.MathUtils.clamp(age/duration,0,1);
    const sx=p.x, sz=p.z, ex=p.toX, ez=p.toZ;
    obj.geometry.setFromPoints([new THREE.Vector3(sx,2.35,sz),new THREE.Vector3(sx+(ex-sx)*t,2.35,sz+(ez-sz)*t)]);
    obj.visible=true;
  }
  for(const [k,o] of projectileObjects){if(!seen.has(k)){o.geometry.dispose();o.visible=false;projectileObjects.delete(k)}}
}

let data=null, camMode='auto', keys=Object.create(null);
let yaw=0, pitch=-.25;
const freePos=new THREE.Vector3(MAP.spawns.A.x,18,MAP.spawns.A.z);
let pointerLocked=false;
function setCam(mode){
  camMode=mode; document.querySelectorAll('#cameraBar button').forEach(b=>b.classList.toggle('active',b.dataset.cam===mode));
  if(mode==='free'){freePos.copy(camera.position); yaw=camera.rotation.y; if(renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock();}
  else if(document.pointerLockElement===renderer.domElement) document.exitPointerLock();
}
document.querySelectorAll('#cameraBar button').forEach(b=>b.onclick=()=>setCam(b.dataset.cam));
addEventListener('keydown',e=>{keys[e.key.toLowerCase()]=true;if(e.code==='Space')keys.space=true;if(e.key==='1')setCam('auto');if(e.key==='2')setCam('A');if(e.key==='3')setCam('B');if(e.key==='4')setCam('overview');if(e.key==='5')setCam('free')});
addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;if(e.code==='Space')keys.space=false});
renderer.domElement.addEventListener('click',()=>{if(camMode==='free'&&document.pointerLockElement!==renderer.domElement)renderer.domElement.requestPointerLock?.()});
document.addEventListener('pointerlockchange',()=>{pointerLocked=document.pointerLockElement===renderer.domElement;document.body.classList.toggle('free-camera',pointerLocked&&camMode==='free')});
document.addEventListener('mousemove',e=>{if(camMode!=='free'||!pointerLocked)return;yaw-=e.movementX*.0025;pitch-=e.movementY*.0022;pitch=THREE.MathUtils.clamp(pitch,-1.45,1.45)});

function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmt(ms){let s=Math.max(0,Math.ceil(Number(ms||0)/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}
function updateUI(d){
  document.querySelector('#round').textContent=`ROUND ${d.round||1}`;document.querySelector('#score').textContent=`${d.score?.A||0} : ${d.score?.B||0}`;
  const phase=d.status==='betting'?'APOSTAS':d.roundPhase==='break'?'INTERVALO':d.status==='finished'?'FIM':'AO VIVO';document.querySelector('#phase').textContent=phase;if(connection)connection.textContent=phase;
  document.querySelector('#spectators').textContent=d.spectators||0;document.querySelector('#poolA').textContent=new Intl.NumberFormat('pt-BR').format(d.pool?.A||0);document.querySelector('#poolB').textContent=new Intl.NumberFormat('pt-BR').format(d.pool?.B||0);
  for(const s of ['A','B']){const f=d.fighters?.[s];if(!f)continue;document.querySelector('#name'+s).textContent=f.name.toUpperCase();document.querySelector('#state'+s).textContent=(f.state||'').toUpperCase();document.querySelector('#hp'+s).style.width=`${Math.max(0,f.hp/Math.max(1,f.maxHp)*100)}%`;document.querySelector('#armor'+s).textContent=`ARM ${f.armor}`;document.querySelector('#ammo'+s).textContent=`${f.ammo} / ${f.maxAmmo}`;bots[s].position.set(f.x,0,f.z);bots[s].rotation.y=f.rotation||0;bots[s].visible=f.hp>0}
  document.querySelector('#timer').textContent=d.status==='betting'?fmt(d.bettingEndsAt-Date.now()):d.roundPhase==='live'?fmt(d.roundEndsAt-Date.now()):d.status==='finished'?'FINAL':'INTERVALO';document.querySelector('#betting').textContent=d.status==='betting'?'APOSTAS ABERTAS':d.status==='finished'?'ARENA ENCERRADA':`POOL ${new Intl.NumberFormat('pt-BR').format((d.pool?.A||0)+(d.pool?.B||0))}`;
  const lines=(d.events||[]).slice(-8).reverse();document.querySelector('#feed').innerHTML=lines.map(e=>`<div class="event">${new Date(e.at).toLocaleTimeString()} — ${escapeHtml(e.text||'')}</div>`).join('');const c=(d.commentary||[]).slice(-1)[0];if(c)document.querySelector('#commentaryText').textContent=c.text;updateSpectators(d.bettors||[]);updateProjectiles(d.projectiles||[]);
}
async function poll(){if(!id)return;try{const r=await fetch(api(),{cache:'no-store'});if(!r.ok)throw new Error(`API ${r.status}`);const p=await r.json();if(!p.ok)throw new Error(p.error||'API inválida');data=p;updateUI(p)}catch(e){console.warn('Arena API',e);document.querySelector('#phase').textContent='RECONECTANDO';if(connection)connection.textContent='RECONECTANDO'}setTimeout(poll,700)}poll();

function targetFor(){if(!data)return CENTER;if(camMode==='A')return bots.A.position.clone().add(new THREE.Vector3(0,2,0));if(camMode==='B')return bots.B.position.clone().add(new THREE.Vector3(0,2,0));return data.camera?.target==='A'?bots.A.position.clone().add(new THREE.Vector3(0,2,0)):data.camera?.target==='B'?bots.B.position.clone().add(new THREE.Vector3(0,2,0)):CENTER}
function updateFreeCamera(){const speed=keys.shift?1.7:.75;const forward=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw));const right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));if(keys.w)freePos.addScaledVector(forward,speed);if(keys.s)freePos.addScaledVector(forward,-speed);if(keys.d)freePos.addScaledVector(right,speed);if(keys.a)freePos.addScaledVector(right,-speed);if(keys.space)freePos.y+=speed;if(keys.control)freePos.y-=speed;freePos.x=THREE.MathUtils.clamp(freePos.x,3,MAP.size.x-3);freePos.z=THREE.MathUtils.clamp(freePos.z,3,MAP.size.z-3);freePos.y=THREE.MathUtils.clamp(freePos.y,2,80);camera.position.lerp(freePos,.18);const dir=new THREE.Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));camera.lookAt(camera.position.clone().add(dir))}
function animate(){requestAnimationFrame(animate);if(camMode==='free')updateFreeCamera();else{const t=targetFor();if(camMode==='overview'||(camMode==='auto'&&data?.camera?.target==='overview')){const desired=CENTER.clone().add(new THREE.Vector3(0,Math.max(45,MAP.size.x*.24),Math.max(10,MAP.size.z*.06)));camera.position.lerp(desired,.035)}else{camera.position.lerp(t.clone().add(new THREE.Vector3(-10,7,-10)),.06)}camera.lookAt(t)}for(const o of spectatorLayer.children){const label=o.children[2];if(label)label.lookAt(camera.position)}renderer.render(scene,camera)}animate();
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
