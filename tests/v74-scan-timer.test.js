/* TSG BIOM v74 — ON-SCREEN SCAN TIMER (Chairman's order,
   2026-11-26: "add a timer so that I can understand how much
   time needed for the system to scan or detect registered palm
   or how much time needed for a registration").

   The timer factory is extracted verbatim from app.js (the
   SCAN-TIMER markers) and driven over a fake monotonic clock
   and fake interval timers: start/stop/freeze/reset semantics,
   the 100 ms tick cadence, and the honesty rule — the display
   is the true elapsed in tenths (nearest tenth via toFixed,
   never floored, never cached between scans). Wiring is pinned
   by source checks: all four surfaces start their timer at the
   scan tap and stop it at the verdict, the wallet successes
   that close the scan card state the same measured time in the
   message they already show, and the enrolment completion
   screen states the palm-capture time. The v74 migration step
   is a pure adoption. Frozen bars re-pinned. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../biometrics.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  [' + detail + ']' : '')); }
}

const root = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
function sliceBetween(src, a, b) {
  const i = src.indexOf(a);
  const j = b ? src.indexOf(b, i + a.length) : src.length;
  return i === -1 ? '' : src.slice(i, j === -1 ? src.length : j);
}

/* ================= the factory, extracted verbatim ============ */
const timerSrc = sliceBetween(appSrc, '/* SCAN-TIMER-BEGIN', '/* SCAN-TIMER-END */');
check('TIMER factory block exists between the SCAN-TIMER markers', timerSrc.indexOf('function createScanTimer') !== -1);
check('TIMER factory clock is performance.now (monotonic), never Date.now',
  timerSrc.indexOf('performance.now()') !== -1 && timerSrc.indexOf('Date.now') === -1);
const createScanTimer = new Function(timerSrc + '\nreturn createScanTimer;')();

function fakeDeps() {
  const d = { t: 100000, tickFn: null, tickMs: null, cleared: [], nextId: 7 };
  d.now = function () { return d.t; };
  d.setInterval = function (fn, ms) { d.tickFn = fn; d.tickMs = ms; return d.nextId; };
  d.clearInterval = function (id) { d.cleared.push(id); };
  return d;
}

/* ================= start / tick / display ===================== */
(function () {
  const d = fakeDeps();
  const tm = createScanTimer(d);
  const el = { textContent: '' };
  tm.bind(el);
  check('TIMER idle before start: elapsed 0.0s, not running, hasRun false',
    tm.elapsedText() === '0.0s' && tm.running() === false && tm.hasRun() === false);
  check('TIMER stop before start is a no-op returning 0', tm.stop() === 0);
  tm.start('Scanned in ');
  check('TIMER start paints 0.0s at once and registers a 100 ms tick',
    el.textContent === '0.0s' && d.tickMs === 100 && tm.TICK_MS === 100 && tm.running() === true);
  d.t += 1000; d.tickFn();
  check('TIMER tick at 1000 ms shows 1.0s', el.textContent === '1.0s', el.textContent);
  d.t += 849; d.tickFn();
  check('TIMER tick at 1849 ms shows 1.8s', el.textContent === '1.8s', el.textContent);
  check('TIMER elapsedText at 1999 ms is 2.0s — nearest tenth of the true value, never floored',
    (function () { d.t += 150; return tm.elapsedText() === '2.0s'; })(), tm.elapsedText());
})();

/* ================= stop freezes the verdict total ============= */
(function () {
  const d = fakeDeps();
  const tm = createScanTimer(d);
  const el = { textContent: '' };
  tm.bind(el);
  tm.start('Scanned in ');
  d.t += 1800;
  const frozen = tm.stop();
  check('TIMER stop returns the true elapsed (1800 ms) and writes the verdict line',
    frozen === 1800 && el.textContent === 'Scanned in 1.8s', el.textContent);
  check('TIMER stop clears the tick interval', d.cleared.indexOf(d.nextId) !== -1 && tm.running() === false);
  d.t += 60000; if (d.tickFn) d.tickFn();
  check('TIMER a stray tick after stop cannot move the frozen total',
    el.textContent === 'Scanned in 1.8s' && tm.elapsedText() === '1.8s');
  check('TIMER stop is idempotent — the same frozen value, never re-measured',
    tm.stop() === 1800 && el.textContent === 'Scanned in 1.8s');
  check('TIMER capture surfaces label their total Captured in',
    (function () {
      const d2 = fakeDeps(); const tm2 = createScanTimer(d2); const el2 = { textContent: '' };
      tm2.bind(el2); tm2.start('Captured in '); d2.t += 2400; tm2.stop();
      return el2.textContent === 'Captured in 2.4s';
    })(), el.textContent);
})();

/* ================= reset / restart ============================ */
(function () {
  const d = fakeDeps();
  const tm = createScanTimer(d);
  const el = { textContent: '' };
  tm.bind(el);
  tm.start('Scanned in ');
  d.t += 3200; tm.stop();
  tm.reset();
  check('TIMER reset blanks the readout and clears hasRun (a fresh card shows no stale time)',
    el.textContent === '' && tm.hasRun() === false && tm.elapsedText() === '0.0s');
  tm.start('Scanned in ');
  d.t += 500; d.tickFn();
  check('TIMER a restarted timer measures the NEW scan from zero (no cached value)',
    el.textContent === '0.5s' && tm.elapsedMs() === 500, el.textContent);
})();

/* ================= wiring: HTML + CSS ========================= */
['w', 'e', 't', 'u'].forEach(function (p) {
  check('WIRE index.html carries the ' + p + ' timer readout inside its scan pill',
    html.indexOf('id="' + p + 'ScanTimer"') !== -1 && html.indexOf('id="' + p + 'ScanPill"') !== -1);
});
check('WIRE the readout style uses tabular numerals and hides when empty',
  css.indexOf('.scantimer') !== -1 && css.indexOf('tabular-nums') !== -1 && css.indexOf('.scantimer:empty') !== -1);

/* ================= wiring: the four surfaces ================== */
const walletRun = sliceBetween(appSrc, 'function runWalletScan()', 'function hideWalletScan()');
check('WIRE wallet scan starts its timer at the Scan tap and stops it when the flow settles',
  walletRun.indexOf("scanTimerStart('w', 'Scanned in ')") !== -1 && walletRun.indexOf("scanTimerStop('w')") !== -1);
check('WIRE opening the wallet scan card resets the timer (no stale total)',
  sliceBetween(appSrc, 'function showWalletScan(ctx)', 'function startWalletCamera()').indexOf("scanTimerReset('w')") !== -1);
check('WIRE closing the wallet scan card stops any still-ticking timer',
  sliceBetween(appSrc, 'function hideWalletScan()', '/* SCAN-TIMER-BEGIN').indexOf("scanTimerStop('w')") !== -1);
check('WIRE the four wallet successes that close the card state the measured scan time in their result (v90: the two Send successes left with the Send flow)',
  (appSrc.match(/ScanTimers\.w\.elapsedText\(\)/g) || []).length >= 4,
  'elapsedText sites=' + (appSrc.match(/ScanTimers\.w\.elapsedText\(\)/g) || []).length);
const termRun = sliceBetween(appSrc, 'function runTermScan()', "$('termScan').addEventListener");
check('WIRE terminal starts its timer as streaming begins and stops it at the verdict (plus the settle backstop)',
  termRun.indexOf("scanTimerStart('t', 'Scanned in ')") !== -1 && (termRun.match(/scanTimerStop\('t'\)/g) || []).length >= 2);
check('WIRE terminal Next Customer and person change reset the timer',
  (appSrc.match(/scanTimerReset\('t'\)/g) || []).length >= 2);
const enrolRun = sliceBetween(appSrc, 'function runPalmCapture()', 'function maybeArmTerminal');
check('WIRE enrolment capture starts its timer at the Scan Palm tap and stops it when the capture outcome is known (and on failure)',
  enrolRun.indexOf("scanTimerStart('e', 'Captured in ')") !== -1 && (enrolRun.match(/scanTimerStop\('e'\)/g) || []).length >= 2);
const topupRun = sliceBetween(appSrc, 'function runTopupCapture()', '/* ---------------- Demo wallet');
check('WIRE Add Angles capture starts its timer at the guided-capture tap and stops it at the capture outcome (and on failure)',
  topupRun.indexOf("scanTimerStart('u', 'Captured in ')") !== -1 && (topupRun.match(/scanTimerStop\('u'\)/g) || []).length >= 2);
check('WIRE the enrolment completion screen states the palm-capture time, guarded to a capture that ran',
  appSrc.indexOf('Palm capture time:') !== -1 && appSrc.indexOf('ScanTimers.e.hasRun()') !== -1);
check('WIRE leaving a scan view stops its timer (no tick left running on a hidden page)',
  appSrc.indexOf("if (page !== 'topup') scanTimerStop('u');") !== -1 && appSrc.indexOf("if (page !== 'terminal') scanTimerStop('t');") !== -1);

/* ============ scope extension: durations on the records ====== */
const durFnSrc = sliceBetween(appSrc, 'function scanDurationForKind', '\n  /* SCAN-GUIDANCE-BEGIN');
check('STAMP scanDurationForKind exists (the noteScan duration source)', durFnSrc.indexOf('function scanDurationForKind') !== -1);
(function () {
  /* One SHARED fake clock for all four timers — in the app all
     timers read the same performance.now() timeline, and the
     recency comparison is only meaningful on one timeline. */
  const clock = { t: 100000 };
  const sharedDeps = {
    now: function () { return clock.t; },
    setInterval: function () { return 1; },
    clearInterval: function () {}
  };
  const timers = { w: createScanTimer(sharedDeps), e: createScanTimer(sharedDeps), t: createScanTimer(sharedDeps), u: createScanTimer(sharedDeps) };
  const scanDurationForKind = new Function('ScanTimers', durFnSrc + '\nreturn scanDurationForKind;')(timers);
  check('STAMP no timer has run: every kind stamps null (unmeasured, never estimated)',
    scanDurationForKind('enrol') === null && scanDurationForKind('verify') === null && scanDurationForKind('money-auth') === null);
  timers.e.start('Captured in '); clock.t += 2400; timers.e.stop();
  check('STAMP enrol stamps the enrol timer\u2019s frozen total', scanDurationForKind('enrol') === 2400);
  timers.u.start('Captured in '); clock.t += 1300; timers.u.stop();
  check('STAMP topup and re-register stamp the Palm Identity timer', scanDurationForKind('topup') === 1300 && scanDurationForKind('re-register') === 1300);
  timers.w.start('Scanned in '); clock.t += 1750;
  check('STAMP a running wallet scan stamps verify/money-auth/identify live', scanDurationForKind('verify') === 1750 && scanDurationForKind('money-auth') === 1750 && scanDurationForKind('identify') === 1750);
  check('STAMP owner-unlock stamps the wallet timer', scanDurationForKind('owner-unlock') === 1750);
  timers.w.stop(); clock.t += 50;
  timers.t.start('Scanned in '); clock.t += 900;
  check('STAMP a running terminal scan wins over the wallet\u2019s older frozen total', scanDurationForKind('verify') === 900);
  check('STAMP field-test stamps the terminal timer', scanDurationForKind('field-test') === 900);
  timers.t.stop(); clock.t += 5000;
  check('STAMP after both stop, the most recently stopped surface wins', scanDurationForKind('verify') === 900);
})();
check('STAMP noteScan stamps via the optional scanDurationMs dep (caller value wins, rigs without the dep untouched)',
  appSrc.indexOf("typeof deps.scanDurationMs === 'function'") !== -1 &&
  appSrc.indexOf('fields.durationMs === undefined') !== -1 &&
  appSrc.indexOf('scanDurationMs: function (kind) { return scanDurationForKind(kind); }') !== -1);
check('STAMP B.syncScanRecord carries a measured durationMs and omits an unmeasured one',
  (function () {
    const withD = B.syncScanRecord({ kind: 'verify', profileName: 'A', biomId: 'B1', durationMs: 1712.4, result: 'Verified' });
    const without = B.syncScanRecord({ kind: 'verify', profileName: 'A', biomId: 'B1', result: 'Verified' });
    const bad = B.syncScanRecord({ kind: 'verify', profileName: 'A', biomId: 'B1', durationMs: -3, result: 'Verified' });
    return withD.durationMs === 1712.4 && !('durationMs' in without) && !('durationMs' in bad);
  })());
check('STAMP B.syncProfileRecord carries the phone only when the person has one',
  (function () {
    const prof = { v: 4, codes: ['QUJD'], hand: 'left' };
    const withP = B.syncProfileRecord({ id: 'B1', name: 'A', phone: '01933038706', palmProfile: prof }, 123);
    const without = B.syncProfileRecord({ id: 'B1', name: 'A', palmProfile: prof }, 123);
    return withP.phone === '01933038706' && !('phone' in without);
  })());
check('STAMP the re-registration captures are timed on the Palm Identity surface (start at step 1, stop on fail and on success)',
  appSrc.indexOf("scanTimerStart('u', 'Captured in ')") !== -1 &&
  sliceBetween(appSrc, 'function reregFail', 'function runReRegistration').indexOf("scanTimerStop('u')") !== -1 &&
  sliceBetween(appSrc, 'function bankReRegistration', 'function wireRereg').indexOf("scanTimerStop('u')") !== -1);

/* ============ seat-fix regressions (Seats 1 + 3) ============= */
(function () {
  const termScan = sliceBetween(appSrc, 'function runTermScan', 'function wireTerminal');
  /* v83 pin advance (named): the terminal timer no longer
     starts literally at the tap — it starts at the warm gate
     (Pipeline.whenWarm), the Chairman's merchant-tail order
     of 2026-11-27: a tap on a not-yet-warm pipeline waits
     OUTSIDE the measured span, so leftover warm-up can no
     longer be stamped into durationMs. The invariant this
     check exists for is unchanged — the registry lookup the
     span must cover (DB.get by id) still begins after the
     timer starts, and the no-scan exits still reset it. (The
     DB.all('people') line at the head is the v82 concurrent
     tail load, outside the span by its own design.) */
  check('SEATFIX terminal timer starts at the warm gate (before the registry lookup), and the no-scan exits reset it',
    termScan.indexOf("scanTimerStart('t', 'Scanned in ')") !== -1 &&
    termScan.indexOf('Pipeline.whenWarm()') !== -1 &&
    termScan.indexOf('Pipeline.whenWarm()') < termScan.indexOf("scanTimerStart('t', 'Scanned in ')") &&
    termScan.indexOf("scanTimerStart('t', 'Scanned in ')") < termScan.indexOf("DB.get('people', personId)") &&
    (termScan.match(/scanTimerReset\('t'\)/g) || []).length >= 3);
  check('SEATFIX terminal tap races closed: a per-invocation claim token is taken synchronously before the timer starts, held to that invocation\u2019s settle, and the settle acts only on its own token',
    termScan.indexOf('if (termScanClaim || palmScanBusy) return;') !== -1 &&
    termScan.indexOf('if (termScanClaim || palmScanBusy) return;') < termScan.indexOf("scanTimerStart('t', 'Scanned in ')") &&
    termScan.indexOf('var myClaim = {};') !== -1 &&
    termScan.indexOf('if (termScanClaim === myClaim)') !== -1 &&
    (termScan.match(/releaseClaim\(\)/g) || []).length >= 3 &&
    appSrc.indexOf('var termScanClaim = null;') !== -1);
  check('SEATFIX the terminal verdict line is labelled as engine time — the pill total is the only scan total',
    appSrc.indexOf('Engine match time: ') !== -1 &&
    appSrc.indexOf("(verified ? 'Verified' : 'Scanned') + ' in '") === -1);
  check('SEATFIX the quick-verify message omits the engine-latency clause so it states one total (the log keeps the full string)',
    appSrc.indexOf('measured.replace(/ Scan latency:') !== -1 &&
    appSrc.indexOf("' Scan latency: '") !== -1);
  check('SEATFIX wallet records freeze before they stamp (stop inserted ahead of the in-flow noteScan calls; v90: 7 sites — the two Send sites left with the flow)',
    (appSrc.match(/scanTimerStop\('w'\); \/\/ v74 \(Seat 1 fix\)/g) || []).length >= 7);
  check('SEATFIX the topup flow snapshots its frozen duration and passes it explicitly to the post-await records',
    appSrc.indexOf('var captureMs = Math.round(ScanTimers.u.elapsedMs());') !== -1 &&
    (appSrc.match(/durationMs: captureMs/g) || []).length >= 6);
  const rereg = sliceBetween(appSrc, 'function runReRegistration', 'function bankReRegistration');
  check('SEATFIX re-registration starts its timer at the confirm action (before the registry lookup)',
    rereg.indexOf("scanTimerStart('u', 'Captured in ')") !== -1 &&
    rereg.indexOf("scanTimerStart('u', 'Captured in ')") < rereg.indexOf("DB.all('people')"));
  const bank = sliceBetween(appSrc, 'function bankReRegistration', 'function wireRereg');
  check('SEATFIX re-registration freezes before its success record stamps',
    bank.indexOf("scanTimerStop('u')") !== -1 &&
    bank.indexOf("scanTimerStop('u')") < bank.indexOf("Sync.noteScan({ kind: 're-register', profileName: person.name"));
})();

/* ================= migration + frozen bars ==================== */
check('MIGRATION the v74 step is a pure adoption: a v73-stamped snapshot opens unchanged under v74',
  (function () {
    const store = {
      people: [{ id: 'TSG-BIO-3001', name: 'Ayesha Rahman', wallet: { balance: 750, statement: [], linkedAccounts: [] }, palmProfile: { v: 4, codes: ['QUJD'] } }],
      logs: [{ ts: 1, result: 'Verified' }], transactions: [{ id: 'BIOM-PAY-1001', amount: 320 }], meta: []
    };
    const before = JSON.stringify(store);
    const mig = B.migrateBiomData(JSON.parse(before), 'v73', 'v74');
    return mig.appliedSteps.join(',') === 'v74' && mig.changed === false && JSON.stringify(mig.snapshot) === before;
  })());
check('FROZEN bars untouched: EDCC 0.32 / PalmNet 0.5895',
  B.PALMPRINT_THRESHOLD === 0.32 && B.PALMNET_THRESHOLD === 0.5895);

console.log(fail === 0
  ? 'ALL V74 SCAN-TIMER TESTS PASSED (' + pass + ')'
  : 'V74 SCAN-TIMER: ' + fail + ' FAILED of ' + (pass + fail));
process.exit(fail === 0 ? 0 : 1);
