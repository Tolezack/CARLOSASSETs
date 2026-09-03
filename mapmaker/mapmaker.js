const qs = new URLSearchParams(location.search); const token = qs.get('token') || ''; const API = (window.ARENA_API_BASE || 'https://carlos-4rxr.onrender.com').replace(/\/$/,'');
const canvas=document.querySelector('#canvas'), ctx=canvas.getContext('2d'); const status=document.querySelector('#status'), msg=document.querySelector('#message');
let map=null, tool='wall', scale=1, ox=0, oz=0, drag=null;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fit(){const w=canvas.clientWidth,h=canvas.clientHeight;canvas.width=w*devicePixelRatio;canvas.height=h*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0); if(map){scale=Math.min((w-50)/map.size.x,(h-50)/map.size.z);ox=(w-map.size.x*scale)/2;oz=(h-map.size.z*scale)/2;}draw();}
function toWorld(x,z){return {x:(x-ox)/scale,z:(z-oz)/scale}} function toScreen(x,z){return {x:ox+x*scale,z:oz+z*scale}}
function draw(){if(!map)return;const w=canvas.clientWidth,h=canvas.clientHeight;ctx.clearRect(0,0,w,h);ctx.strokeStyle='#1d242b';for(let x=0;x<=map.size.x;x+=10){const a=toScreen(x,0),b=toScreen(x,map.size.z);ctx.beginPath();ctx.moveTo(a.x,a.z);ctx.lineTo(b.x,b.z);ctx.stroke()}for(let z=0;z<=map.size.z;z+=10){const a=toScreen(0,z),b=toScreen(map.size.x,z);ctx.beginPath();ctx.moveTo(a.x,a.z);ctx.lineTo(b.x,b.z);ctx.stroke()}ctx.fillStyle='#263027';ctx.fillRect(ox,oz,map.size.x*scale,map.size.z*scale);
for(const r of map.walls){const a=toScreen(r[0],r[1]),b=toScreen(r[2],r[3]);ctx.fillStyle='#59443b';ctx.fillRect(a.x,a.z,b.x-a.x,b.z-a.z)}for(const c of map.cover){const a=toScreen(c.x-c.w/2,c.z-c.d/2);ctx.fillStyle='#8b795e';ctx.fillRect(a.x,a.z,c.w*scale,c.d*scale)}
for(const side of ['A','B']){const p=map.spawns[side],s=toScreen(p.x,p.z);ctx.fillStyle=side==='A'?'#d64b4b':'#4b8bd6';ctx.beginPath();ctx.arc(s.x,s.z,8,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.fillText('SPAWN '+side,s.x+10,s.z+4);const q=map.sites[side],t=toScreen(q.x,q.z);ctx.strokeStyle=side==='A'?'#d64b4b':'#4b8bd6';ctx.lineWidth=2;ctx.strokeRect(t.x-14,t.z-14,28,28);ctx.lineWidth=1}}
function nearest(v){return Math.max(0,Math.min(v,9999))}
function commitTool(a,b){
  if(tool==='wall'){
    let x1=nearest(a.x), z1=nearest(a.z), x2=nearest(b.x), z2=nearest(b.z);
    if(Math.abs(x2-x1)<2) x2=x1+2; if(Math.abs(z2-z1)<2) z2=z1+2;
    map.walls.push([x1,z1,x2,z2]);
  } else if(tool==='cover'){
    map.cover.push({x:(a.x+b.x)/2,z:(a.z+b.z)/2,w:Math.max(2,Math.abs(b.x-a.x)),d:Math.max(2,Math.abs(b.z-a.z)),h:2.5});
  } else if(tool==='erase'){
    const x=a.x,z=a.z;
    let wi=-1, best=Infinity;
    map.walls.forEach((r,i)=>{const cx=Math.max(Math.min(x,Math.max(r[0],r[2])),Math.min(r[0],r[2]));const cz=Math.max(Math.min(z,Math.max(r[1],r[3])),Math.min(r[1],r[3]));const d=Math.hypot(x-cx,z-cz);if(d<best){best=d;wi=i}});
    let ci=-1; best=Math.min(best, 999); map.cover.forEach((c,i)=>{const d=Math.hypot(x-c.x,z-c.z);if(d<best){best=d;ci=i;wi=-1}});
    if(ci>=0) map.cover.splice(ci,1); else if(wi>=0 && best<12) map.walls.splice(wi,1);
  } else {
    const p={x:Math.max(4,Math.min(map.size.x-4,a.x)),z:Math.max(4,Math.min(map.size.z-4,a.z))};
    if(tool==='spawnA'||tool==='spawnB')map.spawns[tool.slice(-1)]=p; else map.sites[tool.slice(-1)]=p;
  }
  draw()
}
canvas.addEventListener('pointerdown',e=>{const p=toWorld(e.offsetX,e.offsetY);drag={start:p,last:p}});canvas.addEventListener('pointerup',e=>{if(!drag)return;const p=toWorld(e.offsetX,e.offsetY);commitTool(drag.start,p);drag=null});canvas.addEventListener('wheel',e=>{e.preventDefault();const before=toWorld(e.offsetX,e.offsetY);scale*=e.deltaY<0?1.1:.9;scale=Math.max(.2,Math.min(8,scale));ox=e.offsetX-before.x*scale;oz=e.offsetY-before.z*scale;draw()},{passive:false});
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{tool=b.dataset.tool;document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('active',x===b))});document.querySelector('[data-tool="wall"]').classList.add('active');
async function load(){if(!token){status.textContent='LINK INVÁLIDO';msg.textContent='Use o link gerado por ?mapmaker no Discord.';return}status.textContent='CARREGANDO...';try{const r=await fetch(`${API}/api/mapmaker/map?token=${encodeURIComponent(token)}`);const p=await r.json();if(!r.ok||!p.ok)throw new Error(p.error||'Acesso negado.');map=structuredClone(p.map);document.querySelector('#mapName').value=map.name;document.querySelector('#mapX').value=map.size.x;document.querySelector('#mapZ').value=map.size.z;status.textContent='ADMIN AUTORIZADO';fit()}catch(e){status.textContent='ERRO';msg.textContent=e.message}}
document.querySelector('#save').onclick=async()=>{if(!map)return;map.name=document.querySelector('#mapName').value||map.name;map.size.x=Math.max(40,Number(document.querySelector('#mapX').value)||map.size.x);map.size.z=Math.max(40,Number(document.querySelector('#mapZ').value)||map.size.z);try{const r=await fetch(`${API}/api/mapmaker/map`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,map})});const p=await r.json();if(!r.ok||!p.ok)throw new Error(p.error||'Falha ao salvar');map=p.map;msg.innerHTML=`✅ Salvo. ${p.persisted?'Publicado no CARLOSASSETs.':'Mantido no servidor (configure ARENA_ASSETS_GITHUB_REPO para publicar).'}`;fit()}catch(e){msg.textContent='❌ '+e.message}};document.querySelector('#reload').onclick=load;addEventListener('resize',fit);load();
