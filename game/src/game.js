// game.js — the simulation: Marisol, driving, combat, crime and the law.
// This module owns the mutable world state and advances it one fixed step
// at a time. Rendering (render.js) only reads it; the loop (main.js) feeds
// it input. Wanted level is the heart of the crime loop: crimes witnessed
// by pedestrians or police raise it, hiding lowers it, and the police
// presence scales with it.

import {
  WORLD_W, WORLD_H, WATER_Y, clamp, dist, collides, inWater, onPier, makeRng, districtAt,
} from './world.js';
import {
  makePed, nearestCar, carRect, updateTraffic, updatePed, updatePoliceCar,
  updateCop, spawnPoliceCar, spawnCop,
} from './entities.js';
import { MISSIONS, pickupSpots, REP_LEVELS, repLevelFor, collectibleSpots } from './missions.js';
import { buildSideJob } from './sidejobs.js';
import { buildRandomEvent } from './events.js';
import { freshSave } from './save.js';

export const SCREEN = { TITLE: 'title', PLAY: 'play', PAUSED: 'paused', BUSTED: 'busted', WASTED: 'wasted', COMPLETE: 'complete' };

const PLAYER_SPEED = 148;
const PLAYER_SPRINT = 218;
const CAR_ACCEL = 330;
const CAR_MAX = 335;
const CAR_REVERSE = 120;

/** Create the whole game state for a city and a save (or a fresh one). */
export function createGame(city, save) {
  const data = save || freshSave();
  const startX = data.x ?? 7 * 176 + 30;
  const startY = data.y ?? 5 * 176 + 30;
  const game = {
    city,
    screen: SCREEN.TITLE,
    time: 0,
    dayT: 0.32,                       // time of day, 0..1 (starts golden hour)
    player: {
      x: startX, y: startY, vx: 0, vy: 0, angle: -Math.PI / 2,
      health: 100, car: null, walkPhase: 0, punchCd: 0, hurtFlash: 0,
      bustMeter: 0, dead: false,
    },
    cars: [], peds: [], bullets: [], particles: [], floaters: [],
    wanted: 0, wantedHeat: 0, hideTimer: 0, policeTimer: 0,
    money: data.money,
    missionIndex: data.missionIndex,
    storyDone: data.storyDone,
    mission: null,                    // active mission runtime
    missionOffer: null,               // mission waiting at its start marker
    sideJob: null,                    // active repeatable side job (J to take one)
    randomEvent: null,                // active street event (cash drop / race / raid)
    eventTimer: 45,                   // seconds until the next street event
    rep: data.rep ?? 0,               // reputation points (REP_LEVELS)
    tags: collectibleSpots().map((p, i) => ({ ...p, taken: (data.tagsTaken || []).includes(i), index: i })),
    bestTrial: data.bestTrial ?? null,
    skidT: 0,                         // throttle for tyre-screech sounds
    dialogue: null, dialogueT: 0,
    message: '', messageT: 0,
    pickups: pickupSpots().map((p) => ({ ...p, taken: false, respawn: 0 })),
    stats: { ...data.stats },
    save: data,
    shake: 0,
    rng: makeRng(1234567),
    events: [],                       // sound/event queue drained by main.js
    trialBest: null,
    muted: false,
  };
  return game;
}

/** Queue a named event (sound cue or UI hook) for the shell to consume. */
function emit(game, name, data) { game.events.push({ name, data }); }

/** Show a transient centre-screen message. */
export function notify(game, text, seconds = 3) {
  game.message = text;
  game.messageT = seconds;
}

/** Play a sequence of dialogue lines, one at a time. */
export function say(game, lines) {
  game.dialogue = [...lines];
  game.dialogueT = 3.4;
}

/** The reputation level index for the game's current points. */
export function repLevel(game) { return repLevelFor(game.rep); }

/** Add reputation points; a level-up pays a small bonus and celebrates. */
export function addRep(game, n) {
  const before = repLevel(game);
  game.rep += n;
  const after = repLevel(game);
  if (after > before) {
    const bonus = 50 * after;
    game.money += bonus;
    game.stats.earned += bonus;
    emit(game, 'levelup');
    notify(game, `Reputation up — ${REP_LEVELS[after].name}! Bonus $${bonus}`, 4);
    floater(game, game.player.x, game.player.y - 34, `${REP_LEVELS[after].name}!`, '#facc15');
  }
}

/** Commit a crime: raise wanted heat; witnesses decide if stars follow. */
export function commitCrime(game, severity, x, y) {
  let witnessed = game.wanted > 0;
  if (!witnessed) {
    for (const ped of game.peds) {
      if (!ped.dead && dist(ped.x, ped.y, x, y) < 190) { witnessed = true; break; }
    }
  }
  if (!witnessed) {
    for (const car of game.cars) {
      if (car.kind === 'police' && dist(car.x, car.y, x, y) < 320) { witnessed = true; break; }
    }
  }
  if (witnessed) {
    game.wantedHeat += severity;
    game.hideTimer = 0;
    const stars = clamp(Math.floor(game.wantedHeat / 26) + (game.wantedHeat > 0 ? 1 : 0), 0, 5);
    if (stars > game.wanted) {
      game.wanted = stars;
      emit(game, 'star');
      notify(game, game.wanted >= 3 ? 'The harbour patrol is hunting you!' : 'Wanted level rose', 2);
    }
  }
}

/** Damage the player; handles death. */
export function hurtPlayer(game, amount) {
  const p = game.player;
  if (p.dead || game.screen !== SCREEN.PLAY) return;
  p.health -= amount;
  p.hurtFlash = 0.25;
  emit(game, 'hurt');
  if (p.health <= 0) {
    p.health = 0;
    p.dead = true;
    game.stats.timesWasted++;
    game.screen = SCREEN.WASTED;
    emit(game, 'wasted');
  }
}

/** Spawn a burst of simple particles (sparks, splashes, cash sparkle). */
export function burst(game, x, y, color, n, speed = 90) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.9);
    game.particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.35 + Math.random() * 0.4, maxLife: 0.75, color, size: 2 + Math.random() * 3,
    });
  }
}

/** Floating text (cash gains, labels) that drifts up and fades. */
export function floater(game, x, y, text, color = '#a3e635') {
  game.floaters.push({ x, y, text, color, life: 1.4 });
}

/** Start the mission with the given index, if the story has one there. */
export function startMission(game, index) {
  const def = MISSIONS[index];
  if (!def) return;
  game.mission = {
    def, index, stage: 0, timer: null, checkpoint: 0,
    targetCarId: null, startedAt: game.time,
  };
  const stage = def.stages[0];
  if (stage.kind === 'trial') game.mission.timer = stage.time;
  if (stage.kind === 'steal') markTargetCar(game, stage, game.mission);
  say(game, def.brief);
  notify(game, `Mission: ${def.title}`, 3.5);
  emit(game, 'missionStart');
}

/** Find (or respawn) the highlighted steal-target car for a stage. */
function markTargetCar(game, stage, runtime) {
  let best = null; let bestD = Infinity;
  for (const car of game.cars) {
    if (car.kind !== 'parked' || car.dead) continue;
    const d = dist(car.x, car.y, stage.x, stage.y);
    if (d < bestD) { bestD = d; best = car; }
  }
  if (best) {
    best.color = '#e11d48'; // the vermilion coupe
    best.x = stage.x; best.y = stage.y;
    runtime.targetCarId = best.id;
  }
}

/** Take a repeatable side job (taxi, courier or repo) from Dee's phone. */
export function startSideJob(game) {
  if (game.mission || game.sideJob || game.screen !== SCREEN.PLAY) return false;
  const def = buildSideJob(game.rng, game.player.x, game.player.y);
  game.sideJob = { def, stage: 0, timer: def.timer, checkpoint: 0, targetCarId: null };
  if (def.stages[0].kind === 'steal') markTargetCar(game, def.stages[0], game.sideJob);
  notify(game, `Side job: ${def.title} — $${def.reward}`, 3.5);
  emit(game, 'eventStart');
  return true;
}

/** The current side-job stage, or null. */
export function currentSideStage(game) {
  if (!game.sideJob) return null;
  return game.sideJob.def.stages[game.sideJob.stage];
}

/** Complete the active side job: pay out, add reputation, persist. */
function completeSideJob(game) {
  const job = game.sideJob;
  game.money += job.def.reward;
  game.stats.earned += job.def.reward;
  game.stats.sideJobsDone++;
  floater(game, game.player.x, game.player.y - 30, `+$${job.def.reward}`, '#facc15');
  emit(game, 'cash');
  emit(game, 'sideDone');
  notify(game, `Side job done — ${job.def.title}`, 3.5);
  game.sideJob = null;
  addRep(game, 40);
  syncSave(game);
}

/** Fail the active side job; another is a keypress away. */
function failSideJob(game, reason) {
  notify(game, `Side job failed: ${reason}`, 3.5);
  emit(game, 'missionFail');
  game.sideJob = null;
}

/** Side-job stage logic: the same stage kinds story missions use. */
function updateSideJob(game, dt, input) {
  if (input.justPressed('j') && !game.mission && !game.sideJob) startSideJob(game);
  const job = game.sideJob;
  if (!job) return;
  job.timer -= dt;
  if (job.timer <= 0) { failSideJob(game, 'the clock ran out'); return; }
  const stage = job.def.stages[job.stage];
  const p = game.player;
  if (stage.kind === 'goto') {
    const okVehicle = stage.anyVehicle || !stage.needVehicle || !!p.car;
    if (dist(p.x, p.y, stage.x, stage.y) < stage.r && okVehicle) {
      job.stage++;
      if (job.stage >= job.def.stages.length) { completeSideJob(game); return; }
      const next = job.def.stages[job.stage];
      if (next.kind === 'steal') markTargetCar(game, next, job);
      emit(game, 'pickup');
      notify(game, 'Objective updated', 2);
    }
  } else if (stage.kind === 'steal') {
    if (job.targetCarId && p.car && p.car.id === job.targetCarId) {
      job.stage++;
      emit(game, 'pickup');
      notify(game, 'Objective updated', 2);
    }
  }
}

/** Start a random street event near the player. */
export function startRandomEvent(game) {
  if (game.mission || game.sideJob || game.randomEvent) return false;
  const def = buildRandomEvent(game.rng, game.player.x, game.player.y);
  game.randomEvent = { def, t: def.duration, checkpoint: 0 };
  if (def.type === 'raid') {
    commitCrime(game, 52, game.player.x, game.player.y);
    // A raid is a raid even on an empty street: force the heat if nobody
    // witnessed it, so the event always plays as advertised.
    if (game.wanted === 0) {
      game.wantedHeat = 52;
      game.wanted = 2;
      game.hideTimer = 0;
      emit(game, 'star');
      notify(game, 'The harbour patrol is hunting you!', 2);
    }
  }
  notify(game, `Street event: ${def.title} — $${def.reward}`, 4);
  emit(game, 'eventStart');
  return true;
}

/** The current event target point (or checkpoint), for the HUD and minimap. */
export function currentEventTarget(game) {
  const ev = game.randomEvent;
  if (!ev) return null;
  if (ev.def.type === 'streetrace') return ev.def.checkpoints[ev.checkpoint];
  return ev.def.target;
}

/** Street-event logic: cash crate, checkpoint race, or surviving a raid. */
function updateRandomEvent(game, dt) {
  const ev = game.randomEvent;
  if (!ev) {
    // Event director: a quiet minute, then the city throws something.
    game.eventTimer -= dt;
    if (game.eventTimer <= 0) {
      game.eventTimer = 55 + game.rng() * 35;
      startRandomEvent(game);
    }
    return;
  }
  ev.t -= dt;
  const p = game.player;
  if (ev.def.type === 'cashdrop') {
    if (dist(p.x, p.y, ev.def.target.x, ev.def.target.y) < ev.def.target.r) {
      game.money += ev.def.reward;
      game.stats.earned += ev.def.reward;
      game.stats.eventsDone++;
      floater(game, p.x, p.y - 30, `+$${ev.def.reward}`, '#facc15');
      emit(game, 'cash');
      notify(game, 'Cash crate grabbed!', 3);
      game.randomEvent = null;
      addRep(game, 30);
      syncSave(game);
      return;
    }
  } else if (ev.def.type === 'streetrace') {
    const pt = ev.def.checkpoints[ev.checkpoint];
    if (pt && dist(p.x, p.y, pt.x, pt.y) < ev.def.target.r) {
      ev.checkpoint++;
      emit(game, 'raceCheckpoint');
      floater(game, pt.x, pt.y, `Checkpoint ${ev.checkpoint}/${ev.def.checkpoints.length}`, '#fb923c');
      if (ev.checkpoint >= ev.def.checkpoints.length) {
        game.money += ev.def.reward;
        game.stats.earned += ev.def.reward;
        game.stats.eventsDone++;
        emit(game, 'cash');
        notify(game, `Race won — $${ev.def.reward}!`, 3.5);
        game.randomEvent = null;
        addRep(game, 30);
        syncSave(game);
        return;
      }
    }
  } else if (ev.def.type === 'raid') {
    if (game.wanted === 0 && ev.t < ev.def.duration - 3) {
      // Shook the raid off early: still counts, smaller fuss.
      game.stats.eventsDone++;
      notify(game, 'Raid dodged — the patrol lost you', 3);
      game.randomEvent = null;
      addRep(game, 30);
      syncSave(game);
      return;
    }
  }
  if (ev.t <= 0) {
    if (ev.def.type === 'raid') {
      game.money += ev.def.reward;
      game.stats.earned += ev.def.reward;
      game.stats.eventsDone++;
      notify(game, `Survived the raid — $${ev.def.reward}`, 3.5);
      addRep(game, 30);
      syncSave(game);
    } else {
      notify(game, `${ev.def.title} is over — too slow`, 3);
    }
    game.randomEvent = null;
  }
}

/** Neon tags: glowing collectibles hidden around the city. */
function updateCollectibles(game) {
  const p = game.player;
  for (const tag of game.tags) {
    if (tag.taken) continue;
    if (dist(p.x, p.y, tag.x, tag.y) < 26) {
      tag.taken = true;
      game.stats.tagsFound++;
      game.money += 25;
      game.stats.earned += 25;
      floater(game, tag.x, tag.y - 16, '+$25 tag', '#e879f9');
      emit(game, 'tag');
      addRep(game, 10);
      if (game.tags.every((t) => t.taken)) {
        game.money += 500;
        game.stats.earned += 500;
        notify(game, 'All 12 neon tags! Bonus $500 — Neon Royalty material', 4);
        addRep(game, 100);
      } else {
        notify(game, `Neon tag ${game.stats.tagsFound}/12`, 2);
      }
      syncSave(game);
    }
  }
}

/** Complete the active mission: pay out, advance the story, persist. */
function completeMission(game) {
  const m = game.mission;
  game.money += m.def.reward;
  game.stats.earned += m.def.reward;
  floater(game, game.player.x, game.player.y - 30, `+$${m.def.reward}`, '#facc15');
  emit(game, 'cash');
  emit(game, 'missionDone');
  say(game, m.def.outro);
  notify(game, `Mission passed — ${m.def.title}`, 4);
  game.mission = null;
  game.missionIndex = m.index + 1;
  if (game.missionIndex >= MISSIONS.length) game.storyDone = true;
  addRep(game, 100);
  syncSave(game);
}

/** Fail the active mission with a reason; it can be retried at its start. */
function failMission(game, reason) {
  notify(game, `Mission failed: ${reason}`, 4);
  emit(game, 'missionFail');
  game.mission = null;
}

/** The world point where the next mission is offered (a phone-booth glow). */
export function missionOfferPoint(game) {
  if (game.storyDone || game.mission) return null;
  // Offers wait at the Cannery Row safehouse porch.
  return { x: 2 * 176 + 84, y: 4 * 176 + 88 };
}

/** Copy the live progress into the save object (the shell writes it out). */
export function syncSave(game) {
  game.save.money = game.money;
  game.save.missionIndex = game.missionIndex;
  game.save.storyDone = game.storyDone;
  game.save.x = Math.round(game.player.x);
  game.save.y = Math.round(game.player.y);
  game.save.rep = game.rep;
  game.save.tagsTaken = game.tags.filter((t) => t.taken).map((t) => t.index);
  game.save.bestTrial = game.bestTrial;
  game.save.stats = { ...game.stats };
}

/** Player-on-foot movement with building collision, axis separated. */
function moveOnFoot(game, dt, input) {
  const p = game.player;
  const axes = input.axes();
  const sprint = input.held('shift');
  const speed = sprint ? PLAYER_SPRINT : PLAYER_SPEED;
  let mx = axes.x, my = axes.y;
  const len = Math.hypot(mx, my);
  if (len > 0) {
    mx /= len; my /= len;
    p.angle = Math.atan2(my, mx);
    p.walkPhase += dt * (sprint ? 13 : 9);
  }
  const nx = p.x + mx * speed * dt;
  if (!collides(game.city, { x: nx - 7, y: p.y - 7, w: 14, h: 14 })) p.x = nx;
  const ny = p.y + my * speed * dt;
  if (!collides(game.city, { x: p.x - 7, y: ny - 7, w: 14, h: 14 })) p.y = ny;
  // Remember the walk velocity: the camera leans into it (see cameraTarget).
  p.vx = mx * speed;
  p.vy = my * speed;
  p.x = clamp(p.x, 10, WORLD_W - 10);
  p.y = clamp(p.y, 10, WORLD_H - 10);
  if (inWater(p.x, p.y) && !onPier(game.city, p.x, p.y)) {
    // Wade back: deep water drags you to shore and stings.
    p.y = WATER_Y + 20;
    if (Math.random() < dt * 2) hurtPlayer(game, 4);
  }
  game.stats.distanceKm += (Math.hypot(mx, my) * speed * dt) / 100000;
}

/** Driving: arcade car physics for the car the player sits in. */
function driveCar(game, dt, input) {
  const p = game.player;
  const car = p.car;
  const fwd = input.held('w') || input.held('arrowup');
  const back = input.held('s') || input.held('arrowdown');
  const left = input.held('a') || input.held('arrowleft');
  const right = input.held('d') || input.held('arrowright');
  if (fwd) car.speed += CAR_ACCEL * dt;
  else if (back) car.speed -= (car.speed > 4 ? 420 : 130) * dt;
  else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 60 * dt);
  car.speed = clamp(car.speed, -CAR_REVERSE, CAR_MAX * (car.health > 25 ? 1 : 0.55));
  const steer = (left ? -1 : 0) + (right ? 1 : 0);
  if (steer !== 0 && Math.abs(car.speed) > 6) {
    car.angle += steer * 2.15 * dt * Math.sign(car.speed) * Math.min(1, Math.abs(car.speed) / 130);
  }
  if (input.held(' ')) { // handbrake
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 520 * dt);
    // Drifting on the handbrake: skid marks, smoke and a screech.
    if (Math.abs(car.speed) > 120) {
      game.skidT -= dt;
      const bx = car.x - Math.cos(car.angle) * 18;
      const by = car.y - Math.sin(car.angle) * 18;
      game.particles.push({
        x: bx, y: by, vx: 0, vy: 0, life: 0.9, maxLife: 0.9,
        color: '#27272a', size: 7,
      });
      if (game.skidT <= 0) { game.skidT = 0.45; emit(game, 'screech'); }
    }
  }
  // A seasoned wheelwoman keeps her ride patched: slow self-repair.
  if (repLevel(game) >= 2 && car.health < 100 && Math.abs(car.speed) < 40) {
    car.health = Math.min(100, car.health + 1.5 * dt);
  }
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  const rect = carRect({ ...car, x: nx, y: ny });
  if (!collides(game.city, rect)) {
    car.x = nx; car.y = ny;
  } else {
    // Crash: damage, shake, noise, and a crime if it was loud.
    if (Math.abs(car.speed) > 120) {
      car.health -= Math.abs(car.speed) * 0.05;
      game.shake = Math.min(10, Math.abs(car.speed) * 0.03);
      burst(game, car.x + Math.cos(car.angle) * 22, car.y + Math.sin(car.angle) * 22, '#fbbf24', 10, 130);
      emit(game, 'crash', { big: Math.abs(car.speed) > 220 });
      commitCrime(game, 6, car.x, car.y);
      if (car.health < 30) hurtPlayer(game, 3);
    }
    car.speed *= -0.25;
  }
  // Hitting other cars.
  for (const other of game.cars) {
    if (other === car || other.dead) continue;
    if (dist(car.x, car.y, other.x, other.y) < 34) {
      const push = Math.atan2(other.y - car.y, other.x - car.x);
      other.x += Math.cos(push) * 26 * dt * 4;
      other.y += Math.sin(push) * 26 * dt * 4;
      other.health -= Math.abs(car.speed) * 0.06;
      if (Math.abs(car.speed) > 90) {
        emit(game, 'crash', { big: false });
        burst(game, (car.x + other.x) / 2, (car.y + other.y) / 2, '#fca5a5', 7, 110);
        commitCrime(game, 8, car.x, car.y);
        car.speed *= 0.55;
        game.shake = Math.max(game.shake, 4);
      }
    }
  }
  // Running over pedestrians is the darkest crime in the harbour.
  for (const ped of game.peds) {
    if (ped.dead) continue;
    if (Math.abs(car.speed) > 40 && dist(car.x, car.y, ped.x, ped.y) < 20) {
      ped.health -= 70;
      emit(game, 'crash', { big: false });
      burst(game, ped.x, ped.y, '#ef4444', 10, 120);
      commitCrime(game, ped.kind === 'cop' ? 40 : 30, ped.x, ped.y);
      if (ped.health <= 0) { ped.dead = true; }
      car.speed *= 0.8;
    }
  }
  if (inWater(car.x, car.y + 10) && !onPier(game.city, car.x, car.y)) {
    emit(game, 'splash');
    notify(game, 'The harbour claims another car…', 2.5);
    car.dead = true;
    p.car = null;
    p.y = WATER_Y - 14;
    hurtPlayer(game, 12);
  }
  p.x = car.x; p.y = car.y;
  p.angle = car.angle;
  game.stats.distanceKm += Math.abs(car.speed * dt) / 100000;
}

/** Enter/exit the nearest car. Stealing is a crime when witnessed. */
function toggleCar(game, input) {
  const p = game.player;
  if (!input.justPressed('e')) return;
  if (p.car) {
    const side = p.car.angle + Math.PI / 2;
    p.x = p.car.x + Math.cos(side) * 26;
    p.y = p.car.y + Math.sin(side) * 26;
    if (collides(game.city, { x: p.x - 7, y: p.y - 7, w: 14, h: 14 })) {
      p.x = p.car.x - Math.cos(side) * 26;
      p.y = p.car.y - Math.sin(side) * 26;
    }
    p.car.driver = null;
    p.car = null;
    emit(game, 'door');
    emit(game, 'engineOff');
    return;
  }
  const car = nearestCar(game.cars, p.x, p.y, 40);
  if (!car) return;
  const wasParked = car.kind === 'parked' || car.speed === 0;
  if (car.kind === 'traffic') {
    // Yank the driver out: they become a fleeing pedestrian.
    const driver = makePed(car.x + 20, car.y + 10, '#fda4af', 'civilian');
    game.peds.push(driver);
    commitCrime(game, 20, car.x, car.y);
  } else if (wasParked) {
    commitCrime(game, 14, car.x, car.y);
  }
  if (game.mission && car.id === game.mission.targetCarId) {
    advanceStage(game);
  }
  car.kind = 'player';
  car.driver = 'marisol';
  p.car = car;
  game.stats.carsStolen += wasParked || car.driver ? 1 : 0;
  emit(game, 'door');
  emit(game, 'engineOn');
  notify(game, 'Driving — W/S move, A/D steer, Space handbrake, E exit, H horn', 2.6);
}

/** Melee/gun combat: mouse aims, click or F attacks. */
function combat(game, dt, input, view) {
  const p = game.player;
  p.punchCd -= dt;
  if (p.car) return;
  const aim = Math.atan2(view.mouseWorldY - p.y, view.mouseWorldX - p.x);
  if ((input.mouse.down || input.held('f')) && p.punchCd <= 0) {
    p.punchCd = 0.32;
    p.angle = aim;
    const hasGun = game.missionIndex >= 1 || game.storyDone;
    if (hasGun) {
      game.bullets.push({
        x: p.x + Math.cos(aim) * 14, y: p.y + Math.sin(aim) * 14,
        vx: Math.cos(aim) * 720, vy: Math.sin(aim) * 720,
        life: 0.55, from: 'player',
      });
      emit(game, 'shot');
      game.shake = Math.max(game.shake, 1.6);
      commitCrime(game, 16, p.x, p.y);
    } else {
      emit(game, 'punch');
      // Fists: hit whoever stands in front.
      for (const ped of game.peds) {
        if (ped.dead) continue;
        if (dist(p.x, p.y, ped.x, ped.y) < 30 && Math.abs(((Math.atan2(ped.y - p.y, ped.x - p.x) - aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 1.1) {
          ped.health -= 34;
          burst(game, ped.x, ped.y, '#fca5a5', 5, 80);
          commitCrime(game, ped.kind === 'cop' ? 30 : 15, ped.x, ped.y);
          if (ped.health <= 0) ped.dead = true;
        }
      }
      for (const car of game.cars) {
        if (!car.dead && dist(p.x, p.y, car.x, car.y) < 34) {
          car.health -= 6;
          burst(game, car.x, car.y, '#fbbf24', 4, 70);
        }
      }
    }
  }
}

/** Advance bullets; resolve hits on peds, cars and the player. */
function updateBullets(game, dt) {
  for (const b of game.bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (collides(game.city, { x: b.x - 2, y: b.y - 2, w: 4, h: 4 })) { b.life = 0; burst(game, b.x, b.y, '#fde68a', 3, 60); continue; }
    if (b.from === 'player') {
      // A Harbor Legend's pistol hits harder than a courier's.
      const dmg = 40 + (repLevel(game) >= 3 ? 15 : 0);
      for (const ped of game.peds) {
        if (ped.dead || b.life <= 0) continue;
        if (dist(b.x, b.y, ped.x, ped.y) < 10) {
          ped.health -= dmg; b.life = 0;
          burst(game, ped.x, ped.y, '#ef4444', 7, 100);
          commitCrime(game, ped.kind === 'cop' ? 34 : 24, ped.x, ped.y);
          if (ped.health <= 0) ped.dead = true;
        }
      }
      for (const car of game.cars) {
        if (car.dead || b.life <= 0 || car === game.player.car) continue;
        if (dist(b.x, b.y, car.x, car.y) < 20) { car.health -= 12; b.life = 0; burst(game, b.x, b.y, '#fbbf24', 4, 80); }
      }
    } else if (b.from === 'cop') {
      const p = game.player;
      const target = p.car || p;
      if (dist(b.x, b.y, target.x, target.y) < (p.car ? 22 : 10)) {
        b.life = 0;
        if (p.car) { p.car.health -= 5; if (Math.random() < 0.4) hurtPlayer(game, 4); }
        else hurtPlayer(game, 7);
      }
    }
  }
  game.bullets = game.bullets.filter((b) => b.life > 0);
}

/** Police pressure: keep the unit counts matched to the wanted level. */
function policeDirector(game, dt) {
  const p = game.player;
  game.policeTimer -= dt;
  const copCars = game.cars.filter((c) => c.kind === 'police' && !c.dead);
  const copPeds = game.peds.filter((c) => c.kind === 'cop' && !c.dead);
  const wantCars = [0, 1, 2, 3, 4, 5][game.wanted] || 0;
  const wantPeds = [0, 0, 1, 2, 3, 4][game.wanted] || 0;
  if (game.policeTimer <= 0) {
    game.policeTimer = 1.4;
    if (copCars.length < wantCars) game.cars.push(spawnPoliceCar(p, game.rng));
    else if (copPeds.length < wantPeds) game.peds.push(spawnCop(p, game.rng));
  }
  // Despawn units that fell far behind when the heat is off them.
  if (game.wanted === 0) {
    for (const c of copCars) if (dist(c.x, c.y, p.x, p.y) > 700) c.dead = true;
    for (const c of copPeds) if (dist(c.x, c.y, p.x, p.y) > 620) c.dead = true;
  }
  // Foot cops shoot; standing close to one on foot fills the bust meter.
  let busting = false;
  for (const cop of copPeds) {
    const d = dist(cop.x, cop.y, p.x, p.y);
    if (d < 150 && game.wanted > 0 && cop.shootCd <= 0) {
      cop.shootCd = 0.9 + Math.random() * 0.5;
      const a = Math.atan2(p.y - cop.y, p.x - cop.x) + (Math.random() - 0.5) * 0.16;
      game.bullets.push({ x: cop.x, y: cop.y, vx: Math.cos(a) * 620, vy: Math.sin(a) * 620, life: 0.5, from: 'cop' });
      emit(game, 'shot');
    }
    if (d < 30 && !p.car) busting = true;
  }
  for (const c of copCars) {
    if (dist(c.x, c.y, p.x, p.y) < 44 && Math.abs(c.speed) < 30 && Math.abs(p.car ? p.car.speed : 0) < 20) busting = true;
  }
  if (busting && game.wanted > 0) {
    p.bustMeter += dt;
    if (p.bustMeter > 1.6) {
      p.bustMeter = 0;
      game.screen = SCREEN.BUSTED;
      game.stats.timesBusted++;
      emit(game, 'busted');
    }
  } else {
    p.bustMeter = Math.max(0, p.bustMeter - dt * 1.4);
  }
}

/** Wanted decay: stay unseen and the stars cool off, one at a time. */
function wantedDecay(game, dt) {
  if (game.wanted === 0) return;
  const p = game.player;
  let seen = false;
  for (const c of game.cars) {
    if (c.kind === 'police' && !c.dead && dist(c.x, c.y, p.x, p.y) < 300) { seen = true; break; }
  }
  if (!seen) {
    for (const c of game.peds) {
      if (c.kind === 'cop' && !c.dead && dist(c.x, c.y, p.x, p.y) < 200) { seen = true; break; }
    }
  }
  if (seen) { game.hideTimer = 0; return; }
  game.hideTimer += dt;
  const need = 7 + game.wanted * 2;
  if (game.hideTimer > need) {
    game.hideTimer = 0;
    game.wanted--;
    game.wantedHeat = Math.max(0, game.wantedHeat - 30);
    if (game.wanted === 0) {
      game.wantedHeat = 0;
      notify(game, 'You lost the harbour patrol', 2.5);
    } else {
      notify(game, 'The heat is cooling…', 2);
    }
  }
}

/** The current mission stage, or null. */
export function currentStage(game) {
  if (!game.mission) return null;
  return game.mission.def.stages[game.mission.stage];
}

/** Move the active mission to its next stage (or complete it). */
export function advanceStage(game) {
  const m = game.mission;
  if (!m) return;
  // Remember the best Harbour Trial clock (time left when it was cleared).
  const done = m.def.stages[m.stage];
  if (done && done.kind === 'trial' && m.timer !== null) {
    const left = Math.round(m.timer * 10) / 10;
    if (game.bestTrial === null || left > game.bestTrial) game.bestTrial = left;
  }
  m.stage++;
  m.checkpoint = 0;
  if (m.stage >= m.def.stages.length) { completeMission(game); return; }
  const stage = m.def.stages[m.stage];
  m.timer = stage.kind === 'trial' || stage.kind === 'deliver' ? stage.time : null;
  if (stage.kind === 'steal') markTargetCar(game, stage, m);
  if (stage.heat) commitCrime(game, stage.heat * 26, game.player.x, game.player.y);
  emit(game, 'pickup');
  notify(game, 'Objective updated', 2);
}

/** Mission stage logic: markers, timers, checkpoints, escape conditions. */
function updateMission(game, dt) {
  const offer = missionOfferPoint(game);
  if (offer && !game.mission) {
    game.missionOffer = offer;
    if (dist(game.player.x, game.player.y, offer.x, offer.y) < 34 && !game.player.car) {
      startMission(game, game.missionIndex);
    }
  } else game.missionOffer = null;
  const stage = currentStage(game);
  if (!stage) return;
  const p = game.player;
  if (stage.kind === 'goto') {
    const okVehicle = stage.anyVehicle || !stage.needVehicle || !!p.car;
    const okCalm = !stage.needCalm || game.wanted === 0;
    if (dist(p.x, p.y, stage.x, stage.y) < stage.r && okVehicle && okCalm) advanceStage(game);
    else if (dist(p.x, p.y, stage.x, stage.y) < stage.r && stage.needCalm && game.wanted > 0) {
      notify(game, 'Lose the patrol before you reach the safehouse!', 1.2);
    }
  } else if (stage.kind === 'steal') {
    // Completion happens in toggleCar when she enters the target car.
    if (game.mission && game.mission.targetCarId && p.car && p.car.id === game.mission.targetCarId) advanceStage(game);
  } else if (stage.kind === 'escape') {
    if (game.wanted >= stage.stars) advanceStage(game);
  } else if (stage.kind === 'trial') {
    game.mission.timer -= dt;
    const pt = stage.points[game.mission.checkpoint];
    if (pt && dist(p.x, p.y, pt.x, pt.y) < stage.r) {
      game.mission.checkpoint++;
      emit(game, 'pickup');
      floater(game, pt.x, pt.y, `Checkpoint ${game.mission.checkpoint}/${stage.points.length}`, '#22d3ee');
      if (game.mission.checkpoint >= stage.points.length) { advanceStage(game); return; }
    }
    if (game.mission && game.mission.timer <= 0) failMission(game, 'the clock ran out');
  } else if (stage.kind === 'deliver') {
    game.mission.timer -= dt;
    const okCalm = !stage.needCalm || game.wanted === 0;
    if (p.car && dist(p.x, p.y, stage.x, stage.y) < stage.r && okCalm) { advanceStage(game); return; }
    if (p.car && dist(p.x, p.y, stage.x, stage.y) < stage.r && stage.needCalm && game.wanted > 0) {
      notify(game, 'Lose the patrol before you roll onto the pier!', 1.2);
    }
    if (game.mission && game.mission.timer <= 0) failMission(game, 'the ferry window closed');
  }
}

/** Cash pickups: dockside envelopes worth a little side money. */
function updatePickups(game, dt) {
  for (const pk of game.pickups) {
    if (pk.taken) {
      pk.respawn -= dt;
      if (pk.respawn <= 0) pk.taken = false;
      continue;
    }
    if (dist(game.player.x, game.player.y, pk.x, pk.y) < 24) {
      pk.taken = true;
      pk.respawn = 45;
      const value = 15 + Math.floor(Math.random() * 30);
      game.money += value;
      game.stats.earned += value;
      floater(game, pk.x, pk.y - 16, `+$${value}`, '#a3e635');
      emit(game, 'cash');
      syncSave(game);
    }
  }
}

/**
 * Advance the whole simulation one step. `view` carries the mouse position
 * in world coordinates for aiming. Only runs in PLAY screen.
 */
export function stepGame(game, dt, input, view) {
  game.time += dt;
  game.dayT = (game.dayT + dt / 240) % 1; // a full day/night cycle in 4 minutes
  const p = game.player;
  p.punchCd = Math.max(0, p.punchCd - dt);
  p.hurtFlash = Math.max(0, p.hurtFlash - dt);
  game.messageT = Math.max(0, game.messageT - dt);
  game.shake = Math.max(0, game.shake - dt * 26);
  if (game.dialogue) {
    game.dialogueT -= dt;
    if (game.dialogueT <= 0) {
      game.dialogue.shift();
      game.dialogueT = 3.4;
      if (game.dialogue.length === 0) game.dialogue = null;
    }
  }
  if (input.justPressed('h') && p.car) emit(game, 'horn');
  toggleCar(game, input);
  if (p.car) driveCar(game, dt, input);
  else moveOnFoot(game, dt, input);
  combat(game, dt, input, view);
  // Ambient life.
  const threat = game.bullets.length || game.wanted >= 2 ? { x: p.x, y: p.y } : null;
  for (const car of game.cars) {
    if (car.dead || car === p.car) continue;
    if (car.kind === 'traffic') updateTraffic(car, dt, game.city, game.cars, game.peds, p.car ? null : p);
    else if (car.kind === 'police') updatePoliceCar(car, dt, game.city, p, game.wanted);
  }
  for (const ped of game.peds) {
    if (ped.dead) continue;
    if (ped.kind === 'cop') updateCop(ped, dt, game.city, p);
    else updatePed(ped, dt, game.city, threat);
  }
  policeDirector(game, dt);
  wantedDecay(game, dt);
  updateBullets(game, dt);
  updateMission(game, dt);
  updateSideJob(game, dt, input);
  updateRandomEvent(game, dt);
  updateCollectibles(game);
  updatePickups(game, dt);
  // Particles and floaters.
  for (const pt of game.particles) {
    pt.x += pt.vx * dt; pt.y += pt.vy * dt;
    pt.vx *= 0.92; pt.vy *= 0.92; pt.life -= dt;
  }
  game.particles = game.particles.filter((pt) => pt.life > 0);
  for (const f of game.floaters) { f.y -= 26 * dt; f.life -= dt; }
  game.floaters = game.floaters.filter((f) => f.life > 0);
  // Cull the far dead so arrays stay small.
  if (game.cars.length > 90) game.cars = game.cars.filter((c) => !c.dead || dist(c.x, c.y, p.x, p.y) < 500);
  if (game.peds.length > 90) game.peds = game.peds.filter((c) => !c.dead || dist(c.x, c.y, p.x, p.y) < 500);
  // Periodic autosave of position and progress.
  game.autosaveT = (game.autosaveT || 0) + dt;
  if (game.autosaveT > 5) { game.autosaveT = 0; syncSave(game); emit(game, 'autosave'); }
}

/** Where the camera should centre: the player (or her car), leaning ahead
 *  into motion so fast driving reads before the car arrives there. */
export function cameraTarget(game) {
  const p = game.player;
  const look = 0.32;
  let lx = 0, ly = 0;
  if (p.car) {
    lx = Math.cos(p.car.angle) * p.car.speed * look;
    ly = Math.sin(p.car.angle) * p.car.speed * look;
  } else {
    lx = p.vx * look; ly = p.vy * look;
  }
  return { x: p.x + lx, y: p.y + ly };
}

/** Current district name for the HUD. */
export function locationName(game) {
  return districtAt(game.player.x, game.player.y);
}
