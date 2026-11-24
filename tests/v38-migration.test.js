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
   on the same wallet-carrying store.

   Extended for v45 (2026-11-23): the chain gains 'v45' — the
   second CONVERSION step, and the only one that touches palm
   profiles. v45 changes the template format itself (96x96
   affine patch, bit-packed templates): old byte-format codes
   cannot be read by the packed pipeline and cannot be converted,
   so the step ARCHIVES them — codes move verbatim into the
   profile's legacyCodes field, codes becomes [], format becomes
   'legacy', rescanNeeded is set — and every other field of every
   record stays byte-identical. The per-version VERIFY checks of
   the v38-v44 sections are therefore replaced by FORMAT checks
   (a byte profile at any older stamp is a legacy profile to the
   current reader); preservation is still proven byte-for-byte at
   every step, and the v45 section proves the conversion itself,
   the wallet's survival through it, and the fail-closed verify
   with the honest re-scan reason.

   Extended for v46 (2026-11-23): the chain gains 'v46' — an
   ADOPTION step. v46 changes no stored field; it adds the
   user-operated Delete All Data action (More page, type-to-
   confirm; the wipe itself is proven in v46-wipe.test.js). That
   action is NOT a migration step: the v46 section below proves a
   wallet-carrying v45 store opens under v46 byte-identical, and
   the full chain still preserves everything end to end.

   Extended for v47 (2026-11-24): the chain gains 'v47' — an
   ADOPTION step. v47 adds the PalmNet neural matcher alongside
   EDCC; neural embeddings live in an OPTIONAL profile.neural
   field written only by v47 enrolment / Add Angles / Neural
   Scan saves, so no existing field changes shape and nothing
   needs converting. The v47 section below proves a
   wallet-carrying v46 store opens under v47 byte-identical —
   including a profile that already carries a neural bank — and
   the full chain still preserves everything end to end.

   Extended for v48 (2026-11-24): the chain gains 'v48' — an
   ADOPTION step. v48 changes no stored field; it reworks only
   the per-view flash (torch) control in app.js (the choice
   becomes a preference that survives stream restarts and camera
   switches; capability-honest disabling — proven in
   v48-flash.test.js). Flash choices were never stored data. The
   v48 section below proves a wallet-and-neural-carrying v47
   store opens under v48 byte-identical, and the full chain
   still preserves everything end to end.

   Extended for v49 (2026-11-24): the chain gains 'v49' — an
   ADOPTION step. v49 changes no stored field; it adds the
   same-person banking guard, the strict money-scan rule and
   the freeze-proofing bounds (decision logic only — proven in
   v49-guard-money-freeze.test.js). Field-test records gain
   optional strict-rule fields written only by v49 terminal
   scans; older records lack them and readers treat them as
   absent. The v49 section below proves a wallet-and-neural-
   carrying v48 store opens under v49 byte-identical, and the
   full chain still preserves everything end to end.

   Extended for v50 (2026-11-24): the chain gains 'v50' — an
   ADOPTION step. v50 changes no stored field; it is a
   performance-only release (enrolment pacing/yields, status
   write-on-change, scratch-canvas reuse) plus the Chairman's
   correction that wallet open no longer runs the strict money
   rule (proven in v50-smooth-enrol.test.js). The v50 section
   below proves a wallet-and-neural-carrying v49 store opens
   under v50 byte-identical, and the full chain still preserves
   everything end to end.

   Extended for v51 (2026-11-24): the chain gains 'v51' — an
   ADOPTION step. v51 changes no stored field's shape; it adds
   hand separation (decision logic in
   v51-hand-separation.test.js). A palm profile MAY gain an
   optional hand field ('left' | 'right') written only by v51
   enrolment and by the first guarded top-up that passes on a
   profile that lacks one; readers treat a missing hand as
   null. The v51 section below proves a wallet-and-neural-
   carrying v50 store opens under v51 byte-identical, that a
   profile already carrying a hand keeps it byte-identical,
   and the full chain still preserves everything end to end.

   Extended for v53 (2026-11-24): the chain gains 'v53' — an
   ADOPTION step. v53 changes no stored field and no decision
   rule; it changes what a scan frame must be to count toward
   matching (the full-hand frame rule), what a failed scan
   reports (the measured diagnosis panel), and adds the owner
   recovery path (guarded Add Angles from the wallet-open
   failure card, then a confirmation-gated re-registration
   that replaces only the named profile's palm bank — proven
   in v53-owner-verify-fix.test.js). The v53 section below
   proves a hand-stamped, wallet-and-neural-carrying v52 store
   opens under v53 byte-identical, and the full chain still
   preserves everything end to end. (No "Extended for v52"
   paragraph was added at the v52 bump; the v52 section in the
   body carries its note.)

   Extended for v54 (2026-11-24): the chain gains 'v54' — an
   ADOPTION step. v54 changes no stored field; it swaps the
   PalmNet model (Round 3 snapshot 'palmnet-r3-ep12', bar
   0.5895) for the Round 1 model ('palmnet-v1', bar 0.5773)
   and adds model stamping, judged AT READ TIME: stored banks
   are never rewritten, so a v53 store — including a bank
   stamped by the retired model — opens under v54
   byte-identical, and that bank then reads as no neural
   evidence until a Neural Scan re-banks it (the read-time
   proof lives in v54-palmnet-r3.test.js; the section below
   proves the byte-identical opening and the intact wallet).
   The full chain still preserves everything end to end.

   Extended for v55 (2026-11-24): the chain gains 'v55' — an
   ADOPTION step. v55 changes no stored field, no bar and no
   model byte; it repairs the remedy path around the v54
   model swap (AUDIT-v54.md): the stale-bank Neural Scan
   becomes recovery-eligible, the guard-refusal wording
   stops claiming a checked mismatch when the neural leg
   could not run, the re-registration paperwork counts the
   STORED neural bank, and the model loader refuses a
   manifest naming a different model. All read-time and
   app-flow logic (proven in v55-neural-recovery.test.js),
   so a v54 store — neural banks of either stamp included —
   opens under v55 byte-identical. The v55 section below
   proves exactly that, with one stale-stamped and one
   current-stamped bank side by side.

   Extended for v56 (2026-11-24): the chain gains 'v56' — an
   ADOPTION step. v56 changes no stored field; it adds the
   Scan Sync (default OFF): scan records and encrypted palm
   banks mirror to the owner's own TSG Biom API when he turns
   it on. Sync preferences are localStorage prefs and the
   outbox is one 'syncOutbox' meta row whose value the
   migration never interprets, so a v55 store — with or
   without that row — opens under v56 byte-identical, and
   with sync off the app behaves exactly as v55 (proven in
   v56-sync.test.js). The v56 section below proves the
   adoption on the two-stamp store carrying a queued outbox. */
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
const enrolledCodes = clipFrames(PALM_A, 51).slice()
  .sort(function (a, b) { return b.sharpness - a.sharpness; }).slice(0, 6)
  .map(function (f) { return Buffer.from(f.code).toString('base64'); });
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
check('SURVIVE profile preserved; to the current reader it is the legacy format', !!mp && B.palmprintProfileFormat(mp.palmProfile) === 'legacy' && !B.palmprintProfileSane(mp.palmProfile));
check('SURVIVE transaction intact', mig.snapshot.transactions.length === 1 && mig.snapshot.transactions[0].id === 'BIOM-PAY-1001' && mig.snapshot.transactions[0].amount === 250);
check('SURVIVE log row intact', mig.snapshot.logs.length === 1 && mig.snapshot.logs[0].result === 'Verified');
check('SURVIVE meta sequences intact', mig.snapshot.meta.length === 2 && mig.snapshot.meta[0].value === 2842 && mig.snapshot.meta[1].value === 1002);

/* ---------- the migrated enrolment under the v45 reader ------------
   A byte-format profile cannot be verified by the packed
   pipeline: the verify fails CLOSED (never a false accept, never
   a crash) and the fail reason states the re-scan honestly. The
   probes below are real packed live templates of both palms. */
const probeSame = B.selectPalmprintLiveCodes(clipFrames(PALM_A, 71));
const rSame = B.verifyPalmprintProfile(mp.palmProfile, probeSame);
check('VERIFY a legacy profile fails closed against its own palm', rSame.verified === false && rSame.ok === false, rSame.reason);
check('VERIFY the fail reason is the honest re-scan reason', /re-scan/.test(B.palmprintProfileFailReason(mp.palmProfile)));
const probeOther = B.selectPalmprintLiveCodes(clipFrames(PALM_B, 81));
const rOther = B.verifyPalmprintProfile(mp.palmProfile, probeOther);
check('VERIFY a legacy profile fails closed against another palm too', rOther.verified === false && rOther.ok === false);

/* ---------- older / unknown writers, idempotence, damage ---------- */
const migOld = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v36', 'v38');
check('MIGRATE from an older version (v36) preserves the person', migOld.snapshot.people.length === 1 && migOld.snapshot.people[0].loyaltyPoints === 137);
const migUnknown = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), null, 'v38');
check('MIGRATE from an unknown version (null stamp, data present) preserves the person',
  migUnknown.snapshot.people.length === 1 && migUnknown.snapshot.people[0].loyaltyPoints === 137 &&
  JSON.stringify(migUnknown.snapshot.people[0].palmProfile.codes) === JSON.stringify(enrolledCodes));
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
check('CHAIN v60 is the newest link', B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v60' &&
  B.BIOM_DATA_VERSIONS.join(',') === 'v37,v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v52,v53,v54,v55,v56,v57,v58,v59,v60', B.BIOM_DATA_VERSIONS.join(','));
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
check('FORMAT the v39-migrated profile is a legacy-format profile to the current reader',
  B.palmprintProfileFormat(mp39.palmProfile) === 'legacy');
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
check('FORMAT the v40-migrated profile is a legacy-format profile to the current reader',
  B.palmprintProfileFormat(mp40.palmProfile) === 'legacy');
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
check('FORMAT the v41-migrated profile is a legacy-format profile to the current reader',
  B.palmprintProfileFormat(mp41.palmProfile) === 'legacy');
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
check('FORMAT the v42-migrated profile is a legacy-format profile to the current reader',
  B.palmprintProfileFormat(mp42.palmProfile) === 'legacy');
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
check('FORMAT the v43-migrated profile is a legacy-format profile to the current reader',
  B.palmprintProfileFormat(mp43.palmProfile) === 'legacy');
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
check('FORMAT the v44-migrated profile is a legacy-format profile to the current reader',
  B.palmprintProfileFormat(mp44.palmProfile) === 'legacy');
const migAgain44 = B.migrateBiomData(mig44.snapshot, 'v44', 'v44');
check('MIGRATE is idempotent at v44', migAgain44.appliedSteps.length === 0 && migAgain44.changed === false &&
  migAgain44.snapshot.people[0].wallet.balance === 450 && migAgain44.snapshot.people[0].wallet.statement.length === 1);

/* ---------- v45: the format conversion — codes archived, all else
   byte-identical ------------------------------------------------
   The store below is the wallet-carrying v44 store (balance 450,
   one DEMO-1 statement entry, one linked account). The v45 step
   must rewrite ONLY the people store, and within the person ONLY
   the palm profile: codes archived verbatim as legacyCodes,
   format 'legacy', rescanNeeded set. A profile already in the
   packed format, and a person with no profile, pass by identity. */
const mig45 = B.migrateBiomData(JSON.parse(JSON.stringify(v43WalletStore)), 'v44', 'v45');
check('MIGRATE v44->v45 runs the v45 step', mig45.appliedSteps.indexOf('v45') !== -1, mig45.appliedSteps.join(','));
check('MIGRATE v44->v45 rewrites ONLY the people store', mig45.changedStores.join(',') === 'people',
  'changedStores=' + JSON.stringify(mig45.changedStores));
const mp45 = mig45.snapshot.people[0];
check('LEGACY the old codes are archived verbatim, none lost', !!mp45 && JSON.stringify(mp45.palmProfile.legacyCodes) === JSON.stringify(enrolledCodes),
  mp45 && mp45.palmProfile.legacyCodes.length + ' codes archived');
check('LEGACY the profile is flagged for re-scan', !!mp45 && mp45.palmProfile.format === 'legacy' && mp45.palmProfile.rescanNeeded === true &&
  Array.isArray(mp45.palmProfile.codes) && mp45.palmProfile.codes.length === 0);
check('LEGACY the reader agrees: legacy format, not sane, re-scan reason',
  B.palmprintProfileFormat(mp45.palmProfile) === 'legacy' && !B.palmprintProfileSane(mp45.palmProfile) && /re-scan/.test(B.palmprintProfileFailReason(mp45.palmProfile)));
const person45Rest = Object.assign({}, mp45); delete person45Rest.palmProfile;
const person44Rest = JSON.parse(v43PersonBefore); delete person44Rest.palmProfile;
check('SURVIVE v45 every non-profile field byte-identical (wallet 450, DEMO-1, linked account, points)',
  JSON.stringify(person45Rest) === JSON.stringify(person44Rest),
  'balance=' + mp45.wallet.balance + ' stmt=' + mp45.wallet.statement.length + ' accts=' + mp45.wallet.linkedAccounts.length);
check('SURVIVE v45 transactions, logs and meta untouched', mig45.snapshot.transactions.length === 1 &&
  mig45.snapshot.logs.length === 1 && mig45.snapshot.meta.length === 3);
const migChain45 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v45');
check('MIGRATE v37->v45 runs all eight steps in order', migChain45.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45', migChain45.appliedSteps.join(','));
check('MIGRATE v37->v45 keeps the person, gains the wallet, flags the palm',
  migChain45.snapshot.people.length === 1 && migChain45.snapshot.people[0].loyaltyPoints === 137 &&
  migChain45.snapshot.people[0].wallet.balance === 0 && migChain45.snapshot.people[0].palmProfile.format === 'legacy' &&
  JSON.stringify(migChain45.snapshot.people[0].palmProfile.legacyCodes) === JSON.stringify(enrolledCodes));
const packedProfileFixture = (function () {
  const S = B.PALMPRINT_ROI_SIZE;
  const frames = [];
  for (let i = 0; i < 9; i++) {
    const roi = roiImage(PALM_A, 51 + i, {});
    frames.push({ openness: 2.0, roi: roi, code: B.palmprintEncode(roi, S, S), sharpness: 100 + i * 10 });
  }
  return { v: 4, format: 'packed96', codes: B.selectPalmprintProfileCodes(frames) };
})();
const v45PackedStore = JSON.parse(JSON.stringify(v43WalletStore));
v45PackedStore.people[0].palmProfile = packedProfileFixture;
const packedBefore = JSON.stringify(v45PackedStore.people[0]);
const mig45Packed = B.migrateBiomData(JSON.parse(JSON.stringify(v45PackedStore)), 'v44', 'v45');
check('MIGRATE a packed-format profile passes v45 by identity (no rewrite at all)',
  mig45Packed.changed === false && JSON.stringify(mig45Packed.snapshot.people[0]) === packedBefore);
const v45BareStore = JSON.parse(JSON.stringify(v43WalletStore));
delete v45BareStore.people[0].palmProfile;
const mig45Bare = B.migrateBiomData(JSON.parse(JSON.stringify(v45BareStore)), 'v44', 'v45');
check('MIGRATE a person with no palm profile is untouched by v45',
  mig45Bare.changed === false && !('palmProfile' in mig45Bare.snapshot.people[0]));
const migAgain45 = B.migrateBiomData(mig45.snapshot, 'v45', 'v45');
check('MIGRATE is idempotent at v45', migAgain45.appliedSteps.length === 0 && migAgain45.changed === false &&
  migAgain45.snapshot.people[0].wallet.balance === 450 && migAgain45.snapshot.people[0].palmProfile.format === 'legacy');
const mig45Twice = B.migrateBiomData(JSON.parse(JSON.stringify(mig45.snapshot)), 'v44', 'v45');
check('MIGRATE re-running the v45 step over a flagged profile changes nothing further',
  mig45Twice.changed === false && JSON.stringify(mig45Twice.snapshot.people[0].palmProfile.legacyCodes) === JSON.stringify(enrolledCodes));

/* ---------- v46: adoption — a v45 store opens byte-identical -------
   v46 adds the owner's Delete All Data ACTION, not a migration
   step: the v45 wallet-carrying store (post-v45 shape: balance
   450, DEMO-1, one linked account, legacy-flagged palm) must pass
   through the v46 step with nothing rewritten at all. */
const v46Store = JSON.parse(JSON.stringify(mig45.snapshot));
const v46Before = JSON.stringify(v46Store);
const mig46 = B.migrateBiomData(v46Store, 'v45', 'v46');
check('MIGRATE v45->v46 runs the v46 step', mig46.appliedSteps.indexOf('v46') !== -1, mig46.appliedSteps.join(','));
check('MIGRATE v45->v46 rewrites NOTHING (pure adoption)', mig46.changed === false && JSON.stringify(mig46.snapshot) === v46Before,
  'changedStores=' + JSON.stringify(mig46.changedStores));
check('SURVIVE v46 wallet, statement, linked account and flagged palm intact',
  mig46.snapshot.people[0].wallet.balance === 450 && mig46.snapshot.people[0].wallet.statement.length === 1 &&
  mig46.snapshot.people[0].wallet.linkedAccounts.length === 1 && mig46.snapshot.people[0].palmProfile.format === 'legacy');
const migChain46 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v46');
check('MIGRATE v37->v46 runs all nine steps in order', migChain46.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46', migChain46.appliedSteps.join(','));
check('MIGRATE v37->v46 keeps the person, gains the wallet, flags the palm',
  migChain46.snapshot.people.length === 1 && migChain46.snapshot.people[0].loyaltyPoints === 137 &&
  migChain46.snapshot.people[0].wallet.balance === 0 && migChain46.snapshot.people[0].palmProfile.format === 'legacy');
const migAgain46 = B.migrateBiomData(mig46.snapshot, 'v46', 'v46');
check('MIGRATE is idempotent at v46', migAgain46.appliedSteps.length === 0 && migAgain46.changed === false &&
  migAgain46.snapshot.people[0].wallet.balance === 450);

/* ---------- v47: adoption — a v46 store opens byte-identical -------
   v47 adds the PalmNet neural matcher. Neural embeddings live in
   an optional profile.neural field that only v47 saves write;
   the step converts nothing, so the wallet-carrying v46 store
   (balance 450, DEMO-1 statement, one linked account, legacy-
   flagged palm) must pass through byte-identical — and so must a
   store whose profile ALREADY carries a neural bank (the step
   must not strip the new field either). */
const v47Store = JSON.parse(JSON.stringify(mig46.snapshot));
const v47Before = JSON.stringify(v47Store);
const mig47 = B.migrateBiomData(v47Store, 'v46', 'v47');
check('MIGRATE v46->v47 runs the v47 step', mig47.appliedSteps.indexOf('v47') !== -1, mig47.appliedSteps.join(','));
check('MIGRATE v46->v47 rewrites NOTHING (pure adoption)', mig47.changed === false && JSON.stringify(mig47.snapshot) === v47Before,
  'changedStores=' + JSON.stringify(mig47.changedStores));
check('SURVIVE v47 wallet, statement, linked account and flagged palm intact',
  mig47.snapshot.people[0].wallet.balance === 450 && mig47.snapshot.people[0].wallet.statement.length === 1 &&
  mig47.snapshot.people[0].wallet.linkedAccounts.length === 1 && mig47.snapshot.people[0].palmProfile.format === 'legacy');
const v47NeuralStore = JSON.parse(JSON.stringify(mig46.snapshot));
v47NeuralStore.people[0].palmProfile = { v: 4, format: 'packed96', codes: ['R0hJ'], neural: { v: 1, dim: 256, model: 'palmnet-v1', embeddings: ['QUJD'] } };
const v47NeuralBefore = JSON.stringify(v47NeuralStore);
const mig47n = B.migrateBiomData(v47NeuralStore, 'v46', 'v47');
check('MIGRATE v46->v47 keeps an existing neural bank byte-identical',
  mig47n.changed === false && JSON.stringify(mig47n.snapshot) === v47NeuralBefore &&
  mig47n.snapshot.people[0].palmProfile.neural.embeddings[0] === 'QUJD');
const migChain47 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v47');
check('MIGRATE v37->v47 runs all ten steps in order', migChain47.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46,v47', migChain47.appliedSteps.join(','));
check('MIGRATE v37->v47 keeps the person, gains the wallet, flags the palm',
  migChain47.snapshot.people.length === 1 && migChain47.snapshot.people[0].loyaltyPoints === 137 &&
  migChain47.snapshot.people[0].wallet.balance === 0 && migChain47.snapshot.people[0].palmProfile.format === 'legacy');
const migAgain47 = B.migrateBiomData(mig47.snapshot, 'v47', 'v47');
check('MIGRATE is idempotent at v47', migAgain47.appliedSteps.length === 0 && migAgain47.changed === false &&
  migAgain47.snapshot.people[0].wallet.balance === 450);

/* ---------- v48: adoption — a v47 store opens byte-identical -------
   v48 reworks only the flash (torch) control in app.js; flash
   choices were never stored data, so the step converts nothing.
   The wallet-and-neural-carrying v47 store (balance 450, DEMO-1
   statement, one linked account, neural bank on the profile)
   must pass through byte-identical. */
const v48Store = JSON.parse(JSON.stringify(v47NeuralStore));
const v48Before = JSON.stringify(v48Store);
const mig48 = B.migrateBiomData(v48Store, 'v47', 'v48');
check('MIGRATE v47->v48 runs the v48 step', mig48.appliedSteps.indexOf('v48') !== -1, mig48.appliedSteps.join(','));
check('MIGRATE v47->v48 rewrites NOTHING (pure adoption)', mig48.changed === false && JSON.stringify(mig48.snapshot) === v48Before,
  'changedStores=' + JSON.stringify(mig48.changedStores));
check('SURVIVE v48 wallet, statement, linked account and neural bank intact',
  mig48.snapshot.people[0].wallet.balance === 450 && mig48.snapshot.people[0].wallet.statement.length === 1 &&
  mig48.snapshot.people[0].wallet.linkedAccounts.length === 1 &&
  mig48.snapshot.people[0].palmProfile.neural.embeddings[0] === 'QUJD');
const migChain48 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v48');
check('MIGRATE v37->v48 runs all eleven steps in order', migChain48.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48', migChain48.appliedSteps.join(','));
check('MIGRATE v37->v48 keeps the person, gains the wallet, flags the palm',
  migChain48.snapshot.people.length === 1 && migChain48.snapshot.people[0].loyaltyPoints === 137 &&
  migChain48.snapshot.people[0].wallet.balance === 0 && migChain48.snapshot.people[0].palmProfile.format === 'legacy');
const migAgain48 = B.migrateBiomData(mig48.snapshot, 'v48', 'v48');
check('MIGRATE is idempotent at v48', migAgain48.appliedSteps.length === 0 && migAgain48.changed === false &&
  migAgain48.snapshot.people[0].wallet.balance === 450);

/* ---------- v49: adoption — a v48 store opens byte-identical -------
   v49 adds decision logic only (the banking guard, the strict
   money-scan rule, the freeze bounds); it converts no stored
   field. The wallet-and-neural-carrying store must pass through
   byte-identical, and the full chain from v37 must still land
   with the person, wallet and palm flag intact. */
const v49Store = JSON.parse(JSON.stringify(v47NeuralStore));
const v49Before = JSON.stringify(v49Store);
const mig49 = B.migrateBiomData(v49Store, 'v48', 'v49');
check('MIGRATE v48->v49 runs the v49 step', mig49.appliedSteps.indexOf('v49') !== -1, mig49.appliedSteps.join(','));
check('MIGRATE v48->v49 rewrites NOTHING (pure adoption)', mig49.changed === false && JSON.stringify(mig49.snapshot) === v49Before,
  'changedStores=' + JSON.stringify(mig49.changedStores));
check('SURVIVE v49 wallet, statement, linked account and neural bank intact',
  mig49.snapshot.people[0].wallet.balance === 450 && mig49.snapshot.people[0].wallet.statement.length === 1 &&
  mig49.snapshot.people[0].wallet.linkedAccounts.length === 1 &&
  mig49.snapshot.people[0].palmProfile.neural.embeddings[0] === 'QUJD');
const migChain49 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v49');
check('MIGRATE v37->v49 runs all twelve steps in order', migChain49.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49', migChain49.appliedSteps.join(','));
check('MIGRATE v37->v49 keeps the person, gains the wallet, flags the palm',
  migChain49.snapshot.people.length === 1 && migChain49.snapshot.people[0].loyaltyPoints === 137 &&
  migChain49.snapshot.people[0].wallet.balance === 0 && migChain49.snapshot.people[0].palmProfile.format === 'legacy');
const migAgain49 = B.migrateBiomData(mig49.snapshot, 'v49', 'v49');
check('MIGRATE is idempotent at v49', migAgain49.appliedSteps.length === 0 && migAgain49.changed === false &&
  migAgain49.snapshot.people[0].wallet.balance === 450);

/* ---------- v50: adoption — a v49 store opens byte-identical -------
   v50 is performance-only (enrolment pacing and yields, status
   write-on-change, scratch-canvas reuse) plus the wallet-open
   strict-rule correction; it converts no stored field. The
   wallet-and-neural-carrying store must pass through
   byte-identical, and the full chain from v37 must still land
   with the person, wallet and palm flag intact. */
const v50Store = JSON.parse(JSON.stringify(v47NeuralStore));
const v50Before = JSON.stringify(v50Store);
const mig50 = B.migrateBiomData(v50Store, 'v49', 'v50');
check('MIGRATE v49->v50 runs the v50 step', mig50.appliedSteps.indexOf('v50') !== -1, mig50.appliedSteps.join(','));
check('MIGRATE v49->v50 rewrites NOTHING (pure adoption)', mig50.changed === false && JSON.stringify(mig50.snapshot) === v50Before,
  'changedStores=' + JSON.stringify(mig50.changedStores));
check('SURVIVE v50 wallet, statement, linked account and neural bank intact',
  mig50.snapshot.people[0].wallet.balance === 450 && mig50.snapshot.people[0].wallet.statement.length === 1 &&
  mig50.snapshot.people[0].wallet.linkedAccounts.length === 1 &&
  mig50.snapshot.people[0].palmProfile.neural.embeddings[0] === 'QUJD');
const migChain50 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v50');
check('MIGRATE v37->v50 runs all thirteen steps in order', migChain50.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50', migChain50.appliedSteps.join(','));
check('MIGRATE v37->v50 keeps the person, gains the wallet, flags the palm',
  migChain50.snapshot.people.length === 1 && migChain50.snapshot.people[0].loyaltyPoints === 137 &&
  migChain50.snapshot.people[0].wallet.balance === 0 && migChain50.snapshot.people[0].palmProfile.format === 'legacy');
const migAgain50 = B.migrateBiomData(mig50.snapshot, 'v50', 'v50');
check('MIGRATE is idempotent at v50', migAgain50.appliedSteps.length === 0 && migAgain50.changed === false &&
  migAgain50.snapshot.people[0].wallet.balance === 450);

/* ---------- v51: adoption — a v50 store opens byte-identical -------
   v51 adds hand separation: decision logic plus one OPTIONAL
   profile field (hand) that only v51 enrolment / guarded
   top-up writes. Migration converts nothing, so the
   wallet-and-neural-carrying store passes through
   byte-identical with hand absent (read as null), a profile
   already carrying a hand keeps it byte-identical, and the
   full chain from v37 still lands intact. */
const v51Store = JSON.parse(JSON.stringify(v47NeuralStore));
const v51Before = JSON.stringify(v51Store);
const mig51 = B.migrateBiomData(v51Store, 'v50', 'v51');
check('MIGRATE v50->v51 runs the v51 step', mig51.appliedSteps.indexOf('v51') !== -1, mig51.appliedSteps.join(','));
check('MIGRATE v50->v51 rewrites NOTHING (pure adoption)', mig51.changed === false && JSON.stringify(mig51.snapshot) === v51Before,
  'changedStores=' + JSON.stringify(mig51.changedStores));
check('SURVIVE v51 wallet, statement, linked account and neural bank intact',
  mig51.snapshot.people[0].wallet.balance === 450 && mig51.snapshot.people[0].wallet.statement.length === 1 &&
  mig51.snapshot.people[0].wallet.linkedAccounts.length === 1 &&
  mig51.snapshot.people[0].palmProfile.neural.embeddings[0] === 'QUJD');
check('HAND a pre-v51 profile reads hand null after adoption (no field invented)',
  B.palmProfileHand(mig51.snapshot.people[0].palmProfile) === null && !('hand' in mig51.snapshot.people[0].palmProfile));
const v51HandStore = JSON.parse(JSON.stringify(v47NeuralStore));
v51HandStore.people[0].palmProfile.hand = 'left';
const v51HandBefore = JSON.stringify(v51HandStore);
const mig51Hand = B.migrateBiomData(v51HandStore, 'v50', 'v51');
check('HAND a hand-stamped profile survives v50->v51 byte-identical',
  mig51Hand.changed === false && JSON.stringify(mig51Hand.snapshot) === v51HandBefore &&
  B.palmProfileHand(mig51Hand.snapshot.people[0].palmProfile) === 'left');
const migChain51 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v51');
check('MIGRATE v37->v51 runs all fourteen steps in order', migChain51.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51', migChain51.appliedSteps.join(','));
check('MIGRATE v37->v51 keeps the person, gains the wallet, flags the palm',
  migChain51.snapshot.people.length === 1 && migChain51.snapshot.people[0].loyaltyPoints === 137 &&
  migChain51.snapshot.people[0].wallet.balance === 0 && migChain51.snapshot.people[0].palmProfile.format === 'legacy');
const migAgain51 = B.migrateBiomData(mig51.snapshot, 'v51', 'v51');
check('MIGRATE is idempotent at v51', migAgain51.appliedSteps.length === 0 && migAgain51.changed === false &&
  migAgain51.snapshot.people[0].wallet.balance === 450);

/* ---------- v52: adoption — a v51 store opens byte-identical -------
   v52 is a presentation-layer release (the regBIOM customer
   surfaces rebuilt to the approved designs). It changes no stored
   field and no decision rule, so the wallet-and-neural-and-hand-
   carrying store passes through byte-identical, a hand-stamped
   profile keeps its hand, and the full chain from v37 still
   lands intact. */
const v52Store = JSON.parse(JSON.stringify(v47NeuralStore));
v52Store.people[0].palmProfile.hand = 'right';
const v52Before = JSON.stringify(v52Store);
const mig52 = B.migrateBiomData(v52Store, 'v51', 'v52');
check('MIGRATE v51->v52 runs the v52 step', mig52.appliedSteps.indexOf('v52') !== -1, mig52.appliedSteps.join(','));
check('MIGRATE v51->v52 rewrites NOTHING (pure adoption)', mig52.changed === false && JSON.stringify(mig52.snapshot) === v52Before,
  'changedStores=' + JSON.stringify(mig52.changedStores));
check('SURVIVE v52 wallet, statement, linked account, neural bank and hand stamp intact',
  mig52.snapshot.people[0].wallet.balance === 450 && mig52.snapshot.people[0].wallet.statement.length === 1 &&
  mig52.snapshot.people[0].wallet.linkedAccounts.length === 1 &&
  mig52.snapshot.people[0].palmProfile.neural.embeddings[0] === 'QUJD' &&
  B.palmProfileHand(mig52.snapshot.people[0].palmProfile) === 'right');
const migChain52 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v52');
check('MIGRATE v37->v52 runs all fifteen steps in order', migChain52.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v52', migChain52.appliedSteps.join(','));
check('MIGRATE v37->v52 keeps the person, gains the wallet, flags the palm',
  migChain52.snapshot.people.length === 1 && migChain52.snapshot.people[0].loyaltyPoints === 137 &&
  migChain52.snapshot.people[0].wallet.balance === 0 && migChain52.snapshot.people[0].palmProfile.format === 'legacy');
const migAgain52 = B.migrateBiomData(mig52.snapshot, 'v52', 'v52');
check('MIGRATE is idempotent at v52', migAgain52.appliedSteps.length === 0 && migAgain52.changed === false &&
  migAgain52.snapshot.people[0].wallet.balance === 450);

/* ---------- v53: adoption — a v52 store opens byte-identical -------
   v53 changes no stored field and no decision rule: the
   full-hand frame rule judges live frames, the diagnosis panel
   renders scan outcomes, and the owner recovery path writes
   only the existing profile shape (through app.js flows, not
   migration). The hand-stamped, wallet-and-neural-carrying
   store passes through byte-identical, and the full chain
   from v37 still lands intact. */
const v53Store = JSON.parse(JSON.stringify(v47NeuralStore));
v53Store.people[0].palmProfile.hand = 'left';
const v53Before = JSON.stringify(v53Store);
const mig53 = B.migrateBiomData(v53Store, 'v52', 'v53');
check('MIGRATE v52->v53 runs the v53 step', mig53.appliedSteps.indexOf('v53') !== -1, mig53.appliedSteps.join(','));
check('MIGRATE v52->v53 rewrites NOTHING (pure adoption)', mig53.changed === false && JSON.stringify(mig53.snapshot) === v53Before,
  'changedStores=' + JSON.stringify(mig53.changedStores));
check('SURVIVE v53 wallet, statement, linked account, neural bank and hand stamp intact',
  mig53.snapshot.people[0].wallet.balance === 450 && mig53.snapshot.people[0].wallet.statement.length === 1 &&
  mig53.snapshot.people[0].wallet.linkedAccounts.length === 1 &&
  mig53.snapshot.people[0].palmProfile.neural.embeddings[0] === 'QUJD' &&
  B.palmProfileHand(mig53.snapshot.people[0].palmProfile) === 'left');
const migChain53 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v53');
check('MIGRATE v37->v53 runs all sixteen steps in order', migChain53.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v52,v53', migChain53.appliedSteps.join(','));
check('MIGRATE v37->v53 keeps the person, gains the wallet, flags the palm',
  migChain53.snapshot.people.length === 1 && migChain53.snapshot.people[0].loyaltyPoints === 137 &&
  migChain53.snapshot.people[0].wallet.balance === 0 && migChain53.snapshot.people[0].palmProfile.format === 'legacy');
const migAgain53 = B.migrateBiomData(mig53.snapshot, 'v53', 'v53');
check('MIGRATE is idempotent at v53', migAgain53.appliedSteps.length === 0 && migAgain53.changed === false &&
  migAgain53.snapshot.people[0].wallet.balance === 450);

/* ---------- v54: model swap, staleness judged at read time -------
   The store is the v47 neural fixture's shape: a wallet-carrying
   profile whose neural bank is stamped 'palmnet-v1' — the Round 1
   model v54 retires. The adoption must leave the store (bank,
   stamp and all) byte-identical; that the surviving bank then
   reads as no neural evidence is the read-time staleness rule,
   proven functionally in v54-palmnet-r3.test.js. */
const v54Store = JSON.parse(JSON.stringify(v47NeuralStore));
v54Store.people[0].palmProfile.hand = 'left';
const v54Before = JSON.stringify(v54Store);
const mig54 = B.migrateBiomData(v54Store, 'v53', 'v54');
check('MIGRATE v53->v54 runs the v54 step', mig54.appliedSteps.indexOf('v54') !== -1, mig54.appliedSteps.join(','));
check('MIGRATE v53->v54 rewrites NOTHING (pure adoption — the stale bank is NOT re-stamped or deleted)', mig54.changed === false && JSON.stringify(mig54.snapshot) === v54Before,
  'changedStores=' + JSON.stringify(mig54.changedStores));
check('SURVIVE v54 wallet, statement, linked account, neural bank (old stamp intact) and hand stamp intact',
  mig54.snapshot.people[0].wallet.balance === 450 && mig54.snapshot.people[0].wallet.statement.length === 1 &&
  mig54.snapshot.people[0].wallet.linkedAccounts.length === 1 &&
  mig54.snapshot.people[0].palmProfile.neural.model === 'palmnet-v1' &&
  mig54.snapshot.people[0].palmProfile.neural.embeddings[0] === 'QUJD' &&
  B.palmProfileHand(mig54.snapshot.people[0].palmProfile) === 'left');
const migChain54 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v54');
check('MIGRATE v37->v54 runs all seventeen steps in order', migChain54.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v52,v53,v54', migChain54.appliedSteps.join(','));
check('MIGRATE v37->v54 keeps the person, gains the wallet, flags the palm',
  migChain54.snapshot.people.length === 1 && migChain54.snapshot.people[0].loyaltyPoints === 137 &&
  migChain54.snapshot.people[0].wallet.balance === 0 && migChain54.snapshot.people[0].palmProfile.format === 'legacy');
const migAgain54 = B.migrateBiomData(mig54.snapshot, 'v54', 'v54');
check('MIGRATE is idempotent at v54', migAgain54.appliedSteps.length === 0 && migAgain54.changed === false &&
  migAgain54.snapshot.people[0].wallet.balance === 450);

/* ---------- v55: remedy-path repair — adoption, both stamps survive --
   v55 changes no stored field: its fixes are app-flow and
   read-time (the stale-bank Neural Scan recovery grant, the
   refusal wording, the stored-bank counts, the loader's
   model-id check — proven in v55-neural-recovery.test.js).
   The store below carries BOTH bank stamps at once: person 1
   the Round-1 bank v54 retired, person 2 a current
   'palmnet-r3-ep12' bank. The adoption must leave both
   byte-identical, stamps and all. */
const v55Store = JSON.parse(JSON.stringify(v47NeuralStore));
v55Store.people[0].palmProfile.hand = 'left';
const v55Person2 = JSON.parse(JSON.stringify(v55Store.people[0]));
v55Person2.id = 'TSG-BIO-2';
v55Person2.name = 'Current Bank';
v55Person2.palmProfile = { v: 4, format: 'packed96', codes: ['SktM'], hand: 'right', neural: { v: 1, dim: 256, model: 'palmnet-r3-ep12', embeddings: ['REVG'] } };
v55Store.people.push(v55Person2);
const v55Before = JSON.stringify(v55Store);
const mig55 = B.migrateBiomData(v55Store, 'v54', 'v55');
check('MIGRATE v54->v55 runs the v55 step', mig55.appliedSteps.indexOf('v55') !== -1, mig55.appliedSteps.join(','));
check('MIGRATE v54->v55 rewrites NOTHING (pure adoption — neither bank is re-stamped, merged or deleted)', mig55.changed === false && JSON.stringify(mig55.snapshot) === v55Before,
  'changedStores=' + JSON.stringify(mig55.changedStores));
check('SURVIVE v55 both banks keep their stamps and the wallet stays intact',
  mig55.snapshot.people[0].palmProfile.neural.model === 'palmnet-v1' &&
  mig55.snapshot.people[1].palmProfile.neural.model === 'palmnet-r3-ep12' &&
  mig55.snapshot.people[0].wallet.balance === 450 && mig55.snapshot.people[0].wallet.statement.length === 1 &&
  B.palmProfileHand(mig55.snapshot.people[0].palmProfile) === 'left' &&
  B.palmProfileHand(mig55.snapshot.people[1].palmProfile) === 'right');
const migChain55 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v55');
check('MIGRATE v37->v55 runs all eighteen steps in order', migChain55.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v52,v53,v54,v55', migChain55.appliedSteps.join(','));
check('MIGRATE v37->v55 keeps the person, gains the wallet, flags the palm',
  migChain55.snapshot.people.length === 1 && migChain55.snapshot.people[0].loyaltyPoints === 137 &&
  migChain55.snapshot.people[0].wallet.balance === 0 && migChain55.snapshot.people[0].palmProfile.format === 'legacy');
const migAgain55 = B.migrateBiomData(mig55.snapshot, 'v55', 'v55');
check('MIGRATE is idempotent at v55', migAgain55.appliedSteps.length === 0 && migAgain55.changed === false &&
  migAgain55.snapshot.people[0].wallet.balance === 450);

/* ---------- v56: Scan Sync — a pure adoption -------------------
   v56 changes no stored field. Sync preferences are localStorage
   prefs (never in these stores) and the outbox is one
   'syncOutbox' meta row whose VALUE the migration never
   interprets. The store below is the v55 two-stamp store PLUS a
   queued outbox row: the adoption must leave every byte —
   both bank stamps, the wallet, and the queued items —
   exactly as it found them. */
const v56Store = JSON.parse(JSON.stringify(v55Store));
v56Store.meta = (v56Store.meta || []).concat([{ key: 'syncOutbox', value: [{ type: 'scan', record: { id: 'q1', ts: 1764000000000, kind: 'verify', biomId: 'TSG-BIO-1', result: 'Verified' } }] }]);
const v56Before = JSON.stringify(v56Store);
const mig56 = B.migrateBiomData(v56Store, 'v55', 'v56');
check('MIGRATE v55->v56 runs the v56 step', mig56.appliedSteps.indexOf('v56') !== -1, mig56.appliedSteps.join(','));
check('MIGRATE v55->v56 rewrites NOTHING (pure adoption — banks, wallet and the queued outbox all survive byte-identical)',
  mig56.changed === false && JSON.stringify(mig56.snapshot) === v56Before,
  'changedStores=' + JSON.stringify(mig56.changedStores));
check('SURVIVE v56 both bank stamps and the outbox row are intact',
  mig56.snapshot.people[0].palmProfile.neural.model === 'palmnet-v1' &&
  mig56.snapshot.people[1].palmProfile.neural.model === 'palmnet-r3-ep12' &&
  mig56.snapshot.meta.some(function (r) { return r.key === 'syncOutbox' && r.value.length === 1 && r.value[0].record.id === 'q1'; }));
const migChain56 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v56');
check('MIGRATE v37->v56 runs all nineteen steps in order', migChain56.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v52,v53,v54,v55,v56', migChain56.appliedSteps.join(','));
check('MIGRATE v37->v56 keeps the person, gains the wallet, flags the palm',
  migChain56.snapshot.people.length === 1 && migChain56.snapshot.people[0].loyaltyPoints === 137 &&
  migChain56.snapshot.people[0].wallet.balance === 0 && migChain56.snapshot.people[0].palmProfile.format === 'legacy');
const migAgain56 = B.migrateBiomData(mig56.snapshot, 'v56', 'v56');
check('MIGRATE is idempotent at v56', migAgain56.appliedSteps.length === 0 && migAgain56.changed === false &&
  migAgain56.snapshot.people[0].wallet.balance === 450);

/* ---------- v57: camera-layer release — a pure adoption ----------
   v57 changes no stored field: it reworks the Front/Back switch
   in the camera layer and makes the "too dark" guidance
   facing-aware. The store below is the v56 store (the v55
   two-stamp store PLUS a queued sync outbox row): the adoption
   must leave every byte — both bank stamps, the wallet, the
   hand stamps and the queued items — exactly as it found them. */
const v57Store = JSON.parse(JSON.stringify(v56Store));
const v57Before = JSON.stringify(v57Store);
const mig57 = B.migrateBiomData(v57Store, 'v56', 'v57');
check('MIGRATE v56->v57 runs the v57 step', mig57.appliedSteps.indexOf('v57') !== -1, mig57.appliedSteps.join(','));
check('MIGRATE v56->v57 rewrites NOTHING (pure adoption — banks, wallet, hands and the queued outbox all survive byte-identical)',
  mig57.changed === false && JSON.stringify(mig57.snapshot) === v57Before,
  'changedStores=' + JSON.stringify(mig57.changedStores));
check('SURVIVE v57 both bank stamps, the hands and the outbox row are intact',
  mig57.snapshot.people[0].palmProfile.neural.model === 'palmnet-v1' &&
  mig57.snapshot.people[1].palmProfile.neural.model === 'palmnet-r3-ep12' &&
  B.palmProfileHand(mig57.snapshot.people[0].palmProfile) === 'left' &&
  B.palmProfileHand(mig57.snapshot.people[1].palmProfile) === 'right' &&
  mig57.snapshot.meta.some(function (r) { return r.key === 'syncOutbox' && r.value.length === 1 && r.value[0].record.id === 'q1'; }));
const migChain57 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v57');
check('MIGRATE v37->v57 runs all twenty steps in order', migChain57.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v52,v53,v54,v55,v56,v57', migChain57.appliedSteps.join(','));
check('MIGRATE v37->v57 keeps the person, gains the wallet, flags the palm',
  migChain57.snapshot.people.length === 1 && migChain57.snapshot.people[0].loyaltyPoints === 137 &&
  migChain57.snapshot.people[0].wallet.balance === 0 && migChain57.snapshot.people[0].palmProfile.format === 'legacy');
const migAgain57 = B.migrateBiomData(mig57.snapshot, 'v57', 'v57');
check('MIGRATE is idempotent at v57', migAgain57.appliedSteps.length === 0 && migAgain57.changed === false &&
  migAgain57.snapshot.people[0].wallet.balance === 450);

/* ---------- v58: manual-scan release — a pure adoption ----------
   v58 changes no stored field: it gates every scan entry point
   behind its Scan button in app.js. The store below is the v57
   store (the v56 two-stamp store PLUS a queued sync outbox
   row): the adoption must leave every byte — both bank stamps,
   the wallet, the hand stamps and the queued items — exactly
   as it found them. */
const v58Store = JSON.parse(JSON.stringify(v57Store));
const v58Before = JSON.stringify(v58Store);
const mig58 = B.migrateBiomData(v58Store, 'v57', 'v58');
check('MIGRATE v57->v58 runs the v58 step', mig58.appliedSteps.indexOf('v58') !== -1, mig58.appliedSteps.join(','));
check('MIGRATE v57->v58 rewrites NOTHING (pure adoption — banks, wallet, hands and the queued outbox all survive byte-identical)',
  mig58.changed === false && JSON.stringify(mig58.snapshot) === v58Before,
  'changedStores=' + JSON.stringify(mig58.changedStores));
check('SURVIVE v58 both bank stamps, the hands and the outbox row are intact',
  mig58.snapshot.people[0].palmProfile.neural.model === 'palmnet-v1' &&
  mig58.snapshot.people[1].palmProfile.neural.model === 'palmnet-r3-ep12' &&
  B.palmProfileHand(mig58.snapshot.people[0].palmProfile) === 'left' &&
  B.palmProfileHand(mig58.snapshot.people[1].palmProfile) === 'right' &&
  mig58.snapshot.meta.some(function (r) { return r.key === 'syncOutbox' && r.value.length === 1 && r.value[0].record.id === 'q1'; }));
const migChain58 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v58');
check('MIGRATE v37->v58 runs all twenty-one steps in order', migChain58.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v52,v53,v54,v55,v56,v57,v58', migChain58.appliedSteps.join(','));
check('MIGRATE v37->v58 keeps the person, gains the wallet, flags the palm',
  migChain58.snapshot.people.length === 1 && migChain58.snapshot.people[0].loyaltyPoints === 137 &&
  migChain58.snapshot.people[0].wallet.balance === 0 && migChain58.snapshot.people[0].palmProfile.format === 'legacy');
const migAgain58 = B.migrateBiomData(mig58.snapshot, 'v58', 'v58');
check('MIGRATE is idempotent at v58', migAgain58.appliedSteps.length === 0 && migAgain58.changed === false &&
  migAgain58.snapshot.people[0].wallet.balance === 450);

/* ---------- v59: Phase A step-0 truth pass — a pure adoption ----
   v59 changes no stored field: copy truth (templates are encoded,
   not yet encrypted), the Delete All server-copy line, the D6
   points-after-payment reorder and the inline-handler removal —
   all in app.js / index.html. The store below is the v58 store:
   the adoption must leave every byte exactly as it found it. */
const v59Store = JSON.parse(JSON.stringify(v58Store));
const v59Before = JSON.stringify(v59Store);
const mig59 = B.migrateBiomData(v59Store, 'v58', 'v59');
check('MIGRATE v58->v59 runs the v59 step', mig59.appliedSteps.indexOf('v59') !== -1, mig59.appliedSteps.join(','));
check('MIGRATE v58->v59 rewrites NOTHING (pure adoption — banks, wallet, hands and the queued outbox all survive byte-identical)',
  mig59.changed === false && JSON.stringify(mig59.snapshot) === v59Before,
  'changedStores=' + JSON.stringify(mig59.changedStores));
check('SURVIVE v59 both bank stamps, the hands and the outbox row are intact',
  mig59.snapshot.people[0].palmProfile.neural.model === 'palmnet-v1' &&
  mig59.snapshot.people[1].palmProfile.neural.model === 'palmnet-r3-ep12' &&
  B.palmProfileHand(mig59.snapshot.people[0].palmProfile) === 'left' &&
  B.palmProfileHand(mig59.snapshot.people[1].palmProfile) === 'right' &&
  mig59.snapshot.meta.some(function (r) { return r.key === 'syncOutbox' && r.value.length === 1 && r.value[0].record.id === 'q1'; }));
const migChain59 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v59');
check('MIGRATE v37->v59 runs all twenty-two steps in order', migChain59.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v52,v53,v54,v55,v56,v57,v58,v59', migChain59.appliedSteps.join(','));
check('MIGRATE v37->v59 keeps the person, gains the wallet, flags the palm',
  migChain59.snapshot.people.length === 1 && migChain59.snapshot.people[0].loyaltyPoints === 137 &&
  migChain59.snapshot.people[0].wallet.balance === 0 && migChain59.snapshot.people[0].palmProfile.format === 'legacy');
const migAgain59 = B.migrateBiomData(mig59.snapshot, 'v59', 'v59');
check('MIGRATE is idempotent at v59', migAgain59.appliedSteps.length === 0 && migAgain59.changed === false &&
  migAgain59.snapshot.people[0].wallet.balance === 450);

/* ---------- v60: wallet entry without a scan — a pure adoption ---
   v60 changes no stored field: wallet entry stops being a palm
   scan (one enrolled profile opens directly, several show a
   tap-to-choose picker), and the v53 owner-recovery entries move
   from wallet-open failures to My Account → Palm Identity. The
   store below is the v59 store: the adoption must leave every
   byte exactly as it found it. */
const v60Store = JSON.parse(JSON.stringify(v59Store));
const v60Before = JSON.stringify(v60Store);
const mig60 = B.migrateBiomData(v60Store, 'v59', 'v60');
check('MIGRATE v59->v60 runs the v60 step', mig60.appliedSteps.indexOf('v60') !== -1, mig60.appliedSteps.join(','));
check('MIGRATE v59->v60 rewrites NOTHING (pure adoption — banks, wallet, hands and the queued outbox all survive byte-identical)',
  mig60.changed === false && JSON.stringify(mig60.snapshot) === v60Before,
  'changedStores=' + JSON.stringify(mig60.changedStores));
check('SURVIVE v60 both bank stamps, the hands and the outbox row are intact',
  mig60.snapshot.people[0].palmProfile.neural.model === 'palmnet-v1' &&
  mig60.snapshot.people[1].palmProfile.neural.model === 'palmnet-r3-ep12' &&
  B.palmProfileHand(mig60.snapshot.people[0].palmProfile) === 'left' &&
  B.palmProfileHand(mig60.snapshot.people[1].palmProfile) === 'right' &&
  mig60.snapshot.meta.some(function (r) { return r.key === 'syncOutbox' && r.value.length === 1 && r.value[0].record.id === 'q1'; }));
const migChain60 = B.migrateBiomData(JSON.parse(JSON.stringify(v37Store)), 'v37', 'v60');
check('MIGRATE v37->v60 runs all twenty-three steps in order', migChain60.appliedSteps.join(',') === 'v38,v39,v40,v41,v42,v43,v44,v45,v46,v47,v48,v49,v50,v51,v52,v53,v54,v55,v56,v57,v58,v59,v60', migChain60.appliedSteps.join(','));
check('MIGRATE v37->v60 keeps the person, gains the wallet, flags the palm',
  migChain60.snapshot.people.length === 1 && migChain60.snapshot.people[0].loyaltyPoints === 137 &&
  migChain60.snapshot.people[0].wallet.balance === 0 && migChain60.snapshot.people[0].palmProfile.format === 'legacy');
const migAgain60 = B.migrateBiomData(mig60.snapshot, 'v60', 'v60');
check('MIGRATE is idempotent at v60', migAgain60.appliedSteps.length === 0 && migAgain60.changed === false &&
  migAgain60.snapshot.people[0].wallet.balance === 450);

/* ---------- the shipped app source carries no AUTOMATIC wipe -------
   v46 note: the only erase in the app is the owner's confirmed
   Delete All Data action (DB.clearAll + B.wipeBiomData, wired in
   wireWipeData — proven in v46-wipe.test.js). What stays banned,
   and is still pinned here: deleting the whole database and
   removing store keys, the retired update-time wipe mechanics. */
const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
check('APP declares the current data version (v60)', appSrc.indexOf("APP_DATA_VERSION = 'v60'") !== -1);
check('APP startup runs the migration', appSrc.indexOf('migrateBiomData') !== -1 && appSrc.indexOf('migrateDbStores') !== -1);
check('APP contains no database deletion (the retired wipe)', appSrc.indexOf('deleteDatabase') === -1);
check('APP contains no store-key removal (the retired wipe)', !/removeItem\(\s*'tsgbiom_/.test(appSrc));
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
check('APP shell is v60', swSrc.indexOf('tsg-biom-shell-v60') !== -1);

console.log(fail === 0 ? 'ALL MIGRATION TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
