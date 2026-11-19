// shots.js — staged scenes for the entry's screenshots, behind ?shot=.
// Each scene builds the real game, fast-forwards the real simulation with a
// simple scripted driver, and freezes a frame that shows the game's systems
// honestly: the title over the city, a mission pickup downtown, a police
// chase with the wanted stars lit, Marisol on foot at the beach pier, and a
// side job with a street event running beside it. The same seed and script
// always produce the same frame.

import { createGame, stepGame, startMission, startSideJob, startRandomEvent, commitCrime, SCREEN } from './game.js';
import { spawnAmbient } from './entities.js';
import { avenueX, streetY, WORLD_W, WATER_Y } from './world.js';

/** A no-op input with scripted overrides, shaped like the real Input. */
function scriptedInput(script) {
  const keys = new Set(script.keys || []);
  return {
    keys,
    mouse: { x: 0, y: 0, down: false, clicked: false },
    axes() {
      return {
        x: (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0),
        y: (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0),
      };
    },
    held(k) { return keys.has(k); },
    justPressed() { return false; },
    endFrame() {},
    set(list) { keys.clear(); for (const k of list) keys.add(k); },
  };
}

const VIEW = { mouseWorldX: 0, mouseWorldY: 0 };
const STEP = 1 / 60;

/** Run `seconds` of simulation with the scripted keys held. */
function run(game, input, seconds, keys) {
  input.set(keys || []);
  const steps = Math.floor(seconds / STEP);
  for (let i = 0; i < steps; i++) stepGame(game, STEP, input, VIEW);
}

/** A fresh game with ambient life, Marisol placed and the title dismissed. */
function baseGame(city, save) {
  const game = createGame(city, save || null);
  const amb = spawnAmbient(city, 20240);
  game.cars = amb.cars;
  game.peds = amb.peds;
  game.screen = SCREEN.PLAY;
  return game;
}

/**
 * Stage the named scene and return the game to draw. Names: title, mission,
 * chase, pier, side. Anything else is the title.
 */
export function stageShot(name, city) {
  const input = scriptedInput({});
  if (name === 'side') {
    // Side work in progress: a taxi fare active, a cash-drop event live,
    // a neon tag glowing nearby, and Marisol's reputation on the HUD.
    const game = baseGame(city);
    game.player.x = avenueX(7) + 8;
    game.player.y = streetY(4) + 60;
    game.rep = 420;
    game.money = 860;
    // Event first: starting a side job afterwards is allowed, not vice versa.
    startRandomEvent(game);
    startSideJob(game);
    game.dialogue = null;
    run(game, input, 1.2, ['w']);
    run(game, input, 0.8, ['w', 'd']);
    game.message = 'Side job + street event — the harbour never sleeps';
    game.messageT = 5;
    return game;
  }
  if (name === 'mission') {
    const game = baseGame(city);
    game.player.x = avenueX(6) + 8;
    game.player.y = streetY(4) + 60;
    startMission(game, 0);
    game.dialogue = null; // the briefing box would hide the street
    run(game, input, 1.6, ['w']);
    run(game, input, 0.8, ['w', 'd']);
    game.money = 315;
    return game;
  }
  if (name === 'chase') {
    const game = baseGame(city);
    game.player.x = avenueX(7);
    game.player.y = streetY(5) + 40;
    // Put her in a stolen car with the patrol already angry.
    let car = game.cars.find((c) => c.kind === 'parked');
    car.x = game.player.x; car.y = game.player.y; car.angle = 0; car.kind = 'player';
    game.player.car = car;
    game.wanted = 3;
    game.wantedHeat = 60;
    run(game, input, 2.4, ['w']);
    run(game, input, 1.1, ['w', 'a']);
    // Bring two patrol cars into frame behind her for the frozen moment.
    const p = game.player;
    const behind = [
      { dx: -70, dy: 54 }, { dx: -96, dy: -48 },
    ];
    for (const off of behind) {
      const cop = game.cars.find((c) => c.kind === 'police' && !c.dead);
      if (!cop) break;
      cop.x = p.x + off.dx; cop.y = p.y + off.dy;
      cop.angle = Math.atan2(p.y - cop.y, p.x - cop.x);
      cop.speed = 120;
    }
    run(game, input, 0.35, ['w']);
    game.mission = null;
    game.message = 'The harbour patrol is hunting you!';
    game.messageT = 5;
    return game;
  }
  if (name === 'pier') {
    const game = baseGame(city);
    game.dayT = 0.66; // dusk: neon hour
    startMission(game, 4);
    game.mission.stage = 1; // final leg: the pier run, crate aboard
    game.mission.timer = 74;
    game.dialogue = null;
    // Marisol drives the crate down the pier deck toward the marker.
    let car = game.cars.find((c) => c.kind === 'parked');
    car.x = WORLD_W / 2; car.y = WATER_Y - 120; car.angle = Math.PI / 2; car.kind = 'player';
    car.color = '#e11d48';
    game.player.car = car;
    game.player.x = car.x; game.player.y = car.y;
    game.money = 1240;
    run(game, input, 0.8, ['w']);
    return game;
  }
  // Title: the city alive behind the menu, Marisol standing in frame.
  const game = baseGame(city);
  game.screen = SCREEN.TITLE;
  game.player.x = avenueX(7) - 30;
  game.player.y = streetY(4) + 44;
  run(game, input, 2.0, []);
  game.screen = SCREEN.TITLE;
  return game;
}
