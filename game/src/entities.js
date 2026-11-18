// entities.js — the living traffic of Neon Harbor.
// Civilian cars drive the avenue/street grid, turning at intersections and
// braking for obstacles; parked cars wait at curbs to be stolen; pedestrians
// stroll the sidewalks and flee from danger; police units (cars and foot
// officers) hunt the player while a wanted level is active.

import {
  BLOCK, ROAD, COLS, ROWS, WORLD_W, WATER_Y,
  avenueX, streetY, clamp, dist, collides, makeRng,
} from './world.js';

export const CAR_COLORS = ['#e2e8f0', '#94a3b8', '#f87171', '#fb923c', '#facc15', '#34d399', '#38bdf8', '#a78bfa', '#f472b6', '#1f2937'];
export const PED_COLORS = ['#fda4af', '#fcd34d', '#6ee7b7', '#93c5fd', '#c4b5fd', '#fdba74', '#f9a8d4', '#a5f3fc'];

let nextId = 1;

/** A car: position is its centre; angle in radians (0 = east). */
export function makeCar(x, y, angle, color, kind) {
  return {
    id: nextId++, kind, x, y, angle, speed: 0,
    w: 44, h: 22, color, health: 100, driver: null,
    // traffic AI state
    axis: Math.abs(Math.cos(angle)) > 0.5 ? 'h' : 'v',
    dir: (Math.abs(Math.cos(angle)) > 0.5 ? Math.sign(Math.cos(angle)) : Math.sign(Math.sin(angle))) || 1,
    lane: 0, turnCooldown: 0, stuck: 0,
    sirenPhase: Math.random() * Math.PI * 2,
    dead: false,
  };
}

/** The car's axis-aligned bounding box (slightly forgiving). */
export function carRect(car) {
  const horiz = Math.abs(Math.cos(car.angle)) > 0.5;
  const w = horiz ? car.w : car.h;
  const h = horiz ? car.h : car.w;
  return { x: car.x - w / 2, y: car.y - h / 2, w, h };
}

/** A pedestrian (also used for foot police with kind 'cop'). */
export function makePed(x, y, color, kind) {
  return {
    id: nextId++, kind, x, y, vx: 0, vy: 0, angle: Math.random() * Math.PI * 2,
    color, health: 100, state: 'walk', wanderT: Math.random() * 3,
    speed: 26 + Math.random() * 22, dead: false, shootCd: 0,
  };
}

/** Pick a point on a sidewalk: just inside a block edge, clear of buildings. */
function sidewalkPoint(rng) {
  const c = Math.floor(rng() * COLS);
  const r = Math.floor(rng() * ROWS);
  const side = Math.floor(rng() * 4);
  const bx = c * BLOCK + ROAD;
  const by = r * BLOCK + ROAD;
  const inner = BLOCK - ROAD;
  if (side === 0) return { x: bx + 4 + rng() * (inner - 8), y: by - 8 };
  if (side === 1) return { x: bx + 4 + rng() * (inner - 8), y: by + inner + 2 };
  if (side === 2) return { x: bx - 8, y: by + 4 + rng() * (inner - 8) };
  return { x: bx + inner + 2, y: by + 4 + rng() * (inner - 8) };
}

/** Spawn the ambient city population: moving traffic, parked cars, walkers. */
export function spawnAmbient(city, seed) {
  const rng = makeRng(seed ^ 0x9e3779b9);
  const cars = [];
  const peds = [];
  // Moving traffic on random avenues/streets.
  for (let i = 0; i < 26; i++) {
    const vertical = rng() < 0.5;
    const dir = rng() < 0.5 ? 1 : -1;
    let x, y, angle;
    if (vertical) {
      const a = Math.floor(rng() * (COLS + 1));
      x = avenueX(a) + (dir > 0 ? -11 : 11);
      y = 80 + rng() * (WATER_Y - 240);
      angle = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      const s = Math.floor(rng() * (ROWS + 1));
      y = streetY(s) + (dir > 0 ? 11 : -11);
      x = 80 + rng() * (WORLD_W - 160);
      angle = dir > 0 ? 0 : Math.PI;
    }
    const car = makeCar(x, y, angle, CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)], 'traffic');
    car.speed = 60 + rng() * 50;
    car.axis = vertical ? 'v' : 'h';
    car.dir = dir;
    cars.push(car);
  }
  // Parked cars hugging curbs: the stealable fleet.
  for (let i = 0; i < 30; i++) {
    const vertical = rng() < 0.5;
    let x, y, angle;
    if (vertical) {
      const a = Math.floor(rng() * (COLS + 1));
      x = avenueX(a) + (rng() < 0.5 ? -20 : 20);
      y = 70 + rng() * (WATER_Y - 220);
      angle = Math.PI / 2;
    } else {
      const s = Math.floor(rng() * (ROWS + 1));
      y = streetY(s) + (rng() < 0.5 ? -20 : 20);
      x = 70 + rng() * (WORLD_W - 140);
      angle = 0;
    }
    const car = makeCar(x, y, angle, CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)], 'parked');
    car.speed = 0;
    cars.push(car);
  }
  for (let i = 0; i < 42; i++) {
    const p = sidewalkPoint(rng);
    peds.push(makePed(p.x, p.y, PED_COLORS[Math.floor(rng() * PED_COLORS.length)], 'civilian'));
  }
  return { cars, peds };
}

/** Nearest car to a point within `range`, or null. */
export function nearestCar(cars, x, y, range) {
  let best = null; let bestD = range;
  for (const car of cars) {
    if (car.dead) continue;
    const d = dist(x, y, car.x, car.y);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

/**
 * Advance one traffic car along its road. It keeps its lane, slows for a car
 * or pedestrian ahead, and at intersections sometimes turns onto the
 * crossing road. Returns 'crash' when it bumps something hard.
 */
export function updateTraffic(car, dt, city, cars, peds, playerPos) {
  if (car.kind !== 'traffic') return null;
  car.turnCooldown -= dt;
  const cruise = 95;
  // Look ahead for obstacles.
  const fx = car.x + Math.cos(car.angle) * 40;
  const fy = car.y + Math.sin(car.angle) * 40;
  let blocked = false;
  for (const other of cars) {
    if (other === car || other.dead) continue;
    if (dist(fx, fy, other.x, other.y) < 30) { blocked = true; break; }
  }
  if (!blocked) {
    for (const ped of peds) {
      if (!ped.dead && dist(fx, fy, ped.x, ped.y) < 22) { blocked = true; break; }
    }
  }
  if (!blocked && playerPos && dist(fx, fy, playerPos.x, playerPos.y) < 24) blocked = true;
  const target = blocked ? 0 : cruise;
  car.speed += clamp(target - car.speed, -260 * dt, 90 * dt);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  // At an intersection, maybe turn.
  const nearAve = Math.round((car.x - ROAD / 2) / BLOCK);
  const nearSt = Math.round((car.y - ROAD / 2) / BLOCK);
  const onAve = Math.abs(car.x - avenueX(clamp(nearAve, 0, COLS))) < 16;
  const onSt = Math.abs(car.y - streetY(clamp(nearSt, 0, ROWS))) < 16;
  if (onAve && onSt && car.turnCooldown <= 0 && Math.random() < 0.35) {
    car.turnCooldown = 2.5;
    const turn = Math.random() < 0.5 ? 1 : -1;
    car.angle += turn * Math.PI / 2;
    // Snap into the correct lane of the new road.
    if (Math.abs(Math.cos(car.angle)) > 0.5) {
      car.y = streetY(clamp(nearSt, 0, ROWS)) + (Math.cos(car.angle) > 0 ? 11 : -11);
      car.axis = 'h'; car.dir = Math.sign(Math.cos(car.angle));
    } else {
      car.x = avenueX(clamp(nearAve, 0, COLS)) + (Math.sin(car.angle) > 0 ? -11 : 11);
      car.axis = 'v'; car.dir = Math.sign(Math.sin(car.angle));
    }
  }
  // Wrap around the map edges so traffic never drains away.
  if (car.x < -60) car.x = WORLD_W + 50; if (car.x > WORLD_W + 60) car.x = -50;
  if (car.y < -60) car.y = WATER_Y - 120; if (car.y > WATER_Y - 60) car.y = 40;
  // Buildings should never be entered; if a turn clipped one, back out.
  if (collides(city, carRect(car))) {
    car.x -= Math.cos(car.angle) * car.speed * dt * 1.6;
    car.y -= Math.sin(car.angle) * car.speed * dt * 1.6;
    car.speed = 0;
    car.stuck += dt;
    if (car.stuck > 1.2) { car.angle += Math.PI; car.stuck = 0; }
  } else car.stuck = 0;
  return null;
}

/**
 * Advance a pedestrian: wander along sidewalks, flee screaming from a threat
 * point when one is given, and keep out of buildings and the sea.
 */
export function updatePed(ped, dt, city, threat) {
  if (ped.dead) return;
  ped.wanderT -= dt;
  let tx = 0, ty = 0;
  if (threat && dist(ped.x, ped.y, threat.x, threat.y) < 130) {
    const a = Math.atan2(ped.y - threat.y, ped.x - threat.x);
    tx = Math.cos(a); ty = Math.sin(a);
    ped.state = 'flee';
  } else {
    ped.state = 'walk';
    if (ped.wanderT <= 0) {
      ped.wanderT = 2 + Math.random() * 3;
      ped.angle = Math.random() * Math.PI * 2;
    }
    tx = Math.cos(ped.angle); ty = Math.sin(ped.angle);
  }
  const sp = ped.state === 'flee' ? ped.speed * 2.1 : ped.speed;
  const nx = ped.x + tx * sp * dt;
  const ny = ped.y + ty * sp * dt;
  const box = { x: nx - 6, y: ny - 6, w: 12, h: 12 };
  if (!collides(city, box) && ny < WATER_Y - 30) {
    ped.x = nx; ped.y = ny;
    ped.vx = tx * sp; ped.vy = ty * sp;
  } else {
    ped.angle += Math.PI * (0.6 + Math.random() * 0.5);
    ped.wanderT = 0.4;
  }
}

/**
 * Police car behaviour: pursue the player's position, ram to stop, and keep
 * pressure. Steering is a simple pursuit with obstacle slide.
 */
export function updatePoliceCar(car, dt, city, target) {
  const want = Math.atan2(target.y - car.y, target.x - car.x);
  let diff = want - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const d = dist(car.x, car.y, target.x, target.y);
  const maxSpeed = d > 260 ? 252 : 205;
  car.angle += clamp(diff, -2.4 * dt, 2.4 * dt);
  const accel = Math.cos(diff) > -0.2 ? 300 : -160;
  car.speed += clamp(accel * dt, -300 * dt, 300 * dt);
  car.speed = clamp(car.speed, -70, maxSpeed);
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  if (!collides(city, { x: nx - 16, y: ny - 16, w: 32, h: 32 })) {
    car.x = nx; car.y = ny;
  } else {
    // Slide along the wall and bleed speed.
    if (!collides(city, { x: nx - 16, y: car.y - 16, w: 32, h: 32 })) car.x = nx;
    else if (!collides(city, { x: car.x - 16, y: ny - 16, w: 32, h: 32 })) car.y = ny;
    car.speed *= 0.45;
  }
  car.sirenPhase += dt * 9;
}

/**
 * Foot officer behaviour: run at the player, and inside range stop and fire
 * (the caller turns `shootCd` hits into damage). Close enough for long
 * enough and the caller busts the player.
 */
export function updateCop(ped, dt, city, target) {
  if (ped.dead) return;
  ped.shootCd -= dt;
  const d = dist(ped.x, ped.y, target.x, target.y);
  if (d > 74) {
    const a = Math.atan2(target.y - ped.y, target.x - ped.x);
    const nx = ped.x + Math.cos(a) * 118 * dt;
    const ny = ped.y + Math.sin(a) * 118 * dt;
    if (!collides(city, { x: nx - 6, y: ny - 6, w: 12, h: 12 })) { ped.x = nx; ped.y = ny; }
    ped.angle = a;
  } else {
    ped.angle = Math.atan2(target.y - ped.y, target.x - ped.x);
  }
}

/** Spawn a police car at a road edge a fair distance from the player. */
export function spawnPoliceCar(player, rng) {
  for (let tries = 0; tries < 12; tries++) {
    const vertical = rng() < 0.5;
    let x, y, angle;
    if (vertical) {
      const a = Math.floor(rng() * (COLS + 1));
      x = avenueX(a);
      y = clamp(player.y + (rng() < 0.5 ? -1 : 1) * (420 + rng() * 260), 60, WATER_Y - 120);
      angle = y < player.y ? Math.PI / 2 : -Math.PI / 2;
    } else {
      const s = Math.floor(rng() * (ROWS + 1));
      y = streetY(s);
      x = clamp(player.x + (rng() < 0.5 ? -1 : 1) * (420 + rng() * 260), 60, WORLD_W - 60);
      angle = x < player.x ? 0 : Math.PI;
    }
    if (dist(x, y, player.x, player.y) < 340) continue;
    const car = makeCar(x, y, angle, '#f8fafc', 'police');
    return car;
  }
  const car = makeCar(clamp(player.x + 520, 60, WORLD_W - 60), clamp(player.y - 380, 60, WATER_Y - 100), Math.PI, '#f8fafc', 'police');
  return car;
}

/** Spawn a foot officer near (but not on top of) the player. */
export function spawnCop(player, rng) {
  const a = rng() * Math.PI * 2;
  const x = clamp(player.x + Math.cos(a) * 300, 30, WORLD_W - 30);
  const y = clamp(player.y + Math.sin(a) * 300, 30, WATER_Y - 60);
  const ped = makePed(x, y, '#1e3a8a', 'cop');
  ped.health = 60;
  return ped;
}
