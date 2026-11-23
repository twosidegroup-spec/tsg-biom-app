/* TSG Biom — v38 regression: app updates MIGRATE the on-device
   store forward; they never wipe it.
   Trigger (the Chairman's phone verdict on v37, 2026-11-23 13:35):
   "from now keep data dont wipe". Every version bump up to v37
   deleted the whole store on first open and forced a fresh
   enrolment. From v38 the startup path runs B.migrateBiomData over
   the stored snapshot instead.

   This suite builds a store in the EXACT v37 written shapes (the
   person object finishEnrollment saves, a BIOM-PAY transaction, a
   verification log row, the biomSeq meta row), JSON-round-trips it
   the way storage does, runs the real migration chain the app runs,
   and proves: the person, the palm codes and the points survive
   untouched, and the migrated profile still VERIFIES against a
   fresh probe of the same palm (and still rejects another palm).
   Fixtures are the palmprint.test.js synthetic palms — the profile
   codes are real EDCC codes in the stored base64 form. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function lcg(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
function roiImage(creases, seed, opts) {
  opts = opts || {};
  const size = 128, rnd = lcg(seed);
  const noiseAmp = opts.noiseAmp != null ? opts.noiseAmp : 12;
  const noise = [];
  for (let i = 0; i < size * size; i++) noise.push((rnd() - 0.5) * noiseAmp);
  const dx = opts.dx || 0, dy = opts.dy || 0, bright = opts.bright || 0;
  const g = new Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x + dx, py = y + dy;
    let v = 172 + Math.sin(px * 0.045 + 1.7) * 9 + Math.cos(py * 0.06 + 0.4) * 7 + bright;
    for (const c of creases) {
      if (c.vert) {
        const lx = c.a * py + c.b + Math.sin(py * c.f + c.p) * c.amp;
        const d = Math.abs(px - lx);
        if (d < 3) v -= (3 - d) * 30;
      } else {
        const ly = c.a * px + c.b + Math.sin(px * c.f + c.p) * c.amp;
        const d = Math.abs(py - ly);
        if (d < 3) v -= (3 - d) * 30;
      }
    }
    g[y * size + x] = Math.max(0, Math.min(255, Math.round(v + noise[y * size + x])));
  }
  return g;
}
const PALM_A = [{ a: 0.22, b: 26, f: 0.05, p: 1, amp: 3 }, { a: -0.35, b: 92, f: 0.04, p: 3, amp: 4 }, { a: 0.04, b: 62, f: 0.06, p: 5, amp: 3 }, { a: 0.55, b: 18, f: 0.05, p: 2, amp: 3, vert: true }];
const PALM_B = [{ a: -0.05, b: 38, f: 0.04, p: 2, amp: 5 }, { a: 0.18, b: 55, f: 0.07, p: 1, amp: 3 }, { a: -0.5, b: 118, f: 0.05, p: 4, amp: 4 }, { a: 0.85, b: 4, f: 0.04, p: 3, amp: 4, vert: true }];
function encode(creases, seed, opts) { return B.palmprintEncode(roiImage(creases, seed, opts), 128, 128); }
function clipFrames(creases, baseSeed) {
  const frames = [];
  for (let i = 0; i < 9; i++) {
    frames.push({ openness: 2.0, code: encode(creases, baseSeed + i, { dx: (i % 3) - 1, dy: ((i + 1) % 3) - 1 }), sharpness: 100 + i * 10 });
  }
  return frames;
}

/* ---------- a v37 store, in the exact shapes the v37 app wrote --- */
const enrolledCodes = B.selectPalmprintProfileCodes(clipFrames(PALM_A, 51));
check('fixture: enrolment selects stored codes', Array.isArray(enrolledCodes) && enrolledCodes.length >= 2,
  enrolledCodes ? enrolledCodes.length + ' codes' : 'null');
const v37Store = {
  people: [{
    id: 'TSG-BIO-2841', name: 'Migration Fixture Person', phone: '01700000000', type: 'Customer',
    store: 'GreenCare Pharmacy (CVS)', walletProvider: 'bKash', walletNumber: '01700000000',
    limits: { perTx: 1000, daily: null }, loyaltyPoints: 137,
    palmProfile: { v: 3, codes: enrolledCodes }, enrolledAt: 1795410000000
  }],
  logs: [{ ts: 1795410100000, personId: 'TSG-BIO-2841', personName: 'Migration Fixture Person', store: 'GreenCare Pharmacy (CVS)', method: 'palm', measured: 'Palmprint similarity 0.512', result: 'Verified' }],
  transactions: [{
    id: 'BIOM-PAY-1001', ts: 1795410200000, personId: 'TSG-BIO-2841', personName: 'Migration Fixture Person',
    provider: 'bKash', walletMasked: '01700-***000', store: 'GreenCare Pharmacy (CVS)', amount: 250,
    method: 'palm', measured: 'Palmprint similarity 0.512', status: 'Biometric Authorised — Pending Provider Settlement'
  }],
  meta: [{ key: 'biomSeq', value: 2842 }, { key: 'paySeq', value: 1002 }]
};
/* Storage round-trip: localStorage holds JSON text, IndexedDB a
   structured clone — either way the migration sees plain data. */
const storedForm = JSON.parse(JSON.stringify(v37Store));

/* ---------- the migration the v38 startup runs -------------------- */
const mig = B.migrateBiomData(storedForm, 'v37', 'v38');
check('MIGRATE v37->v38 runs the v38 step', mig.appliedSteps.indexOf('v38') !== -1, mig.appliedSteps.join(','));
check('MIGRATE v37->v38 is an adoption: no store rewritten', mig.changed === false && mig.changedStores.length === 0,
  'changedStores=' + JSON.stringify(mig.changedStores));
const mp = mig.snapshot.people[0];
check('SURVIVE person row intact', !!mp && mp.id === 'TSG-BIO-2841' && mp.name === 'Migration Fixture Person');
check('SURVIVE loyalty points intact', !!mp && mp.loyaltyPoints === 137, mp && String(mp.loyaltyPoints));
check('SURVIVE palm codes byte-identical', !!mp && JSON.stringify(mp.palmProfile.codes) === JSON.stringify(enrolledCodes),
  mp && mp.palmProfile.codes.length + ' codes');
check('SURVIVE profile still sane to the v38 reader', !!mp && B.palmprintProfileSane(mp.palmProfile));
check('SURVIVE transaction intact', mig.snapshot.transactions.length === 1 && mig.snapshot.transactions[0].id === 'BIOM-PAY-1001' && mig.snapshot.transactions[0].amount === 250);
check('SURVIVE log row intact', mig.snapshot.logs.length === 1 && mig.snapshot.logs[0].result === 'Verified');
check('SURVIVE meta sequences intact', mig.snapshot.meta.length === 2 && mig.snapshot.meta[0].value === 2842 && mig.snapshot.meta[1].value === 1002);

/* ---------- the migrated enrolment still verifies ------------------ */
const probeSame = B.selectPalmprintLiveCodes(clipFrames(PALM_A, 71));
const rSame = B.verifyPalmprintProfile(mp.palmProfile, probeSame);
check('VERIFY migrated profile accepts the same palm', rSame.verified === true, 'sim=' + (rSame.similarity && rSame.similarity.toFixed(3)));
const probeOther = B.selectPalmprintLiveCodes(clipFrames(PALM_B, 81));
const rOther = B.verifyPalmprintProfile(mp.palmProfile, probeOther);
check('VERIFY migrated profile still rejects another palm', rOther.verified === false, 'sim=' + (rOther.similarity && rOther.similarity.toFixed(3)));

/* ---------- older / unknown writers, idempotence, damage ---------- */
const migOld = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v36', 'v38');
check('MIGRATE from an older version (v36) preserves the person', migOld.snapshot.people.length === 1 && migOld.snapshot.people[0].loyaltyPoints === 137);
const migUnknown = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), null, 'v38');
check('MIGRATE from an unknown version (null stamp, data present) preserves the person',
  migUnknown.snapshot.people.length === 1 && B.palmprintProfileSane(migUnknown.snapshot.people[0].palmProfile));
const migAgain = B.migrateBiomData(mig.snapshot, 'v38', 'v38');
check('MIGRATE is idempotent at the current version', migAgain.appliedSteps.length === 0 && migAgain.changed === false &&
  migAgain.snapshot.people.length === 1 && migAgain.snapshot.people[0].loyaltyPoints === 137);
const damaged = JSON.parse(JSON.stringify(v37Store)); delete damaged.logs;
const migDamaged = B.migrateBiomData(damaged, 'v37', 'v38');
check('MIGRATE a store with a missing logs array keeps the people', Array.isArray(migDamaged.snapshot.logs) &&
  migDamaged.snapshot.people.length === 1 && migDamaged.snapshot.people[0].id === 'TSG-BIO-2841');

/* ---------- the shipped app source carries no wipe ----------------- */
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
check('APP v38 declares the data version', appSrc.indexOf("APP_DATA_VERSION = 'v38'") !== -1);
check('APP startup runs the migration', appSrc.indexOf('migrateBiomData') !== -1 && appSrc.indexOf('migrateDbStores') !== -1);
check('APP contains no database deletion (the retired wipe)', appSrc.indexOf('deleteDatabase') === -1);
check('APP contains no store-key removal (the retired wipe)', !/removeItem\(\s*'tsgbiom_/.test(appSrc));
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
check('APP shell is v38', swSrc.indexOf('tsg-biom-shell-v38') !== -1);

console.log(fail === 0 ? 'ALL MIGRATION TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
