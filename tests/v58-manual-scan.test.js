/* TSG BIOM v58 — MANUAL SCAN gate tests.

   The Chairman's order (2026-11-25): scanning must NOT start by
   itself. At v57 every scan view began analysing the moment its
   camera opened — wallet scan card, terminal, enrolment palm
   step, Add Angles top-up — so a palm caught half-positioned
   produced spoof / not-verified verdicts before the customer
   was ready. v58 gates every entry point behind its Scan
   button: entering a view opens the camera preview and ARMS
   the view; no frame is analysed, no verdict can occur and no
   scan record is produced until the tap. After the tap the
   pipelines run exactly as before, and after a verdict the
   view returns to armed instead of re-scanning in a loop.

   What is proven here, at the level the code allows:
   (a) STRUCTURE — every camera-start function contains no call
       to its scan-run function; the Scan buttons are the only
       bindings that reach the run functions; Next Customer
       re-arms without scanning; no auto-start helper remains.
   (b) BEHAVIOUR — the four camera-start functions are extracted
       and run against stub deps: each leaves its run-spy at
       zero calls, enables its Scan button and lands on the
       armed status copy. runWalletScan is extracted with its
       real closure variables: one tap = exactly one judgement
       cycle (one ctx.run), a second tap while busy adds none,
       and after the cycle settles the card is armed again
       (pill back to Ready, a fresh tap runs a fresh cycle).
   (c) The designed mid-scan camera fallback (swap after 18
       analysed frames with no hand, INSIDE a tapped scan) is
       still present — it happens after the tap and stays.
   (d) Version coherence at v58 + the v58 migration step is
       the identity (byte-identical adoption is proven in
       v38-migration.test.js).

   Rig honesty: extracted functions run against stubs, not a
   phone camera. The feel of the flow on the Chairman's phone
   is his verdict, not claimed here. */
'use strict';
const fs = require('fs');
const path = require('path');
const B = require(path.join(__dirname, '..', 'biometrics.js'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); }
}

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

function sliceBetween(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a === -1) return '';
  const b = src.indexOf(endMarker, a + startMarker.length);
  return b === -1 ? src.slice(a) : src.slice(a, b);
}
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) return null;
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return null;
}
function makeEl() {
  return {
    disabled: true, textContent: '', innerHTML: '', value: '',
    classList: { contains: function () { return false; }, add: function () {}, remove: function () {} }
  };
}

/* ---------- (a) structure: no start path reaches a scan ---------- */

const walletStart = sliceBetween(appSrc, 'function startWalletCamera()', 'function runWalletScan()');
check('STRUCT wallet camera start contains NO scan call', walletStart.length > 0 && walletStart.indexOf('runWalletScan()') === -1);
check('STRUCT wallet camera start lands on the armed copy', walletStart.indexOf('position the open palm in the frame, then tap Scan') !== -1);

const termStart = sliceBetween(appSrc, 'function startTermCamera()', "$('termStart').addEventListener");
check('STRUCT terminal camera start contains NO scan call', termStart.length > 0 && termStart.indexOf('runTermScan(') === -1);
check('STRUCT terminal camera start lands on the armed copy', termStart.indexOf('then tap SCAN') !== -1);

const palmStart = sliceBetween(appSrc, 'function startPalmCamera()', 'function maybeArmEnroll()');
check('STRUCT enrol camera start contains NO capture call', palmStart.length > 0 && palmStart.indexOf('runPalmCapture') === -1);
check('STRUCT enrol camera start takes no auto-capture flag', palmStart.indexOf('autoCapture') === -1);
check('STRUCT enrol camera start lands on the armed copy', palmStart.indexOf('then tap Scan Palm') !== -1);

const topStart = sliceBetween(appSrc, 'function startTopupCamera()', 'function runTopupCapture()');
check('STRUCT top-up camera start contains NO capture call', topStart.length > 0 && topStart.indexOf('runTopupCapture(') === -1);
check('STRUCT top-up camera start lands on the armed copy', topStart.indexOf('tap Run Guided Capture') !== -1);

const walletRestarter = sliceBetween(appSrc, 'camRestarters.walletAct = function', "$('wScanStart').addEventListener");
check('STRUCT wallet camera-switch restarter starts NO scan', walletRestarter.length > 0 && walletRestarter.indexOf('runWalletScan(') === -1);
check('STRUCT wallet restarter keeps the v49 freeze line byte-identical',
  walletRestarter.indexOf("$('wScanStatus').textContent = 'Camera blocked.'; });") !== -1 ||
  appSrc.indexOf("$('wScanStatus').textContent = 'Camera blocked.'; });") !== -1);

const termNext = sliceBetween(appSrc, "$('termNext').addEventListener", 'function logVerification');
check('STRUCT Next Customer re-arms WITHOUT scanning', termNext.length > 0 && termNext.indexOf('runTermScan(') === -1);

check('STRUCT no auto-start helper remains anywhere', appSrc.indexOf('maybeAutoStart') === -1);
check('STRUCT no caller passes an auto-capture flag', appSrc.indexOf('startPalmCamera(true)') === -1 && appSrc.indexOf('startPalmCamera(false)') === -1);
check('STRUCT arm-on-entry helpers exist for terminal and enrolment',
  appSrc.indexOf('function maybeArmTerminal()') !== -1 && appSrc.indexOf('function maybeArmEnroll()') !== -1);

/* The Scan buttons are the ONLY bindings that reach a run fn. */
check('BIND wallet Scan button runs the wallet scan', appSrc.indexOf("$('wScanRun').addEventListener('click', runWalletScan)") !== -1);
check('BIND terminal SCAN button runs the terminal scan', appSrc.indexOf("$('termScan').addEventListener('click', runTermScan)") !== -1);
check('BIND enrol Scan Palm button runs the capture', appSrc.indexOf("$('palmCapture').addEventListener('click', runPalmCapture)") !== -1);
check('BIND top-up capture button runs the capture', appSrc.indexOf("$('topCapture').addEventListener('click', runTopupCapture)") !== -1);
check('BIND Start Camera buttons open cameras only',
  appSrc.indexOf("$('wScanStart').addEventListener('click', startWalletCamera)") !== -1 &&
  appSrc.indexOf("$('termStart').addEventListener('click', startTermCamera)") !== -1);

/* HTML: honest copy + the armed pill default. */
check('HTML enrol button is labelled Scan Palm, not Auto-Capture',
  htmlSrc.indexOf('id="palmCapture" disabled>Scan Palm</button>') !== -1 && htmlSrc.indexOf('Auto-Capture Palm') === -1);
check('HTML enrol copy no longer claims the camera starts by itself',
  htmlSrc.indexOf('The camera starts by itself when this step opens') === -1 &&
  htmlSrc.indexOf('nothing is captured until you tap') !== -1);
check('HTML terminal copy no longer claims the scan starts by itself',
  htmlSrc.indexOf('the camera and the scan then start by themselves') === -1 &&
  htmlSrc.indexOf('nothing is scanned until the tap') !== -1);
check('HTML wallet pill starts at Ready (armed), driven by wScanPillText',
  htmlSrc.indexOf('id="wScanPillText">Ready</span>') !== -1);

/* ---------- (c) the mid-scan fallback stays ---------- */
check('FALLBACK mid-scan camera swap after 18 analysed frames is untouched (verify + identify + enrol watch)',
  (appSrc.match(/analysed >= 18/g) || []).length === 2 && appSrc.indexOf('watchFrames >= 18') !== -1);

/* ---------- (d) version coherence ---------- */
const appVer = (appSrc.match(/APP_DATA_VERSION = '(v\d+)'/) || [])[1];
/* v59 pin conversion (named, per the v55/v56/v57 precedent):
   this check pinned v58 absolutely; from v59 it is a COHERENCE
   check — app version, shell and newest chain link agree,
   whatever the current version is. The v58-specific facts
   (the step exists and is the identity) stay pinned below. */
check('VERSION app data version, shell and newest migration link agree (coherence form since v59)',
  !!appVer && swSrc.indexOf('tsg-biom-shell-' + appVer) !== -1 &&
  B.BIOM_DATA_VERSIONS[B.BIOM_DATA_VERSIONS.length - 1] === appVer);
const mig58probeSrc = '{"people":[],"logs":[],"transactions":[],"meta":[]}';
const mig58probe = B.migrateBiomData(JSON.parse(mig58probeSrc), 'v57', 'v58');
check('VERSION v58 migration step is the identity (applies, changes nothing)',
  mig58probe.appliedSteps.indexOf('v58') !== -1 && mig58probe.changed === false &&
  JSON.stringify(mig58probe.snapshot) === mig58probeSrc);

/* ---------- (b) behaviour: extracted camera starts arm only ---------- */

async function behaviour() {
  const camOk = { start: function () { return Promise.resolve(); } };
  const pipe = { enterScanView: function () {} };
  const errHTML = function () { return ''; };

  /* wallet */
  {
    const els = { wScanVideo: makeEl(), wScanRun: makeEl(), wScanStatus: makeEl(), wScanMsg: makeEl() };
    let runs = 0;
    const fn = new Function('Cam', '$', 'Pipeline', 'camFacing', 'runWalletScan', 'cameraErrorHTML',
      'return (' + extractFn(appSrc, 'startWalletCamera') + ');')(
      camOk, function (id) { return els[id]; }, pipe, { walletAct: 'user' },
      function () { runs++; }, errHTML);
    await fn();
    check('BEHAVIOUR wallet camera opens ARMED: no scan ran', runs === 0);
    check('BEHAVIOUR wallet Scan button enabled while armed', els.wScanRun.disabled === false);
    check('BEHAVIOUR wallet armed status copy shown', els.wScanStatus.textContent === 'Camera on — position the open palm in the frame, then tap Scan.', els.wScanStatus.textContent);
  }
  /* terminal */
  {
    const els = { termVideo: makeEl(), termScan: makeEl(), termStatus: makeEl(), termResult: makeEl(), termPerson: makeEl() };
    els.termPerson.value = 'p1';
    let runs = 0;
    const camTerm = { start: function () { return Promise.resolve(); }, stop: function () {} };
    const fn = new Function('Cam', '$', 'Pipeline', 'camFacing', 'termFacingKey', 'getTerminalPerson', 'personHasMethod', 'notEnrolledMessage', 'cameraErrorHTML', 'runTermScan',
      'return (' + extractFn(appSrc, 'startTermCamera') + ');')(
      camTerm, function (id) { return els[id]; }, pipe, { terminal: 'user' },
      function () { return 'terminal'; },
      function () { return Promise.resolve({ id: 'p1' }); },
      function () { return true; }, function () { return ''; }, errHTML,
      function () { runs++; });
    fn();
    await new Promise(function (r) { setTimeout(r, 0); });
    await new Promise(function (r) { setTimeout(r, 0); });
    check('BEHAVIOUR terminal camera opens ARMED: no scan ran', runs === 0);
    check('BEHAVIOUR terminal SCAN button enabled while armed', els.termScan.disabled === false);
    check('BEHAVIOUR terminal armed status copy shown', els.termStatus.textContent === 'Camera on — the customer positions an open palm in the frame, anywhere in view, then tap SCAN.', els.termStatus.textContent);
  }
  /* enrolment */
  {
    const els = { palmVideo: makeEl(), palmCapture: makeEl(), palmStatus: makeEl(), palmMsg: makeEl() };
    let runs = 0;
    const fn = new Function('Cam', '$', 'Pipeline', 'camFacing', 'runPalmCapture', 'cameraErrorHTML',
      'return (' + extractFn(appSrc, 'startPalmCamera') + ');')(
      camOk, function (id) { return els[id]; }, pipe, { enrollPalm: 'user' },
      function () { runs++; }, errHTML);
    await fn();
    check('BEHAVIOUR enrol camera opens ARMED: no capture ran', runs === 0);
    check('BEHAVIOUR enrol Scan Palm button enabled while armed', els.palmCapture.disabled === false);
    check('BEHAVIOUR enrol armed status copy shown', els.palmStatus.textContent.indexOf('then tap Scan Palm') !== -1, els.palmStatus.textContent);
  }
  /* top-up */
  {
    const els = { topVideo: makeEl(), topCapture: makeEl(), topStatus: makeEl(), topMsg: makeEl() };
    let runs = 0;
    const fn = new Function('Cam', '$', 'Pipeline', 'camFacing', 'syncCamToggle', 'syncFlashToggle', 'runTopupCapture', 'cameraErrorHTML',
      'return (' + extractFn(appSrc, 'startTopupCamera') + ');')(
      camOk, function (id) { return els[id]; }, pipe, { topup: 'user' },
      function () {}, function () {}, function () { runs++; }, errHTML);
    await fn();
    check('BEHAVIOUR top-up camera opens ARMED: no capture ran', runs === 0);
    check('BEHAVIOUR top-up capture button enabled while armed', els.topCapture.disabled === false);
    check('BEHAVIOUR top-up armed status copy shown', els.topStatus.textContent === 'Camera on — position the open palm in the frame, then tap Run Guided Capture.', els.topStatus.textContent);
  }

  /* runWalletScan with its real closure variables (direct eval so
     the busy flag is genuinely shared across taps). */
  {
    let palmScanBusy = false;
    let walletScanCtx = null;
    let walletControl = null;
    let verdicts = 0;
    const pillTexts = [];
    const els = {
      wScanRun: { disabled: false },
      walletScanCard: { classList: { contains: function () { return false; } } }
    };
    const $ = function (id) { return els[id]; };
    const setScanPill = function (t) { pillTexts.push(t); };
    const walletSession = { verdict: function () { verdicts++; }, frame: function () { return {}; } };
    const walletScanFailed = function () {};
    const updateScanIndicators = function () {};
    const runWalletScan = eval('(' + extractFn(appSrc, 'runWalletScan') + ')');
    const tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

    let runCalls = 0, release = null;
    walletScanCtx = { run: function () { runCalls++; return new Promise(function (res) { release = res; }); } };

    runWalletScan();            /* tap 1 */
    await tick();
    check('BEHAVIOUR one tap arms exactly one judgement cycle', runCalls === 1, 'runCalls=' + runCalls);
    runWalletScan();            /* tap 2 while busy */
    await tick();
    check('BEHAVIOUR a second tap while scanning adds NO cycle', runCalls === 1, 'runCalls=' + runCalls);
    release();                  /* the judged scan settles */
    await tick(); await tick();
    check('BEHAVIOUR after the verdict the session closes exactly once', verdicts === 1, 'verdicts=' + verdicts);
    check('BEHAVIOUR the pill returns to Ready (armed) after the verdict',
      pillTexts.join(',') === 'Scanning,Ready', pillTexts.join(','));
    runWalletScan();            /* tap 3 — a fresh cycle from armed */
    await tick();
    check('BEHAVIOUR a fresh tap from armed runs a fresh cycle', runCalls === 2, 'runCalls=' + runCalls);
    release();
    await tick(); await tick();
    walletScanCtx = null;
    runWalletScan();            /* no context: nothing can run */
    await tick();
    check('BEHAVIOUR with no scan context a tap runs nothing', runCalls === 2, 'runCalls=' + runCalls);
  }
}

behaviour().then(function () {
  console.log(fail === 0 ? 'ALL v58 MANUAL-SCAN TESTS PASSED (' + pass + ')' : fail + ' FAILURES, ' + pass + ' passed');
  process.exit(fail === 0 ? 0 : 1);
}).catch(function (e) {
  console.log('ERROR ' + (e && e.stack || e));
  process.exit(1);
});
