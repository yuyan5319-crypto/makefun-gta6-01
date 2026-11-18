// main.js — the shell: canvas, fixed-step loop, screen flow and sound.
// It builds the city, loads the save, runs the simulation from game.js at
// 60 steps a second, renders with render.js, turns simulation events into
// WebAudio sounds, and handles the title / pause / busted / wasted flow.
// With ?shot=<name> it instead stages one deterministic screenshot scene.

import { buildCity } from './world.js';
import { createGame, stepGame, cameraTarget, locationName, SCREEN, syncSave } from './game.js';
import { spawnAmbient } from './entities.js';
import { render } from './render.js';
import { Input } from './input.js';
import { SoundBank } from './audio.js';
import { loadSave, storeSave, wipeSave, freshSave } from './save.js';
import { stageShot } from './shots.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');

const SEED = 20240;
const city = buildCity(SEED);

function fitCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const shotSeed = Number(params.get('seed') || SEED);

let game;
let input = null;
const sound = new SoundBank();

if (shotName) {
  // Screenshot mode: one staged frame, no loop, no sound, no save writes.
  const shotCity = buildCity(shotSeed === SEED ? SEED : shotSeed);
  game = stageShot(shotName, shotCity);
  const cam = cameraTarget(game);
  render(ctx, game, canvas.width, canvas.height, cam, locationName(game));
  document.title = `Marisol Heat — shot: ${shotName}`;
} else {
  bootLive();
}

function bootLive() {
  const save = loadSave();
  game = createGame(city, save);
  const amb = spawnAmbient(city, SEED);
  game.cars = amb.cars;
  game.peds = amb.peds;
  input = new Input(canvas);

  const unlock = () => { sound.unlock(); };
  window.addEventListener('keydown', unlock, { once: false });
  window.addEventListener('mousedown', unlock, { once: false });

  let last = performance.now();
  let acc = 0;
  const STEP = 1 / 60;

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt;
    const cam = cameraTarget(game);
    const view = {
      mouseWorldX: cam.x - canvas.width / 2 + input.mouse.x,
      mouseWorldY: cam.y - canvas.height / 2 + input.mouse.y,
    };
    while (acc >= STEP) {
      acc -= STEP;
      handleScreenKeys();
      if (game.screen === SCREEN.PLAY) {
        stepGame(game, STEP, input, view);
      }
      drainEvents();
      input.endFrame();
    }
    const camNow = cameraTarget(game);
    render(ctx, game, canvas.width, canvas.height, camNow, locationName(game));
    sound.setEngine(game.screen === SCREEN.PLAY && !!game.player.car, game.player.car ? Math.abs(game.player.car.speed) / 335 : 0);
    const policeNear = game.wanted > 0 && game.cars.some((c) => c.kind === 'police' && !c.dead);
    sound.setSiren(game.screen === SCREEN.PLAY && policeNear);
  }
  requestAnimationFrame(frame);
}

/** Title, pause and end-screen key handling (edge-triggered). */
function handleScreenKeys() {
  const s = game.screen;
  if (s === SCREEN.TITLE) {
    if (input.justPressed('n')) {
      wipeSave();
      const fresh = createGame(city, freshSave());
      fresh.cars = game.cars; fresh.peds = game.peds;
      game = fresh;
      game.screen = SCREEN.PLAY;
      announce('New game: Marisol arrives in Neon Harbor with $40 and a debt.');
      sound.click();
    } else if (input.justPressed('enter')) {
      game.screen = SCREEN.PLAY;
      announce('Marisol Heat: explore Neon Harbor.');
      sound.click();
    }
    return;
  }
  if (s === SCREEN.PLAY && (input.justPressed('p') || input.justPressed('escape'))) {
    game.screen = SCREEN.PAUSED;
    syncSave(game); storeSave(game.save);
    return;
  }
  if (s === SCREEN.PAUSED && (input.justPressed('p') || input.justPressed('escape') || input.justPressed('enter'))) {
    game.screen = SCREEN.PLAY;
    return;
  }
  if ((s === SCREEN.BUSTED || s === SCREEN.WASTED || s === SCREEN.COMPLETE) && input.justPressed('enter')) {
    revive();
    return;
  }
  if (input.justPressed('m')) {
    const muted = sound.toggleMute();
    game.muted = muted;
    announce(muted ? 'Sound muted.' : 'Sound on.');
  }
}

/** After a bust or a wasting: a fine, a heal, and back onto the street. */
function revive() {
  const p = game.player;
  if (game.screen === SCREEN.BUSTED) {
    const fine = Math.min(game.money, 60 + game.wanted * 40);
    game.money -= fine;
    announce(`Busted. The patrol fines Marisol $${fine}.`);
  } else if (game.screen === SCREEN.WASTED) {
    const bill = Math.min(game.money, 80);
    game.money -= bill;
    announce(`Wasted. The harbour clinic bills Marisol $${bill}.`);
  }
  if (game.storyDone && game.screen === SCREEN.COMPLETE) {
    // Nothing to revive from: just return to the open city.
  }
  p.dead = false;
  p.health = 100;
  p.car = null;
  game.wanted = 0;
  game.wantedHeat = 0;
  game.cars = game.cars.filter((c) => c.kind !== 'police');
  game.peds = game.peds.filter((c) => c.kind !== 'cop');
  game.screen = SCREEN.PLAY;
  syncSave(game);
  storeSave(game.save);
}

/** Turn the simulation's queued events into sounds and save writes. */
function drainEvents() {
  for (const ev of game.events) {
    switch (ev.name) {
      case 'door': sound.door(); break;
      case 'horn': sound.horn(); break;
      case 'crash': sound.crash(ev.data && ev.data.big); break;
      case 'shot': sound.shot(); break;
      case 'punch': sound.punch(); break;
      case 'hurt': sound.hurt(); break;
      case 'cash': sound.cash(); break;
      case 'pickup': sound.pickup(); break;
      case 'star': sound.star(); break;
      case 'splash': sound.splash(); break;
      case 'missionDone':
        sound.missionDone();
        syncSave(game); storeSave(game.save);
        if (game.storyDone) game.screen = SCREEN.COMPLETE;
        break;
      case 'missionFail': sound.busted(); break;
      case 'busted': sound.busted(); syncSave(game); storeSave(game.save); break;
      case 'wasted': sound.busted(); syncSave(game); storeSave(game.save); break;
      case 'autosave': storeSave(game.save); break;
      default: break;
    }
  }
  game.events.length = 0;
}

/** Keep the screen-reader status line loosely in sync with the game. */
function announce(text) {
  if (status) status.textContent = text;
}
