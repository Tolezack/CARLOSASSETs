'use strict';
const { MAP, distance, clamp, isWalkable, nearestWalkable, findPath, lineOfSight } = require('./arena-map.cjs');
const { addCommentary } = require('./commentator.cjs');

const ROUND_LIMIT_MS = 75_000;
const ROUND_BREAK_MS = 4_000;
const FIRE_RANGE = 34;
const MOVE_SPEED = 7.0; // unidades/segundo
const BOT_RADIUS = 2.4;
const PATH_REPLAN_MS = 1_000;

function makeFighter(side, name, profile, forcedSpawn = null) {
  const spawn = nearestWalkable(forcedSpawn || MAP.spawns[side]);
  return {
    side, name, profile, hp: 100, maxHp: 100, armor: 100, energy: 100,
    x: spawn.x, z: spawn.z, rotation: side === 'A' ? Math.PI / 2 : -Math.PI / 2,
    weapon: 'rifle', ammo: 30, maxAmmo: 30, state: 'moving', intent: 'take-space',
    target: null, lastKnownEnemy: null, cooldown: 0, reloadAt: 0, kills: 0, deaths: 0,
    shots: 0, hits: 0, lowHpCalled: false, path: [], pathIndex: 0,
    nextReplanAt: 0, strafeSign: side === 'A' ? 1 : -1, stuckTicks: 0,
    lastX: spawn.x, lastZ: spawn.z, lastMoveAt: Date.now(),
  };
}

function createMatch() {
  const now = Date.now();
  const spawnA = nearestWalkable(MAP.spawns.A);
  let spawnB = nearestWalkable(MAP.spawns.B);
  if (distance(spawnA, spawnB) < Math.max(20, Math.min(MAP.size.x, MAP.size.z) * 0.35)) {
    spawnB = nearestWalkable({ x: MAP.size.x - 8, z: MAP.size.z / 2 });
  }
  return {
    map: MAP.id, round: 1, score: { A: 0, B: 0 }, roundPhase: 'live',
    roundStartedAt: now, roundEndsAt: now + ROUND_LIMIT_MS, winner: null, finishedAt: null,
    camera: { mode: 'auto', target: 'overview', reason: 'overview' }, projectiles: [], projectileSeq: 0,
    lastTickAt: now, fighters: {
      A: makeFighter('A', 'Rubi', 'entry-fragger', spawnA),
      B: makeFighter('B', 'Trovão', 'anchor-igl', spawnB),
    },
  };
}

function pushEvent(match, event, now) {
  const names = { A: match.fighters.A.name, B: match.fighters.B.name };
  const e = { at: now, ...event,
    actorName: event.actorName || (event.actor ? names[event.actor] : undefined),
    targetName: event.targetName || (event.target ? names[event.target] : undefined),
  };
  if (!e.text) e.text = event.type === 'round_start' ? `Round ${match.round} começou.` : event.type;
  match.events = match.events || []; match.events.push(e); match.events = match.events.slice(-80);
  addCommentary(match, e, now);
}

function resetRound(match, now) {
  for (const side of ['A', 'B']) {
    const f = match.fighters[side]; const requested = MAP.spawns[side]; const spawn = nearestWalkable(requested);
    Object.assign(f, {
      hp: 100, armor: 100, energy: 100, x: spawn.x, z: spawn.z,
      ammo: 30, cooldown: 0, reloadAt: 0,
      state: 'moving', intent: side === 'A' ? 'take-space' : 'hold-site',
      target: null, lastKnownEnemy: null, lowHpCalled: false,
      path: [], pathIndex: 0, nextReplanAt: now, stuckTicks: 0,
      lastX: spawn.x, lastZ: spawn.z, lastMoveAt: now,
      strafeSign: side === 'A' ? 1 : -1,
    });
  }
  match.round += 1; match.roundPhase = 'live'; match.roundStartedAt = now;
  match.roundEndsAt = now + ROUND_LIMIT_MS; match.projectiles = [];
  pushEvent(match, { type: 'round_start', actorName: 'Rubi', text: `Round ${match.round} começou.` }, now);
}

function visible(a, b) { return distance(a, b) <= FIRE_RANGE && lineOfSight(a, b); }

function chooseIntent(self, enemy, match) {
  const d = distance(self, enemy);
  const elapsed = Math.max(0, (Date.now() - match.roundStartedAt) / 1000);
  if (self.hp < 28) return 'retreat-cover';
  if (self.ammo <= 3) return 'reload';
  if (d < 22 && visible(self, enemy)) return 'take-duel';
  if (enemy.lastKnownEnemy && !visible(self, enemy) && elapsed > 12) return 'investigate';
  // Abertura: ocupam lados diferentes. Depois, ambos avançam pelo meio e
  // finalmente caçam o adversário. Isso evita que os dois repitam o mesmo site.
  if (elapsed < 7) return self.profile === 'entry-fragger' ? 'a-site-hit' : 'hold-site';
  if (elapsed < 14) return 'mid-control';
  if (enemy.hp < 60 || elapsed >= 14) return 'pressure';
  return 'mid-control';
}

function strategicGoal(f, match) {
  const enemy = match.fighters[f.side === 'A' ? 'B' : 'A'];
  if (f.intent === 'retreat-cover') {
    const candidates = MAP.cover.filter(c => isWalkable(c.x, c.z));
    return candidates.reduce((best, c) => distance(f, c) < distance(f, best) ? c : best, candidates[0] || MAP.spawns[f.side]);
  }
  if (f.intent === 'take-duel' || f.intent === 'pressure') return enemy;
  if (f.intent === 'investigate' && enemy.lastKnownEnemy) return enemy.lastKnownEnemy;
  if (f.intent === 'a-site-hit') return MAP.sites.A;
  if (f.intent === 'b-site-hit') return MAP.sites.B;
  if (f.intent === 'hold-site') return MAP.sites[f.side];
  // Mid-control usa posições alternadas para os bots não ficarem presos na mesma área.
  const choices = f.side === 'A'
    ? [{ x: 64, z: 70 }, { x: 88, z: 42 }, { x: 88, z: 98 }, { x: 112, z: 70 }]
    : [{ x: 176, z: 70 }, { x: 152, z: 42 }, { x: 152, z: 98 }, { x: 128, z: 70 }];
  return choices[(match.round + Math.floor((Date.now() - match.roundStartedAt) / 5000)) % choices.length];
}

function updatePath(f, target, now, force = false) {
  const goal = nearestWalkable(target);
  if (!force && now < f.nextReplanAt && f.path.length) return;
  const path = findPath(f, goal);
  f.path = path; f.pathIndex = path.length > 1 ? 1 : 0; f.nextReplanAt = now + PATH_REPLAN_MS;
}

function safeMove(f, dx, dz) {
  const maxX = MAP.size.x - 3 - BOT_RADIUS, maxZ = MAP.size.z - 3 - BOT_RADIUS;
  const nx = clamp(f.x + dx, 3 + BOT_RADIUS, maxX);
  const nz = clamp(f.z + dz, 3 + BOT_RADIUS, maxZ);
  let moved = false;
  if (isWalkable(nx, f.z, BOT_RADIUS)) { f.x = nx; moved = true; }
  if (isWalkable(f.x, nz, BOT_RADIUS)) { f.z = nz; moved = true; }
  return moved;
}

function moveToward(f, target, speedPerSecond, evade, dt, now) {
  const pathTarget = target;
  updatePath(f, pathTarget, now);
  let next = f.path[f.pathIndex] || nearestWalkable(pathTarget);
  if (distance(f, next) < 2.2 && f.pathIndex < f.path.length - 1) {
    f.pathIndex += 1; next = f.path[f.pathIndex];
  }
  let dx = next.x - f.x, dz = next.z - f.z;
  let len = Math.hypot(dx, dz);
  if (len < 0.01) return false;
  let ux = dx / len, uz = dz / len;
  if (evade) {
    const lateralX = -uz * f.strafeSign, lateralZ = ux * f.strafeSign;
    const amount = Math.min(0.75, Math.max(0.25, len / 28));
    ux = ux * 0.72 + lateralX * amount; uz = uz * 0.72 + lateralZ * amount;
    const n = Math.hypot(ux, uz) || 1; ux /= n; uz /= n;
    if (Math.random() < dt * 0.9) f.strafeSign *= -1;
  }
  const step = Math.min(speedPerSecond * dt, Math.max(0.15, len));
  let moved = safeMove(f, ux * step, uz * step);
  if (!moved) {
    f.path = []; f.pathIndex = 0; f.nextReplanAt = 0;
    const lateralX = -uz * f.strafeSign, lateralZ = ux * f.strafeSign;
    moved = safeMove(f, lateralX * step, lateralZ * step);
  }
  if (moved) f.rotation = Math.atan2(dx, dz);
  return moved;
}

function fire(match, side, now) {
  const self = match.fighters[side]; const enemy = match.fighters[side === 'A' ? 'B' : 'A'];
  if (self.cooldown > now || self.reloadAt > now || self.ammo <= 0 || !visible(self, enemy) || enemy.hp <= 0) return false;
  self.ammo -= 1; self.shots += 1; self.cooldown = now + 520;
  const accuracy = self.profile === 'anchor-igl' ? 0.78 : 0.70;
  const hit = Math.random() < accuracy;
  const range = distance(self, enemy);
  const baseAngle = Math.atan2(enemy.x - self.x, enemy.z - self.z);
  const angle = baseAngle + (hit ? 0 : (Math.random() - 0.5) * 0.14);
  const end = hit ? { x: enemy.x, z: enemy.z } : { x: self.x + Math.sin(angle) * range, z: self.z + Math.cos(angle) * range };
  match.projectiles.push({ id: ++match.projectileSeq, from: side, x: self.x, z: self.z, toX: end.x, toZ: end.z, at: now, duration: Math.max(120, Math.min(420, range * 5.5)), hit });
  if (match.projectiles.length > 100) match.projectiles.splice(0, match.projectiles.length - 100);
  if (!hit) { pushEvent(match, { type: 'contact', actor: side, target: side === 'A' ? 'B' : 'A', text: `${self.name} disparou.` }, now); return true; }
  self.hits += 1;
  const damage = 14 + Math.floor(Math.random() * 10);
  const absorbed = Math.min(enemy.armor, Math.floor(damage * 0.35)); enemy.armor -= absorbed;
  const finalDamage = damage - absorbed; enemy.hp = Math.max(0, enemy.hp - finalDamage); enemy.lastKnownEnemy = { x: self.x, z: self.z };
  pushEvent(match, { type: 'hit', actor: side, target: side === 'A' ? 'B' : 'A', damage: finalDamage, hp: enemy.hp, text: `${self.name} acertou ${enemy.name} (-${finalDamage}).` }, now);
  if (enemy.hp <= 0) {
    self.kills += 1; enemy.deaths += 1; enemy.state = 'dead';
    pushEvent(match, { type: 'kill', actor: side, target: side === 'A' ? 'B' : 'A', text: `${self.name} eliminou ${enemy.name}.` }, now);
  } else if (enemy.hp < 30 && !enemy.lowHpCalled) {
    enemy.lowHpCalled = true; pushEvent(match, { type: 'low_hp', actor: side === 'A' ? 'B' : 'A', hp: enemy.hp }, now);
  }
  return true;
}

function tickMatch(match, now = Date.now()) {
  if (!match || match.winner || match.roundPhase === 'finished') return;
  const dt = Math.min(0.35, Math.max(0.05, (now - (match.lastTickAt || now - 250)) / 1000));
  match.lastTickAt = now;
  match.projectiles = (match.projectiles || []).filter(p => now - p.at <= p.duration + 100);
  if (match.roundPhase === 'break') {
    if (now >= match.nextRoundAt) {
      if (match.score.A >= 3 || match.score.B >= 3) {
        match.roundPhase = 'finished'; match.winner = match.score.A >= 3 ? 'A' : 'B'; match.finishedAt = now;
        pushEvent(match, { type: 'match_win', actor: match.winner, scoreA: match.score.A, scoreB: match.score.B }, now);
      } else resetRound(match, now);
    }
    updateCamera(match, now); return;
  }
  const a = match.fighters.A, b = match.fighters.B;
  for (const side of ['A', 'B']) {
    const f = match.fighters[side], enemy = match.fighters[side === 'A' ? 'B' : 'A'];
    if (f.hp <= 0) continue;
    f.energy = Math.min(100, f.energy + 5 * dt); f.intent = chooseIntent(f, enemy, match);
    if (f.intent === 'reload') {
      f.state = 'reloading'; if (!f.reloadAt) f.reloadAt = now + 1800;
      if (now >= f.reloadAt) { f.ammo = f.maxAmmo; f.reloadAt = 0; f.state = 'moving'; }
      else moveToward(f, strategicGoal(f, match), 4.5, true, dt, now);
      continue;
    }
    const d = distance(f, enemy), hasSight = d <= FIRE_RANGE && visible(f, enemy);
    if (hasSight) {
      f.state = 'engaging'; f.target = enemy.side;
      moveToward(f, enemy, d < 12 ? 3.4 : 4.7, true, dt, now);
      fire(match, side, now);
    } else {
      f.target = null; f.state = f.intent === 'retreat-cover' ? 'retreating' : 'moving';
      moveToward(f, strategicGoal(f, match), f.profile === 'entry-fragger' ? 7.2 : 6.4, f.intent !== 'hold-site', dt, now);
    }
    const moved = Math.hypot(f.x - f.lastX, f.z - f.lastZ);
    f.stuckTicks = moved < 0.08 ? f.stuckTicks + 1 : 0; f.lastX = f.x; f.lastZ = f.z;
    if (f.stuckTicks >= 8) {
      f.stuckTicks = 0; f.path = []; f.pathIndex = 0; f.nextReplanAt = 0; f.strafeSign *= -1;
      const escape = { x: f.x + f.strafeSign * 10, z: f.z + (side === 'A' ? 8 : -8) };
      moveToward(f, escape, 8, true, dt, now);
      pushEvent(match, { type: 'reposition', actor: side, text: `${f.name} procurou outra rota.` }, now);
    }
  }
  const dead = a.hp <= 0 || b.hp <= 0, timed = now >= match.roundEndsAt;
  if (dead || timed) {
    const winner = dead ? (a.hp > 0 ? 'A' : b.hp > 0 ? 'B' : (a.hp >= b.hp ? 'A' : 'B')) : (a.hp === b.hp ? (Math.random() < 0.5 ? 'A' : 'B') : (a.hp > b.hp ? 'A' : 'B'));
    match.score[winner] += 1; match.roundPhase = 'break'; match.nextRoundAt = now + ROUND_BREAK_MS;
    pushEvent(match, { type: 'round_win', actor: winner, scoreA: match.score.A, scoreB: match.score.B, text: `${match.fighters[winner].name} venceu o round.` }, now);
    if (match.score[winner] >= 3) {
      match.roundPhase = 'finished'; match.winner = winner; match.finishedAt = now;
      pushEvent(match, { type: 'match_win', actor: winner, scoreA: match.score.A, scoreB: match.score.B, text: `${match.fighters[winner].name} venceu o BO5.` }, now);
    }
  }
  updateCamera(match, now);
}

function updateCamera(match, now = Date.now()) {
  const a = match.fighters.A, b = match.fighters.B;
  if (match.roundPhase === 'finished') { match.camera = { mode: 'auto', target: 'overview', reason: 'match-finished' }; return; }
  const target = a.hp <= 0 ? 'B' : b.hp <= 0 ? 'A' : distance(a, b) < FIRE_RANGE ? (a.hp <= b.hp ? 'A' : 'B') : (a.hp < 30 ? 'A' : b.hp < 30 ? 'B' : 'overview');
  match.camera = { mode: 'auto', target, reason: target === 'overview' ? 'rotation' : 'active-duel', at: now };
}

module.exports = { createMatch, tickMatch, resetRound, ROUND_LIMIT_MS, ROUND_BREAK_MS, FIRE_RANGE };
