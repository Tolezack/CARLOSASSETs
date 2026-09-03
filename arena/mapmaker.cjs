'use strict';
const { randomBytes } = require('node:crypto');

const sessions = new Map();

function createMapMakerSession(guildId, userId, ttlMs = 30 * 60 * 1000, now = Date.now()) {
  const token = randomBytes(24).toString('base64url');
  const session = { token, guildId: String(guildId), userId: String(userId), expiresAt: now + ttlMs, createdAt: now };
  sessions.set(token, session);
  return session;
}

function authorizeMapMakerSession(token, guildId, now = Date.now()) {
  const session = sessions.get(String(token || ''));
  if (!session || session.expiresAt <= now || session.guildId !== String(guildId)) return false;
  return true;
}

function getMapMakerSession(token, now = Date.now()) {
  const session = sessions.get(String(token || ''));
  if (!session || session.expiresAt <= now) {
    if (session) sessions.delete(session.token);
    return null;
  }
  return session;
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function point(value) {
  if (!value || typeof value !== 'object') return null;
  return { x: number(value.x), z: number(value.z) };
}

function normalizeRect(value) {
  if (!Array.isArray(value) || value.length < 4) return null;
  const r = value.slice(0, 5).map(v => number(v, NaN));
  if (r.slice(0, 4).some(v => !Number.isFinite(v))) return null;
  const [x1, z1, x2, z2] = r;
  const h = Number.isFinite(r[4]) ? Math.max(1, Math.min(30, r[4])) : 4;
  if (Math.abs(x2 - x1) < 1 || Math.abs(z2 - z1) < 1) return null;
  return [x1, z1, x2, z2, h];
}

function normalizeCover(value) {
  if (!value || typeof value !== 'object') return null;
  const x = number(value.x, NaN), z = number(value.z, NaN), w = number(value.w, NaN), d = number(value.d, NaN), h = number(value.h, 2.5);
  if (![x, z, w, d, h].every(Number.isFinite) || w < 1 || d < 1 || h < 0.5) return null;
  return { x, z, w, d, h };
}

function rectContainsPoint(rect, p, padding = 0) {
  return p.x >= Math.min(rect[0], rect[2]) - padding && p.x <= Math.max(rect[0], rect[2]) + padding && p.z >= Math.min(rect[1], rect[3]) - padding && p.z <= Math.max(rect[1], rect[3]) + padding;
}

function normalizeMapDocument(input) {
  const source = input && typeof input === 'object' ? input : {};
  const sx = Math.max(40, Math.min(1000, number(source.size?.x, 240)));
  const sz = Math.max(40, Math.min(1000, number(source.size?.z, 140)));
  const spawns = { A: point(source.spawns?.A) || { x: 12, z: sz / 2 }, B: point(source.spawns?.B) || { x: sx - 12, z: sz / 2 } };
  spawns.A.x = Math.max(5, Math.min(sx - 5, spawns.A.x)); spawns.A.z = Math.max(5, Math.min(sz - 5, spawns.A.z));
  spawns.B.x = Math.max(5, Math.min(sx - 5, spawns.B.x)); spawns.B.z = Math.max(5, Math.min(sz - 5, spawns.B.z));
  const map = {
    id: String(source.id || 'resenha-inferno').slice(0, 64),
    name: String(source.name || 'Resenha Inferno').slice(0, 100),
    version: Math.max(1, Math.floor(number(source.version, 1))),
    size: { x: sx, z: sz },
    sites: { A: point(source.sites?.A) || { x: sx * 0.2, z: sz * 0.25 }, B: point(source.sites?.B) || { x: sx * 0.8, z: sz * 0.75 } },
    spawns,
    cameraAnchors: Array.isArray(source.cameraAnchors) ? source.cameraAnchors.slice(0, 20).map(a => ({ id: String(a.id || 'camera').slice(0, 32), x: number(a.x), y: number(a.y, 20), z: number(a.z), lookX: number(a.lookX, sx / 2), lookY: number(a.lookY), lookZ: number(a.lookZ, sz / 2) })) : [],
    walls: (Array.isArray(source.walls) ? source.walls : []).map(normalizeRect).filter(Boolean).slice(0, 300),
    cover: (Array.isArray(source.cover) ? source.cover : []).map(normalizeCover).filter(Boolean).slice(0, 200),
  };
  for (const side of ['A', 'B']) {
    map.sites[side].x = Math.max(5, Math.min(sx - 5, map.sites[side].x));
    map.sites[side].z = Math.max(5, Math.min(sz - 5, map.sites[side].z));
  }
  const usableWalls = map.walls;
  const spawnIsBlocked = p => usableWalls.some(w => rectContainsPoint(w, p, 3));
  if (spawnIsBlocked(spawns.A)) spawns.A = { x: 8, z: sz / 2 };
  if (spawnIsBlocked(spawns.B)) spawns.B = { x: sx - 8, z: sz / 2 };
  if (Math.hypot(spawns.A.x - spawns.B.x, spawns.A.z - spawns.B.z) < Math.max(20, sx * 0.35)) {
    spawns.A = { x: 8, z: sz / 2 }; spawns.B = { x: sx - 8, z: sz / 2 };
  }
  return map;
}

module.exports = { createMapMakerSession, authorizeMapMakerSession, getMapMakerSession, normalizeMapDocument, sessions };
