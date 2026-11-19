// sidejobs.js — repeatable side work in Neon Harbor.
// When no story mission is running, Marisol can press J at the safehouse
// (or anywhere on foot) to take a side job: a taxi fare, a courier drop, or
// a repo job. Each job is plain data — a short stage list the game loop in
// game.js drives with the same stage kinds story missions use (goto, steal,
// deliver) — plus a payout scaled to the trip. Side jobs pay cash and
// reputation, and they keep the city paying after the story is done.

import { avenueX, streetY, WORLD_W, WATER_Y } from './world.js';

/** The three kinds of side work Dee's phone can offer. */
export const SIDE_JOB_TYPES = [
  { type: 'taxi', label: 'Taxi fare', base: 120 },
  { type: 'courier', label: 'Courier drop', base: 150 },
  { type: 'repo', label: 'Repo job', base: 260 },
];

/** Pick a street corner near the player, clamped inside the city. */
function nearCorner(rng, px, py, radius) {
  const a = Math.floor(rng() * 15);
  const s = Math.floor(rng() * 11);
  let x = avenueX(a) + (rng() < 0.5 ? -18 : 18);
  let y = streetY(s) + (rng() < 0.5 ? -18 : 18);
  // Pull the corner toward the player so jobs stay reachable.
  x = Math.max(60, Math.min(WORLD_W - 60, x));
  y = Math.max(60, Math.min(WATER_Y - 120, y));
  if (Math.hypot(x - px, y - py) > radius) {
    x = px + (x - px) * (radius / Math.hypot(x - px, y - py));
    y = py + (y - py) * (radius / Math.hypot(x - px, y - py));
  }
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Build one side job. `rng` is the game's rng so jobs vary run to run.
 * Returns { type, title, label, reward, timer, stages } — the same shape a
 * story mission's stage list has, so the loop can drive it unchanged.
 */
export function buildSideJob(rng, px, py) {
  const pick = SIDE_JOB_TYPES[Math.floor(rng() * SIDE_JOB_TYPES.length)];
  const from = nearCorner(rng, px, py, 520);
  const to = nearCorner(rng, px, py, 900);
  const trip = Math.round(Math.hypot(to.x - from.x, to.y - from.y));
  const reward = pick.base + Math.round(trip / 12);
  if (pick.type === 'taxi') {
    return {
      type: 'taxi',
      title: 'Taxi Fare',
      label: 'Pick up the fare, then drop them off before the meter dies',
      reward,
      timer: 80,
      stages: [
        { kind: 'goto', label: 'Pick up the fare', x: from.x, y: from.y, r: 40, anyVehicle: true },
        { kind: 'goto', label: 'Drop the fare at the destination', x: to.x, y: to.y, r: 46, anyVehicle: true },
      ],
    };
  }
  if (pick.type === 'courier') {
    return {
      type: 'courier',
      title: 'Courier Drop',
      label: 'Grab the package, then run it across town against the clock',
      reward: reward + 40,
      timer: 85,
      stages: [
        { kind: 'goto', label: 'Collect the package', x: from.x, y: from.y, r: 40, anyVehicle: true },
        { kind: 'goto', label: 'Deliver the package', x: to.x, y: to.y, r: 46, anyVehicle: true },
      ],
    };
  }
  // Repo: steal the marked car, then park it in the Portside garage.
  return {
    type: 'repo',
    title: 'Repo Job',
    label: 'Take the marked car and park it in the Portside garage',
    reward: reward + 90,
    timer: 110,
    stages: [
      { kind: 'steal', label: 'Take the marked car', x: from.x, y: from.y, r: 60 },
      { kind: 'goto', label: 'Park it at the Portside garage', x: avenueX(1) + 26, y: streetY(5) + 26, r: 46, anyVehicle: false, needVehicle: true },
    ],
  };
}
