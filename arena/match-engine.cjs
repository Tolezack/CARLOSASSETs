'use strict';
const { MAP, distance, clamp, isWalkable, nearestWalkable, findPath, lineOfSight } = require('./arena-map.cjs');
const { addCommentary } = require('./commentator.cjs');
const { SHOT_PITCH_MIN, SHOT_PITCH_MAX } = require('./sound-config.cjs');

const ROUND_LIMIT_MS = 75_000;
const ROUND_BREAK_MS = 4_000;
const FIRE_RANGE = 34;
const MOVE_SPEED = 7.0; // unidades/segundo
const BOT_RADIUS = 2.4;
const PATH_REPLAN_MS = 650;
const SNAPSHOT_MAX_STEP = 3.0;
const RELOAD_MS = 1_650;
const BOT_MAGAZINE_SIZE = 3;
const BOT_RESERVE_AMMO = 9;
const SUPPLY_PICKUP_RADIUS = 5.0;
const SHIELD_PICKUP_AMOUNT = 60;
const SUPPLY_MIN_SPAWN_DISTANCE = 18;

function makeFighter(side, name, profile, forcedSpawn = null) {
  const spawn = nearestWalkable(forcedSpawn || MAP.spawns[side]);
  return {
    side, name, profile, hp: 100, maxHp: 100, armor: 100, energy: 100,
    x: spawn.x, z: spawn.z, rotation: side === 'A' ? Math.PI / 2 : -Math.PI / 2,
    weapon: 'rifle', ammo: BOT_MAGAZINE_SIZE, maxAmmo: BOT_MAGAZINE_SIZE, reserveAmmo: BOT_RESERVE_AMMO, state: 'moving', intent: 'take-space',
    target: null, lastKnownEnemy: null, cooldown: 0, reloadAt: 0, kills: 0, deaths: 0,
    shots: 0, hits: 0, lowHpCalled: false, path: [], pathIndex: 0,
    nextReplanAt: 0, strafeSign: side === 'A' ? 1 : -1, stuckTicks: 0,
    lastX: spawn.x, lastZ: spawn.z, lastMoveAt: Date.now(),
  };
}

function randomSupplyPosition(occupied = []) {
  for (let i = 0; i < 80; i += 1) {
    const candidate = nearestWalkable({
      x: 8 + Math.random() * Math.max(1, MAP.size.x - 16),
      z: 8 + Math.random() * Math.max(1, MAP.size.z - 16),
    });
    if (occupied.every((p) => distance(candidate, p) >= SUPPLY_MIN_SPAWN_DISTANCE)) return candidate;
  }
  return nearestWalkable({ x: MAP.size.x / 2, z: MAP.size.z / 2 });
}

function createRoundSupplies() {
  const ammo = randomSupplyPosition([MAP.spawns.A, MAP.spawns.B]);
  const shield = randomSupplyPosition([MAP.spawns.A, MAP.spawns.B, ammo]);
  return [
    { id: `ammo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: 'ammo', x: ammo.x, z: ammo.z, active: true, amount: BOT_RESERVE_AMMO },
    { id: `shield-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: 'shield', x: shield.x, z: shield.z, active: true, amount: SHIELD_PICKUP_AMOUNT },
  ];
}

function activeSupply(match, type) {
  return (match.supplies || []).find((s) => s.active && (!type || s.type === type)) || null;
}

function collectSupply(match, f, now) {
  const supply = (match.supplies || []).find((s) => s.active && distance(f, s) <= SUPPLY_PICKUP_RADIUS);
  if (!supply) return false;
  supply.active = false;
  if (supply.type === 'ammo') {
    f.ammo = f.maxAmmo;
    f.reserveAmmo = Math.max(f.reserveAmmo, supply.amount || BOT_RESERVE_AMMO);
    f.reloadAt = 0;
    f.state = 'repositioning';
    f.path = []; f.pathIndex = 0; f.nextReplanAt = now;
    pushEvent(match, { type: 'ammo_pickup', actor: f.side, text: `${f.name} pegou a caixa de munição e reabasteceu.` }, now);
  } else if (supply.type === 'shield') {
    const before = f.armor;
    f.armor = Math.min(100, f.armor + (supply.amount || SHIELD_PICKUP_AMOUNT));
    f.state = 'repositioning';
    f.path = []; f.pathIndex = 0; f.nextReplanAt = now;
    pushEvent(match, { type: 'shield_pickup', actor: f.side, armor: f.armor, text: `${f.name} pegou o escudo (+${f.armor - before}).` }, now);
  }
  return true;
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
    camera: { mode: 'auto', target: 'overview', reason: 'overview' }, projectiles: [], projectileSeq: 0, soundEvents: [], supplies: createRoundSupplies(),
    lastTickAt: now, fighters: {
      A: makeFighter('A', 'Rubi', 'entry-fragger', spawnA),
      B: makeFighter('B', 'Trovão', 'anchor-igl', spawnB),
    },
  };
}

function pushSound(match, name, now, extra = {}) {
  match.soundEvents = match.soundEvents || [];
  match.soundEvents.push({ id: `${now}-${match.soundEvents.length}`, at: now, name, ...extra });
  match.soundEvents = match.soundEvents.slice(-60);
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
      ammo: BOT_MAGAZINE_SIZE, reserveAmmo: BOT_RESERVE_AMMO, cooldown: 0, reloadAt: 0,
      state: 'moving', intent: side === 'A' ? 'take-space' : 'hold-site',
      target: null, lastKnownEnemy: null, lowHpCalled: false,
      path: [], pathIndex: 0, nextReplanAt: now, stuckTicks: 0,
      lastX: spawn.x, lastZ: spawn.z, lastMoveAt: now,
      strafeSign: side === 'A' ? 1 : -1,
    });
  }
  match.round += 1; match.roundPhase = 'live'; match.roundStartedAt = now;
  match.roundEndsAt = now + ROUND_LIMIT_MS; match.projectiles = []; match.supplies = createRoundSupplies();
  pushEvent(match, { type: 'round_start', actorName: 'Rubi', text: `Round ${match.round} começou.` }, now);
}

function visible(a, b) { return distance(a, b) <= FIRE_RANGE && lineOfSight(a, b); }

function chooseIntent(self, enemy, match) {
  const d = distance(self, enemy);
  const elapsed = Math.max(0, (Date.now() - match.roundStartedAt) / 1000);
  const seenEnemy = visible(self, enemy);
  if (self.hp < 28) return 'retreat-cover';
  if (self.ammo <= 0 && activeSupply(match, 'ammo')) return 'seek-ammo';
  if (self.ammo <= 0 && self.reserveAmmo > 0) return 'reload';
  if (self.ammo <= 0 && self.reserveAmmo <= 0) return activeSupply(match, 'ammo') ? 'seek-ammo' : 'retreat-cover';
  if (self.armor < 45 && activeSupply(match, 'shield') && !seenEnemy) return 'seek-shield';
  if (self.ammo <= 4 && self.reserveAmmo > 0 && !seenEnemy) return 'reload';
  if (d < 18 && seenEnemy && self.hp > 45) return 'take-duel';
  if (enemy.lastKnownEnemy && !seenEnemy && elapsed > 8) return 'investigate';
  if (elapsed < 7) return self.profile === 'entry-fragger' ? 'a-site-hit' : 'hold-site';
  if (elapsed < 15) return self.profile === 'anchor-igl' ? 'mid-control' : 'pressure';
  if (enemy.hp < 60 || elapsed >= 15) return 'pressure';
  return 'mid-control';
}

function strategicGoal(f, match) {
  const enemy = match.fighters[f.side === 'A' ? 'B' : 'A'];
  if (f.intent === 'seek-ammo' || f.intent === 'seek-shield') {
    const type = f.intent === 'seek-ammo' ? 'ammo' : 'shield';
    const supply = activeSupply(match, type);
    if (supply) return supply;
    return MAP.spawns[f.side];
  }
  if (f.intent === 'retreat-cover' || f.intent === 'reload') {
    const candidates = MAP.cover.filter(c => isWalkable(c.x, c.z));
    const safe = candidates.filter(c => !lineOfSight(c, enemy) && distance(f, c) <= 42);
    const pool = safe.length ? safe : candidates;
    return pool.reduce((best, c) => {
      if (!best) return c;
      const score = distance(f, c) + (lineOfSight(c, enemy) ? 18 : 0) + Math.abs(distance(c, enemy) - 14) * 0.35;
      const bestScore = distance(f, best) + (lineOfSight(best, enemy) ? 18 : 0) + Math.abs(distance(best, enemy) - 14) * 0.35;
      return score < bestScore ? c : best;
    }, null) || MAP.spawns[f.side];
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
  self.ammo -= 1; self.shots += 1; self.cooldown = now + 720;
  const pitch = Number((SHOT_PITCH_MIN + Math.random() * (SHOT_PITCH_MAX - SHOT_PITCH_MIN)).toFixed(3));
  pushSound(match, 'rifle-shot', now, { actor: side, pitch, volume: 0.82 });
  pushEvent(match, { type: 'shot', actor: side, target: side === 'A' ? 'B' : 'A', weapon: self.weapon, ammo: self.ammo, pitch }, now);
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

function separateFighters(match) {
  const a = match.fighters.A, b = match.fighters.B;
  if (a.hp <= 0 || b.hp <= 0) return;
  const minDistance = BOT_RADIUS * 2.05;
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d >= minDistance) return;
  const nx = d > 0.001 ? dx / d : 1;
  const nz = d > 0.001 ? dz / d : 0;
  const push = (minDistance - Math.max(d, 0.001)) * 0.5 + 0.08;
  const ax = a.x - nx * push, az = a.z - nz * push;
  const bx = b.x + nx * push, bz = b.z + nz * push;
  if (isWalkable(ax, a.z, BOT_RADIUS)) a.x = ax;
  if (isWalkable(a.x, az, BOT_RADIUS)) a.z = az;
  if (isWalkable(bx, b.z, BOT_RADIUS)) b.x = bx;
  if (isWalkable(b.x, bz, BOT_RADIUS)) b.z = bz;
  a.rotation = Math.atan2(b.x - a.x, b.z - a.z);
  b.rotation = Math.atan2(a.x - b.x, a.z - b.z);
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
    if (collectSupply(match, f, now)) continue;
    f.energy = Math.min(100, f.energy + 5 * dt); f.intent = chooseIntent(f, enemy, match);
    if (f.intent === 'seek-ammo' || f.intent === 'seek-shield') {
      const goal = strategicGoal(f, match);
      f.state = f.intent === 'seek-ammo' ? 'seeking-ammo' : 'seeking-shield';
      moveToward(f, goal, 7.0, false, dt, now);
      continue;
    }
    if (f.intent === 'reload') {
      const coverGoal = strategicGoal({ ...f, intent: 'retreat-cover' }, match);
      if (!f.reloadAt) {
        // Com pente vazio a recarga não pode depender de conseguir chegar à cobertura:
        // inicia imediatamente para o bot nunca ficar travado com 0 munição.
        if (f.ammo <= 0) {
          f.reloadAt = now + RELOAD_MS;
          f.state = 'reloading';
          pushSound(match, 'rifle-reload', now, { actor: side, pitch: 1, volume: 0.9 });
          pushEvent(match, { type: 'reload_start', actor: side, text: `${f.name} ficou sem munição e iniciou a recarga.` }, now);
        } else {
          f.state = 'seeking-cover';
          moveToward(f, coverGoal, 5.8, true, dt, now);
          if (distance(f, coverGoal) < 4.5) {
            f.reloadAt = now + RELOAD_MS;
            f.state = 'reloading';
            pushSound(match, 'rifle-reload', now, { actor: side, pitch: 1, volume: 0.9 });
            pushEvent(match, { type: 'reload_start', actor: side, text: `${f.name} entrou em cobertura e iniciou a recarga.` }, now);
          }
        }
      } else if (now >= f.reloadAt) {
        const needed = f.maxAmmo - f.ammo;
        const loaded = Math.min(needed, f.reserveAmmo);
        f.ammo += loaded; f.reserveAmmo -= loaded; f.reloadAt = 0;
        f.state = 'repositioning';
        f.strafeSign *= -1; f.path = []; f.pathIndex = 0; f.nextReplanAt = 0;
        pushEvent(match, { type: 'reload_end', actor: side, ammo: f.ammo, reserveAmmo: f.reserveAmmo, text: `${f.name} terminou a recarga.` }, now);
      }
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
  separateFighters(match);
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


function snapshotMatch(match, now = Date.now()) {
  return {
    at: now,
    supplies: (match.supplies || []).map((s) => ({ id: s.id, type: s.type, x: s.x, z: s.z, active: s.active })),
    fighters: Object.fromEntries(['A', 'B'].map(side => {
      const f = match.fighters[side];
      return [side, { x: f.x, z: f.z, rotation: f.rotation, state: f.state, ammo: f.ammo }];
    })),
  };
}

module.exports = { createMatch, tickMatch, resetRound, snapshotMatch, ROUND_LIMIT_MS, ROUND_BREAK_MS, FIRE_RANGE };
