// Sunspire Heat engine: the game loop, input, wanted level, missions, side
// jobs, collisions, saving and the screenshot / self-test staging modes.

import {
  buildTown, TILE, WORLD_W, WORLD_H, PLACES, BEACH_Y,
  isRoadAt, hitsBuilding, resolveBuildingCollision,
} from './town.js';
import {
  makeCar, driveCar, updateTraffic, updatePolice, spawnTraffic, spawnParked, CAR_DEFS,
} from './cars.js';
import {
  makePlayer, makePed, spawnPeds, movePlayerOnFoot, playerShoot, playerPunch,
  updatePed, makeCop, updateCop,
} from './people.js';
import { MISSIONS, STORY_DEBT, makeTaxiJob, makeCourierJob, stepPlace, objectiveLabel } from './story.js';
import { Sfx } from './sfx.js';
import { drawWorld, drawMinimap, cameraFor } from './view.js';
import { mulberry32, clamp, dist } from './rng.js';

const SAVE_KEY = 'sunspire-heat-save-v1';
const VIEW_W = 1280;
const VIEW_H = 720;

function $(id) { return document.getElementById(id); }

export class Game {
  constructor() {
    this.canvas = $('game');
    this.ctx = this.canvas.getContext('2d');
    this.mapCtx = $('minimap').getContext('2d');
    this.sfx = new Sfx();
    this.town = buildTown();
    this.rnd = mulberry32(777);
    this.time = 0;
    this.clockMin = 9 * 60;
    this.mode = 'title';
    this.errors = [];
    window.addEventListener('error', (e) => this.errors.push(String(e.message || e.error)));
    this.resetWorld();
    this.keys = new Set();
    this.mouse = { x: VIEW_W / 2, y: VIEW_H / 2, down: false };
    this.aim = { x: 0, y: 0 };
    this.cam = cameraFor(PLACES.plaza.x, PLACES.plaza.y);
    this.toastTimer = 0;
    this.bustTimer = 0;
    this.wantedDecay = 0;
    this.hurtTimer = 0;
    this.surviveTimer = 0;
    this.spawnTimer = 0;
    this.testDrive = null; // self-test input override
    this.selftest = null;
    this.shotMode = null;
    this.bindInput();
    this.wireButtons();
    this.applyShotMode();
    this.refreshTitle();
  }

  // ---------------------------------------------------------- setup

  resetWorld() {
    this.player = makePlayer(PLACES.plaza.x, PLACES.plaza.y + 90);
    this.cars = [
      ...spawnTraffic(this.rnd, 14),
      ...spawnParked(this.rnd, 9, this.town.buildings),
    ];
    // A taxi waiting right by the plaza for job one.
    this.cars.push(makeCar('taxi', PLACES.plaza.x + 40, PLACES.plaza.y + 150, 0));
    // The coupe for job three, parked by the garage.
    this.cars.push(makeCar('coupe', PLACES.garage.x + 60, PLACES.garage.y + 40, Math.PI / 2));
    this.peds = spawnPeds(this.rnd, 26);
    this.cops = [];
    this.particles = [];
    this.wanted = 0;
    this.missionIdx = 0;
    this.stepIdx = 0;
    this.sideJob = null;
    this.jobMarker = null;
    this.marker = null;
    this.stats = { shots: 0, hits: 0, carsStolen: 0, cashEarned: 0, missionsDone: 0, coins: 0, timePlayed: 0 };
    this.setMarkerForStep();
  }

  bindInput() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.sfx.unlock();
      if (e.code === 'KeyE' && this.mode === 'play') this.tryEnterExit();
      if (e.code === 'Space' && this.mode === 'play' && !this.player.inCar) this.tryPunch();
      if (e.code === 'KeyP' && this.mode === 'play') { this.saveGame(); this.toast('Game saved.'); }
      if (e.code === 'KeyM') {
        const muted = this.sfx.toggleMute();
        this.toast(muted ? 'Sound off.' : 'Sound on.');
      }
      if (e.code === 'Escape') {
        if (this.mode === 'play') this.pauseGame();
        else if (this.mode === 'pause') this.resumeGame();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - rect.left) * (VIEW_W / rect.width);
      this.mouse.y = (e.clientY - rect.top) * (VIEW_H / rect.height);
    });
    this.canvas.addEventListener('mousedown', (e) => {
      this.sfx.unlock();
      if (e.button !== 0) return;
      this.mouse.down = true;
      if (this.mode === 'play' && !this.player.inCar) this.tryShoot();
    });
    window.addEventListener('mouseup', () => { this.mouse.down = false; });
    window.addEventListener('blur', () => this.keys.clear());
  }

  wireButtons() {
    $('btn-start').addEventListener('click', () => { this.sfx.unlock(); this.sfx.click(); this.startGame(false); });
    $('btn-continue').addEventListener('click', () => { this.sfx.unlock(); this.sfx.click(); this.startGame(true); });
    $('btn-resume').addEventListener('click', () => this.resumeGame());
    $('btn-save').addEventListener('click', () => { this.saveGame(); this.toast('Game saved.'); });
    $('btn-quit').addEventListener('click', () => this.quitToTitle());
    $('btn-retry').addEventListener('click', () => this.startGame(true));
    $('btn-dead-title').addEventListener('click', () => this.quitToTitle());
    $('btn-again').addEventListener('click', () => { this.resetWorld(); this.startGame(false); });
    $('btn-win-title').addEventListener('click', () => this.quitToTitle());
  }

  // ---------------------------------------------------------- modes

  showScreen(name) {
    for (const id of ['screen-title', 'screen-pause', 'screen-dead', 'screen-win']) $(id).classList.add('hidden');
    if (name) $(name).classList.remove('hidden');
    $('hud').classList.toggle('hidden', name !== null);
  }

  refreshTitle() {
    const save = this.readSave();
    $('btn-continue').classList.toggle('hidden', !save);
    if (save) {
      $('continue-label').textContent = `Job ${Math.min(save.missionIdx + 1, 5)} of 5 · $${save.cash}`;
    }
  }

  startGame(fromSave) {
    if (fromSave) {
      const save = this.readSave();
      if (save) this.applySave(save);
      else this.resetWorld();
    } else {
      this.resetWorld();
    }
    this.mode = 'play';
    this.showScreen(null);
    this.toast(STORY_INTRO_SHORT);
    this.setMarkerForStep();
    this.updateHud();
  }

  pauseGame() {
    this.mode = 'pause';
    this.showScreen('screen-pause');
  }

  resumeGame() {
    this.mode = 'play';
    this.showScreen(null);
  }

  quitToTitle() {
    this.mode = 'title';
    this.refreshTitle();
    this.showScreen('screen-title');
  }

  die(cause) {
    if (this.mode !== 'play') return;
    this.mode = 'dead';
    this.sfx.fail();
    this.sfx.engine(0, false);
    this.sfx.siren(0, false);
    $('dead-line').textContent = cause === 'busted'
      ? 'Busted — the SPPD hauled Dana in. The week is over.'
      : 'Flatlined on a Sunspire sidewalk. The city moves on.';
    this.showScreen('screen-dead');
  }

  winGame() {
    if (this.mode !== 'play') return;
    this.mode = 'win';
    this.sfx.jingle();
    this.sfx.engine(0, false);
    this.sfx.siren(0, false);
    const s = this.stats;
    $('win-stats').textContent =
      `Jobs done: ${s.missionsDone} · Cash earned: $${s.cashEarned} · Cars stolen: ${s.carsStolen} · ` +
      `Shots fired: ${s.shots} (${s.hits} hits) · Sun coins: ${s.coins}/20 · Time: ${Math.floor(s.timePlayed / 60)}m ${Math.floor(s.timePlayed % 60)}s`;
    this.showScreen('screen-win');
  }

  // ---------------------------------------------------------- actions

  nearestCar(maxD) {
    let best = null;
    let bestD = maxD;
    for (const car of this.cars) {
      const d = dist(this.player.x, this.player.y, car.x, car.y);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  tryEnterExit() {
    const p = this.player;
    if (p.inCar) {
      const car = p.inCar;
      car.speed = 0;
      p.inCar = null;
      p.x = car.x - Math.sin(car.angle) * 34;
      p.y = car.y + Math.cos(car.angle) * 34;
      const fixed = resolveBuildingCollision(this.town.buildings, p.x, p.y, 15);
      p.x = fixed.x; p.y = fixed.y;
      return;
    }
    const car = this.nearestCar(78);
    if (!car) return;
    p.inCar = car;
    car.traffic = false;
    this.stats.carsStolen++;
    this.setWanted(Math.max(this.wanted, 1));
    this.toast(`Took the ${car.def.name}. The owner called it in — wanted level up.`);
    this.sfx.sirenBlip();
  }

  tryShoot() {
    const p = this.player;
    if (p.ammo <= 0) { this.toast('Out of ammo — find the green $ markers for work, or finish a job.'); return; }
    const hit = playerShoot(p, this.aim.x, this.aim.y, this.peds, this.cops, this.cars);
    if (!hit) return;
    this.stats.shots++;
    this.sfx.shot();
    this.burst(hit.hitX, hit.hitY, '#ffe9a8', 5);
    if (hit.kind === 'ped') {
      this.stats.hits++;
      this.removePed(hit.obj);
      this.burst(hit.obj.x, hit.obj.y, '#ff5a3c', 10);
      this.setWanted(this.wanted + 1);
      this.toast('That was a civilian. The city saw it.');
    } else if (hit.kind === 'cop') {
      this.stats.hits++;
      hit.obj.hp -= 1;
      this.burst(hit.obj.x, hit.obj.y, '#2e6bff', 8);
      if (hit.obj.hp <= 0) {
        this.cops.splice(this.cops.indexOf(hit.obj), 1);
        this.burst(hit.obj.x, hit.obj.y, '#2e6bff', 16);
        this.setWanted(Math.min(5, this.wanted + 1));
        this.toast('Cop down. That only makes it worse.');
      }
    } else if (hit.kind === 'car') {
      this.stats.hits++;
      hit.obj.damage += 0.35;
      if (hit.obj.damage > 1.2) {
        hit.obj.traffic = false;
        hit.obj.speed = 0;
        this.burst(hit.obj.x, hit.obj.y, '#888', 10);
      }
      if (hit.obj.police) this.setWanted(Math.min(5, this.wanted + 1));
    }
    // Nearby pedestrians panic at gunfire.
    for (const ped of this.peds) {
      if (dist(ped.x, ped.y, p.x, p.y) < 320) {
        ped.flee = 2.5;
        ped.fleeX = ped.x - p.x;
        ped.fleeY = ped.y - p.y;
        ped.panic = true;
      }
    }
  }

  tryPunch() {
    const hit = playerPunch(this.player, this.peds, this.cops);
    if (!hit) return;
    this.sfx.punch();
    if (hit.kind === 'ped') {
      this.removePed(hit.obj);
      this.setWanted(Math.max(this.wanted, 1));
      this.toast('You decked a pedestrian. Witnesses everywhere.');
    } else if (hit.kind === 'cop') {
      hit.obj.hp -= 1;
      if (hit.obj.hp <= 0) {
        this.cops.splice(this.cops.indexOf(hit.obj), 1);
        this.setWanted(Math.min(5, this.wanted + 1));
      }
    }
  }

  removePed(ped) {
    const i = this.peds.indexOf(ped);
    if (i >= 0) this.peds.splice(i, 1);
    // The city refills: a fresh pedestrian wanders in elsewhere.
    const fresh = spawnPeds(this.rnd, 1);
    this.peds.push(...fresh);
  }

  setWanted(n) {
    this.wanted = clamp(Math.round(n), 0, 5);
    this.wantedDecay = 0;
  }

  addCash(n) {
    this.player.cash += n;
    this.stats.cashEarned += n;
  }

  toast(text, seconds = 3) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    this.toastTimer = seconds;
  }

  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 160;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.5, maxLife: 0.5, color, size: 3 + Math.random() * 4,
      });
    }
  }

  // ---------------------------------------------------------- missions

  currentMission() {
    return this.missionIdx < MISSIONS.length ? MISSIONS[this.missionIdx] : null;
  }

  setMarkerForStep() {
    const m = this.currentMission();
    this.marker = null;
    if (m) {
      const step = m.steps[this.stepIdx];
      if (step && step.place) this.marker = { ...stepPlace(step) };
    }
    if (this.sideJob && this.sideJob.stage === 'pickup') this.jobMarker = { ...this.sideJob.from };
    else if (this.sideJob && this.sideJob.stage === 'dropoff') this.jobMarker = { ...this.sideJob.to };
    else if (!this.sideJob) this.jobMarker = this.pickJobSpot();
  }

  pickJobSpot() {
    // A green $ marker drifts between named places when no job is active.
    const keys = Object.keys(PLACES);
    return { ...PLACES[keys[Math.floor(this.rnd() * keys.length)]] };
  }

  completeStep() {
    const m = this.currentMission();
    if (!m) return;
    this.stepIdx++;
    this.sfx.pickup();
    if (this.stepIdx >= m.steps.length) {
      this.addCash(m.reward);
      this.player.ammo += 12;
      this.stats.missionsDone++;
      this.toast(`${m.title} — done! +$${m.reward}, +12 ammo.`);
      this.sfx.jingle();
      this.missionIdx++;
      this.stepIdx = 0;
      this.saveGame();
      if (this.missionIdx >= MISSIONS.length) {
        this.winGame();
        return;
      }
      const next = this.currentMission();
      this.toast(`New job: ${next.title}`);
    }
    this.setMarkerForStep();
    this.armSurviveStep();
  }

  checkMissionStep(dt) {
    const m = this.currentMission();
    if (!m) return;
    const step = m.steps[this.stepIdx];
    if (!step) return;
    const p = this.player;
    const px = p.inCar ? p.inCar.x : p.x;
    const py = p.inCar ? p.inCar.y : p.y;
    switch (step.kind) {
      case 'inCar':
        if (p.inCar) this.completeStep();
        break;
      case 'reach': {
        const place = stepPlace(step);
        if (place && dist(px, py, place.x, place.y) < step.radius && (!step.inCar || p.inCar)) {
          this.completeStep();
        }
        break;
      }
      case 'wanted':
        if (this.wanted >= step.min) this.completeStep();
        break;
      case 'stealKind':
        if (p.inCar && p.inCar.kind === step.kindName) this.completeStep();
        break;
      case 'survive': {
        if (this.surviveTimer > 0) {
          this.surviveTimer -= dt;
          // Rival push: foot cops keep coming while the timer runs.
          this.spawnTimer -= dt;
          if (this.spawnTimer <= 0 && this.cops.length < 3) {
            this.spawnTimer = 2.5;
            const a = Math.random() * Math.PI * 2;
            this.cops.push(makeCop(px + Math.cos(a) * 420, py + Math.sin(a) * 420));
          }
          if (this.surviveTimer <= 0) this.completeStep();
        }
        break;
      }
      default:
        break;
    }
  }

  armSurviveStep() {
    const m = this.currentMission();
    if (!m) return;
    const step = m.steps[this.stepIdx];
    if (step && step.kind === 'survive') this.surviveTimer = step.seconds;
  }

  // ---------------------------------------------------------- side jobs

  tryStartSideJob() {
    if (this.sideJob) return;
    const p = this.player;
    if (!this.jobMarker) return;
    if (dist(p.x, p.y, this.jobMarker.x, this.jobMarker.y) > 70) return;
    if (this.rnd() < 0.5) {
      this.sideJob = makeTaxiJob(this.rnd, PLACES);
      this.sideJob.stage = 'pickup';
      this.toast(`Taxi job: pick up the fare at ${this.sideJob.from.name}.`);
    } else {
      this.sideJob = makeCourierJob(this.rnd, PLACES);
      this.sideJob.stage = 'deliver';
      this.toast(`Courier job: deliver the parcel to ${this.sideJob.to.name}.`);
    }
    this.setMarkerForStep();
  }

  updateSideJob() {
    const job = this.sideJob;
    if (!job) return;
    const p = this.player;
    const px = p.inCar ? p.inCar.x : p.x;
    const py = p.inCar ? p.inCar.y : p.y;
    if (job.kind === 'taxi' && job.stage === 'pickup') {
      if (dist(px, py, job.from.x, job.from.y) < 80) {
        job.stage = 'dropoff';
        this.toast('Fare aboard. Drive them to ' + job.to.name + '.');
        this.setMarkerForStep();
      }
    } else {
      const dest = job.kind === 'taxi' ? job.to : job.to;
      if (dist(px, py, dest.x, dest.y) < 80) {
        this.addCash(job.fare);
        this.toast(`${job.title} done — +$${job.fare}.`);
        this.sfx.jingle();
        this.sideJob = null;
        this.jobMarker = this.pickJobSpot();
        this.setMarkerForStep();
      }
    }
  }

  // ---------------------------------------------------------- save / load

  readSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  saveGame() {
    const p = this.player;
    const data = {
      version: 1,
      missionIdx: this.missionIdx,
      stepIdx: this.stepIdx,
      cash: p.cash,
      health: p.health,
      ammo: p.ammo,
      x: p.inCar ? p.inCar.x : p.x,
      y: p.inCar ? p.inCar.y : p.y,
      coinsTaken: this.town.coins.map((c) => c.taken),
      stats: this.stats,
      clockMin: this.clockMin,
      savedAt: new Date().toISOString(),
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
  }

  applySave(save) {
    this.resetWorld();
    this.missionIdx = save.missionIdx || 0;
    this.stepIdx = save.stepIdx || 0;
    this.player.cash = save.cash ?? 120;
    this.player.health = save.health ?? 100;
    this.player.ammo = save.ammo ?? 24;
    this.player.x = save.x ?? PLACES.plaza.x;
    this.player.y = save.y ?? PLACES.plaza.y;
    this.stats = { ...this.stats, ...(save.stats || {}) };
    this.clockMin = save.clockMin ?? 9 * 60;
    if (Array.isArray(save.coinsTaken)) {
      save.coinsTaken.forEach((taken, i) => { if (this.town.coins[i]) this.town.coins[i].taken = !!taken; });
    }
    this.setMarkerForStep();
  }

  // ---------------------------------------------------------- update

  playerPos() {
    const p = this.player;
    return p.inCar ? { x: p.inCar.x, y: p.inCar.y } : { x: p.x, y: p.y };
  }

  update(dt) {
    this.time += dt;
    this.clockMin += dt;
    if (this.mode === 'title') {
      // Ambient city behind the title screen.
      for (const car of this.cars) if (car.traffic) updateTraffic(car, dt, this.cars);
      for (const ped of this.peds) updatePed(ped, dt, this.town.buildings, []);
      this.cam = cameraFor(PLACES.plaza.x, PLACES.plaza.y);
      return;
    }
    if (this.mode !== 'play') return;
    this.stats.timePlayed += dt;
    const p = this.player;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.toastTimer = Math.max(0, this.toastTimer - dt);
    if (this.toastTimer <= 0) $('toast').classList.remove('show');

    // --- Input vector.
    let mx = 0, my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.testDrive) { mx = this.testDrive.mx || 0; my = this.testDrive.my || 0; }
    const len = Math.hypot(mx, my) || 1;
    mx /= len; my /= len;

    // Aim follows the mouse in world space.
    this.aim.x = this.cam.x + this.mouse.x;
    this.aim.y = this.cam.y + this.mouse.y;
    if (!p.inCar && (this.mouse.x !== VIEW_W / 2 || this.mouse.y !== VIEW_H / 2)) {
      p.angle = Math.atan2(this.aim.y - p.y, this.aim.x - p.x);
    }

    if (p.inCar) {
      const car = p.inCar;
      const throttle = this.testDrive ? (this.testDrive.throttle ?? 0) : (my < 0 ? 1 : my > 0 ? -0.7 : 0);
      const steer = this.testDrive ? (this.testDrive.steer ?? 0) : mx;
      driveCar(car, {
        throttle,
        steer,
        brake: this.keys.has('Space') || this.testDrive?.brake,
        nitro: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.testDrive?.nitro,
      }, dt, this.town.buildings);
      p.x = car.x; p.y = car.y;
      p.angle = car.angle;
      this.sfx.engine(Math.abs(car.speed) / car.def.maxSpeed, true);
      // Running over pedestrians is a crime the city notices.
      for (const ped of [...this.peds]) {
        if (dist(car.x, car.y, ped.x, ped.y) < 26 && Math.abs(car.speed) > 60) {
          this.removePed(ped);
          this.burst(ped.x, ped.y, '#ff5a3c', 12);
          this.setWanted(this.wanted + 1);
          this.toast('You ran someone over. Wanted level up.');
        }
      }
    } else {
      movePlayerOnFoot(p, { mx, my }, dt, this.town.buildings);
      this.sfx.engine(0, false);
    }

    // --- Traffic + police.
    for (const car of this.cars) {
      if (car.traffic) updateTraffic(car, dt, this.cars);
      else if (car.police) updatePolice(car, dt, this.town.buildings);
    }
    this.updatePolicePresence(dt);
    this.collideCars(dt);

    // --- Pedestrians + foot cops.
    const pos = this.playerPos();
    const threats = [];
    if (!p.inCar && p.shootTimer > 0.2) threats.push({ x: p.x, y: p.y, radius: 320 });
    for (const car of this.cars) {
      if (Math.abs(car.speed) > 120) threats.push({ x: car.x, y: car.y, radius: 130 });
    }
    for (const ped of this.peds) updatePed(ped, dt, this.town.buildings, threats);
    for (const cop of [...this.cops]) {
      if (p.inCar) {
        // Cops give up chasing a car on foot; they head for the roadside.
        if (dist(cop.x, cop.y, pos.x, pos.y) > 700) this.cops.splice(this.cops.indexOf(cop), 1);
        continue;
      }
      const hit = updateCop(cop, p, dt, this.town.buildings);
      if (hit === 'hit' && p.invuln <= 0) {
        p.health -= 9;
        p.invuln = 0.7;
        this.hurtTimer = 0.4;
        this.sfx.punch();
        this.burst(p.x, p.y, '#ff5a3c', 6);
      }
    }

    // Busted: a foot cop lingers on an on-foot player at 3+ stars.
    if (!p.inCar && this.wanted >= 3) {
      const near = this.cops.some((c) => dist(c.x, c.y, p.x, p.y) < 46);
      this.bustTimer = near ? this.bustTimer + dt : 0;
      if (this.bustTimer > 2.5) { this.die('busted'); return; }
    } else {
      this.bustTimer = 0;
    }

    // --- Wanted decay when the heat cannot see you.
    const policeNear = this.cars.some((c) => c.police && dist(c.x, c.y, pos.x, pos.y) < 520)
      || this.cops.some((c) => dist(c.x, c.y, pos.x, pos.y) < 420);
    if (!policeNear && this.wanted > 0) {
      this.wantedDecay += dt;
      if (this.wantedDecay > 9) {
        this.wantedDecay = 0;
        this.setWanted(this.wanted - 1);
        if (this.wanted === 0) this.toast('You lost them. For now.');
      }
    } else {
      this.wantedDecay = 0;
    }

    // --- Coins.
    for (const coin of this.town.coins) {
      if (!coin.taken && dist(pos.x, pos.y, coin.x, coin.y) < 30) {
        coin.taken = true;
        this.stats.coins++;
        this.addCash(25);
        this.sfx.coin();
        this.toast('Sun coin! +$25.');
      }
    }

    // --- Missions + side jobs.
    this.checkMissionStep(dt);
    this.tryStartSideJob();
    this.updateSideJob();

    // --- Particles.
    for (const pt of [...this.particles]) {
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      if (pt.life <= 0) this.particles.splice(this.particles.indexOf(pt), 1);
    }

    // --- Slow heal when clean and calm.
    if (this.wanted === 0 && p.health < 100 && this.hurtTimer <= 0) {
      p.health = Math.min(100, p.health + 2.5 * dt);
    }
    if (p.health <= 0) { this.die('dead'); return; }

    // --- Camera + audio.
    const focus = this.playerPos();
    this.cam = cameraFor(focus.x, focus.y);
    this.sfx.siren(dt, this.wanted > 0);
    this.updateHud();
  }

  /** Keep the right number of police around for the wanted level. */
  updatePolicePresence(dt) {
    const pos = this.playerPos();
    const wantCars = Math.min(this.wanted, 4);
    const haveCars = this.cars.filter((c) => c.police).length;
    if (haveCars < wantCars) {
      const a = Math.random() * Math.PI * 2;
      const car = makeCar('police',
        clamp(pos.x + Math.cos(a) * 620, 60, WORLD_W - 60),
        clamp(pos.y + Math.sin(a) * 620, 60, WORLD_H - 60),
        0, { target: this.playerPosProxy() });
      this.cars.push(car);
    }
    // Prune police that fell far behind once the heat drops.
    for (const car of [...this.cars]) {
      if (car.police && this.wanted === 0 && dist(car.x, car.y, pos.x, pos.y) > 900) {
        this.cars.splice(this.cars.indexOf(car), 1);
      }
    }
    // Foot cops join the chase at 2+ stars when the player is on foot.
    if (this.wanted >= 2 && !this.player.inCar && this.cops.length < Math.min(3, this.wanted - 1)) {
      if (Math.random() < dt * 0.8) {
        const a = Math.random() * Math.PI * 2;
        this.cops.push(makeCop(
          clamp(pos.x + Math.cos(a) * 380, 40, WORLD_W - 40),
          clamp(pos.y + Math.sin(a) * 380, 40, WORLD_H - 40)));
      }
    }
  }

  /** A live {x,y} view of the player for police targeting. */
  playerPosProxy() {
    const self = this;
    return {
      get x() { const p = self.playerPos(); return p.x; },
      get y() { const p = self.playerPos(); return p.y; },
    };
  }

  /** Car-vs-car bumps: push apart, spark, damage, slow both. */
  collideCars(dt) {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        const d = dist(a.x, a.y, b.x, b.y);
        const minD = 34;
        if (d >= minD || d < 0.01) continue;
        const push = (minD - d) / 2;
        const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        const rel = Math.abs(a.speed - b.speed);
        if (rel > 90) {
          a.speed *= 0.6; b.speed *= 0.6;
          a.damage += 0.08; b.damage += 0.08;
          this.burst((a.x + b.x) / 2, (a.y + b.y) / 2, '#ffe9a8', 6);
          if (a === this.player.inCar || b === this.player.inCar) this.sfx.crash();
          // Ramming a cop car hard is a crime.
          if ((a.police || b.police) && (a === this.player.inCar || b === this.player.inCar) && rel > 180) {
            this.setWanted(this.wanted + 1);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------- HUD

  updateHud() {
    const p = this.player;
    $('health-bar').style.width = `${clamp(p.health, 0, 100)}%`;
    $('health-num').textContent = Math.ceil(Math.max(0, p.health));
    $('cash-num').textContent = p.cash.toLocaleString('en-US');
    const starsEl = $('stars');
    let html = '';
    for (let i = 0; i < 5; i++) html += `<span class="${i < this.wanted ? 'lit' : 'dim'}">★</span>`;
    if (starsEl.innerHTML !== html) starsEl.innerHTML = html;
    $('ammo-num').textContent = p.inCar ? '—' : p.ammo;
    const hh = Math.floor(this.clockMin / 60) % 24;
    const mm = Math.floor(this.clockMin % 60);
    $('clock-num').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const speed = p.inCar ? Math.abs(p.inCar.speed) * 0.22 : 0;
    $('speed-num').textContent = `${Math.round(speed)} mph`;
    const m = this.currentMission();
    $('objective-title').textContent = m ? m.title : (this.sideJob ? this.sideJob.title : 'FREE ROAM');
    let text = objectiveLabel(m, this.stepIdx);
    if (m && m.steps[this.stepIdx]?.kind === 'survive' && this.surviveTimer > 0) {
      text += ` — ${Math.ceil(this.surviveTimer)}s left`;
    }
    if (this.sideJob) text = `${this.sideJob.text} ($${this.sideJob.fare})`;
    $('objective-text').textContent = text;
  }

  // ---------------------------------------------------------- render

  render() {
    const pos = this.playerPos();
    const S = {
      player: this.player,
      cars: this.cars,
      peds: this.peds,
      cops: this.cops,
      particles: this.particles,
      marker: this.marker,
      jobMarker: this.jobMarker,
      wanted: this.wanted,
      aim: this.mode === 'play' && !this.player.inCar ? this.aim : null,
    };
    drawWorld(this.ctx, S, this.town, this.cam, this.time);
    if (this.mode !== 'title') drawMinimap(this.mapCtx, S, this.town);
    // Beach hint when the player is near the shore.
    if (pos.y > BEACH_Y - 200 && this.mode === 'play') {
      this.ctx.fillStyle = 'rgba(0,0,0,0.35)';
      this.ctx.fillRect(20, VIEW_H - 44, 300, 28);
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '14px sans-serif';
      this.ctx.fillText('Sunspire Pier — the end of the road.', 30, VIEW_H - 25);
    }
  }

  // ---------------------------------------------------------- main loop

  frame = (t) => {
    const dt = Math.min(0.05, (t - (this.lastT || t)) / 1000 || 0.016);
    this.lastT = t;
    try {
      this.update(dt);
    } catch (err) {
      this.errors.push(String(err && err.message || err));
    }
    try {
      this.render();
    } catch (err) {
      this.errors.push(String(err && err.message || err));
    }
    if (this.selftest) this.selftestTick(dt);
    requestAnimationFrame(this.frame);
  };

  start() {
    // Shot/self-test modes already started the game in the constructor;
    // only show the title screen for a normal interactive load.
    if (!this.shotMode && !this.selftest) this.showScreen('screen-title');
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------- shot staging

  applyShotMode() {
    const params = new URLSearchParams(location.search);
    this.shotMode = params.get('shot');
    const selftest = params.get('selftest');
    if (!this.shotMode && !selftest) return;
    if (selftest) {
      this.selftest = { phase: 0, frames: 0, notes: [], startX: 0, startY: 0, cashBefore: 0 };
      this.startGame(false);
      return;
    }
    if (this.shotMode === 'title') return; // Title screen as-is.
    this.startGame(false);
    const p = this.player;
    if (this.shotMode === 'street') {
      const taxi = this.cars.find((c) => c.kind === 'taxi' && !c.traffic);
      p.inCar = taxi || this.cars[0];
      p.inCar.traffic = false;
      // Put the cab on the avenue (road row 12) so it can roll freely.
      // Head west from the east side: after a few seconds it is mid-city.
      p.inCar.x = 30 * TILE;
      p.inCar.y = (12 + 0.5) * TILE;
      p.inCar.angle = Math.PI;
      p.inCar.speed = 240;
      p.x = p.inCar.x; p.y = p.inCar.y;
      this.testDrive = { throttle: 1, steer: 0 }; // Keep rolling for the shot.
      this.cam = cameraFor(p.x, p.y);
    } else if (this.shotMode === 'chase') {
      const coupe = this.cars.find((c) => c.kind === 'coupe' && !c.traffic);
      p.inCar = coupe || this.cars[0];
      p.inCar.traffic = false;
      // Stage the chase on the avenue (road row 12), heading west so the
      // car ends up mid-city instead of pinned to the east edge.
      p.inCar.x = 33 * TILE;
      p.inCar.y = (12 + 0.5) * TILE;
      p.inCar.angle = Math.PI;
      p.inCar.speed = 300;
      p.x = p.inCar.x; p.y = p.inCar.y;
      this.testDrive = { throttle: 1, steer: 0 }; // Keep rolling for the shot.
      this.setWanted(3);
      // Police join on the same avenue, behind the player, so the chase
      // reads immediately instead of getting stuck on buildings.
      for (let i = 0; i < 3; i++) {
        this.cars.push(makeCar('police',
          p.x + 320 + i * 120, (12 + 0.5) * TILE, Math.PI,
          { target: this.playerPosProxy() }));
      }
      this.cam = cameraFor(p.x, p.y);
    } else if (this.shotMode === 'mission') {
      this.missionIdx = 1; this.stepIdx = 0;
      p.x = PLACES.bank.x - 120; p.y = PLACES.bank.y + 40;
      this.setWanted(1);
      this.setMarkerForStep();
      this.cam = cameraFor(p.x, p.y);
    } else if (this.shotMode === 'plaza') {
      this.missionIdx = 3; this.stepIdx = 1;
      this.armSurviveStep();
      p.x = PLACES.plaza.x; p.y = PLACES.plaza.y;
      p.ammo = 48;
      this.setWanted(2);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        this.cops.push(makeCop(p.x + Math.cos(a) * 420, p.y + Math.sin(a) * 420));
      }
      // Drift slowly so the cops close in on a moving target, not a statue.
      this.testDrive = { mx: 0.2, my: -0.4 };
      this.setMarkerForStep();
      this.cam = cameraFor(p.x, p.y);
    }
    this.updateHud();
  }

  // ---------------------------------------------------------- self-test

  selftestTick(dt) {
    const st = this.selftest;
    st.frames++;
    const ok = (name, cond, detail) => st.notes.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
    const F = st.frames;
    try {
      if (F === 2) {
        st.startX = this.player.x; st.startY = this.player.y;
        ok('boot', this.mode === 'play' && this.cars.length >= 20, `${this.cars.length} cars, ${this.peds.length} peds, ${this.town.buildings.length} buildings`);
        this.testDrive = { mx: 0, my: -1 };
      } else if (F === 65) {
        const moved = dist(st.startX, st.startY, this.player.x, this.player.y);
        ok('walk', moved > 40, `moved ${Math.round(moved)}px`);
        this.testDrive = null;
        // Step next to the plaza taxi and enter it.
        const taxi = this.cars.find((c) => c.kind === 'taxi' && !c.traffic);
        this.player.x = taxi.x - 30; this.player.y = taxi.y;
        this.tryEnterExit();
        ok('enter-car', !!this.player.inCar, this.player.inCar ? this.player.inCar.def.name : 'none');
      } else if (F === 70) {
        this.testDrive = { throttle: 1, steer: 0.15 };
      } else if (F === 190) {
        const speed = Math.abs(this.player.inCar ? this.player.inCar.speed : 0);
        ok('drive', speed > 80, `${Math.round(speed)}px/s`);
        this.testDrive = null;
        this.aim = { x: this.player.x + 200, y: this.player.y };
        const before = this.stats.shots;
        this.tryShoot();
        ok('shoot', this.stats.shots === before + 1 && this.player.ammo === 23, `ammo ${this.player.ammo}`);
      } else if (F === 200) {
        // Mission 1 step 0 (inCar) should already be complete; drive to the market.
        ok('mission-step0', this.stepIdx === 1 && this.missionIdx === 0, `mission ${this.missionIdx} step ${this.stepIdx}`);
        const car = this.player.inCar;
        car.x = PLACES.market.x; car.y = PLACES.market.y;
        this.player.x = car.x; this.player.y = car.y;
      } else if (F === 210) {
        ok('mission-1-done', this.missionIdx === 1, `mission ${this.missionIdx}, cash $${this.player.cash}`);
        this.setWanted(3);
      } else if (F === 300) {
        const police = this.cars.filter((c) => c.police).length;
        ok('police-spawn', police >= 2, `${police} police cars at wanted 3`);
        st.cashBefore = this.player.cash;
        this.saveGame();
        this.player.cash = 0;
        const save = this.readSave();
        this.applySave(save);
        ok('save-load', this.player.cash === st.cashBefore, `cash $${this.player.cash}`);
      } else if (F === 320) {
        ok('no-errors', this.errors.length === 0, this.errors.slice(0, 3).join(' | '));
        ok('frames-rendered', st.frames >= 300, `${st.frames} frames`);
        const fails = st.notes.filter((n) => n.startsWith('FAIL'));
        const result = {
          verdict: fails.length === 0 && this.errors.length === 0 ? 'SELFTEST PASS' : 'SELFTEST FAIL',
          notes: st.notes,
          errors: this.errors,
          mission: this.missionIdx,
          cash: this.player.cash,
          wanted: this.wanted,
        };
        const el = $('selftest');
        el.textContent = JSON.stringify(result, null, 1);
        el.classList.remove('hidden');
        document.title = result.verdict;
        this.selftest = null;
      }
    } catch (err) {
      this.errors.push(String(err && err.message || err));
      const el = $('selftest');
      el.textContent = JSON.stringify({ verdict: 'SELFTEST FAIL', error: String(err && err.message || err), notes: st.notes });
      el.classList.remove('hidden');
      document.title = 'SELFTEST FAIL';
      this.selftest = null;
    }
  }
}

const STORY_INTRO_SHORT = 'Dana owes the harbor crew $5,000. Five jobs. One week.';
