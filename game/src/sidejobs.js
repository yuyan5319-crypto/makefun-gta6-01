// sidejobs.js — repeatable side work in Neon Harbor.
//
// When no story mission is running, Marisol presses J and Dee's phone
// offers one of three kinds of work: a taxi fare, a courier drop, or a
// repo job. A job is plain data — a title, a payout, a countdown and a
// short stage list — and the simulation in game.js drives those stages
// with the same stage kinds the story uses (goto, steal), so a side job
// feels like a small mission. Jobs pay cash and reputation, which is what
// keeps the city paying after the story is finished.

import { avenueX, streetY, WORLD_W, WATER_Y } from './world.js';

/**
 * The three kinds of side work, with their base pay and time limit.
 * The final reward grows with the trip length (see buildSideJob).
 */
export const SIDE_JOB_TYPES = [
  { type: 'taxi', label: 'Taxi fare', base: 120, limit: 80 },
  { type: 'courier', label: 'Courier drop', base: 150, limit: 85 },
  { type: 'repo', label: 'Repo job', base: 260, limit: 110 },
];

/** The Portside garage, where repossessed cars get parked. */
const GARAGE = { x: avenueX(1) + 26, y: streetY(5) + 26 };

/**
 * Pick a street corner somewhere near the player: a random avenue and
 * street, nudged to the curb, then pulled back inside the city and inside
 * `radius` of the player so the job stays reachable on its timer.
 */
function pickCorner(rng, px, py, radius) {
  const a = Math.floor(rng() * 15);
  const s = Math.floor(rng() * 11);
  const sideX = rng() < 0.5 ? -18 : 18;
  const sideY = rng() < 0.5 ? -18 : 18;
  let x = avenueX(a) + sideX;
  let y = streetY(s) + sideY;
  x = Math.max(60, Math.min(WORLD_W - 60, x));
  y = Math.max(60, Math.min(WATER_Y - 120, y));
  const d = Math.hypot(x - px, y - py);
  if (d > radius) {
    // Too far out: slide the point back along the line to the player.
    const k = radius / d;
    x = Math.round(px + (x - px) * k);
    y = Math.round(py + (y - py) * k);
  }
  return { x, y };
}

/** A `goto` stage at a corner: reach the ring, on foot or driving. */
function goTo(label, at, r = 42) {
  return { kind: 'goto', label, x: at.x, y: at.y, r, anyVehicle: true };
}

/**
 * Build one side job near the player. `rng` is the game's seeded random
 * source, so the work varies from run to run.
 *
 * Returns { type, title, label, reward, timer, stages }.
 */
export function buildSideJob(rng, px, py) {
  const spec = SIDE_JOB_TYPES[Math.floor(rng() * SIDE_JOB_TYPES.length)];
  const pickup = pickCorner(rng, px, py, 520);
  const drop = pickCorner(rng, px, py, 900);
  const trip = Math.hypot(drop.x - pickup.x, drop.y - pickup.y);
  const fare = spec.base + Math.round(trip / 12);

  if (spec.type === 'taxi') {
    return {
      type: 'taxi',
      title: 'Taxi Fare',
      label: 'Pick up the fare, then drop them off before the meter dies',
      reward: fare,
      timer: spec.limit,
      stages: [
        goTo('Pick up the fare', pickup, 40),
        goTo('Drop the fare at the destination', drop, 46),
      ],
    };
  }

  if (spec.type === 'courier') {
    return {
      type: 'courier',
      title: 'Courier Drop',
      label: 'Grab the package, then run it across town against the clock',
      reward: fare + 40,
      timer: spec.limit,
      stages: [
        goTo('Collect the package', pickup, 40),
        goTo('Deliver the package', drop, 46),
      ],
    };
  }

  // Repo: steal the marked car, then park it in the Portside garage.
  return {
    type: 'repo',
    title: 'Repo Job',
    label: 'Take the marked car and park it in the Portside garage',
    reward: fare + 90,
    timer: spec.limit,
    stages: [
      { kind: 'steal', label: 'Take the marked car', x: pickup.x, y: pickup.y, r: 60 },
      {
        kind: 'goto',
        label: 'Park it at the Portside garage',
        x: GARAGE.x, y: GARAGE.y, r: 46,
        anyVehicle: false, needVehicle: true,
      },
    ],
  };
}
