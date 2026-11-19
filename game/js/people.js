// People of Sunspire City: the player on foot, pedestrians and foot cops.
// Pedestrians stroll the sidewalks and flee from gunfire and speeding cars;
// cops on foot chase the player and swing when they catch up.

import { clamp, dist, angleTo, pick } from './rng.js';
import {
  WORLD_W, WORLD_H, TILE, ROAD_HALF, ROAD_ROWS, ROAD_COLS,
  nearestRoadPoint, hitsBuilding, resolveBuildingCollision,
} from './town.js';

const PED_COLORS = ['#e8b04b', '#7fb3d5', '#c96f7f', '#8fc97f', '#b08fd5', '#d5c28f', '#e07a4f'];
const PED_NAMES = ['Mara', 'Theo', 'June', 'Rafi', 'Bea', 'Cole', 'Ana', 'Miles', 'Priya', 'Otis'];

let nextPedId = 1;

/** The player, on foot. */
export function makePlayer(x, y) {
  return {
    x, y, angle: -Math.PI / 2,
    speed: 0,
    health: 100,
    cash: 120,
    ammo: 24,
    inCar: null, // car object when driving
    punchTimer: 0,
    shootTimer: 0,
    muzzle: 0,
    invuln: 0,
    walking: false,
  };
}

/** A pedestrian strolling a sidewalk. */
export function makePed(rnd, x, y) {
  const road = nearestRoadPoint(x, y);
  return {
    id: nextPedId++,
    name: pick(rnd, PED_NAMES),
    color: pick(rnd, PED_COLORS),
    x, y,
    angle: rnd() * Math.PI * 2,
    speed: 26 + rnd() * 22,
    axis: road ? road.axis : 'h',
    dir: rnd() < 0.5 ? -1 : 1,
    flee: 0, // seconds of fleeing left
    fleeX: 0, fleeY: 0,
    panic: false,
    retarget: 0,
  };
}

/** Spawn pedestrians near roads. */
export function spawnPeds(rnd, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const c = pick(rnd, ROAD_COLS);
    const r = pick(rnd, ROAD_ROWS);
    const x = (c + 0.5) * TILE + (rnd() < 0.5 ? -1 : 1) * (ROAD_HALF + 12 + rnd() * 20);
    const y = (r + 0.5) * TILE + (rnd() < 0.5 ? -1 : 1) * (ROAD_HALF + 12 + rnd() * 20);
    out.push(makePed(rnd, clamp(x, 40, WORLD_W - 40), clamp(y, 40, WORLD_H - 40)));
  }
  return out;
}

/** Move the player on foot. input: {mx, my} normalized move vector. */
export function movePlayerOnFoot(player, input, dt, buildings) {
  const speed = 175;
  player.walking = input.mx !== 0 || input.my !== 0;
  const nx = player.x + input.mx * speed * dt;
  const ny = player.y + input.my * speed * dt;
  const fixed = resolveBuildingCollision(buildings, nx, ny, 15);
  player.x = clamp(fixed.x, 24, WORLD_W - 24);
  player.y = clamp(fixed.y, 24, WORLD_H - 24);
  if (player.walking) player.angle = Math.atan2(input.my, input.mx);
  player.punchTimer = Math.max(0, player.punchTimer - dt);
  player.shootTimer = Math.max(0, player.shootTimer - dt);
  player.muzzle = Math.max(0, player.muzzle - dt);
  player.invuln = Math.max(0, player.invuln - dt);
}

/**
 * Fire the player's pistol toward (tx,ty). Hits the nearest ped / cop / car
 * in a narrow cone within range. Returns a hit report or null.
 */
export function playerShoot(player, tx, ty, peds, cops, cars) {
  if (player.shootTimer > 0 || player.ammo <= 0) return null;
  player.shootTimer = 0.28;
  player.ammo -= 1;
  player.muzzle = 0.08;
  const aim = angleTo(player.x, player.y, tx, ty);
  player.angle = aim;
  const range = 460;
  let best = null;
  let bestD = range;
  const consider = (obj, x, y, radius, kind) => {
    const d = dist(player.x, player.y, x, y);
    if (d > bestD || d < 12) return;
    const a = angleTo(player.x, player.y, x, y);
    let da = Math.abs(((a - aim) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    if (da > 0.16) return;
    bestD = d; best = { obj, x, y, kind, radius };
  };
  for (const p of peds) consider(p, p.x, p.y, 14, 'ped');
  for (const c of cops) consider(c, c.x, c.y, 15, 'cop');
  for (const car of cars) {
    if (car.traffic && Math.abs(car.speed) < 5) continue;
    consider(car, car.x, car.y, 26, 'car');
  }
  if (best) {
    best.hitX = player.x + Math.cos(aim) * bestD;
    best.hitY = player.y + Math.sin(aim) * bestD;
    return best;
  }
  return { kind: 'miss', hitX: player.x + Math.cos(aim) * range, hitY: player.y + Math.sin(aim) * range };
}

/** Punch: damages the nearest ped / cop within arm's reach in front. */
export function playerPunch(player, peds, cops) {
  if (player.punchTimer > 0) return null;
  player.punchTimer = 0.4;
  const reach = 42;
  const px = player.x + Math.cos(player.angle) * reach;
  const py = player.y + Math.sin(player.angle) * reach;
  for (const p of peds) {
    if (dist(px, py, p.x, p.y) < 26) return { kind: 'ped', obj: p };
  }
  for (const c of cops) {
    if (dist(px, py, c.x, c.y) < 28) return { kind: 'cop', obj: c };
  }
  return { kind: 'air' };
}

/** Update one pedestrian: stroll, or flee from a threat point. */
export function updatePed(ped, dt, buildings, threats) {
  // A threat (gunshot, speeding car) sends them running away.
  for (const t of threats) {
    if (dist(ped.x, ped.y, t.x, t.y) < t.radius) {
      ped.flee = 2.5;
      ped.fleeX = ped.x - t.x;
      ped.fleeY = ped.y - t.y;
      ped.panic = true;
    }
  }
  if (ped.flee > 0) {
    ped.flee -= dt;
    const len = Math.hypot(ped.fleeX, ped.fleeY) || 1;
    const nx = ped.x + (ped.fleeX / len) * 150 * dt;
    const ny = ped.y + (ped.fleeY / len) * 150 * dt;
    const fixed = resolveBuildingCollision(buildings, nx, ny, 13);
    ped.x = clamp(fixed.x, 24, WORLD_W - 24);
    ped.y = clamp(fixed.y, 24, WORLD_H - 24);
    ped.angle = Math.atan2(ped.fleeY, ped.fleeX);
    if (ped.flee <= 0) ped.panic = false;
    return;
  }
  ped.retarget -= dt;
  if (ped.retarget <= 0) {
    ped.retarget = 2 + Math.random() * 4;
    // At an intersection, sometimes turn onto the crossing road.
    const road = nearestRoadPoint(ped.x, ped.y);
    if (road && Math.random() < 0.45) {
      ped.axis = road.axis === 'h' ? 'v' : 'h';
      ped.dir = Math.random() < 0.5 ? -1 : 1;
    }
  }
  let nx = ped.x, ny = ped.y;
  if (ped.axis === 'h') nx += ped.dir * ped.speed * dt;
  else ny += ped.dir * ped.speed * dt;
  // Stay near the sidewalk: drift back toward the road edge line.
  const road = nearestRoadPoint(ped.x, ped.y);
  if (road) {
    if (road.axis === 'h') ny += clamp((road.y + ROAD_HALF + 16 - ped.y) * 0.4, -30, 30) * dt;
    else nx += clamp((road.x + ROAD_HALF + 16 - ped.x) * 0.4, -30, 30) * dt;
  }
  const fixed = resolveBuildingCollision(buildings, nx, ny, 13);
  ped.x = clamp(fixed.x, 24, WORLD_W - 24);
  ped.y = clamp(fixed.y, 24, WORLD_H - 24);
  ped.angle = ped.axis === 'h' ? (ped.dir > 0 ? 0 : Math.PI) : (ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  if (ped.x <= 30 || ped.x >= WORLD_W - 30) ped.dir *= -1;
  if (ped.y <= 30 || ped.y >= WORLD_H - 30) ped.dir *= -1;
}

/** A foot cop: chases the player and swings up close. */
export function makeCop(x, y) {
  return { x, y, angle: 0, speed: 165, swing: 0, hp: 3 };
}

/** Chase the player; returns 'hit' when a swing lands. */
export function updateCop(cop, player, dt, buildings) {
  const d = dist(cop.x, cop.y, player.x, player.y);
  cop.angle = angleTo(cop.x, cop.y, player.x, player.y);
  cop.swing = Math.max(0, cop.swing - dt);
  if (d > 34) {
    const nx = cop.x + Math.cos(cop.angle) * cop.speed * dt;
    const ny = cop.y + Math.sin(cop.angle) * cop.speed * dt;
    const fixed = resolveBuildingCollision(buildings, nx, ny, 14);
    cop.x = clamp(fixed.x, 24, WORLD_W - 24);
    cop.y = clamp(fixed.y, 24, WORLD_H - 24);
  } else if (cop.swing <= 0) {
    cop.swing = 0.9;
    return 'hit';
  }
  return null;
}
