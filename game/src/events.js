// events.js — random street events that keep Neon Harbor surprising.
// Every minute or so, while no story mission is running, the city throws
// something at Marisol: a dropped cash crate with a short fuse, an
// impromptu street race through three checkpoints, or a harbour-patrol
// raid she has to survive. Each event is plain data — a type, a target,
// a duration and a payout — and the game loop in game.js drives it.

import { avenueX, streetY, WORLD_W, WATER_Y } from './world.js';

/** The three street events, with their base payouts. */
export const EVENT_TYPES = [
  { type: 'cashdrop', label: 'Cash drop', base: 180 },
  { type: 'streetrace', label: 'Street race', base: 400 },
  { type: 'raid', label: 'Patrol raid', base: 300 },
];

/** A point on the grid near the player, for event targets. */
function eventPoint(rng, px, py, minD, maxD) {
  for (let tries = 0; tries < 10; tries++) {
    const a = Math.floor(rng() * 15);
    const s = Math.floor(rng() * 11);
    const x = avenueX(a) + (rng() < 0.5 ? -14 : 14);
    const y = streetY(s) + (rng() < 0.5 ? -14 : 14);
    const d = Math.hypot(x - px, y - py);
    if (d >= minD && d <= maxD) return { x, y };
  }
  return { x: Math.max(80, Math.min(WORLD_W - 80, px + 260)), y: Math.max(80, Math.min(WATER_Y - 140, py + 40)) };
}

/**
 * Build one random street event near the player. Returns
 * { type, title, label, reward, duration, target, checkpoints? }.
 */
export function buildRandomEvent(rng, px, py) {
  const pick = EVENT_TYPES[Math.floor(rng() * EVENT_TYPES.length)];
  if (pick.type === 'cashdrop') {
    const at = eventPoint(rng, px, py, 180, 620);
    return {
      type: 'cashdrop',
      title: 'Cash Drop',
      label: 'A courier dropped a cash crate — grab it before it is gone',
      reward: pick.base,
      duration: 45,
      target: { x: at.x, y: at.y, r: 42 },
    };
  }
  if (pick.type === 'streetrace') {
    const pts = [
      eventPoint(rng, px, py, 150, 500),
      eventPoint(rng, px, py, 300, 700),
      eventPoint(rng, px, py, 300, 800),
    ];
    return {
      type: 'streetrace',
      title: 'Street Race',
      label: 'Three checkpoints, one clock — beat the rival to the line',
      reward: pick.base,
      duration: 60,
      target: { x: pts[0].x, y: pts[0].y, r: 52 },
      checkpoints: pts,
    };
  }
  // Raid: the patrol floods the block. Survive the timer to get paid.
  return {
    type: 'raid',
    title: 'Patrol Raid',
    label: 'The harbour patrol is flooding the block — survive the sweep',
    reward: pick.base,
    duration: 25,
    target: { x: Math.round(px), y: Math.round(py), r: 260 },
  };
}
