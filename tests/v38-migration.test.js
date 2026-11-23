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
   codes are real EDCC codes in the stored base64 form.

   Extended for v39 (2026-11-23): the chain gains 'v39' (an
   adoption step — v39 changes the win rule, not stored data), and
   this suite proves a v38 store, and a v37 store through both
   steps, opens under v39 intact and still verifies. The two
   version-string source pins below name the CURRENT version, as
   they did when they pinned v38.

   Extended for v40 (2026-11-23): the chain gains 'v40' (an
   adoption step — v40 changes only the spoof gate's sampling,
   not stored data), and this suite proves a v39 store, and a v37
   store through all three steps, opens under v40 intact and
   still verifies.

   Extended for v42 (2026-11-23): the chain gains 'v42' — the
   first CONVERSION step. v42 adds the demonstration wallet, so
   the step gives every person a wallet at balance 0 while
   leaving every existing field byte-identical, rewrites only
   the people store, and can never reset a wallet a v42 store
   already carries. (v41's section below stays as written; the
   chain pins move to v42, as they have at every bump.)

   Extended for v43 (2026-11-23): the chain gains 'v43' — an
   ADOPTION step. v43 changes how scans are captured (hands-free
   auto-start/auto-trigger, guidance, cooldown) and how enrolment
   banks codes (per-pose; profiles MAY gain an optional poses
   array on v43 saves), but no stored field changes shape, so a
   v42 store — wallet balance, statement and linked accounts
   included — opens under v43 byte-identical. The v43 section
   below proves exactly that on a wallet-carrying store.

   Extended for v44 (2026-11-23): the chain gains 'v44' — an
   ADOPTION step. v44 changes only how long scans run and what
   they report (the wall-clock scan budget, the geometric-variant
   band gate, per-stage scan diagnostics, the 320 px analysis
   copy); no stored field changes shape, so a v43 store — wallet
   balance, statement and linked accounts included — opens under
   v44 byte-identical. The v44 section below proves exactly that
   on the same wallet-carrying store. */
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

/* ---------- v39: the chain grows, the data still survives ---------
   v39 changes only the Show & Pay win rule and startup pre-warm;
   its migration step is an adoption like v38's. A store written by
   v38 (and one written by v37, through both steps) must open under
   v39 with the person, codes and points intact and still verify. */
check('CHAIN v44 is the newest link', B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v44' &&
  B.BIOM_DATA_VERSIONS.join(',') === 'v37,v38,v39,v40,v41,v42,v43,v44', B.BIOM_DATA_VERSIONS.join(','));
const mig39 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v38', 'v39');
check('MIGRATE v38->v39 runs the v39 step', mig39.appliedSteps.indexOf('v39') !== -1, mig39.appliedSteps.join(','));
check('MIGRATE v38->v39 is an adoption: no store rewritten', mig39.changed === false && mig39.changedStores.length === 0,
  'changedStores=' + JSON.stringify(mig39.changedStores));
const mp39 = mig39.snapshot.people[0];
check('SURVIVE v39 person, points and codes intact', !!mp39 && mp39.id === 'TSG-BIO-2841' && mp39.loyaltyPoints === 137 &&
  JSON.stringify(mp39.palmProfile.codes) === JSON.stringify(enrolledCodes));
const migChain39 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v39');
check('MIGRATE v37->v39 runs both steps in order', migChain39.appliedSteps.join(',') === 'v38,v39', migChain39.appliedSteps.join(','));
check('MIGRATE v37->v39 keeps the person and points', migChain39.snapshot.people.length === 1 && migChain39.snapshot.people[0].loyaltyPoints === 137);
const rSame39 = B.verifyPalmprintProfile(mp39.palmProfile, probeSame);
check('VERIFY the v39-migrated profile accepts the same palm', rSame39.verified === true, 'sim=' + (rSame39.similarity && rSame39.similarity.toFixed(3)));
const rOther39 = B.verifyPalmprintProfile(mp39.palmProfile, probeOther);
check('VERIFY the v39-migrated profile still rejects another palm', rOther39.verified === false, 'sim=' + (rOther39.similarity && rOther39.similarity.toFixed(3)));
const migAgain39 = B.migrateBiomData(mig39.snapshot, 'v39', 'v39');
check('MIGRATE is idempotent at v39', migAgain39.appliedSteps.length === 0 && migAgain39.changed === false &&
  migAgain39.snapshot.people.length === 1 && migAgain39.snapshot.people[0].loyaltyPoints === 137);

/* ---------- v40: the chain grows again, the data still survives --
   v40 changes only the screen-spoof gate's sampling (palm-hull
   masking + coverage); its migration step is an adoption like
   v38's and v39's. A store written by v39 (and one written by
   v37, through all three steps) must open under v40 with the
   person, codes and points intact and still verify. */
const mig40 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v39', 'v40');
check('MIGRATE v39->v40 runs the v40 step', mig40.appliedSteps.indexOf('v40') !== -1, mig40.appliedSteps.join(','));
check('MIGRATE v39->v40 is an adoption: no store rewritten', mig40.changed === false && mig40.changedStores.length === 0,
  'changedStores=' + JSON.stringify(mig40.changedStores));
const mp40 = mig40.snapshot.people[0];
check('SURVIVE v40 person, points and codes intact', !!mp40 && mp40.id === 'TSG-BIO-2841' && mp40.loyaltyPoints === 137 &&
  JSON.stringify(mp40.palmProfile.codes) === JSON.stringify(enrolledCodes));
const migChain40 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v40');
check('MIGRATE v37->v40 runs all three steps in order', migChain40.appliedSteps.join(',') === 'v38,v39,v40', migChain40.appliedSteps.join(','));
check('MIGRATE v37->v40 keeps the person and points', migChain40.snapshot.people.length === 1 && migChain40.snapshot.people[0].loyaltyPoints === 137);
const rSame40 = B.verifyPalmprintProfile(mp40.palmProfile, probeSame);
check('VERIFY the v40-migrated profile accepts the same palm', rSame40.verified === true, 'sim=' + (rSame40.similarity && rSame40.similarity.toFixed(3)));
const rOther40 = B.verifyPalmprintProfile(mp40.palmProfile, probeOther);
check('VERIFY the v40-migrated profile still rejects another palm', rOther40.verified === false, 'sim=' + (rOther40.similarity && rOther40.similarity.toFixed(3)));
const migAgain40 = B.migrateBiomData(mig40.snapshot, 'v40', 'v40');
check('MIGRATE is idempotent at v40', migAgain40.appliedSteps.length === 0 && migAgain40.changed === false &&
  migAgain40.snapshot.people.length === 1 && migAgain40.snapshot.people[0].loyaltyPoints === 137);

/* ---------- v41: the chain grows again, the data still survives --
   v41 changes only the probe side of palmprint verification (the
   geometric variant re-encodes); enrolled codes are read exactly
   as before, so its migration step is an adoption like v40's. A
   store written by v40 (and one written by v37, through all four
   steps) must open under v41 with the person, codes and points
   intact and still verify. */
const mig41 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v40', 'v41');
check('MIGRATE v40->v41 runs the v41 step', mig41.appliedSteps.indexOf('v41') !== -1, mig41.appliedSteps.join(','));
check('MIGRATE v40->v41 is an adoption: no store rewritten', mig41.changed === false && mig41.changedStores.length === 0,
  'changedStores=' + JSON.stringify(mig41.changedStores));
const mp41 = mig41.snapshot.people[0];
check('SURVIVE v41 person, points and codes intact', !!mp41 && mp41.id === 'TSG-BIO-2841' && mp41.loyaltyPoints === 137 &&
  JSON.stringify(mp41.palmProfile.codes) === JSON.stringify(enrolledCodes));
const migChain41 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v41');
check('MIGRATE v37->v41 runs all four steps in order', migChain41.appliedSteps.join(',') === 'v38,v39,v40,v41', migChain41.appliedSteps.join(','));
check('MIGRATE v37->v41 keeps the person and points', migChain41.snapshot.people.length === 1 && migChain41.snapshot.people[0].loyaltyPoints === 137);
const rSame41 = B.verifyPalmprintProfile(mp41.palmProfile, probeSame);
check('VERIFY the v41-migrated profile accepts the same palm', rSame41.verified === true, 'sim=' + (rSame41.similarity && rSame41.similarity.toFixed(3)));
const rOther41 = B.verifyPalmprintProfile(mp41.palmProfile, probeOther);
check('VERIFY the v41-migrated profile still rejects another palm', rOther41.verified === false, 'sim=' + (rOther41.similarity && rOther41.similarity.toFixed(3)));
const migAgain41 = B.migrateBiomData(mig41.snapshot, 'v41', 'v41');
check('MIGRATE is idempotent at v41', migAgain41.appliedSteps.length === 0 && migAgain41.changed === false &&
  migAgain41.snapshot.people.length === 1 && migAgain41.snapshot.people[0].loyaltyPoints === 137);

/* ---------- v42: the conversion — every person gains a wallet --
   v42 adds the demonstration wallet (the Chairman's order,
   2026-11-23): the migration gives every existing enrolment a
   wallet at balance 0 with an empty statement and no linked
   accounts, so a v41 enrolment opens under v42 AS a wallet with
   NO re-enrolment. Every pre-existing field stays byte-identical
   and only the people store is rewritten. A wallet a v42 store
   already carries is never reset. */
const mig42 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v41', 'v42');
check('MIGRATE v41->v42 runs the v42 step', mig42.appliedSteps.indexOf('v42') !== -1, mig42.appliedSteps.join(','));
check('MIGRATE v41->v42 rewrites ONLY the people store', mig42.changedStores.join(',') === 'people',
  'changedStores=' + JSON.stringify(mig42.changedStores));
const mp42 = mig42.snapshot.people[0];
check('WALLET v42 the migrated person gains a wallet at balance 0', !!mp42 && !!mp42.wallet &&
  mp42.wallet.balance === 0 && Array.isArray(mp42.wallet.statement) && mp42.wallet.statement.length === 0 &&
  Array.isArray(mp42.wallet.linkedAccounts) && mp42.wallet.linkedAccounts.length === 0);
check('SURVIVE v42 person, points and codes byte-identical', !!mp42 && mp42.id === 'TSG-BIO-2841' && mp42.name === 'Migration Fixture Person' &&
  mp42.loyaltyPoints === 137 && JSON.stringify(mp42.palmProfile.codes) === JSON.stringify(enrolledCodes));
check('SURVIVE v42 transaction, log and meta untouched', mig42.snapshot.transactions.length === 1 &&
  mig42.snapshot.transactions[0].id === 'BIOM-PAY-1001' && mig42.snapshot.logs.length === 1 && mig42.snapshot.meta.length === 2);
const migChain42 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v42');
check('MIGRATE v37->v42 runs all five steps in order', migChain42.appliedSteps.join(',') === 'v38,v39,v40,v41,v42', migChain42.appliedSteps.join(','));
check('MIGRATE v37->v42 keeps the person and adds the wallet', migChain42.snapshot.people.length === 1 &&
  migChain42.snapshot.people[0].loyaltyPoints === 137 && migChain42.snapshot.people[0].wallet.balance === 0);
const rSame42 = B.verifyPalmprintProfile(mp42.palmProfile, probeSame);
check('VERIFY the v42-migrated profile accepts the same palm', rSame42.verified === true, 'sim=' + (rSame42.similarity && rSame42.similarity.toFixed(3)));
const rOther42 = B.verifyPalmprintProfile(mp42.palmProfile, probeOther);
check('VERIFY the v42-migrated profile still rejects another palm', rOther42.verified === false, 'sim=' + (rOther42.similarity && rOther42.similarity.toFixed(3)));
const v42StoreLive = JSON.parse(JSON.stringify(mig42.snapshot));
v42StoreLive.people[0].wallet.balance = 450;
v42StoreLive.people[0].wallet.statement.push({ ref: 'DEMO-1', ts: 1795423600000, kind: 'add', amount: 450, balanceAfter: 450 });
const migAgain42 = B.migrateBiomData(v42StoreLive, 'v42', 'v42');
check('MIGRATE is idempotent at v42', migAgain42.appliedSteps.length === 0 && migAgain42.changed === false &&
  migAgain42.snapshot.people[0].wallet.balance === 450);
const migRestamp42 = B.migrateBiomData(JSON.parse(JSON.stringify(v42StoreLive)), 'v41', 'v42');
check('MIGRATE the v42 step never resets a wallet a v42 store already carries',
  migRestamp42.snapshot.people[0].wallet.balance === 450 && migRestamp42.snapshot.people[0].wallet.statement.length === 1 &&
  migRestamp42.changed === false);

/* ---------- v43: the adoption — a wallet-carrying store survives --
   v43 changes capture and banking, never stored shapes, so its
   step is the identity. The store below is a v42 store WITH money
   in it: a demo balance of 450, one DEMO-1 statement entry and one
   linked funding account, in the shapes the v42 app writes. After
   the bump the whole person record — wallet included — must be
   byte-identical, and no store may be rewritten at all. */
const v43WalletStore = JSON.parse(JSON.stringify(mig42.snapshot));
v43WalletStore.people[0].wallet.balance = 450;
v43WalletStore.people[0].wallet.statement.push({ ref: 'DEMO-1', ts: 1795423600000, kind: 'add', amount: 450, balanceAfter: 450, accountType: 'bKash', accountLabel: 'Personal bKash' });
v43WalletStore.people[0].wallet.linkedAccounts.push({ id: 'acct-1', type: 'bKash', label: 'Personal bKash' });
v43WalletStore.meta.push({ key: 'demoSeq', value: 2 });
const v43PersonBefore = JSON.stringify(v43WalletStore.people[0]);
const mig43 = B.migrateBiomData(JSON.parse(JSON.stringify(v43WalletStore)), 'v42', 'v43');
check('MIGRATE v42->v43 runs the v43 step', mig43.appliedSteps.indexOf('v43') !== -1, mig43.appliedSteps.join(','));
check('MIGRATE v42->v43 is an adoption: no store rewritten', mig43.changed === false && mig43.changedStores.length === 0,
  'changedStores=' + JSON.stringify(mig43.changedStores));
const mp43 = mig43.snapshot.people[0];
check('WALLET v43 balance, statement and linked account byte-identical', JSON.stringify(mp43) === v43PersonBefore,
  mp43 && 'balance=' + mp43.wallet.balance + ' stmt=' + mp43.wallet.statement.length + ' accts=' + mp43.wallet.linkedAccounts.length);
check('SURVIVE v43 palm codes byte-identical', !!mp43 && JSON.stringify(mp43.palmProfile.codes) === JSON.stringify(enrolledCodes));
const migChain43 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v43');
check('MIGRATE v37->v43 runs all six steps in order', migChain43.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43', migChain43.appliedSteps.join(','));
check('MIGRATE v37->v43 keeps the person, points and gains the wallet', migChain43.snapshot.people.length === 1 &&
  migChain43.snapshot.people[0].loyaltyPoints === 137 && migChain43.snapshot.people[0].wallet.balance === 0);
const rSame43 = B.verifyPalmprintProfile(mp43.palmProfile, probeSame);
check('VERIFY the v43-migrated profile accepts the same palm', rSame43.verified === true, 'sim=' + (rSame43.similarity && rSame43.similarity.toFixed(3)));
const rOther43 = B.verifyPalmprintProfile(mp43.palmProfile, probeOther);
check('VERIFY the v43-migrated profile still rejects another palm', rOther43.verified === false, 'sim=' + (rOther43.similarity && rOther43.similarity.toFixed(3)));
const migAgain43 = B.migrateBiomData(mig43.snapshot, 'v43', 'v43');
check('MIGRATE is idempotent at v43', migAgain43.appliedSteps.length === 0 && migAgain43.changed === false &&
  migAgain43.snapshot.people[0].wallet.balance === 450 && migAgain43.snapshot.people[0].wallet.statement.length === 1);

/* ---------- v44: the adoption — a wallet-carrying store survives --
   v44 changes scan duration and reporting, never stored shapes,
   so its step is the identity, like v43's: the wallet-carrying
   v43 store must open under v44 with the whole person record —
   enrolment codes, wallet balance, statement, linked account —
   byte-identical, and the migrated palm must still verify. */
const mig44 = B.migrateBiomData(JSON.parse(JSON.stringify(v43WalletStore)), 'v43', 'v44');
check('MIGRATE v43->v44 runs the v44 step', mig44.appliedSteps.indexOf('v44') !== -1, mig44.appliedSteps.join(','));
check('MIGRATE v43->v44 is an adoption: no store rewritten', mig44.changed === false && mig44.changedStores.length === 0,
  'changedStores=' + JSON.stringify(mig44.changedStores));
const mp44 = mig44.snapshot.people[0];
check('WALLET v44 balance, statement and linked account byte-identical', JSON.stringify(mp44) === v43PersonBefore,
  mp44 && 'balance=' + mp44.wallet.balance + ' stmt=' + mp44.wallet.statement.length + ' accts=' + mp44.wallet.linkedAccounts.length);
check('SURVIVE v44 palm codes byte-identical', !!mp44 && JSON.stringify(mp44.palmProfile.codes) === JSON.stringify(enrolledCodes));
const migChain44 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v44');
check('MIGRATE v37->v44 runs all seven steps in order', migChain44.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44', migChain44.appliedSteps.join(','));
check('MIGRATE v37->v44 keeps the person, points and gains the wallet', migChain44.snapshot.people.length === 1 &&
  migChain44.snapshot.people[0].loyaltyPoints === 137 && migChain44.snapshot.people[0].wallet.balance === 0);
const rSame44 = B.verifyPalmprintProfile(mp44.palmProfile, probeSame);
check('VERIFY the v44-migrated profile accepts the same palm', rSame44.verified === true, 'sim=' + (rSame44.similarity && rSame44.similarity.toFixed(3)));
const rOther44 = B.verifyPalmprintProfile(mp44.palmProfile, probeOther);
check('VERIFY the v44-migrated profile still rejects another palm', rOther44.verified === false, 'sim=' + (rOther44.similarity && rOther44.similarity.toFixed(3)));
const migAgain44 = B.migrateBiomData(mig44.snapshot, 'v44', 'v44');
check('MIGRATE is idempotent at v44', migAgain44.appliedSteps.length === 0 && migAgain44.changed === false &&
  migAgain44.snapshot.people[0].wallet.balance === 450 && migAgain44.snapshot.people[0].wallet.statement.length === 1);

/* ---------- the shipped app source carries no wipe ----------------- */
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
check('APP declares the current data version (v44)', appSrc.indexOf("APP_DATA_VERSION = 'v44'") !== -1);
check('APP startup runs the migration', appSrc.indexOf('migrateBiomData') !== -1 && appSrc.indexOf('migrateDbStores') !== -1);
check('APP contains no database deletion (the retired wipe)', appSrc.indexOf('deleteDatabase') === -1);
check('APP contains no store-key removal (the retired wipe)', !/removeItem\(\s*'tsgbiom_/.test(appSrc));
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
check('APP shell is v44', swSrc.indexOf('tsg-biom-shell-v44') !== -1);

console.log(fail === 0 ? 'ALL MIGRATION TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
