// events.js — random street events that keep Neon Harbor surprising.
//
// About once a minute, while no story mission or side job is running, the
// city throws something at Marisol: a courier drops a cash crate with a
// short fuse, a rival calls out an impromptu street race through three
// checkpoints, or the harbour patrol floods the block in a raid she has
// to survive. An event is plain data — a type, a target, a duration and
// a payout — and the game loop in game.js drives it.

import { avenueX, streetY, WORLD_W, WATER_Y } from './world.js';

/** The three street events, with their base payouts. */
export const EVENT_TYPES = [
  { type: 'cashdrop', label: 'Cash drop', base: 180 },
  { type: 'streetrace', label: 'Street race', base: 400 },
  { type: 'raid', label: 'Patrol raid', base: 300 },
];

/**
 * A point on the grid somewhere near the player, between `minD` and
 * `maxD` away: a random avenue/street corner, nudged to the curb.
 * Falls back to a point just ahead of the player if the dice refuse.
 */
function eventPoint(rng, px, py, minD, maxD) {
  for (let tries = 0; tries < 10; tries++) {
    const a = Math.floor(rng() * 15);
    const s = Math.floor(rng() * 11);
    const x = avenueX(a) + (rng() < 0.5 ? -14 : 14);
    const y = streetY(s) + (rng() < 0.5 ? -14 : 14);
    const d = Math.hypot(x - px, y - py);
    if (d >= minD && d <= maxD) return { x, y };
  }
  return {
    x: Math.max(80, Math.min(WORLD_W - 80, px + 260)),
    y: Math.max(80, Math.min(WATER_Y - 140, py + 40)),
  };
}

/** A cash-drop event: one crate, one short fuse. */
function cashDropEvent(rng, px, py) {
  const at = eventPoint(rng, px, py, 180, 620);
  return {
    type: 'cashdrop',
    title: 'Cash Drop',
    label: 'A courier dropped a cash crate — grab it before it is gone',
    reward: 180,
    duration: 45,
    target: { x: at.x, y: at.y, r: 42 },
  };
}

/** A street-race event: three checkpoints, one clock, one rival. */
function streetRaceEvent(rng, px, py) {
  const points = [
    eventPoint(rng, px, py, 150, 500),
    eventPoint(rng, px, py, 300, 700),
    eventPoint(rng, px, py, 300, 800),
  ];
  return {
    type: 'streetrace',
    title: 'Street Race',
    label: 'Three checkpoints, one clock — beat the rival to the line',
    reward: 400,
    duration: 60,
    target: { x: points[0].x, y: points[0].y, r: 52 },
    checkpoints: points,
  };
}

/** A patrol-raid event: survive the sweep at the player's own position. */
function raidEvent(px, py) {
  return {
    type: 'raid',
    title: 'Patrol Raid',
    label: 'The harbour patrol is flooding the block — survive the sweep',
    reward: 300,
    duration: 25,
    target: { x: Math.round(px), y: Math.round(py), r: 260 },
  };
}

/**
 * Build one random street event near the player. Returns
 * { type, title, label, reward, duration, target, checkpoints? }.
 */
export function buildRandomEvent(rng, px, py) {
  const pick = EVENT_TYPES[Math.floor(rng() * EVENT_TYPES.length)];
  if (pick.type === 'cashdrop') return cashDropEvent(rng, px, py);
  if (pick.type === 'streetrace') return streetRaceEvent(rng, px, py);
  return raidEvent(px, py);
}
