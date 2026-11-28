/* TSG BIOM v84 — PHASE 1: SPEED (overnight programme, Phase 1;
   the coordinator's profile, verified against the v83 tree).

   The timed span of a Verified money-auth scan ends with a
   verdict tail that v83 started COLD after the last
   confirmation frame's analysis: Promise.all(impostorMaxFor,
   neuralImpostorMaxFor) in verifiedOut, the neural half
   re-embedding the win ROI whenever the stream's own embed of
   that frame had not landed yet. v84 changes SCHEDULING ONLY:

   L1 (speculative verdict tail): when the win first latches in
     tryWin, both impostor maxima start at once on verifiedOut's
     exact inputs (win.rois; the hand = win.probeHand ||
     scanHand() at latch time). Equivalence argument, pinned
     below: verifiedOut reads win.probeHand FIRST, so when the
     winning frame's hand is known the tail-time hand is that
     same value whatever later frames do; when it is unknown,
     the latch-time consensus could in principle move, so
     verifiedOut consumes the speculation ONLY if the hand it
     computes at the tail equals the latch hand AND the win
     object is the latched object — otherwise it starts cold,
     exactly as v83. Hygiene catches at start swallow a
     speculation on every non-verified exit (liveness / spoof /
     cancel / cap): wasted compute only, never an unhandled
     rejection, never a verdict.
   L3 (no duplicate embed for the win pair): the stream keeps
     each frame's IN-FLIGHT embedPair promise
     (framePairPromiseByIdx); neuralImpostorMaxFor, when the
     landed pair cache misses, awaits that promise instead of
     calling PalmNet.embedPair again on the same ROI. Same
     pair, same scores — only the duplicate engine pass goes
     away. A fresh embed runs only when no in-flight promise
     exists.
   The collected-set path (finalOut -> verifiedOut, win.rois =
     liveRois, fast:false) builds a NEW win object, so it can
     never match the speculation's win reference: it keeps
     v83 behaviour exactly — pinned below.

   Frozen, untouched: EDCC 0.32, PalmNet 0.5895, the strict
   two-frame rule and its margins (0.10 / 0.15), the banking
   guard, enrolment gates, the block system, the v81 consent
   call sites, the scan-record schema, and the v74/v83 timer
   start/stop points. No frame pacing, spoof sampling,
   liveness, MAXF/deadline, camera or MediaPipe change.

   All timing evidence lives in the Phase-1 report and is RIG
   numbers; the phone is the verdict. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const bioSrc = fs.readFileSync(path.join(__dirname, '..', 'biometrics.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function sliceBetween(src, a, b) {
  const i = src.indexOf(a); if (i === -1) return '';
  const j = src.indexOf(b, i + a.length); if (j === -1) return '';
  return src.slice(i, j);
}
const verify = sliceBetween(appSrc, 'function streamVerifyPalm', 'function streamIdentifyPalm');

/* ---------------- version coherence ---------------- */
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v95',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v95' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v95'") !== -1 &&
  htmlSrc.indexOf('<meta name="biom-build" content="v95">') !== -1 &&
  htmlSrc.indexOf('TSG Biom · App v95 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v95' &&
  B.BIOM_DATA_VERSIONS.length === 59);

/* ---------------- migration: v84 is a pure adoption ---------------- */
check('MIGRATION the v84 step is a pure adoption: a v83 store opens byte-identical at v84', (function () {
  const before = JSON.stringify({ people: [{ id: 'TSG-BIO-1', name: 'Gate', wallet: { balance: 5, statement: [], linkedAccounts: [] } }], logs: [], transactions: [], meta: [{ k: 'syncBlockedIds', v: 1 }] });
  const mig = B.migrateBiomData(JSON.parse(before), 'v83', 'v84');
  return mig.appliedSteps.join(',') === 'v84' && mig.changed === false && JSON.stringify(mig.snapshot) === before;
})());
check('MIGRATION the v84 step is declared a pure adoption in biometrics.js',
  bioSrc.indexOf("'v84': function (snap) { return snap; }") !== -1);

/* ---------------- frozen bars, margins, timer spans ---------------- */
check('FREEZE the shipped bars are untouched (EDCC 0.32 / PalmNet 0.5895) and the strict money margins stand',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895 &&
  B.MONEY_MARGIN_EDCC === 0.10 && B.MONEY_MARGIN_NEURAL === 0.15);
check('FREEZE the strict two-frame money gate is still the honoured win condition in loop()',
  verify.indexOf("if (win && lv.pass && sp.framesChecked >= 3 && (!strictMoney || moneyGate.confirmed('target'))) return verifiedOut();") !== -1 &&
  verify.indexOf('moneyGate.noteVerified(\'target\', frameIdx)') !== -1);
check('TIMERS the v74 timer machinery is intact (four surfaces, one createScanTimer) and no v84 code touches a timer start/stop',
  appSrc.indexOf('var ScanTimers = { w: createScanTimer(), e: createScanTimer(), t: createScanTimer(), u: createScanTimer() };') !== -1 &&
  sliceBetween(verify, 'function startSpecTail()', 'function neuralScoreForRois').indexOf('ScanTimer') === -1 &&
  verify.indexOf('scanTimerStart') === -1 && verify.indexOf('scanTimerStop') === -1);

/* ---------------- L1: speculation starts at the latch ---------------- */
check('L1 the speculation state exists and starts exactly once, at the win latch inside tryWin',
  verify.indexOf('var specTail = null;') !== -1 &&
  verify.indexOf('win = { res: fused, rois: [frameRoiByIdx[frameIdx]], fast: false, frameIdx: frameIdx, probeHand: frames[frameIdx] ? frames[frameIdx].hand : null };\n        startSpecTail();') !== -1 &&
  (verify.match(/startSpecTail\(\);/g) || []).length === 1 &&
  sliceBetween(verify, 'function startSpecTail()', 'function neuralScoreForRois').indexOf('if (specTail || !win) return;') !== -1);
check('L1 the speculation uses verifiedOut\u2019s exact inputs: win.rois and (win.probeHand || scanHand())',
  sliceBetween(verify, 'function startSpecTail()', 'function neuralScoreForRois').indexOf('var hand = win.probeHand || scanHand();') !== -1 &&
  sliceBetween(verify, 'function startSpecTail()', 'function neuralScoreForRois').indexOf('var edccP = impostorMaxFor(win.rois, hand);') !== -1 &&
  sliceBetween(verify, 'function startSpecTail()', 'function neuralScoreForRois').indexOf('var neuralP = neuralImpostorMaxFor(win.rois, hand, win.frameIdx);') !== -1);
check('L1 hygiene catches are attached at start, so a speculation on a non-verified exit is swallowed (compute only)',
  sliceBetween(verify, 'function startSpecTail()', 'function neuralScoreForRois').indexOf('edccP.catch(function () {});') !== -1 &&
  sliceBetween(verify, 'function startSpecTail()', 'function neuralScoreForRois').indexOf('neuralP.catch(function () {});') !== -1 &&
  sliceBetween(verify, 'function startSpecTail()', 'function neuralScoreForRois').indexOf('specTail = { winRef: win, hand: hand, edccP: edccP, neuralP: neuralP };') !== -1);

/* ---------------- L1: verifiedOut consumes it, guarded ---------------- */
const vout = sliceBetween(verify, 'function verifiedOut()', 'function finalOut(');
check('L1 verifiedOut computes its hand exactly as v83 (win.probeHand || scanHand()) BEFORE choosing the tail',
  vout.indexOf('var winHand = win.probeHand || scanHand();') !== -1 &&
  vout.indexOf('var winHand = win.probeHand || scanHand();') < vout.indexOf('var tailP ='));
check('L1 verifiedOut consumes the speculation ONLY on win-object identity AND hand equality; otherwise it starts cold exactly as v83',
  vout.indexOf('var tailP = (specTail && specTail.winRef === win && specTail.hand === winHand)') !== -1 &&
  vout.indexOf('? Promise.all([specTail.edccP, specTail.neuralP])') !== -1 &&
  vout.indexOf(': Promise.all([impostorMaxFor(win.rois, winHand), neuralImpostorMaxFor(win.rois, winHand, win.frameIdx)]);') !== -1 &&
  vout.indexOf('return tailP.then(function (both) {') !== -1);
check('L1 the judgement after the tail is the v83 judgement (same both[] order, same margin check)',
  vout.indexOf('var impMax = both[0], nImpMax = both[1];') !== -1 &&
  vout.indexOf('var mc = B.moneyMarginCheck(win.res, impMax, nImpMax);') !== -1);

/* ---------------- L1: the collected-set path is unchanged ---------------- */
const fout = sliceBetween(verify, 'function finalOut(', 'function applyMatch(');
check('L1 collected-set path unchanged: finalOut still builds a NEW win object (no probeHand / frameIdx) and calls verifiedOut, so the win-reference guard can never consume a streamed speculation for it',
  fout.indexOf('win = { res: fused, rois: liveRois, fast: false };') !== -1 &&
  fout.indexOf('return verifiedOut();') !== -1);
check('L1 no speculation is started anywhere outside tryWin (identify stream and finalOut never start one)',
  (appSrc.match(/startSpecTail/g) || []).length === 2 && // the definition + the latch call, nothing else
  sliceBetween(appSrc, 'function streamIdentifyPalm', 'function grabVideoFrameInto').indexOf('startSpecTail') === -1);

/* ---------------- L3: no duplicate embed for the win pair ---------------- */
check('L3 the stream keeps each frame\u2019s in-flight embed promise, from the very call that used to be fire-and-forget',
  verify.indexOf('var framePairPromiseByIdx = {};') !== -1 &&
  verify.indexOf('var pairPromise = PalmNet.embedPair(r.roi);') !== -1 &&
  verify.indexOf('framePairPromiseByIdx[myIdx] = pairPromise;') !== -1 &&
  verify.indexOf('pairPromise.then(function (pair) {') !== -1 &&
  verify.indexOf('framePairByIdx[myIdx] = pair || null;') !== -1);
const nim = sliceBetween(verify, 'function neuralImpostorMaxFor(', '/* The PalmNet sentence');
check('L3 neuralImpostorMaxFor awaits the in-flight promise when the landed pair cache misses, before any fresh embed',
  nim.indexOf("var inFlight = (!cached && typeof winFrameIdx === 'number' && rois.length === 1) ? framePairPromiseByIdx[winFrameIdx] : null;") !== -1 &&
  nim.indexOf('var pairsP = cached ? Promise.resolve([cached]) : (inFlight ? inFlight.then(function (pair) { return [pair]; }) : Promise.all(rois.map(function (roi) { return PalmNet.embedPair(roi); })));') !== -1);
check('L3 the landed-pair reuse (v82) still wins first, and a fresh embed remains only as the no-in-flight fallback',
  nim.indexOf('var cached = (typeof winFrameIdx === \'number\' && rois.length === 1) ? framePairByIdx[winFrameIdx] : null;') !== -1 &&
  nim.indexOf('var cached =') < nim.indexOf('var inFlight =') &&
  (nim.match(/PalmNet\.embedPair/g) || []).length === 1);

/* ---------------- L1/L3 behaviour: promise-level equivalence ---------------- */
(function () {
  /* Deterministic, synchronous witness of the L3 mechanism with
     a manual thenable: one embedPair call, its promise stored,
     and two independent consumers (the stream's own continuation
     and the tail's) both receive the SAME pair object — a second
     call would be a second engine pass and is never made. */
  let calls = 0;
  const pair = [[0.1], [0.2]];
  const embedPair = function () {
    calls++;
    return { then: function (fn) { fn(pair); } };
  };
  const inFlight = embedPair(); // the stream's one pass
  let streamSeen = null, tailSeen = null;
  inFlight.then(function (p) { streamSeen = p; });
  tailSeen = (function () { let v = null; inFlight.then(function (p) { v = [p]; }); return v; })();
  check('L3 behaviour: one embedPair call serves both the stream and the tail, with the identical pair object',
    calls === 1 && streamSeen === pair && tailSeen !== null && tailSeen[0] === pair);
  /* L1 consumption guard, as a truth table over the exact
     predicate verifiedOut uses. */
  const consume = function (spec, winObj, winHand) { return !!(spec && spec.winRef === winObj && spec.hand === winHand); };
  const w = { rois: ['roi'] };
  check('L1 behaviour: the guard consumes only on same win object + same hand (probeHand-known and consensus-stable cases), and falls back cold on a moved consensus or the collected-set win object',
    consume({ winRef: w, hand: 'left' }, w, 'left') === true &&
    consume({ winRef: w, hand: null }, w, null) === true &&
    consume({ winRef: w, hand: 'left' }, w, 'right') === false &&
    consume({ winRef: w, hand: null }, w, 'left') === false &&
    consume({ winRef: w, hand: 'left' }, { rois: ['roi'] }, 'left') === false &&
    consume(null, w, 'left') === false);
})();

console.log(fail === 0 ? 'ALL V84 SPEED TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
