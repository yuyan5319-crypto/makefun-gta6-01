// Vehicles for Sunspire Heat: arcade physics, road traffic and police pursuit.
// Cars are plain objects; this module owns how they move and collide.

import { clamp, angleDelta, dist } from './rng.js';
import { WORLD_W, WORLD_H, ROAD_HALF, hitsBuilding, resolveBuildingCollision, randomRoadPoint } from './town.js';

export const CAR_DEFS = {
  taxi: { name: 'Sunspire Taxi', color: '#ffc21c', top: 88, accel: 340, maxSpeed: 300, grip: 2.6, len: 46, wid: 22 },
  sedan: { name: 'Meridian Sedan', color: '#5e8fd0', top: 92, accel: 320, maxSpeed: 310, grip: 2.4, len: 46, wid: 22 },
  coupe: { name: 'Vortex Coupe', color: '#d0483e', top: 96, accel: 400, maxSpeed: 380, grip: 3.1, len: 44, wid: 21 },
  truck: { name: 'Harbor Hauler', color: '#7a7d84', top: 70, accel: 240, maxSpeed: 230, grip: 1.9, len: 58, wid: 26 },
  van: { name: 'Parcel Van', color: '#e8e2d2', top: 76, accel: 260, maxSpeed: 250, grip: 2.0, len: 52, wid: 24 },
  police: { name: 'SPPD Interceptor', color: '#20242e', top: 100, accel: 420, maxSpeed: 400, grip: 3.0, len: 47, wid: 22 },
};

let nextCarId = 1;

/** Make a car of a given def at (x,y) facing angle. */
export function makeCar(kind, x, y, angle, opts = {}) {
  const def = CAR_DEFS[kind];
  return {
    id: nextCarId++,
    kind, def,
    x, y, angle,
    speed: 0,
    traffic: !!opts.traffic,
    axis: opts.axis || 'h',
    dir: opts.dir || 1,
    lane: opts.lane || 0,
    cruise: opts.cruise || (190 + Math.random() * 60),
    police: kind === 'police',
    target: opts.target || null, // police: who to chase
    damage: 0,
    brakeLight: false,
    nitro: 1, // 0..1 nitro meter
  };
}

/** Drive a car with arcade inputs. input: {throttle -1..1, steer -1..1, brake, nitro}. */
export function driveCar(car, input, dt, buildings) {
  const def = car.def;
  const boost = input.nitro && car.nitro > 0 ? 1.5 : 1;
  if (input.nitro && car.nitro > 0) car.nitro = Math.max(0, car.nitro - dt * 0.5);
  else car.nitro = Math.min(1, car.nitro + dt * 0.12);

  const forward = input.throttle;
  car.speed += forward * def.accel * boost * dt;
  if (input.brake) car.speed -= Math.sign(car.speed) * 520 * dt;
  // Drag + rolling resistance.
  car.speed -= car.speed * 0.55 * dt;
  if (Math.abs(car.speed) < 4 && forward === 0) car.speed = 0;
  car.speed = clamp(car.speed, -def.maxSpeed * 0.45, def.maxSpeed * boost);

  // Steering scales with speed; reverse flips it.
  const steerAuthority = clamp(Math.abs(car.speed) / 90, 0, 1);
  car.angle += input.steer * def.grip * steerAuthority * Math.sign(car.speed || 1) * dt;

  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  const hit = hitsBuilding(buildings, nx, ny, def.len * 0.42);
  if (hit) {
    // Scrape: keep the axis that is free, bleed speed.
    const freeX = !hitsBuilding(buildings, nx, car.y, def.len * 0.42);
    const freeY = !hitsBuilding(buildings, car.x, ny, def.len * 0.42);
    if (freeX) car.x = nx;
    if (freeY) car.y = ny;
    if (!freeX && !freeY) {
      const fixed = resolveBuildingCollision(buildings, nx, ny, def.len * 0.42);
      car.x = fixed.x; car.y = fixed.y;
    }
    car.speed *= 0.55;
    car.damage += Math.abs(car.speed) * 0.002;
  } else {
    car.x = nx; car.y = ny;
  }
  car.x = clamp(car.x, 30, WORLD_W - 30);
  car.y = clamp(car.y, 30, WORLD_H - 30);
  car.brakeLight = input.brake || forward < 0;
}

/** Move a traffic car along its road. Wraps at the map edge. */
export function updateTraffic(car, dt, cars) {
  // Slow down for a car ahead in the same lane.
  let ahead = Infinity;
  for (const other of cars) {
    if (other === car || !other.traffic) continue;
    if (other.axis !== car.axis || Math.sign(other.dir) !== Math.sign(car.dir)) continue;
    const laneGap = car.axis === 'h'
      ? Math.abs(other.y - car.y)
      : Math.abs(other.x - car.x);
    if (laneGap > 30) continue;
    const gap = car.axis === 'h'
      ? (other.x - car.x) * car.dir
      : (other.y - car.y) * car.dir;
    if (gap > 0 && gap < ahead) ahead = gap;
  }
  const want = ahead < 70 ? 0 : car.cruise;
  car.speed += (want - car.speed) * Math.min(1, dt * 1.4);
  if (car.axis === 'h') {
    car.x += car.dir * car.speed * dt;
    car.angle = car.dir > 0 ? 0 : Math.PI;
    if (car.x > WORLD_W - 40) car.x = 40;
    if (car.x < 40) car.x = WORLD_W - 40;
  } else {
    car.y += car.dir * car.speed * dt;
    car.angle = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    if (car.y > WORLD_H - 40) car.y = 40;
    if (car.y < 40) car.y = WORLD_H - 40;
  }
}

/** Steer a police car toward its target with a simple pursuit model. */
export function updatePolice(car, dt, buildings) {
  const t = car.target;
  if (!t) return;
  const wantAngle = Math.atan2(t.y - car.y, t.x - car.x);
  const turn = angleDelta(car.angle, wantAngle);
  const d = dist(car.x, car.y, t.x, t.y);
  const throttle = d > 90 ? 1 : 0.35;
  const steer = clamp(turn * 2.2, -1, 1);
  driveCar(car, { throttle, steer, brake: false, nitro: d > 420 }, dt, buildings);
  // Ram contact with the target's car is resolved by the engine.
}

/** Spawn N traffic cars spread across the roads. */
export function spawnTraffic(rnd, count) {
  const kinds = ['sedan', 'coupe', 'van', 'truck', 'taxi'];
  const out = [];
  for (let i = 0; i < count; i++) {
    const p = randomRoadPoint(rnd);
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    const lane = (rnd() < 0.5 ? -1 : 1) * (ROAD_HALF * 0.45);
    const car = makeCar(kind,
      p.axis === 'h' ? p.x : p.x + lane,
      p.axis === 'h' ? p.y + lane : p.y,
      0, { traffic: true, axis: p.axis, dir: rnd() < 0.5 ? -1 : 1, lane });
    out.push(car);
  }
  return out;
}

/** A parked car the player can steal, placed beside a road. */
export function spawnParked(rnd, count, buildings) {
  const kinds = ['sedan', 'coupe', 'taxi', 'van'];
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < 200) {
    const p = randomRoadPoint(rnd);
    const off = (rnd() < 0.5 ? -1 : 1) * (ROAD_HALF + 26);
    const x = p.axis === 'h' ? p.x : p.x + off;
    const y = p.axis === 'h' ? p.y + off : p.y;
    if (hitsBuilding(buildings, x, y, 40)) continue;
    const angle = p.axis === 'h' ? (rnd() < 0.5 ? 0 : Math.PI) : (rnd() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    out.push(makeCar(kinds[Math.floor(rnd() * kinds.length)], x, y, angle));
  }
  return out;
}
