'use strict';

// Resenha Inferno: arena ampla, simétrica e com corredores reais.
// A navegação usa uma malha simples sobre este mesmo mapa; assim o bot
// nunca escolhe um ponto que esteja dentro de uma parede.
const MAP = {
  id: 'resenha-inferno',
  name: 'Resenha Inferno',
  version: 4,
  size: { x: 240, z: 140 },
  sites: {
    A: { x: 42, z: 32 },
    B: { x: 198, z: 108 },
  },
  spawns: {
    A: { x: 14, z: 70 },
    B: { x: 226, z: 70 },
  },
  cameraAnchors: [
    { id: 'overview', x: 120, y: 88, z: 70, lookX: 120, lookY: 0, lookZ: 70 },
    { id: 'a', x: 48, y: 22, z: 34, lookX: 80, lookY: 1, lookZ: 58 },
    { id: 'b', x: 192, y: 22, z: 106, lookX: 160, lookY: 1, lookZ: 82 },
    { id: 'mid', x: 120, y: 30, z: 70, lookX: 120, lookY: 1, lookZ: 70 },
  ],
  walls: [
    // limite externo
    [0, 0, 240, 3, 5], [0, 137, 240, 140, 5], [0, 0, 3, 140, 5], [237, 0, 240, 140, 5],
    // zona A: duas entradas e abrigo lateral
    [34, 8, 38, 50], [34, 90, 38, 132],
    [42, 8, 78, 12], [42, 128, 78, 132],
    [52, 22, 56, 48], [52, 92, 56, 118],
    // corredor superior/inferior esquerdo
    [72, 28, 112, 32], [72, 108, 112, 112],
    [86, 32, 90, 58], [86, 82, 90, 108],
    // miolo: paredes quebradas, mantendo rota central
    [108, 8, 112, 38], [108, 102, 112, 132],
    [128, 38, 166, 42], [128, 98, 166, 102],
    [148, 42, 152, 64], [148, 76, 152, 98],
    // lado B
    [184, 8, 188, 48], [184, 92, 188, 132],
    [162, 8, 198, 12], [162, 128, 198, 132],
    [204, 22, 208, 48], [204, 92, 208, 118],
    [202, 28, 232, 32], [202, 108, 232, 112],
    // pequenas barreiras no centro-leste
    [116, 56, 140, 60], [100, 80, 124, 84],
  ],
  cover: [
    { x: 22, z: 46, w: 8, d: 6, h: 2.5 },
    { x: 22, z: 94, w: 8, d: 6, h: 2.5 },
    { x: 48, z: 70, w: 9, d: 6, h: 2.5 },
    { x: 68, z: 48, w: 8, d: 7, h: 2.5 },
    { x: 68, z: 92, w: 8, d: 7, h: 2.5 },
    { x: 102, z: 48, w: 8, d: 7, h: 2.5 },
    { x: 102, z: 92, w: 8, d: 7, h: 2.5 },
    { x: 120, z: 70, w: 10, d: 8, h: 3 },
    { x: 138, z: 48, w: 8, d: 7, h: 2.5 },
    { x: 138, z: 92, w: 8, d: 7, h: 2.5 },
    { x: 172, z: 48, w: 8, d: 7, h: 2.5 },
    { x: 172, z: 92, w: 8, d: 7, h: 2.5 },
    { x: 192, z: 70, w: 9, d: 6, h: 2.5 },
    { x: 218, z: 46, w: 8, d: 6, h: 2.5 },
    { x: 218, z: 94, w: 8, d: 6, h: 2.5 },
  ],
};

const NAV_STEP = 4;
const BOT_CLEARANCE = 2.4;

function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function pointInsideRect(x, z, rect, padding = 0) {
  return x >= Math.min(rect[0], rect[2]) - padding && x <= Math.max(rect[0], rect[2]) + padding &&
    z >= Math.min(rect[1], rect[3]) - padding && z <= Math.max(rect[1], rect[3]) + padding;
}
function isWalkable(x, z, padding = BOT_CLEARANCE) {
  if (x < 3 + padding || x > MAP.size.x - 3 - padding || z < 3 + padding || z > MAP.size.z - 3 - padding) return false;
  return !MAP.walls.some(w => pointInsideRect(x, z, w, padding));
}
function nearestWalkable(point) {
  if (isWalkable(point.x, point.z)) return { x: point.x, z: point.z };
  for (let radius = NAV_STEP; radius <= 48; radius += NAV_STEP) {
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      const candidate = { x: point.x + Math.cos(a) * radius, z: point.z + Math.sin(a) * radius };
      if (isWalkable(candidate.x, candidate.z)) return candidate;
    }
  }
  return { x: MAP.size.x / 2, z: MAP.size.z / 2 };
}
function cellKey(ix, iz) { return `${ix}:${iz}`; }
function cellFromPoint(point) {
  return {
    ix: clamp(Math.round(point.x / NAV_STEP), 1, Math.floor(MAP.size.x / NAV_STEP) - 1),
    iz: clamp(Math.round(point.z / NAV_STEP), 1, Math.floor(MAP.size.z / NAV_STEP) - 1),
  };
}
function pointFromCell(cell) { return { x: cell.ix * NAV_STEP, z: cell.iz * NAV_STEP }; }
function neighbors(cell) {
  return [
    { ix: cell.ix + 1, iz: cell.iz }, { ix: cell.ix - 1, iz: cell.iz },
    { ix: cell.ix, iz: cell.iz + 1 }, { ix: cell.ix, iz: cell.iz - 1 },
  ];
}
function findPath(start, goal) {
  const s = cellFromPoint(nearestWalkable(start));
  const g = cellFromPoint(nearestWalkable(goal));
  const startKey = cellKey(s.ix, s.iz), goalKey = cellKey(g.ix, g.iz);
  const open = [s];
  const cameFrom = new Map();
  const cost = new Map([[startKey, 0]]);
  const heuristic = c => Math.abs(c.ix - g.ix) + Math.abs(c.iz - g.iz);
  const score = c => (cost.get(cellKey(c.ix, c.iz)) ?? Infinity) + heuristic(c);
  const closed = new Set();
  while (open.length) {
    open.sort((a, b) => score(a) - score(b));
    const current = open.shift();
    const currentKey = cellKey(current.ix, current.iz);
    if (currentKey === goalKey) {
      const path = [];
      let key = currentKey;
      while (key) {
        const [ix, iz] = key.split(':').map(Number);
        path.push(pointFromCell({ ix, iz }));
        key = cameFrom.get(key);
      }
      return path.reverse();
    }
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    for (const next of neighbors(current)) {
      const point = pointFromCell(next);
      const nextKey = cellKey(next.ix, next.iz);
      if (!isWalkable(point.x, point.z) || closed.has(nextKey)) continue;
      const newCost = (cost.get(currentKey) ?? Infinity) + 1;
      if (newCost < (cost.get(nextKey) ?? Infinity)) {
        cost.set(nextKey, newCost);
        cameFrom.set(nextKey, currentKey);
        open.push(next);
      }
    }
  }
  return [];
}
function lineOfSight(a, b) {
  const d = distance(a, b);
  const steps = Math.max(2, Math.ceil(d / 2));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (!isWalkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 1.0)) return false;
  }
  return true;
}
function nearestWaypoint(pos) {
  const target = nearestWalkable(pos);
  return { ...target };
}

function setMapDocument(document) {
  const next = document && typeof document === 'object' ? document : null;
  if (!next?.size || !next.spawns || !next.walls) throw new Error('Mapa inválido.');
  MAP.id = next.id || MAP.id; MAP.name = next.name || MAP.name; MAP.version = Math.max(Number(MAP.version || 0) + 1, Number(next.version || 0));
  MAP.size = { x: Number(next.size.x), z: Number(next.size.z) };
  MAP.sites = structuredClone(next.sites || MAP.sites);
  MAP.spawns = structuredClone(next.spawns);
  MAP.cameraAnchors = structuredClone(next.cameraAnchors || []);
  MAP.walls = structuredClone(next.walls).map(w => [w[0], w[1], w[2], w[3], Number.isFinite(Number(w[4])) ? Number(w[4]) : 4]);
  MAP.cover = structuredClone(next.cover || []);
  return MAP;
}

module.exports = { MAP, NAV_STEP, distance, clamp, pointInsideRect, isWalkable, nearestWalkable, findPath, lineOfSight, nearestWaypoint, setMapDocument };
