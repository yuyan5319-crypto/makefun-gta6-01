// Sunspire City: the map. A fixed grid of avenues and streets, blocks of
// buildings between them, a beach and pier along the south shore and the harbor
// docks on the east edge. Everything is generated from one seed, so the city
// never changes shape between loads.

import { mulberry32, intBetween, pick, clamp } from './rng.js';

export const TILE = 64;
export const COLS = 40;
export const ROWS = 30;
export const WORLD_W = COLS * TILE; // 2560
export const WORLD_H = ROWS * TILE; // 1920
export const ROAD_HALF = 58; // half-width of a road in px
export const CITY_SEED = 20261119;

// Tile rows / columns that carry roads (centres, in tile units).
export const ROAD_ROWS = [2, 7, 12, 17, 22, 27];
export const ROAD_COLS = [3, 9, 15, 21, 27, 33];

// Named places, in world px. Missions and jobs point at these.
export const PLACES = {
  plaza: { x: 15.5 * TILE, y: 12.5 * TILE, name: 'Sol Plaza' },
  safehouse: { x: 3.5 * TILE, y: 27.5 * TILE, name: 'Dana\u2019s Safehouse' },
  pier: { x: 21.5 * TILE, y: 29.2 * TILE, name: 'Sunspire Pier' },
  harbor: { x: 37.5 * TILE, y: 17.5 * TILE, name: 'Harbor Docks' },
  bank: { x: 15.5 * TILE, y: 7.5 * TILE, name: 'Meridian Bank' },
  garage: { x: 27.5 * TILE, y: 12.5 * TILE, name: 'Lou\u2019s Garage' },
  market: { x: 9.5 * TILE, y: 22.5 * TILE, name: 'Night Market' },
  hotel: { x: 21.5 * TILE, y: 2.5 * TILE, name: 'The Palms Hotel' },
};

const BUILDING_COLORS = ['#c98a5e', '#b07a8a', '#8fa3b8', '#a8a06a', '#7d8ba0', '#c2b49a', '#9a7fbf', '#6f9a8a'];
const ROOF_COLORS = ['#5e4a3a', '#4a5568', '#3f4a3a', '#6b4a5e', '#44506a'];

/** Build the whole city from the fixed seed. Returns the town object. */
export function buildTown() {
  const rnd = mulberry32(CITY_SEED);
  const buildings = [];
  const palms = [];
  const lamps = [];

  // One or two buildings per block, with a margin from the road edge.
  for (let ri = 0; ri < ROAD_ROWS.length - 1; ri++) {
    for (let ci = 0; ci < ROAD_COLS.length - 1; ci++) {
      const top = (ROAD_ROWS[ri] + 0.5) * TILE + ROAD_HALF + 14;
      const bottom = (ROAD_ROWS[ri + 1] + 0.5) * TILE - ROAD_HALF - 14;
      const left = (ROAD_COLS[ci] + 0.5) * TILE + ROAD_HALF + 14;
      const right = (ROAD_COLS[ci + 1] + 0.5) * TILE - ROAD_HALF - 14;
      const bw = right - left;
      const bh = bottom - top;
      if (bw < 70 || bh < 70) continue;
      const downtown = ri >= 1 && ri <= 2 && ci >= 2 && ci <= 3;
      const n = downtown || rnd() < 0.55 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        let x, y, w, h;
        if (n === 1) {
          w = bw * (0.55 + rnd() * 0.3); h = bh * (0.55 + rnd() * 0.3);
          x = left + (bw - w) / 2; y = top + (bh - h) / 2;
        } else if (k === 0) {
          w = bw * 0.44; h = bh * (0.62 + rnd() * 0.2);
          x = left; y = top + (bh - h) / 2;
        } else {
          w = bw * 0.44; h = bh * (0.5 + rnd() * 0.3);
          x = right - w; y = top + (bh - h) / 2;
        }
        buildings.push({
          x, y, w, h,
          color: pick(rnd, BUILDING_COLORS),
          roof: pick(rnd, ROOF_COLORS),
          tall: downtown && rnd() < 0.7,
          windows: Math.max(2, Math.floor(w / 46)),
          floors: Math.max(2, Math.floor(h / 52)),
        });
      }
      // Palms along the block's south sidewalk.
      const palmCount = intBetween(rnd, 1, 3);
      for (let p = 0; p < palmCount; p++) {
        palms.push({
          x: left + 20 + rnd() * Math.max(1, bw - 40),
          y: bottom + 8,
          lean: (rnd() - 0.5) * 0.35,
        });
      }
    }
  }

  // Street lamps at every intersection corner.
  for (const r of ROAD_ROWS) {
    for (const c of ROAD_COLS) {
      lamps.push({ x: (c + 0.5) * TILE - ROAD_HALF - 8, y: (r + 0.5) * TILE - ROAD_HALF - 8 });
    }
  }

  // Twenty sun coins on sidewalks for collectors.
  const coins = [];
  let guard = 0;
  while (coins.length < 20 && guard++ < 400) {
    const x = intBetween(rnd, 2, COLS - 2) * TILE + intBetween(rnd, -20, 20);
    const y = intBetween(rnd, 2, ROWS - 2) * TILE + intBetween(rnd, -20, 20);
    if (isRoadAt(x, y) || hitsBuilding(buildings, x, y, 24)) continue;
    coins.push({ x, y, taken: false, phase: rnd() * Math.PI * 2 });
  }

  return { buildings, palms, lamps, coins };
}

/** Is world point (x,y) on a road (within ROAD_HALF of a road centre)? */
export function isRoadAt(x, y) {
  for (const r of ROAD_ROWS) {
    if (Math.abs(y - (r + 0.5) * TILE) <= ROAD_HALF) return true;
  }
  for (const c of ROAD_COLS) {
    if (Math.abs(x - (c + 0.5) * TILE) <= ROAD_HALF) return true;
  }
  return false;
}

/** Centre of the nearest road, for snapping traffic and pedestrians. */
export function nearestRoadPoint(x, y) {
  let best = null;
  let bestD = Infinity;
  for (const r of ROAD_ROWS) {
    const cy = (r + 0.5) * TILE;
    const d = Math.abs(y - cy);
    if (d < bestD) { bestD = d; best = { x: clamp(x, TILE, WORLD_W - TILE), y: cy, axis: 'h' }; }
  }
  for (const c of ROAD_COLS) {
    const cx = (c + 0.5) * TILE;
    const d = Math.abs(x - cx);
    if (d < bestD) { bestD = d; best = { x: cx, y: clamp(y, TILE, WORLD_H - TILE), axis: 'v' }; }
  }
  return best;
}

/** Does a circle at (x,y) radius r touch any building? */
export function hitsBuilding(buildings, x, y, r) {
  for (const b of buildings) {
    const cx = clamp(x, b.x, b.x + b.w);
    const cy = clamp(y, b.y, b.y + b.h);
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy < r * r) return b;
  }
  return null;
}

/** Push a circle out of buildings: returns corrected {x, y}. */
export function resolveBuildingCollision(buildings, x, y, r) {
  for (let pass = 0; pass < 2; pass++) {
    const b = hitsBuilding(buildings, x, y, r);
    if (!b) break;
    const cx = clamp(x, b.x, b.x + b.w);
    const cy = clamp(y, b.y, b.y + b.h);
    let dx = x - cx, dy = y - cy;
    let d = Math.hypot(dx, dy);
    if (d < 0.001) {
      // Centre inside the rect: push out along the smallest penetration.
      const pl = x - b.x + r, pr = b.x + b.w - x + r;
      const pt = y - b.y + r, pb = b.y + b.h - y + r;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) x = b.x - r; else if (m === pr) x = b.x + b.w + r;
      else if (m === pt) y = b.y - r; else y = b.y + b.h + r;
      continue;
    }
    dx /= d; dy /= d;
    x = cx + dx * r; y = cy + dy * r;
  }
  return { x, y };
}

/** A random point on a road, for spawning traffic and parked cars. */
export function randomRoadPoint(rnd) {
  if (rnd() < 0.5) {
    const r = pick(rnd, ROAD_ROWS);
    return { x: TILE + rnd() * (WORLD_W - 2 * TILE), y: (r + 0.5) * TILE, axis: 'h' };
  }
  const c = pick(rnd, ROAD_COLS);
  return { x: (c + 0.5) * TILE, y: TILE + rnd() * (WORLD_H - 2 * TILE), axis: 'v' };
}

/** Y of the beach / water line: south of this is sand, then sea. */
export const BEACH_Y = (ROWS - 1.6) * TILE;
export const SEA_Y = (ROWS - 0.7) * TILE;
