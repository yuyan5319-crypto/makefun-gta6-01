// save.js — persistence in localStorage: cash, story progress, position,
// and lifetime stats. Saving is best-effort: a browser that refuses storage
// still plays the game, it just forgets between visits.

const KEY = 'marisol-heat-neon-harbor-v1';

/** The default save for a fresh Marisol. */
export function freshSave() {
  return {
    money: 40,
    missionIndex: 0,       // next mission to offer; MISSIONS.length = story done
    storyDone: false,
    x: null, y: null,      // last position (null = story start point)
    stats: { earned: 0, carsStolen: 0, timesBusted: 0, timesWasted: 0, distanceKm: 0 },
  };
}

/** Load the save, tolerating missing or damaged data. */
export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || typeof data.money !== 'number') return null;
    const base = freshSave();
    return { ...base, ...data, stats: { ...base.stats, ...(data.stats || {}) } };
  } catch {
    return null;
  }
}

/** Write the save; returns false when storage is unavailable. */
export function storeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

/** Erase the save (New Game). */
export function wipeSave() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to erase */ }
}
