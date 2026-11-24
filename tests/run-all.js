/* TSG Biom — run every test suite in tests/ (added in v59,
   Seat 1 Spec B5: package.json had no test script, so releases
   were regression-checked by hand). Each suite is a standalone
   node script that exits non-zero on failure. The www/ drift
   check runs as part of the gate. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const here = __dirname;
const suites = fs.readdirSync(here)
  .filter(function (n) { return n.endsWith('.test.js'); })
  .sort();

let failed = 0;
for (const name of suites) {
  const r = spawnSync(process.execPath, [path.join(here, name)], { encoding: 'utf8' });
  const last = (r.stdout || '').trim().split('\n').pop() || '';
  if (r.status === 0) {
    console.log('PASS ' + name + ' — ' + last);
  } else {
    failed++;
    console.log('FAIL ' + name);
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
  }
}
const drift = spawnSync(process.execPath, [path.join(here, '..', 'check-www.js')], { encoding: 'utf8' });
if (drift.status === 0) {
  console.log('PASS check-www — ' + (drift.stdout || '').trim());
} else {
  failed++;
  console.log('FAIL check-www');
  process.stdout.write(drift.stdout || '');
}
console.log(failed === 0
  ? 'ALL ' + suites.length + ' SUITES PASSED + www/ drift check'
  : failed + ' FAILURE(S) across ' + suites.length + ' suites');
process.exit(failed === 0 ? 0 : 1);
