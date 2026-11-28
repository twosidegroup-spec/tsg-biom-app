/* TSG BIOM v83 — MERCHANT SCAN TAIL FIX (the Chairman's order,
   2026-11-27 23:22: "Merchant এর ওই জিনিসটা ঠিক করো, যেটা তুমি
   বলছো এখনো করো নাই" — the work the v82 report flagged as NOT
   done and beyond its ordered scope).

   The v82 tail analysis decomposed the merchant money-auth
   tail (phone: 2,034 / 2,326 / 2,365 ms against the ≤1.5 s
   bar) into (1) a pre-warm completion race on the first scan
   after a reopen, (2) camera exposure settling on a fresh
   surface, and (3) strict-win frame-count variance. v83
   closes (1) and the timed-span part of (2):

   WARM SIGNAL: the v67 deep pre-warm was fire-and-forget.
     Its two legs (the detector dummy-landmarks chain and the
     PalmNet dummy embed) are now captured, and
     Pipeline.whenWarm() resolves with the settled state.
     'ready' requires the detector leg to have genuinely run
     (the chain's own continuation reads everResulted +
     lastCallFailed); a PalmNet failure rides warmDetail and
     does NOT fail the gate (the v47 EDCC-only fail-soft is
     the designed behaviour for a dead neural runtime).
     retryWarm re-runs a failed warm-up; failures are never
     cached. The dummy calls themselves are the v67 calls,
     byte-for-byte — dummy inputs only, nothing recorded,
     matched, logged or stored, and Research.tapFrame is
     never touched by the warm path.

   TERMINAL ARM: the camera already started at view entry
     (v58); the armed display is now warm-aware. Warm = the
     v58 armed state. Warming = SCAN held + a getting-ready
     status, flipping to armed when the signal settles.
     Failed = SCAN held + the detector's own wording
     (DETECTOR_FAIL_MSG); Start Camera retries the warm-up.

   WARM GATE (terminal + wallet money-auth): the timed run
     begins when the pipeline reports warm. The pill and the
     v74 timer start at the gate; everything the v74 span
     covered after that point (blocked-ID await, registry
     lookup, stream, verdict) is inside the span exactly as
     before, and on a warm pipeline the gate resolves in a
     microtask so the span IS the v74 span. A warm-up failure
     ends the invocation fail-closed with DETECTOR_FAIL_MSG —
     no scan run, nothing verified or authorised, no record.
     Enrolment and top-up scan starts are deliberately NOT
     gated (their spans are the registration band's, v82).

   Frozen, untouched: EDCC 0.32, PalmNet 0.5895, the strict
   money rule, the banking guard, the enrolment quality
   gates, the block system, the v81 consent rules (no frame
   is captured, tapped or collected before a scan starts;
   the held terminal preview analyses nothing, as at v58).

   All timing evidence lives in the v83 report and is RIG
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

/* ---------------- version coherence ---------------- */
check('VERSION app, shell, meta stamp, user-visible line and chain agree at v95',
  (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1] === 'v95' &&
  swSrc.indexOf("CACHE = 'tsg-biom-shell-v95'") !== -1 &&
  htmlSrc.indexOf('<meta name="biom-build" content="v95">') !== -1 &&
  htmlSrc.indexOf('TSG Biom · App v95 · TwoSide Group') !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === 'v95' &&
  B.BIOM_DATA_VERSIONS.length === 59);

/* ---------------- migration: v83 is a pure adoption ---------------- */
check('MIGRATION the v83 step is a pure adoption: a v82 store opens byte-identical at v83', (function () {
  const before = JSON.stringify({ people: [{ id: 'TSG-BIO-1', name: 'Gate', wallet: { balance: 5, statement: [], linkedAccounts: [] } }], logs: [], transactions: [], meta: [{ k: 'syncBlockedIds', v: 1 }] });
  const mig = B.migrateBiomData(JSON.parse(before), 'v82', 'v83');
  return mig.appliedSteps.join(',') === 'v83' && mig.changed === false && JSON.stringify(mig.snapshot) === before;
})());
check('MIGRATION the v83 step is declared a pure adoption in biometrics.js',
  bioSrc.indexOf("'v83': function (snap) { return snap; }") !== -1);

/* ---------------- frozen bars ---------------- */
check('FREEZE the shipped bars are untouched (EDCC 0.32 / PalmNet 0.5895) and the strict money margins stand',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895 &&
  B.MONEY_MARGIN_EDCC === 0.10 && B.MONEY_MARGIN_NEURAL === 0.15);

/* ---------------- the warm signal ---------------- */
const prewarm = sliceBetween(appSrc, 'function prewarmPalmPipeline()', 'function liveFacingMode()');
check('WARM the Pipeline exposes the readiness signal (whenWarm / warmState / warmDetail / retryWarm)',
  appSrc.indexOf('whenWarm: function ()') !== -1 &&
  appSrc.indexOf('warmState: function () { return palmWarmState; }') !== -1 &&
  appSrc.indexOf('warmDetail: function () { return palmWarmDetail; }') !== -1 &&
  appSrc.indexOf('retryWarm: function ()') !== -1);
check('WARM the detector leg is the v67 dummy chain, captured: two sequential landmarks calls with the verdict read in its own continuation',
  prewarm.indexOf('detChain = PalmProc.landmarks(dc).then(function () { return PalmProc.landmarks(dc); })') !== -1 &&
  prewarm.indexOf('detOk = !!(PalmProc.everResulted() && !PalmProc.lastCallFailed());') !== -1);
check('WARM the PalmNet leg is the v67 dummy embed, captured (init then embedPair on the flat dummy ROI)',
  prewarm.indexOf('netLeg = PalmNet.init().then(function (ok) {') !== -1 &&
  prewarm.indexOf('return PalmNet.embedPair(dummyRoi);') !== -1 &&
  prewarm.indexOf('netOk = !!pair;') !== -1);
check('WARM the promise settles ready only on the detector leg; the PalmNet outcome rides the detail, never the state',
  prewarm.indexOf('palmWarmPromise = Promise.all([detChain, netLeg]).then(function () {') !== -1 &&
  prewarm.indexOf('palmWarmDetail = { detectorOk: detOk, palmnetOk: netOk };') !== -1 &&
  prewarm.indexOf("palmWarmState = detOk ? 'ready' : 'failed';") !== -1);
check('WARM the dummy inputs are unchanged (flat-grey canvases, 128-filled ROI) and the warm path touches no research tap',
  prewarm.indexOf("ctx.fillStyle = '#888888'") !== -1 &&
  prewarm.indexOf("dctx.fillStyle = '#7a7a7a'") !== -1 &&
  prewarm.indexOf('dummyRoi[di] = 128') !== -1 &&
  prewarm.indexOf('Research.') === -1);
check('WARM PalmProc exposes the everResulted evidence the gate reads',
  appSrc.indexOf('everResulted: function () { return this._everResulted; }') !== -1);
check('WARM a failed warm-up is retried, never cached (retryWarm acts only on the failed state and re-runs the pre-warm)',
  appSrc.indexOf("if (palmWarmState !== 'failed') return;") !== -1 &&
  appSrc.indexOf('palmPrewarmStarted = false;') !== -1);

/* ---------------- terminal arm: warm-aware ---------------- */
const termStart = sliceBetween(appSrc, 'function startTermCamera()', "$('termStart').addEventListener");
check('ARM arming the terminal retries a failed warm-up',
  termStart.indexOf('Pipeline.retryWarm();') !== -1 &&
  termStart.indexOf('Pipeline.retryWarm();') < termStart.indexOf('getTerminalPerson()'));
check('ARM the warm arm is the v58 armed state, byte-identical copy, SCAN enabled',
  termStart.indexOf("if (warmNow === 'ready') {") !== -1 &&
  termStart.indexOf("$('termScan').disabled = false;") !== -1 &&
  termStart.indexOf('Camera on — the customer positions an open palm in the frame, anywhere in view, then tap SCAN.') !== -1);
check('ARM the warming arm holds SCAN and says the scanner is getting ready',
  termStart.indexOf("$('termScan').disabled = true;") !== -1 &&
  termStart.indexOf('Camera on — the scanner is getting ready, just a moment…') !== -1 &&
  termStart.indexOf('Pipeline.whenWarm().then(function () {') !== -1);
check('ARM the failed arm holds SCAN and shows the detector wording honestly',
  /* wording updated by the v83 verification pass under app-seat
     review 2 fix F3b: the status now names the real retry
     action (Start Camera), since SCAN stays held.
     Wording updated again by the v83 board fixes (2026-11-28,
     Design seat FIX-C): the two failed-arm sites now carry
     DETECTOR_FAIL_ARM_MSG, which keeps the same facts and ends
     with the Start Camera instruction — DETECTOR_FAIL_MSG's
     "try the scan again" contradicts the held arm. The intent
     is unchanged (failed arm holds SCAN + honest detector
     wording); DETECTOR_FAIL_MSG itself is untouched and still
     used at the scan-time sites, so it must NOT appear here. */
  termStart.indexOf("status.textContent = 'Scanner not ready — tap Start Camera to try again.';") !== -1 &&
  termStart.indexOf("'<div class=\"error\">' + DETECTOR_FAIL_ARM_MSG + '</div>'") !== -1 &&
  termStart.indexOf('DETECTOR_FAIL_MSG') === -1);
check('ARM the settle continuation stands down when the view, a scan or the camera has moved on',
  termStart.indexOf("if (!$('page-terminal').classList.contains('active')) return;") !== -1 &&
  termStart.indexOf('if (palmScanBusy || termScanClaim) return;') !== -1 &&
  termStart.indexOf("if (!(Cam.stream && Cam.video === $('termVideo'))) return;") !== -1);
check('ARM arming still starts no scan (v58 discipline kept)',
  termStart.indexOf('runTermScan(') === -1);

/* ---------------- terminal gate ---------------- */
const termScan = sliceBetween(appSrc, 'function runTermScan()', "$('termScan').addEventListener");
check('GATE the invocation control exists from the tap and is the live termControl before the gate',
  termScan.indexOf('var control = { cancelled: false, onFrame:') !== -1 &&
  termScan.indexOf('termControl = control;') !== -1 &&
  termScan.indexOf('termControl = control;') < termScan.indexOf('Pipeline.whenWarm()'));
check('GATE the timed run starts at the gate: timer after whenWarm, before the registry lookup, exactly one terminal timer start',
  termScan.indexOf('Pipeline.whenWarm()') < termScan.indexOf("scanTimerStart('t', 'Scanned in ')") &&
  termScan.indexOf("scanTimerStart('t', 'Scanned in ')") < termScan.indexOf("DB.get('people', personId)") &&
  (termScan.match(/scanTimerStart\('t'/g) || []).length === 1);
check('GATE a not-ready tap shows the getting-ready notice before the gate',
  /* notice wording updated by the v83 board fixes (2026-11-28,
     Product Manager seat FIX-D): plain wording aligned to the
     arm state — no "palm engine", no "warm" as an
     operator-facing state. Intent unchanged: a not-ready tap
     shows the getting-ready notice before the gate. */
  termScan.indexOf("if (Pipeline.warmState() !== 'ready') {") !== -1 &&
  termScan.indexOf('Getting the scanner ready, just a moment — the scan will start as soon as the scanner is ready…') !== -1);
check('GATE warm failure ends the invocation fail-closed with the detector wording, and kicks the background retry',
  termScan.indexOf("if (warm !== 'ready') {") !== -1 &&
  termScan.indexOf("'<div class=\"error\">' + DETECTOR_FAIL_MSG + '</div>'") !== -1 &&
  termScan.indexOf('Pipeline.retryWarm();') !== -1 &&
  termScan.indexOf('if (gateEnded) return null;') !== -1);
check('GATE a cancel during the warm wait ends the invocation through the same gateEnded path',
  termScan.indexOf('if (control.cancelled) { gateEnded = true; return null; }') !== -1);
check('GATE the gated chain keeps the v79 blocked-ID await ahead of the lookup and the v82 peopleReady stream call',
  termScan.indexOf('return Sync.ensureBlockedIds();') !== -1 &&
  termScan.indexOf("streamVerifyPalm($('termVideo'), $('termStatus'), person, [], null, fieldRec, control, { strictMoney: true, peopleReady: termPeopleReady })") !== -1);

/* ---------------- wallet gate ---------------- */
const walletRun = sliceBetween(appSrc, 'function runWalletScan()', 'function hideWalletScan()');
check('WGATE the wallet money-auth start carries the identical gate: timer after whenWarm, before the flow run, exactly one wallet timer start in the scan',
  walletRun.indexOf('Pipeline.whenWarm()') !== -1 &&
  walletRun.indexOf('Pipeline.whenWarm()') < walletRun.indexOf("scanTimerStart('w', 'Scanned in ')") &&
  walletRun.indexOf("scanTimerStart('w', 'Scanned in ')") < walletRun.indexOf('return ctx.run();') &&
  (walletRun.match(/scanTimerStart\('w'/g) || []).length === 1);
check('WGATE a not-ready wallet tap shows the getting-ready status',
  walletRun.indexOf("if (Pipeline.warmState() !== 'ready') $('wScanStatus').textContent = 'Getting the scanner ready…';") !== -1);
check('WGATE wallet warm failure fails closed through the card failure path with the detector wording + detector cause, and kicks the retry',
  walletRun.indexOf('walletScanFailed({ fail: DETECTOR_FAIL_MSG, detectorFailed: true })') !== -1 &&
  walletRun.indexOf('Pipeline.retryWarm();') !== -1);
check('WGATE a cancel during the wallet warm wait returns without running the flow',
  /* branch extended by the v83 verification pass under app-seat
     review 2 fix F2: the cancel now also restores the armed
     card state (Scan re-enabled, armed status) — the bare
     return wedged an open card. Still returns null; the flow
     still never runs. */
  walletRun.indexOf('if (walletControl.cancelled) {') !== -1 &&
  walletRun.indexOf("$('wScanRun').disabled = false;") !== -1 &&
  walletRun.indexOf('return null; }') !== -1);

/* ---------------- deliberate non-changes ---------------- */
check('SCOPE the warm gate exists at exactly three call sites (terminal arm continuation, terminal gate, wallet gate) plus its definition',
  (appSrc.match(/Pipeline\.whenWarm\(\)/g) || []).length === 3 &&
  (appSrc.match(/whenWarm: function/g) || []).length === 1);
check('SCOPE enrolment and top-up scan starts are NOT gated (their spans are the registration band, v82)',
  sliceBetween(appSrc, 'function runPalmCapture()', 'function renderTermPeople()').indexOf('whenWarm') === -1 &&
  sliceBetween(appSrc, 'function runTopupCapture()', 'function openReregConfirm()').indexOf('whenWarm') === -1);

console.log(fail === 0 ? 'ALL v83 MERCHANT-TAIL TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
process.exit(fail === 0 ? 0 : 1);
