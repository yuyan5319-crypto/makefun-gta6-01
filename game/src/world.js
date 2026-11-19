// world.js — Neon Harbor: the city itself.
// A seeded grid city wrapped around a harbor on its south edge: avenues and
// streets, city blocks filled with neon-lit buildings, sidewalks, palm trees,
// street lamps, a beach and water with animated sparkle. Everything is
// generated from a seed so every visit (and every screenshot) sees the same
// city, and collision uses simple rectangle tests against the buildings.

export const BLOCK = 176;               // city block pitch (road + block)
export const ROAD = 56;                 // road width inside the pitch
export const COLS = 14;                 // blocks across
export const ROWS = 11;                 // blocks down (last row is the shore)
export const WORLD_W = COLS * BLOCK + ROAD;
export const SHORE_Y = ROWS * BLOCK + ROAD;       // where the beach strip begins
export const WORLD_H = SHORE_Y + 300;             // beach + a proper depth of sea

export const WATER_Y = SHORE_Y + 96;              // where the sea starts

const BUILDING_COLORS = [
  '#2b2350', '#33255e', '#3d2a63', '#472f6b', '#24304f', '#2e3a5c',
  '#4a2b52', '#38204a', '#263b4a', '#31435a', '#55304a', '#402a5e',
];
const NEON_COLORS = ['#ff5da2', '#22d3ee', '#facc15', '#a3e635', '#f472b6', '#38bdf8', '#fb923c', '#e879f9'];
const ROOF_COLORS = ['#171233', '#1d1740', '#221a47', '#191238'];

/** Small deterministic PRNG (mulberry32) so the city is identical per seed. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Axis-aligned rectangle overlap test used all over the game. */
export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Clamp a value into [lo, hi]. */
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Distance between two points. */
export function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }

/**
 * The road network: vertical avenues and horizontal streets on the block
 * grid. Each road is a rectangle plus an axis tag; traffic drives on them
 * and the minimap draws them.
 */
export function buildRoads() {
  const roads = [];
  for (let c = 0; c <= COLS; c++) {
    roads.push({ x: c * BLOCK, y: 0, w: ROAD, h: ROWS * BLOCK + ROAD, axis: 'v', index: c });
  }
  for (let r = 0; r <= ROWS; r++) {
    roads.push({ x: 0, y: r * BLOCK, w: COLS * BLOCK + ROAD, h: ROAD, axis: 'h', index: r });
  }
  return roads;
}

/** Centre line coordinate of the n-th vertical avenue / horizontal street. */
export function avenueX(i) { return i * BLOCK + ROAD / 2; }
export function streetY(i) { return i * BLOCK + ROAD / 2; }

/**
 * Named districts, used by mission briefings and the HUD location readout.
 * Returns the district name for a world position.
 */
export function districtAt(x, y) {
  if (y >= WATER_Y) return 'The Open Sea';
  if (y >= WATER_Y - 96) return 'Marina Beach';
  const col = Math.floor(x / (WORLD_W / 3));
  const row = Math.floor(y / (SHORE_Y / 3));
  const names = [
    ['Portside Yards', 'Neon Mile', 'Cielo Heights'],
    ['Old Cannery Row', 'Downtown Lumen', 'The Palms District'],
    ['South Docks', 'Harborfront', 'Vista del Mar'],
  ];
  return names[clamp(row, 0, 2)][clamp(col, 0, 2)];
}

/**
 * Generate the whole city for a seed: buildings (solid), palm trees, lamps,
 * beach umbrellas and the pier. Buildings carry a neon sign colour and a
 * lit-window pattern so the renders feel alive.
 */
export function buildCity(seed) {
  const rng = makeRng(seed);
  const buildings = [];
  const trees = [];
  const lamps = [];
  const umbrellas = [];
  // Neon signs bolted to building corners: the city names itself at night.
  const signs = [
    { x: avenueX(7) + 40, y: streetY(3) + 10, text: 'NEON MILE', color: '#ff5da2' },
    { x: avenueX(2) + 40, y: streetY(4) + 10, text: 'CANNERY ROW', color: '#facc15' },
    { x: avenueX(12) - 40, y: streetY(1) + 10, text: 'CIELO HEIGHTS', color: '#22d3ee' },
    { x: avenueX(7) + 40, y: streetY(5) + 10, text: 'DOWNTOWN LUMEN', color: '#a3e635' },
    { x: avenueX(4) + 40, y: streetY(9) + 10, text: 'SOUTH DOCKS', color: '#38bdf8' },
    { x: avenueX(10) - 40, y: streetY(10) - 14, text: 'FERRY PIER', color: '#f472b6' },
  ];
  // Plazas: open slabs with a fountain dot, for foot traffic to gather on.
  const plazas = [
    { x: avenueX(7), y: streetY(5), r: 46 },
    { x: avenueX(2), y: streetY(4), r: 38 },
    { x: avenueX(10), y: streetY(7), r: 40 },
  ];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const bx = c * BLOCK + ROAD;
      const by = r * BLOCK + ROAD;
      const inner = BLOCK - ROAD;
      const style = Math.floor(rng() * 3);
      const lots = [];
      if (style === 0) {
        lots.push({ x: bx + 8, y: by + 8, w: inner - 16, h: inner - 16 });
      } else if (style === 1) {
        lots.push({ x: bx + 8, y: by + 8, w: inner / 2 - 12, h: inner - 16 });
        lots.push({ x: bx + inner / 2 + 4, y: by + 8, w: inner / 2 - 12, h: inner - 16 });
      } else {
        lots.push({ x: bx + 8, y: by + 8, w: inner - 16, h: inner / 2 - 12 });
        lots.push({ x: bx + 8, y: by + inner / 2 + 4, w: inner / 2 - 12, h: inner / 2 - 12 });
        lots.push({ x: bx + inner / 2 + 4, y: by + inner / 2 + 4, w: inner / 2 - 12, h: inner / 2 - 12 });
      }
      for (const lot of lots) {
        const windows = [];
        const cols = Math.max(2, Math.floor(lot.w / 16));
        const rowsW = Math.max(2, Math.floor(lot.h / 16));
        for (let wy = 0; wy < rowsW; wy++) {
          for (let wx = 0; wx < cols; wx++) {
            if (rng() < 0.42) windows.push({ x: 6 + wx * 16, y: 6 + wy * 16, warm: rng() < 0.7 });
          }
        }
        buildings.push({
          ...lot,
          color: BUILDING_COLORS[Math.floor(rng() * BUILDING_COLORS.length)],
          roof: ROOF_COLORS[Math.floor(rng() * ROOF_COLORS.length)],
          neon: NEON_COLORS[Math.floor(rng() * NEON_COLORS.length)],
          sign: rng() < 0.55,
          windows,
        });
      }
      if (rng() < 0.8) trees.push({ x: bx + 4, y: by + 4, s: 0.8 + rng() * 0.5 });
      if (rng() < 0.6) trees.push({ x: bx + inner - 6, y: by + inner - 6, s: 0.8 + rng() * 0.5 });
      lamps.push({ x: bx - 6, y: by - 6 });
      lamps.push({ x: bx + inner + 2, y: by + inner + 2 });
    }
  }
  for (let x = 60; x < WORLD_W - 60; x += 90 + Math.floor(rng() * 90)) {
    umbrellas.push({ x, y: WATER_Y - 62 + rng() * 30, color: NEON_COLORS[Math.floor(rng() * NEON_COLORS.length)] });
    if (rng() < 0.7) trees.push({ x: x + 26, y: WATER_Y - 80 + rng() * 24, s: 1 + rng() * 0.4 });
  }
  const pier = { x: WORLD_W / 2 - 26, y: WATER_Y - 8, w: 52, h: 150 };
  return { buildings, trees, lamps, umbrellas, pier, signs, plazas, roads: buildRoads() };
}

/** The nearest named landmark (neon sign) to a point, for flavour text. */
export function landmarkNear(city, x, y) {
  let best = null; let bestD = 320;
  for (const s of city.signs) {
    const d = dist(x, y, s.x, s.y);
    if (d < bestD) { bestD = d; best = s.text; }
  }
  return best;
}

/** True when a rectangle hits any building or leaves the world. */
export function collides(city, rect) {
  if (rect.x < 4 || rect.y < 4 || rect.x + rect.w > WORLD_W - 4 || rect.y + rect.h > WORLD_H - 4) return true;
  for (const b of city.buildings) {
    if (rectsOverlap(rect, b)) return true;
  }
  return false;
}

/** True when a point is in deep water. */
export function inWater(x, y) { return y > WATER_Y + 26; }

/** True when a point stands on the pier deck (solid over the water). */
export function onPier(city, x, y) {
  const p = city.pier;
  return x >= p.x - 4 && x <= p.x + p.w + 4 && y >= p.y && y <= p.y + p.h;
}
