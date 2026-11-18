# Marisol Heat — Neon Harbor

An original open-world crime game for the make.fun `gta6-01` bounty ("Make
GTA 6"), built from scratch as plain static files — no build step, no
network, no libraries. Open `game/index.html` in a desktop browser (or run
`node serve.ts` and visit http://localhost:8080) and play.

## The game

Marisol Vega is a dock courier in Neon Harbor, a neon-lit harbour city, and
she owes the Cannery three months of money. Fixer Dee Okafor and dock boss
Renzo feed her a five-job story arc — a quiet envelope run, a stolen coupe,
a loud escape, a harbour time trial, and one last drive down the pier —
while the harbour patrol does its best to end her career early.

- **Open world**: a seeded 14×11-block city with named districts, a beach,
  a pier and the sea, explorable on foot and by car, with a full day/night
  cycle that brings the neon out after dark.
- **Traffic & pedestrians**: cars drive the avenue/street grid, brake for
  obstacles and turn at intersections; pedestrians stroll the sidewalks and
  flee from gunfire and sirens.
- **Steal & drive**: parked cars wait at every curb and moving traffic can
  be carjacked. Arcade driving with handbrake, crashes, damage and smoke.
- **Wanted level & police**: crimes raise heat when witnessed. Police cars
  pursue and ram, foot officers chase and shoot, and standing still in
  reach fills the bust meter. Hide long enough and the stars cool off.
- **Missions & story**: five jobs with briefings, dialogue, stage markers,
  checkpoints, timers and payouts, plus respawning cash pickups for side
  income.
- **Combat**: fists from the start, a pistol once Marisol's reputation
  grows; mouse aim, tracers, hit reactions.
- **HUD & minimap**: health, cash, district, objective line, mission timer,
  wanted stars and a live circular minimap with police and objective blips.
- **Screens & save**: animated title screen, pause, busted/wasted flow, a
  story-complete screen, and progress (cash, story, position, stats) saved
  to `localStorage`.
- **Sound**: all effects are synthesized live with WebAudio — engine hum,
  sirens, horns, crashes, gunshots, cash registers and mission stingers.
  No audio files.

## Controls

| Keys | Action |
| --- | --- |
| WASD / arrows | Move / drive |
| Shift | Sprint |
| E | Enter / exit car |
| Mouse + click, or F | Aim and attack (fists, later pistol) |
| Space | Handbrake |
| H | Horn |
| P / Esc | Pause |
| M | Mute |
| Enter | Confirm / start |
| N | New game (on the title screen) |

## Layout

- `main.ts` — the hand-in program: copies `game/` and `screenshots/` to the
  output directory and writes `dossier.json` with the vendored kit library.
- `game/index.html` — the page.
- `game/src/world.js` — the seeded city: roads, buildings, districts, collision.
- `game/src/entities.js` — traffic, pedestrians, police AI and spawning.
- `game/src/game.js` — the simulation: player, driving, combat, crime, wanted.
- `game/src/missions.js` — the five-job story arc as data.
- `game/src/render.js` — canvas rendering, HUD and minimap, all screens.
- `game/src/audio.js` — the WebAudio sound synth.
- `game/src/input.js` — keyboard and mouse.
- `game/src/save.js` — localStorage persistence.
- `game/src/shots.js` — deterministic `?shot=` scenes used for screenshots.
- `screenshots/` — four real renders of the game (title, mission, chase, pier).

Everything — names, city, characters, story, art and sound — is original to
this entry.
