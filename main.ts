// Token Radar entry for make.fun token-radar-01 (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), ranks every
// protocol that records no token by the implied value of its launch (dashboard/model.js,
// the same module the page is built from), and writes to /output (or MAKEFUN_OUTPUT_DIR,
// or --output <dir>):
//   board.json    the ranked rows with farm steps and every model input
//   data.js       the whole radar as one script the page reads, no fetch and no network
//   dashboard/    the static page
//   screenshots/  three captures of it
//   dossier.json  what the judge reads, written by vendor/makefun-board.ts
//
//   MAKEFUN_OUTPUT_DIR=/tmp/tokenradar-out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, makeBoard, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory>`);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { radar, board } = makeBoard(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the board breaks the gate: ${issue}`);

mkdirSync(out, { recursive: true });
// board.json: the gate's rows plus the model's inputs, the interval and the counts.
writeFileSync(join(out, 'board.json'), `${JSON.stringify({
  model: radar.model,
  as_of: radar.as_of,
  source: radar.source,
  floor_usd: radar.floor_usd,
  counts: radar.counts,
  validation: radar.validation,
  rows: board,
})}\n`);
// data.js: the same radar object the page renders, rows and all, so every figure on
// screen is a field of this JSON and no number is typed into the page by hand.
writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(radar)};\n`);

/** Copy a directory's regular files (no dot-names) into `to`, sorted so both runs match. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter((n) => !n.startsWith('.') && statSync(join(from, n)).isFile()).sort();
  for (const n of names) copyFileSync(join(from, n), join(to, n));
  return names;
}

const pages = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));

// The gate's dashboard rows, checked here before the dossier is written.
if (!pages.includes('index.html')) fail('dashboard/ has no index.html');
if (!pages.some((n) => extname(n) === '.css')) fail('dashboard/ has no .css file');
if (!pages.some((n) => extname(n) === '.js')) fail('dashboard/ has no .js file');
let dashBytes = 0;
for (const n of pages) {
  const size = statSync(join(here, 'dashboard', n)).size;
  dashBytes += size;
  if (/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(n) === false) fail(`dashboard/${n}: a name is letters, digits and . _ -`);
  if (/\bhttps?:\/\//.test(readFileSync(join(here, 'dashboard', n), 'utf8'))) fail(`dashboard/${n} names a network address`);
}
if (pages.length > 400 || dashBytes > 4_194_304) fail(`dashboard/ is ${pages.length} files and ${dashBytes} bytes`);
const bad = shots.find((n) => !IMAGE_NAME.test(n));
if (bad !== undefined) fail(`screenshots/${bad}: a name is letters, digits and . _ -`);
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4 (board, detail, filtered)`);

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${radar.counts.ranked} ranked (${radar.counts.watchlist_ranked}/${radar.counts.watchlist} watchlist, ${radar.counts.below_floor_ranked} below the floor), ` +
    `${radar.counts.tokenized} tokenized comparables, ${radar.counts.set_aside} set aside\n` +
    `token radar: curve a=${radar.validation.curve.a.toFixed(3)} b=${radar.validation.curve.b.toFixed(3)}, leave-one-out miss x${radar.validation.curve.median_miss}\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${pages.length} files, ${dashBytes} bytes), screenshots/ (${shots.length}) and dossier.json to ${out}\n`,
);
