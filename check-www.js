/* TSG Biom — www/ drift check (Seat 1 Spec B5, shipped in v59).
   The committed www/ staging once sat two versions behind the
   web release (v56 sources under a v58 release, still carrying
   the retired auto-scan). This check fails whenever any staged
   file in www/ differs from the root source stage-www.js would
   copy, or a staged file is missing/extra — so a stale copy of
   the app can never silently remain in the repo.
   Run: node check-www.js   (also wired as `npm run check-www`
   and enforced at the end of `npm run stage`.) */
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const out = path.join(root, 'www');
const EXT = new Set(['.html', '.js', '.css', '.json', '.png', '.jpg',
                     '.jpeg', '.webp', '.svg', '.ico']);
const SKIP = new Set(['package.json', 'package-lock.json',
                      'capacitor.config.json', 'stage-www.js', 'check-www.js', 'vercel.json']);

const expected = new Set();
for (const name of fs.readdirSync(root)) {
  const p = path.join(root, name);
  if (!fs.statSync(p).isFile()) continue;
  if (SKIP.has(name) || !EXT.has(path.extname(name).toLowerCase())) continue;
  expected.add(name);
}

let problems = 0;
if (!fs.existsSync(out)) {
  console.log('FAIL www/ does not exist — run `npm run stage`');
  process.exit(1);
}
for (const name of fs.readdirSync(out)) {
  if (!expected.has(name)) {
    console.log('FAIL www/' + name + ' is staged but is not a root runtime file (extra)');
    problems++;
  }
}
for (const name of expected) {
  const staged = path.join(out, name);
  if (!fs.existsSync(staged)) {
    console.log('FAIL www/' + name + ' is missing — run `npm run stage`');
    problems++;
    continue;
  }
  if (!fs.readFileSync(path.join(root, name)).equals(fs.readFileSync(staged))) {
    console.log('FAIL www/' + name + ' differs from the root source — run `npm run stage`');
    problems++;
  }
}
if (problems) {
  console.log('www/ drift check: ' + problems + ' problem(s)');
  process.exit(1);
}
console.log('www/ drift check: OK — www/ matches the root sources (' + expected.size + ' files)');
