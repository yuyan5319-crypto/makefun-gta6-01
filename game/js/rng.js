// Seeded random helpers for Sunspire Heat. One tiny module, no dependencies,
// so the city, traffic and missions are identical on every load.

/** Mulberry32: a small deterministic PRNG. Seed it once per world build. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max] from a random function. */
export function intBetween(rnd, min, max) {
  return min + Math.floor(rnd() * (max - min + 1));
}

/** Pick one element of an array. */
export function pick(rnd, arr) {
  return arr[Math.floor(rnd() * arr.length)];
}

/** Clamp a number into [lo, hi]. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Euclidean distance between two points. */
export function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/** Angle from (ax,ay) to (bx,by). */
export function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

/** Shortest signed turn from angle a toward angle b. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
