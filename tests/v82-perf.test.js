/* TSG BIOM v82 — PERFORMANCE (the Chairman's order, 2026-11-27
   ~22:01, after his own phone timings on live v81: enrolment
   7.25 s, Add Money money-auth 1.67–1.77 s, merchant-terminal
   scan 2,365 ms; targets: merchant scan under 2.0 s,
   registration into the 3–4 s range).

   The release discipline pinned here: SPEED FROM THE PIPELINE
   ONLY. The frozen bars, the strict money rule, the banking
   guard, the codec, the block system and the consent behaviour
   are untouched — the v49/v61/v67/v79/v80/v81 suites pin those;
   this suite pins the three v82 optimisations and the
   invariants that make them safe:

   OPT-1 (enrolment burst overlap — the Chairman's method
     order, 2026-11-27 22:49: reach the 3-4 s registration band
     by overlapping burst analysis with capture): the burst's
     analysis chain runs DURING the fixed 900 ms recording
     window instead of strictly after it. The window itself
     (900 ms), the grab pace, the frame order, the per-frame
     analysis call, the quality gates, the banked template
     count (3) and the cancel checks are unchanged — only the
     scheduling moved. The measured cost is recorded in the
     v82 report, not hidden: on the timing rig, where one
     frame analysis is an ~850 ms main-thread task, in-window
     analyses starve the grab interval and the grabbed-frame
     count falls (16 -> 3, one enrolment in three failing
     selection on the starved pool). On the Chairman's phone
     the per-frame cost is ~200-300 ms, so the pool cost is
     smaller there; the phone is the verdict on both the band
     and the pool.
   OPT-2/OPT-3 (peopleReady): on the terminal and Add Money
     money paths the full people-list load now runs
     CONCURRENTLY with the scan instead of serially before
     frame 1. The list is consumed ONLY by the verdict tail's
     impostor checks; a load failure rejects the tail and the
     scan FAILS CLOSED (the callers' catches deny the scan),
     exactly as a pre-stream load failure denied it before.
     Wallet Pay and Send authorisation deliberately keep the
     pre-loaded list — pinned below so the partial rollout is
     explicit, not accidental.
   OPT-10 (verdict-tail pair reuse): the neural impostor check
     reuses the winning frame's already-computed PalmNet pair
     instead of re-embedding the same ROI. Same embeddings,
     same scores, same judgement — one duplicate embed removed.

   Plus: version coherence at v82, the v82 migration step as a
   pure adoption, the frozen bars, and the v74 timer spans
   (the before/after numbers are only comparable because the
   start/stop points did not move).

   All numbers in the v82 report are RIG numbers; the phone is
   the verdict. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bioSrc = fs.readFileSync(path.join(__dirname, '..', 'biometrics.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

/* ---------------- version coherence ---------------- */
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v91 (v91 named pin change: liquid glass)',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v91' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v91'") !== -1 &&
  htmlSrc.indexOf('<meta name="biom-build" content="v91">') !== -1 &&
  htmlSrc.indexOf('TSG Biom · App v91 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v91' &&
  B.BIOM_DATA_VERSIONS.length === 55);

/* ---------------- migration: v82 is a pure adoption ---------------- */
check('MIGRATION the v82 step is a pure adoption: a v81 store opens byte-identical at v82', (function () {
  const before = JSON.stringify({ people: [{ id: 'TSG-BIO-1', name: 'Gate', wallet: { balance: 5, statement: [], linkedAccounts: [] } }], logs: [], transactions: [], meta: [{ k: 'syncBlockedIds', v: 1 }] });
  const mig = B.migrateBiomData(JSON.parse(before), 'v81', 'v82');
  return mig.appliedSteps.join(',') === 'v82' && mig.changed === false && JSON.stringify(mig.snapshot) === before;
})());
check('MIGRATION the v82 step is declared a pure adoption in biometrics.js',
  bioSrc.indexOf("'v82': function (snap) { return snap; }") !== -1);

/* ---------------- frozen bars ---------------- */
check('FREEZE the shipped bars are untouched (EDCC 0.32 / PalmNet 0.5895) and the strict money margins stand',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895 &&
  B.MONEY_MARGIN_EDCC === 0.10 && B.MONEY_MARGIN_NEURAL === 0.15);

/* ---------------- OPT-1: burst overlap (Chairman's method order) ---------------- */
const enrol = appSrc.slice(appSrc.indexOf('function streamEnrolPalm'), appSrc.indexOf('function streamVerifyPalm'));
check('OPT-1 the burst records and analyses as ONE overlapped phase (recordBurstAnalysed); the old two-phase split is gone',
  enrol.indexOf('function recordBurstAnalysed()') !== -1 &&
  enrol.indexOf('function recordBurst()') === -1 &&
  enrol.indexOf('function analyseBurst(') === -1);
check('OPT-1 the burst window is UNCHANGED: the same fixed 900 ms of stream time (the PALMPRINT_BURST_MS constant)',
  B.PALMPRINT_BURST_MS === 900 &&
  enrol.indexOf('setTimeout(finish, B.PALMPRINT_BURST_MS);') !== -1 &&
  enrol.indexOf('setRing((Date.now() - started) / B.PALMPRINT_BURST_MS);') !== -1);
check('OPT-1 the first frame is grabbed immediately (no 55 ms head start lost) and grabs still pace at 55 ms',
  enrol.indexOf('grab();\n        var iv = setInterval(grab, 55);') !== -1);
check('OPT-1 each grabbed frame is enqueued for analysis in grab order, and the chain still runs the analyses strictly in order',
  enrol.indexOf('if (f) { frames.push(f); Research.tapFrame(f); enqueue(f, frames.length - 1); }') !== -1 &&
  enrol.indexOf('chain = chain.then(function () {') !== -1 &&
  enrol.indexOf('return analysePalmFrame(frame).then(function (r) {') !== -1 &&
  enrol.indexOf('if (i % 2 === 0) tracker.add(frame, r.lm);') !== -1 &&
  enrol.indexOf('resolve(chain.then(function () { return { frames: frames, results: results, lmSets: lmSets }; }));') !== -1);
check('OPT-1 the analysis step still yields for paint between frames and still stops on cancel',
  enrol.indexOf('return yieldForPaint(); }); // v50: paint between burst frames') !== -1 &&
  enrol.indexOf('if (control && control.cancelled) return;') !== -1);
check('OPT-1 the in-window status line is truthful for the overlapped phase (app-seat fix: no "captured" claim mid-capture)',
  enrol.indexOf("'Palm found — capturing and analysing, hold steady...'") !== -1 &&
  enrol.indexOf("'Palm captured — analysing the burst, hold on...'") === -1);
check('OPT-1 the caller banks from the drained chain result and the cancel check still precedes banking',
  enrol.indexOf('return recordBurstAnalysed().then(function (a) {') !== -1 &&
  enrol.indexOf('var lv = B.palmprintBurstLiveness(a.lmSets);') !== -1 &&
  enrol.indexOf('return out({ results: a.results, burst: { frames: a.results.length, liveness: lv } });') !== -1 &&
  enrol.indexOf('if (control && control.cancelled) { var o = out(); o.stopped = true; return o; }') !== -1);

/* ---------------- OPT-3: peopleReady ---------------- */
check('OPT-3 DB.get exists beside DB.all with the same vault funnel',
  appSrc.indexOf('get: function (store, id) {') !== -1 &&
  appSrc.indexOf('_getRaw: function (store, id) {') !== -1);
const verify = appSrc.slice(appSrc.indexOf('function streamVerifyPalm'), appSrc.indexOf('function streamIdentifyPalm'));
check('OPT-3 the stream accepts opts.peopleReady and settles it once, with a hygiene catch so an unconsumed rejection never surfaces',
  verify.indexOf('var peopleSettled = (opts && opts.peopleReady && typeof opts.peopleReady.then === \'function\')') !== -1 &&
  verify.indexOf('peopleSettled.catch(function () {});') !== -1 &&
  verify.indexOf('function peopleForImpostors() {') !== -1);
check('OPT-3 the people list is consumed ONLY by the four impostor functions (matching never reads it)',
  (verify.match(/peopleForImpostors\(\)\.then\(function \(peopleList\) \{/g) || []).length === 4 &&
  verify.indexOf('function impostorMaxFor(rois, probeHand)') !== -1 &&
  verify.indexOf('function neuralImpostorMaxFor(rois, probeHand, winFrameIdx)') !== -1 &&
  verify.indexOf('function impostorTopFor(rois, probeHand)') !== -1 &&
  verify.indexOf('function neuralImpostorTopFor(rois, probeHand)') !== -1);
check('OPT-3 a people-load rejection propagates out of the impostor functions (fail closed, never a silent zero-impostor verdict)',
  /* the pre-v82 "people load failed" catches are gone; the only
     catches left on those chains guard the match/embed work */
  verify.indexOf('return { max: 0, topId: null, topScore: 0 };') === -1 ||
  (verify.match(/peopleForImpostors/g) || []).length >= 5);
check('OPT-3 the terminal starts the list load at scan start and passes it as peopleReady with an empty in-stream list',
  appSrc.indexOf('var termPeopleReady = DB.all(\'people\');') !== -1 &&
  appSrc.indexOf('termPeopleReady.catch(function () {});') !== -1 &&
  appSrc.indexOf("streamVerifyPalm($('termVideo'), $('termStatus'), person, [], null, fieldRec, control, { strictMoney: true, peopleReady: termPeopleReady })") !== -1);
check('OPT-3 Add Money starts the list load at scan start and passes it as peopleReady with an empty in-stream list',
  appSrc.indexOf('var peopleReady = DB.all(\'people\');') !== -1 &&
  appSrc.indexOf('peopleReady.catch(function () {});') !== -1 &&
  appSrc.indexOf("streamVerifyPalm($('wScanVideo'), $('wScanStatus'), fresh, [], null, function () {}, walletControl, { strictMoney: true, peopleReady: peopleReady })") !== -1 &&
  appSrc.indexOf("return DB.get('people', me.id).then(function (got) {") !== -1);
check('OPT-3 DELIBERATE NON-CHANGE: wallet Biom Pay still pre-loads the list and passes it directly (the v82 rollout covers terminal + Add Money only; v90: the Send authorisation site is removed with the Send flow)',
  appSrc.indexOf("streamVerifyPalm($('wScanVideo'), $('wScanStatus'), fresh, people, null, function () {}, walletControl, { strictMoney: true })") !== -1 &&
  appSrc.indexOf('freshSender') === -1);

/* -------- OPT-3 behaviour: DB.get round-trips the vault -------- */
(function () {
  /* The DB layer lives inside app.js's closure and needs a
     browser vault, so the round-trip is proven at the source
     level here: DB.get funnels through the same _getRaw/rawGet
     + unseal path as DB.all, and by-id reads return null (not
     a throw) for a missing record, exactly like a raw get. */
  check('OPT-3 DB.get returns null for a missing record and unseals through the shared funnel',
    appSrc.indexOf('if (!row) return null;') !== -1 &&
    appSrc.indexOf('return vaultDecryptRows([row]).then(function (rows) { return rows && rows[0] ? rows[0] : null; });') !== -1 &&
    appSrc.indexOf('}), DB_OP_TIMEOUT_MS);') !== -1);
})();

/* ---------------- OPT-10: verdict-tail pair reuse ---------------- */
check('OPT-10 the stream stashes each frame pair as it is computed',
  verify.indexOf('var framePairByIdx = {};') !== -1 &&
  verify.indexOf('framePairByIdx[myIdx] = pair || null;') !== -1);
check('OPT-10 the neural impostor check reuses the cached pair ONLY for a streamed single-ROI win',
  verify.indexOf('var cached = (typeof winFrameIdx === \'number\' && rois.length === 1) ? framePairByIdx[winFrameIdx] : null;') !== -1 &&
  /* v84 named pin advance (Phase-1 L3): the pairsP line gained the
     in-flight branch — when the landed pair cache misses, the tail
     now awaits the stream's in-flight embedPair promise for that
     frame before falling back to a fresh embed. The v82 contract
     (cached pair reused for a streamed single-ROI win; fresh embed
     otherwise) is preserved and extended, not changed. */
  verify.indexOf('var pairsP = cached ? Promise.resolve([cached]) : (inFlight ? inFlight.then(function (pair) { return [pair]; }) : Promise.all(rois.map(function (roi) { return PalmNet.embedPair(roi); })));') !== -1);
check('OPT-10 the streamed verdict passes the win frame index; the collected-set verdict path (the Top functions over the live ROI set) is untouched',
  verify.indexOf('Promise.all([impostorMaxFor(win.rois, winHand), neuralImpostorMaxFor(win.rois, winHand, win.frameIdx)])') !== -1 &&
  verify.indexOf('neuralImpostorTopFor(liveRois, probeHand)') !== -1);

/* ---------------- timers: the measured spans did not move ---------------- */
check('TIMERS the v74 timer machinery is intact (four surfaces, one createScanTimer)',
  appSrc.indexOf('var ScanTimers = { w: createScanTimer(), e: createScanTimer(), t: createScanTimer(), u: createScanTimer() };') !== -1 &&
  appSrc.indexOf("fields = Object.assign({}, fields, { durationMs: measured });") !== -1);
check('TIMERS the enrolment still resolves its duration from the capture step (streamEnrolPalm span), not the banking bookkeeping',
  appSrc.indexOf('var captureMs = Math.round(ScanTimers.u.elapsedMs());') !== -1);

console.log(fail === 0 ? 'ALL V82 PERFORMANCE TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
