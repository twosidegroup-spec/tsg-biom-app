/* TSG BIOM v50 — enrolment hang fix + whole-app smoothness pass,
   plus the wallet-open strict-rule correction.

   Ordered 2026-11-24 after the Chairman's phone report on the
   regBIOM scan (screenshot: the no-hand camera-swap message):
   "This part when registering it was stuck lag and got hang fix
   it and make the site ultra smooth and also check everyone is
   working smoothly or not."

   MEASURED DIAGNOSIS (tests/e2e/perf-enrol.js, this rig, v49):
   - The enrolment WATCH loop re-entered analysis the microtask
     the previous frame's landmarks landed — an unpaced,
     self-chaining promise loop. No-hand watch: 95.4% of the
     wall clock inside landmark inference, ONE unbroken main-
     thread long task of ~159 s, and requestAnimationFrame
     starved outright (zero completed 500 ms rAF buckets in
     24 s); a cancel could not even be observed for > 15 s.
   - The burst ANALYSIS chain ran 14 full analyses back to back
     the same way: 12,718 ms, 89% duty, one 12,705 ms long task,
     zero rAF buckets, no progress text after "capturing".
   - Verify/identify were already paced (camera clock) and
     worker-bounded; first load paints at ~1.2 s with PalmNet
     fire-and-forget; Logs renders 1,000 rows in ~151 ms —
     measured, no material lag, unchanged.

   Proven here:
   - PACING + YIELD wiring in streamEnrolPalm: grabs paced to
     the camera clock (waitFreshFrame, the verify stream's own
     discipline), one macrotask yield per analysed watch frame,
     a paint yield between burst frames, the swap resetting the
     pacing clock, the 180 s deadline and the timeout outcome
     intact, and a cancel landing during the burst/analysis now
     ends the capture as 'stopped'.
   - BUSY-FLAG recovery: navigation cancels the enrol control;
     runPalmCapture releases palmScanBusy and the Capture button
     on BOTH the resolve and reject paths.
   - WRITE-ON-CHANGE: both paced streams route loop status
     through setStatus; no unconditional per-frame guidance
     write remains; palmFrameMeasures reuses a scratch canvas.
   - SCORE PARITY: v50 is performance-only — the decision
     constants are unchanged and the perf-verify fixture
     composition reproduces its v49 scores to within 0.001
     (the packed matcher is integer arithmetic; the numbers
     are deterministic).
   - WALLET-OPEN CORRECTION (the Chairman's order, 2026-11-24):
     exactly three strict-money call sites remain (terminal
     Biom Pay, Add Money, Send sender authorisation); both
     wallet-open routes carry no strict flag.
   - VERSIONS v50 / shell v50; 'v50' is a pure adoption step.
   All numbers here are RIG numbers; the phone is the verdict. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function info(msg) { console.log('  ..  ' + msg); }

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

/* ---------------- fixture machinery (perf-verify composition) -- */
function lcg(seed) { let s = seed; return function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; }
const S = B.PALMPRINT_ROI_SIZE;
function roiImage(creases, seed, opts) {
  opts = opts || {};
  const size = opts.size || S, k = 128 / size, rnd = lcg(seed);
  const noiseAmp = opts.noiseAmp != null ? opts.noiseAmp : 12;
  const noise = [];
  for (let i = 0; i < size * size; i++) noise.push((rnd() - 0.5) * noiseAmp);
  const dx = opts.dx || 0, dy = opts.dy || 0;
  const g = new Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + dx) * k, py = (y + dy) * k;
    let v = 172 + Math.sin(px * 0.045 + 1.7) * 9 + Math.cos(py * 0.06 + 0.4) * 7;
    for (const c of creases) {
      if (c.vert) { const lx = c.a * py + c.b + Math.sin(py * c.f + c.p) * c.amp; const d = Math.abs(px - lx); if (d < 3) v -= (3 - d) * 30; }
      else { const ly = c.a * px + c.b + Math.sin(px * c.f + c.p) * c.amp; const d = Math.abs(py - ly); if (d < 3) v -= (3 - d) * 30; }
    }
    g[y * size + x] = Math.max(0, Math.min(255, Math.round(v + noise[y * size + x])));
  }
  return g;
}
const PALM_A = [
  { a: 0.22, b: 26, f: 0.05, p: 1, amp: 3 }, { a: -0.35, b: 92, f: 0.04, p: 3, amp: 4 },
  { a: 0.04, b: 62, f: 0.06, p: 5, amp: 3 }, { a: 0.55, b: 18, f: 0.05, p: 2, amp: 3, vert: true },
  { a: -0.12, b: 108, f: 0.05, p: 6, amp: 4 }
];
const PALM_B = [
  { a: -0.05, b: 38, f: 0.04, p: 2, amp: 5 }, { a: 0.18, b: 55, f: 0.07, p: 1, amp: 3 },
  { a: -0.5, b: 118, f: 0.05, p: 4, amp: 4 }, { a: 0.85, b: 4, f: 0.04, p: 3, amp: 4, vert: true }
];
function enrolProfile(creases, seedBase, nFrames) {
  const frames = [];
  for (let i = 0; i < nFrames; i++) {
    const roi = roiImage(creases, seedBase + i, { dx: (i % 3) - 1, dy: ((i + 1) % 3) - 1 });
    frames.push({ openness: 2.0, code: B.palmprintEncode(roi, S, S), roi: roi, sharpness: 100 + i * 10 });
  }
  return { v: 4, format: B.PALMPRINT_FORMAT, codes: B.selectPalmprintProfileCodes(frames) };
}

/* ---------------- 1. enrol pacing / yield wiring --------------- */
function enrolChecks() {
  const eStart = appSrc.indexOf('function streamEnrolPalm');
  const enrol = appSrc.slice(eStart, appSrc.indexOf('function fieldExhaustiveOn', eStart));
  check('PACE the enrol stream paces grabs to the camera clock (waitFreshFrame, ~100 ms of stream time)',
    enrol.indexOf('function waitFreshFrame()') !== -1 && enrol.indexOf('var target = lastGrabT + 0.1;') !== -1 &&
    // v57 pin update (named): the poll line gained the backward-clock
    // acceptance (a replaced stream restarts currentTime) — the pacing
    // discipline itself is unchanged. The v57 suite pins all three loops.
    enrol.indexOf('if (video.currentTime >= target || video.currentTime < lastGrabT - 0.05 || Date.now() > deadline) return Promise.resolve();') !== -1);
  check('PACE watchStep routes every grab through the pacing wait',
    enrol.indexOf('return waitFreshFrame().then(function () {') !== -1 &&
    enrol.indexOf('lastGrabT = video.currentTime;') !== -1);
  check('YIELD one macrotask yield ends every analysed watch frame (the anti-starvation discipline)',
    enrol.indexOf('function yieldToUi() { return waitMs(0); }') !== -1 &&
    enrol.indexOf("return yieldToUi().then(function () { return qualifies ? 'qualify' : null; });") !== -1);
  check('PACE the camera swap resets the pacing clock (the new stream starts fresh)',
    (enrol.match(/lastGrabT = -1;/g) || []).length >= 2);
  check('BOUND the 180 s watch deadline and its honest timeout outcome are intact',
    enrol.indexOf('var deadline = t0 + 180000;') !== -1 && enrol.indexOf("return Promise.resolve('timeout');") !== -1 &&
    enrol.indexOf('return out({ timedOut: true, hint: lastHint });') !== -1);
  check('YIELD burst analysis paints between frames (yieldForPaint in the per-frame chain)',
    enrol.indexOf('function yieldForPaint()') !== -1 &&
    enrol.indexOf('}).then(function () { return yieldForPaint(); }); // v50: paint between burst frames') !== -1);
  check('PROGRESS the burst analysis has an honest progress status (no more frozen "capturing")',
    enrol.indexOf("'Palm captured — analysing the burst, hold on...'") !== -1);
  check('CANCEL a cancel landing during the burst or its analysis ends the capture as stopped',
    enrol.indexOf('return recordBurst().then(function (burstFrames) {') !== -1 &&
    enrol.indexOf('if (control && control.cancelled) { var o = out(); o.stopped = true; return o; }') !== -1 &&
    enrol.indexOf('if (control && control.cancelled) { var o2 = out(); o2.stopped = true; return o2; }') !== -1);
  check('STATUS the watch hint is written only on change (showHint)',
    enrol.indexOf('function showHint()') !== -1 && enrol.indexOf('lastHint !== shownHint') !== -1 &&
    enrol.indexOf('if (statusEl) statusEl.textContent = lastHint;') === -1);
  check('GATES UNCHANGED the qualify rule, quality gate and spoof sampling are the v49 lines',
    enrol.indexOf('var qualifies = !!(r.roi && hasHand && r.openness >= B.PALM_OPEN_MIN && gate && gate.pass && r.code && B.palmprintCodeSane(r.code));') !== -1 &&
    enrol.indexOf('if (watchFrames % 2 === 1) tracker.add(frame, r.lm);') !== -1 &&
    enrol.indexOf("if (res === 'qualify') { streak++; if (streak >= 2) return 'burst'; }") !== -1);
}

/* ---------------- 2. busy-flag recovery ------------------------ */
function busyChecks() {
  const rStart = appSrc.indexOf('function runPalmCapture()');
  const runCap = appSrc.slice(rStart, appSrc.indexOf("$('palmCapture').addEventListener", rStart));
  check('BUSY runPalmCapture releases the busy flag on resolve AND on reject',
    (runCap.match(/palmScanBusy = false;/g) || []).length >= 2 &&
    runCap.indexOf('}).catch(function (e) {') !== -1);
  check('BUSY the Capture button is re-enabled on the stopped, failure and reject paths',
    (runCap.match(/\$\('palmCapture'\)\.disabled = false;/g) || []).length >= 3);
  check('BUSY a stopped capture is a first-class outcome in runPalmCapture',
    runCap.indexOf('if (res.stopped) {') !== -1);
  check('BUSY navigation cancels the enrol capture (go() wiring intact)',
    appSrc.indexOf("if (page !== 'enroll' && enrollControl) enrollControl.cancelled = true;") !== -1);
  const tStart = appSrc.indexOf('function runTopupCapture()');
  const topCap = appSrc.slice(tStart, appSrc.indexOf('function neuralCandidateRois', tStart) > 0 ? appSrc.indexOf('function neuralCandidateRois', tStart) : tStart + 4000);
  check('BUSY the topup capture (same stream) releases both busy flags in its handler',
    topCap.indexOf('topupBusy = false; palmScanBusy = false;') !== -1 && topCap.indexOf('if (res.stopped) {') !== -1);
}

/* ---------------- 3. write-on-change + scratch reuse ----------- */
function writeChecks() {
  check('WRITE both paced streams route loop status through a change-only setStatus',
    (appSrc.match(/function setStatus\(txt\)/g) || []).length === 2 &&
    appSrc.indexOf("setStatus(guide || (seenHandNow ? 'Hand detected — hold steady.' : 'Show & Pay scanning — show an open hand to the camera.'));") !== -1 &&
    appSrc.indexOf("setStatus(guide || (seenHandNow ? 'Hand detected — hold steady.' : 'Show an open hand to the camera.'));") !== -1);
  check('WRITE no unconditional per-frame guidance write remains in either stream',
    appSrc.indexOf('statusEl.textContent = guide') === -1);
  check('SCRATCH palmFrameMeasures reuses one scratch canvas instead of allocating per frame',
    appSrc.indexOf('var measuresScratch = null;') !== -1 && appSrc.indexOf('measuresScratch.width = size; measuresScratch.height = size;') !== -1 &&
    appSrc.indexOf('var canvas = document.createElement(\'canvas\'); canvas.width = size; canvas.height = size;') === -1);
}

/* ---------------- 4. score parity (performance-only proof) ----- */
function parityChecks() {
  check('CONSTANTS every decision constant is at its v49 value',
    B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895 &&
    B.MONEY_MARGIN_EDCC === 0.10 && B.MONEY_MARGIN_NEURAL === 0.15 &&
    B.SCAN_TIME_BUDGET_MS === 6000 && B.PALM_OPEN_MIN > 0);
  const profileA = enrolProfile(PALM_A, 61, 15);
  const liveA = roiImage(PALM_A, 71, { dx: 1, dy: -1 });
  const liveB = roiImage(PALM_B, 81);
  const fastA = B.verifyPalmprintRoisFast(profileA, [liveA]);
  const fastB = B.verifyPalmprintRoisFast(profileA, [liveB]);
  check('PARITY fast verify genuine reproduces the v49 fixture score (0.523) and verdict',
    fastA.verified === true && Math.abs(fastA.similarity - 0.523) < 0.001, 'sim=' + fastA.similarity);
  check('PARITY fast verify impostor reproduces the v49 fixture score (0.081) and verdict',
    fastB.verified === false && Math.abs(fastB.similarity - 0.081) < 0.001, 'sim=' + fastB.similarity);
  const exactA = B.verifyPalmprintRois(profileA, [liveA]);
  const exactB = B.verifyPalmprintRois(profileA, [liveB]);
  check('PARITY exact verify reproduces the v49 fixture scores (0.5227 / 0.0808) and verdicts',
    exactA.verified === true && Math.abs(exactA.similarity - 0.5227) < 0.001 &&
    exactB.verified === false && Math.abs(exactB.similarity - 0.0808) < 0.001,
    'genuine=' + exactA.similarity + ' impostor=' + exactB.similarity);
  const sel = B.selectPalmprintBurstCodes([
    { openness: 2.0, code: B.palmprintEncode(liveA, S, S), roi: liveA, sharpness: 300 },
    { openness: 2.0, code: B.palmprintEncode(roiImage(PALM_A, 72), S, S), roi: roiImage(PALM_A, 72), sharpness: 200 },
    { openness: 2.0, code: B.palmprintEncode(roiImage(PALM_A, 73), S, S), roi: roiImage(PALM_A, 73), sharpness: 100 }
  ]);
  check('PARITY burst banking selection still banks the burst templates',
    !!sel && Array.isArray(sel.codes) && sel.codes.length >= 1, sel ? sel.codes.length + ' codes' : 'null');
}

/* ---------------- 5. wallet-open correction -------------------- */
function walletChecks() {
  const strictSites = (appSrc.match(/\{ strictMoney: true \}\)/g) || []).length;
  check('WALLET exactly three strict-money call sites remain (terminal, Add Money, Send authorise)',
    strictSites === 3, 'found ' + strictSites);
  const woStart = appSrc.indexOf("$('walletOpenScan')");
  const woSlice = appSrc.slice(woStart, appSrc.indexOf('function openWalletForPerson', woStart));
  check('WALLET the 1:N wallet-open route is a plain identification (no strict flag)',
    woSlice.indexOf('streamIdentifyPalm') !== -1 && woSlice.indexOf('strictMoney') === -1);
  const owStart = appSrc.indexOf('function openWalletForPerson');
  const owSlice = appSrc.slice(owStart, appSrc.indexOf("$('wCloseWallet')", owStart));
  check('WALLET the 1:1 wallet-open route is a plain verify (no strict flag)',
    owSlice.indexOf('streamVerifyPalm') !== -1 && owSlice.indexOf('strictMoney') === -1);
  const addStart = appSrc.indexOf("$('wAddScan')");
  const addSlice = appSrc.slice(addStart, appSrc.indexOf('/* Send Money', addStart) > 0 ? appSrc.indexOf('/* Send Money', addStart) : addStart + 3000);
  check('WALLET Add Money still runs the strict rule',
    addSlice.indexOf('{ strictMoney: true }') !== -1);
}

/* ---------------- 6. versions + migration ---------------------- */
function versionChecks() {
  // v51: the three absolute pins below were converted to the
  // version-coherence form (the v48/v49 pattern) when v51
  // shipped — v50 remains IN the chain as an adoption step; the
  // living current-version pins are in v38-migration + the v51
  // suite. The v49->v50 adoption proof below is unchanged.
  const appVer = (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1];
  const shellVer = (swSrc.match(/tsg-biom-shell-(v\d+)/) || [])[1];
  check('VERSIONS app data version and shell version agree', !!appVer && appVer === shellVer, appVer + ' vs ' + shellVer);
  check('VERSIONS the agreed version is in the migration chain', B.BIOM_DATA_VERSIONS.indexOf(appVer) !== -1, appVer);
  check('MIGRATION v50 remains in the chain as an adoption step', B.BIOM_DATA_VERSIONS.indexOf('v50') !== -1);
  const store = {
    people: [{ id: 'TSG-BIO-1', name: 'Rig', wallet: { balance: 450, statement: [{ kind: 'add', amount: 450 }], linkedAccounts: [{ id: 'a1' }] }, palmProfile: { v: 4, format: 'packed96', codes: ['QUJD'], neural: { v: 1, dim: 256, model: 'palmnet-v1', embeddings: ['QUJD'] } } }],
    logs: [{ ts: 1 }], transactions: [{ id: 'BIOM-PAY-1' }], meta: []
  };
  const before = JSON.stringify(store);
  const mig = B.migrateBiomData(store, 'v49', 'v50');
  check('MIGRATION v49->v50 is a pure adoption (wallet + neural store byte-identical)',
    mig.appliedSteps.join(',') === 'v50' && mig.changed === false && JSON.stringify(mig.snapshot) === before);
}

Promise.resolve()
  .then(enrolChecks).then(busyChecks).then(writeChecks).then(parityChecks).then(walletChecks).then(versionChecks)
  .then(function () {
    console.log(fail === 0 ? 'ALL v50 SMOOTHNESS TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(function (e) { console.log('SUITE ERROR: ' + (e && e.stack || e)); process.exit(1); });
