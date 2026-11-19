# makefun-gta6-01

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/yuyan5319-crypto/makefun-gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/yuyan5319-crypto/makefun-gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Sunspire Heat — an original open-world crime game set in the fictional, sun-soaked Sunspire City. Explore the city on foot and by car, steal cars, outrun the Sunspire PD under a five-star wanted system, run five story jobs for the harbor crew, take taxi fares and courier drops, collect sun coins, and save your progress. Top-down 2D, keyboard + mouse, HUD with live minimap, synthesized sound, no network needed — every file is local.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. WASD to move and drive, E to steal or enter a car, mouse to aim, click to shoot, Space to punch or handbrake, Shift for nitro, P to save, Esc to pause.

## How it is built

- `game/index.html` + `game/style.css` — page, HUD and menus.
- `game/js/boot.js` — entry point; `game/js/engine.js` — game loop, wanted level, missions, saving.
- `game/js/town.js` — the seeded city: avenues, blocks, beach, pier, harbor.
- `game/js/cars.js` — driving physics, traffic and police pursuit.
- `game/js/people.js` — the player on foot, pedestrians, foot cops.
- `game/js/story.js` — five story jobs and side work.
- `game/js/view.js` — world rendering and minimap.
- `game/js/sfx.js` — all sound synthesized with WebAudio.
- `main.ts` — copies `game/` and `screenshots/` to the output directory and writes `dossier.json`.

Screenshots in `screenshots/` are real renders of the game itself, taken in a headless browser from the game's own scene URLs (see `shots.json`).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
