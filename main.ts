// Sunspire Heat — entrypoint for the make.fun grader.
//
// The grader runs this file twice from a read-only checkout of the repo,
// with a writable output directory. It copies the playable game and the
// screenshots into that directory and writes the dossier the scorer checks,
// using the kit's buildDossier from vendor/makefun-game.ts. Nothing here
// touches the network; the only inputs are the files in this repository.

import { buildDossier } from './vendor/makefun-game.ts';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function copyTree(name: string): void {
  const from = join(repoRoot, name);
  const to = join(outDir, name);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

mkdirSync(outDir, { recursive: true });
copyTree('game');
copyTree('screenshots');

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});

writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`sunspire-heat: dossier written to ${join(outDir, 'dossier.json')} (${dossier.length} bytes)`);
